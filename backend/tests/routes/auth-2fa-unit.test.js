/**
 * Unit tests for auth-2fa routes — fully mocked (no real DB needed)
 * Tests all endpoints with prisma and utils mocked.
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// --- Mocks ---
jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
  },
}));

jest.mock('../../utils/2fa', () => ({
  setup2FA: jest.fn(),
  verify2FAToken: jest.fn(),
  verifyBackupCode: jest.fn(),
  useBackupCode: jest.fn(),
  getRemainingBackupCodes: jest.fn(),
  regenerateBackupCodes: jest.fn(),
}));

jest.mock('../../config/2fa', () => ({
  BACKUP_CODES_CONFIG: { count: 10 },
  generateBackupCodes: jest.fn(() => ['12345678', '87654321']),
  hashBackupCodes: jest.fn((codes) => Object.fromEntries(codes.map(c => [c, false]))),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn(() => ({})),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn(() => []),
}));

// Mock requireAuth middleware
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const jwtLib = require('jsonwebtoken');
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Non authentifié' });
    try {
      req.user = jwtLib.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token invalide' });
    }
  },
}));

const prisma = require('../../config/db');
const twoFAUtils = require('../../utils/2fa');
const twoFAConfig = require('../../config/2fa');
const auth2FARouter = require('../../routes/auth-2fa');

const app = express();
app.use(express.json());
app.use('/api/v1/auth/2fa', auth2FARouter);

function makeToken(payload = {}) {
  return jwt.sign(
    { id: 'user-123', role: 'CLIENT', email: 'test@example.com', ...payload },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

const TEST_USER_ID = 'user-123';
const TOKEN = makeToken({ id: TEST_USER_ID });

describe('POST /api/v1/auth/2fa/setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return 401 without authentication token', async () => {
    const res = await request(app).post('/api/v1/auth/2fa/setup');
    expect(res.status).toBe(401);
  });

  test('should return 404 if user not found in DB', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(404);
  });

  test('should return 400 if 2FA is already enabled', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      email: 'test@example.com',
      twoFAEnabled: true,
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('déjà activé');
  });

  test('should return 200 with setupToken, qrCode, backupCodes on success', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      email: 'test@example.com',
      twoFAEnabled: false,
    });

    twoFAUtils.setup2FA.mockResolvedValue({
      secret: 'TEST_SECRET_BASE32',
      qrCode: 'data:image/png;base64,abc123',
      backupCodes: ['12345678', '87654321', '11111111', '22222222', '33333333', '44444444', '55555555', '66666666', '77777777', '88888888'],
      hashedBackupCodes: {},
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('setupToken');
    expect(res.body).toHaveProperty('qrCode');
    expect(res.body).toHaveProperty('backupCodes');
    expect(res.body.message).toContain('Scannez');
  });

  test('should return 500 if setup2FA throws', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      email: 'test@example.com',
      twoFAEnabled: false,
    });
    twoFAUtils.setup2FA.mockRejectedValue(new Error('QR generation failed'));

    const res = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SETUP_ERROR');
  });
});

describe('POST /api/v1/auth/2fa/enable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return 401 without authentication token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .send({ setupToken: 'tok', totpCode: '123456' });

    expect(res.status).toBe(401);
  });

  test('should return 400 if setupToken or totpCode is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('should return 401 if setupToken is invalid JWT', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ setupToken: 'invalid-token', totpCode: '123456' });

    expect(res.status).toBe(401);
  });

  test('should return 403 if setupToken type is wrong or userId mismatch', async () => {
    const badSetupToken = jwt.sign(
      { userId: 'other-user', secret: 'SEC', type: '2fa_setup', hashedBackupCodes: {} },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    const res = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ setupToken: badSetupToken, totpCode: '123456' });

    expect(res.status).toBe(403);
  });

  test('should return 401 if TOTP code is invalid', async () => {
    const setupToken = jwt.sign(
      { userId: TEST_USER_ID, secret: 'TEST_SECRET', type: '2fa_setup', hashedBackupCodes: {} },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    twoFAUtils.verify2FAToken.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ setupToken, totpCode: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('invalide');
  });

  test('should return 201 and enable 2FA with valid TOTP', async () => {
    const setupToken = jwt.sign(
      { userId: TEST_USER_ID, secret: 'TEST_SECRET', type: '2fa_setup', hashedBackupCodes: {} },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    twoFAUtils.verify2FAToken.mockReturnValue(true);
    prisma.user.update.mockResolvedValue({
      id: TEST_USER_ID,
      email: 'test@example.com',
      twoFAEnabled: true,
      twoFAEnabledAt: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ setupToken, totpCode: '123456' });

    expect(res.status).toBe(201);
    expect(res.body.message).toContain('activé');
    expect(res.body.user.twoFAEnabled).toBe(true);
  });

  test('should return 401 if setupToken is expired', async () => {
    const expiredToken = jwt.sign(
      { userId: TEST_USER_ID, secret: 'TEST_SECRET', type: '2fa_setup', hashedBackupCodes: {} },
      process.env.JWT_SECRET,
      { expiresIn: '0s' }
    );

    await new Promise(r => setTimeout(r, 50));

    const res = await request(app)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ setupToken: expiredToken, totpCode: '123456' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/2fa/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return 400 if userId is not a valid UUID', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ userId: 'not-a-uuid', totpCode: '123456' });

    expect(res.status).toBe(400);
  });

  test('should return 404 if user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ userId: uuidv4(), totpCode: '123456' });

    expect(res.status).toBe(404);
  });

  test('should return 400 if 2FA not enabled for user', async () => {
    const userId = uuidv4();
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'test@example.com',
      role: 'CLIENT',
      twoFAEnabled: false,
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ userId, totpCode: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('non activé');
  });

  test('should return 400 if neither totpCode nor backupCode provided', async () => {
    const userId = uuidv4();
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'test@example.com',
      role: 'CLIENT',
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
      twoFABackupCodes: {},
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ userId });

    expect(res.status).toBe(400);
  });

  test('should return 401 if TOTP code is invalid', async () => {
    const userId = uuidv4();
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'test@example.com',
      role: 'CLIENT',
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
      twoFABackupCodes: {},
    });
    twoFAUtils.verify2FAToken.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ userId, totpCode: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('invalide');
  });

  test('should return 200 with token and refreshToken on valid TOTP', async () => {
    const userId = uuidv4();
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'test@example.com',
      role: 'CLIENT',
      adminLevel: null,
      adminPermissions: null,
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
      twoFABackupCodes: {},
    });
    twoFAUtils.verify2FAToken.mockReturnValue(true);
    twoFAUtils.getRemainingBackupCodes.mockReturnValue(10);
    prisma.user.update.mockResolvedValue({ id: userId, lastLoginAt: new Date() });
    prisma.refreshToken.create.mockResolvedValue({ token: 'refresh-tok', userId });

    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ userId, totpCode: '123456' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.message).toContain('réussie');
  });

  test('should return 401 if backup code is invalid', async () => {
    const userId = uuidv4();
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'test@example.com',
      role: 'CLIENT',
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
      twoFABackupCodes: {},
    });
    twoFAUtils.verifyBackupCode.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ userId, backupCode: 'wrongcode' });

    expect(res.status).toBe(401);
  });

  test('should accept valid backup code and mark it as used', async () => {
    const userId = uuidv4();
    const backupCodes = { 'hashofcode': false };

    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'test@example.com',
      role: 'CLIENT',
      adminLevel: null,
      adminPermissions: null,
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
      twoFABackupCodes: backupCodes,
    });
    twoFAUtils.verifyBackupCode.mockReturnValue(true);
    twoFAUtils.useBackupCode.mockReturnValue({ 'hashofcode': true });
    twoFAUtils.getRemainingBackupCodes.mockReturnValue(9);
    prisma.user.update.mockResolvedValue({ id: userId, lastLoginAt: new Date() });
    prisma.refreshToken.create.mockResolvedValue({ token: 'refresh-tok', userId });

    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ userId, backupCode: 'validcode' });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ twoFABackupCodes: { 'hashofcode': true } }),
      })
    );
  });
});

describe('POST /api/v1/auth/2fa/backup-codes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .send({ totpCode: '123456' });

    expect(res.status).toBe(401);
  });

  test('should return 400 if totpCode is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('should return 400 if 2FA not enabled', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      twoFAEnabled: false,
      twoFASecret: null,
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ totpCode: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('non activé');
  });

  test('should return 401 if TOTP is invalid', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
      twoFABackupCodes: {},
    });
    twoFAUtils.verify2FAToken.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ totpCode: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('invalide');
  });

  test('should return 200 with new backup codes on valid TOTP', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
      twoFABackupCodes: {},
    });
    twoFAUtils.verify2FAToken.mockReturnValue(true);
    twoFAUtils.regenerateBackupCodes.mockResolvedValue({
      backupCodes: Array.from({ length: 10 }, () => Math.random().toString().slice(2, 10)),
      hashedBackupCodes: {},
    });
    prisma.user.update.mockResolvedValue({ id: TEST_USER_ID });

    const res = await request(app)
      .post('/api/v1/auth/2fa/backup-codes')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ totpCode: '123456' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('backupCodes');
    expect(res.body.message).toContain('régénérés');
  });
});

describe('POST /api/v1/auth/2fa/disable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .send({ password: 'pass', totpCode: '123456' });

    expect(res.status).toBe(401);
  });

  test('should return 400 if password or totpCode is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('should return 404 if user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ password: 'pass', totpCode: '123456' });

    expect(res.status).toBe(404);
  });

  test('should return 400 if 2FA is not enabled', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      passwordHash: '$2a$10$placeholder',
      twoFAEnabled: false,
      twoFASecret: null,
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ password: 'pass', totpCode: '123456' });

    expect(res.status).toBe(400);
  });

  test('should return 401 if password is incorrect', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);

    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      passwordHash: hash,
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ password: 'wrong-password', totpCode: '123456' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Mot de passe');
  });

  test('should return 401 if TOTP is invalid', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);

    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      passwordHash: hash,
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
    });
    twoFAUtils.verify2FAToken.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ password: 'correct-password', totpCode: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('invalide');
  });

  test('should return 200 and disable 2FA on valid credentials', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 1);

    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      passwordHash: hash,
      twoFAEnabled: true,
      twoFASecret: 'SECRET',
    });
    twoFAUtils.verify2FAToken.mockReturnValue(true);
    prisma.user.update.mockResolvedValue({
      id: TEST_USER_ID,
      email: 'test@example.com',
      twoFAEnabled: false,
    });

    const res = await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ password: 'correct-password', totpCode: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('désactivé');
  });
});

describe('GET /api/v1/auth/2fa/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/v1/auth/2fa/status');
    expect(res.status).toBe(401);
  });

  test('should return 404 if user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/auth/2fa/status')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(404);
  });

  test('should return enabled: false when 2FA is disabled', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      email: 'test@example.com',
      twoFAEnabled: false,
      twoFAEnabledAt: null,
      twoFABackupCodes: null,
    });

    const res = await request(app)
      .get('/api/v1/auth/2fa/status')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.backupCodesRemaining).toBe(0);
  });

  test('should return enabled: true with backupCodesRemaining when 2FA is enabled', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: TEST_USER_ID,
      email: 'test@example.com',
      twoFAEnabled: true,
      twoFAEnabledAt: new Date(),
      twoFABackupCodes: {},
    });
    twoFAUtils.getRemainingBackupCodes.mockReturnValue(8);

    const res = await request(app)
      .get('/api/v1/auth/2fa/status')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.backupCodesRemaining).toBe(8);
    expect(res.body).toHaveProperty('enabledAt');
  });

  test('should return 500 if DB throws', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/v1/auth/2fa/status')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('STATUS_ERROR');
  });
});
