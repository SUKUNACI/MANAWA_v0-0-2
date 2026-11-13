/**
 * 2FA Authentication Tests
 * Tests TOTP setup, verification, backup codes, and management
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/db');
const twoFAUtils = require('../../utils/2fa');
const twoFAConfig = require('../../config/2fa');

// Mock app setup
let app;

describe('2FA Authentication Routes', () => {
  let testUser;
  let authToken;

  beforeAll(() => {
    // Initialize app
    app = require('../../index');
  });

  beforeEach(async () => {
    // Create test user
    testUser = await prisma.user.create({
      data: {
        id: uuidv4(),
        email: 'test2fa@example.com',
        passwordHash: await require('bcryptjs').hash('TestPassword123!', 10),
        firstName: 'Test',
        lastName: 'User',
        role: 'CLIENT',
      },
    });

    // Generate auth token
    authToken = jwt.sign(
      {
        id: testUser.id,
        role: testUser.role,
        email: testUser.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
  });

  afterEach(async () => {
    // Cleanup
    await prisma.user.deleteMany({
      where: { email: 'test2fa@example.com' },
    });
  });

  describe('POST /api/v1/auth/2fa/setup', () => {
    test('should return setup token, QR code, and backup codes', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('setupToken');
      expect(response.body).toHaveProperty('qrCode');
      expect(response.body).toHaveProperty('backupCodes');
      expect(response.body.backupCodes).toHaveLength(10);
      expect(response.body.message).toContain('Scannez le code QR');
    });

    test('should fail if 2FA is already enabled', async () => {
      // First enable 2FA
      const user = await prisma.user.update({
        where: { id: testUser.id },
        data: { twoFAEnabled: true, twoFASecret: 'test-secret' },
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('déjà activé');
    });

    test('should fail without authentication', async () => {
      const response = await request(app).post('/api/v1/auth/2fa/setup');

      expect(response.status).toBe(401);
    });

    test('should generate valid backup codes', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      const { backupCodes } = response.body;

      backupCodes.forEach((code) => {
        expect(code).toMatch(/^\d{8}$/);
      });
    });
  });

  describe('POST /api/v1/auth/2fa/enable', () => {
    test('should enable 2FA with valid TOTP code', async () => {
      // Setup first
      const setupResponse = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${authToken}`);

      expect(setupResponse.status).toBe(200);
      const { setupToken, backupCodes } = setupResponse.body;

      // Decode setup token to get secret
      const decoded = jwt.decode(setupToken);
      const { secret, hashedBackupCodes } = decoded;

      // Generate valid TOTP code
      const totpCode = twoFAConfig.generateSecret
        ? require('speakeasy').totp({
            secret,
            encoding: 'base32',
          })
        : '000000'; // Fallback

      const enableResponse = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          setupToken,
          totpCode,
        });

      expect(enableResponse.status).toBe(201);
      expect(enableResponse.body.message).toContain('activé');
      expect(enableResponse.body.user.twoFAEnabled).toBe(true);
    });

    test('should fail with invalid TOTP code', async () => {
      // Setup first
      const setupResponse = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${authToken}`);

      const { setupToken } = setupResponse.body;

      const enableResponse = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          setupToken,
          totpCode: '000000',
        });

      expect(enableResponse.status).toBe(401);
      expect(enableResponse.body.error).toContain('invalide');
    });

    test('should fail with expired setup token', async () => {
      const expiredToken = jwt.sign(
        {
          userId: testUser.id,
          secret: 'test-secret',
          hashedBackupCodes: {},
          type: '2fa_setup',
        },
        process.env.JWT_SECRET,
        { expiresIn: '0s' }
      );

      // Wait a moment
      await new Promise((r) => setTimeout(r, 100));

      const enableResponse = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          setupToken: expiredToken,
          totpCode: '000000',
        });

      expect(enableResponse.status).toBe(401);
      expect(enableResponse.body.error).toContain('expiré');
    });
  });

  describe('POST /api/v1/auth/2fa/verify', () => {
    beforeEach(async () => {
      // Setup 2FA for test user
      const { backupCodes, hashedBackupCodes } = await twoFAUtils.regenerateBackupCodes();
      const { secret } = await twoFAUtils.setup2FA(testUser.email);

      testUser = await prisma.user.update({
        where: { id: testUser.id },
        data: {
          twoFAEnabled: true,
          twoFASecret: secret,
          twoFABackupCodes: hashedBackupCodes,
          twoFAEnabledAt: new Date(),
        },
      });
    });

    test('should verify valid TOTP code', async () => {
      const totpCode = require('speakeasy').totp({
        secret: testUser.twoFASecret,
        encoding: 'base32',
        time: Math.floor(Date.now() / 1000 / 30),
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({
          userId: testUser.id,
          totpCode,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.message).toContain('réussie');
    });

    test('should reject invalid TOTP code', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({
          userId: testUser.id,
          totpCode: '000000',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('invalide');
    });

    test('should accept valid backup code', async () => {
      const backupCodes = twoFAConfig.generateBackupCodes();
      const hashedBackupCodes = twoFAConfig.hashBackupCodes(backupCodes);

      await prisma.user.update({
        where: { id: testUser.id },
        data: { twoFABackupCodes: hashedBackupCodes },
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({
          userId: testUser.id,
          backupCode: backupCodes[0],
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
    });

    test('should mark backup code as used', async () => {
      const backupCodes = twoFAConfig.generateBackupCodes();
      const hashedBackupCodes = twoFAConfig.hashBackupCodes(backupCodes);

      await prisma.user.update({
        where: { id: testUser.id },
        data: { twoFABackupCodes: hashedBackupCodes },
      });

      // Use backup code
      await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({
          userId: testUser.id,
          backupCode: backupCodes[0],
        });

      // Try to use same code again
      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({
          userId: testUser.id,
          backupCode: backupCodes[0],
        });

      expect(response.status).toBe(401);
    });

    test('should fail if 2FA not enabled', async () => {
      const user = await prisma.user.create({
        data: {
          id: 'test-user-no-2fa',
          email: 'test-no-2fa@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
          role: 'CLIENT',
          twoFAEnabled: false,
        },
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({
          userId: user.id,
          totpCode: '000000',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('non activé');

      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('POST /api/v1/auth/2fa/backup-codes', () => {
    beforeEach(async () => {
      const { secret, hashedBackupCodes } = await twoFAUtils.setup2FA(testUser.email);

      testUser = await prisma.user.update({
        where: { id: testUser.id },
        data: {
          twoFAEnabled: true,
          twoFASecret: secret,
          twoFABackupCodes: hashedBackupCodes,
          twoFAEnabledAt: new Date(),
        },
      });

      authToken = jwt.sign(
        {
          id: testUser.id,
          role: testUser.role,
          email: testUser.email,
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );
    });

    test('should regenerate backup codes with valid TOTP', async () => {
      const totpCode = require('speakeasy').totp({
        secret: testUser.twoFASecret,
        encoding: 'base32',
        time: Math.floor(Date.now() / 1000 / 30),
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ totpCode });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('backupCodes');
      expect(response.body.backupCodes).toHaveLength(10);
      expect(response.body.message).toContain('régénérés');
    });

    test('should fail with invalid TOTP', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ totpCode: '000000' });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('invalide');
    });

    test('should fail without 2FA enabled', async () => {
      const user = await prisma.user.create({
        data: {
          id: 'test-user-no-2fa-2',
          email: 'test-no-2fa-2@example.com',
          passwordHash: 'hash',
          firstName: 'Test',
          lastName: 'User',
          role: 'CLIENT',
        },
      });

      const userToken = jwt.sign(
        {
          id: user.id,
          role: user.role,
          email: user.email,
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ totpCode: '000000' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('non activé');

      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('POST /api/v1/auth/2fa/disable', () => {
    beforeEach(async () => {
      const { secret, hashedBackupCodes } = await twoFAUtils.setup2FA(testUser.email);

      testUser = await prisma.user.update({
        where: { id: testUser.id },
        data: {
          twoFAEnabled: true,
          twoFASecret: secret,
          twoFABackupCodes: hashedBackupCodes,
          twoFAEnabledAt: new Date(),
        },
      });

      authToken = jwt.sign(
        {
          id: testUser.id,
          role: testUser.role,
          email: testUser.email,
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );
    });

    test('should disable 2FA with valid password and TOTP', async () => {
      const password = 'TestPassword123!';
      const totpCode = require('speakeasy').totp({
        secret: testUser.twoFASecret,
        encoding: 'base32',
        time: Math.floor(Date.now() / 1000 / 30),
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          password,
          totpCode,
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('désactivé');

      const updated = await prisma.user.findUnique({
        where: { id: testUser.id },
      });
      expect(updated.twoFAEnabled).toBe(false);
      expect(updated.twoFASecret).toBeNull();
    });

    test('should fail with wrong password', async () => {
      const totpCode = require('speakeasy').totp({
        secret: testUser.twoFASecret,
        encoding: 'base32',
        time: Math.floor(Date.now() / 1000 / 30),
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          password: 'WrongPassword123!',
          totpCode,
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('mot de passe');
    });

    test('should fail with invalid TOTP', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          password: 'TestPassword123!',
          totpCode: '000000',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('invalide');
    });
  });

  describe('GET /api/v1/auth/2fa/status', () => {
    test('should return 2FA status when enabled', async () => {
      const { secret, hashedBackupCodes } = await twoFAUtils.setup2FA(testUser.email);

      await prisma.user.update({
        where: { id: testUser.id },
        data: {
          twoFAEnabled: true,
          twoFASecret: secret,
          twoFABackupCodes: hashedBackupCodes,
          twoFAEnabledAt: new Date(),
        },
      });

      const response = await request(app)
        .get('/api/v1/auth/2fa/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.body).toHaveProperty('enabledAt');
      expect(response.body).toHaveProperty('backupCodesRemaining');
    });

    test('should return false when 2FA disabled', async () => {
      const response = await request(app)
        .get('/api/v1/auth/2fa/status')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
      expect(response.body.backupCodesRemaining).toBe(0);
    });

    test('should fail without authentication', async () => {
      const response = await request(app).get('/api/v1/auth/2fa/status');

      expect(response.status).toBe(401);
    });
  });
});

describe('2FA Utilities', () => {
  describe('setup2FA', () => {
    test('should generate secret and backup codes', async () => {
      const result = await twoFAUtils.setup2FA('test@example.com');

      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('qrCode');
      expect(result).toHaveProperty('backupCodes');
      expect(result).toHaveProperty('hashedBackupCodes');
      expect(result.backupCodes).toHaveLength(10);
      expect(result.qrCode).toContain('data:image');
    });
  });

  describe('verify2FAToken', () => {
    test('should verify valid TOTP token', () => {
      const secret = require('speakeasy').generateSecret({ length: 32 }).base32;
      const token = require('speakeasy').totp({
        secret,
        encoding: 'base32',
        time: Math.floor(Date.now() / 1000 / 30),
      });

      const result = twoFAUtils.verify2FAToken(token, secret);
      expect(result).toBe(true);
    });

    test('should reject invalid TOTP token', () => {
      const secret = require('speakeasy').generateSecret({ length: 32 }).base32;
      const result = twoFAUtils.verify2FAToken('000000', secret);
      expect(result).toBe(false);
    });
  });

  describe('backup codes', () => {
    test('should generate and verify backup codes', async () => {
      const { backupCodes, hashedBackupCodes } = await twoFAUtils.regenerateBackupCodes();

      expect(backupCodes).toHaveLength(10);
      expect(twoFAUtils.verifyBackupCode(backupCodes[0], hashedBackupCodes)).toBe(true);
    });

    test('should mark backup code as used', async () => {
      const { backupCodes, hashedBackupCodes } = await twoFAUtils.regenerateBackupCodes();

      const updated = twoFAUtils.useBackupCode(backupCodes[0], hashedBackupCodes);
      expect(twoFAUtils.verifyBackupCode(backupCodes[0], updated)).toBe(false);
    });

    test('should count remaining backup codes', async () => {
      const { backupCodes, hashedBackupCodes } = await twoFAUtils.regenerateBackupCodes();

      expect(twoFAUtils.getRemainingBackupCodes(hashedBackupCodes)).toBe(10);

      const updated = twoFAUtils.useBackupCode(backupCodes[0], hashedBackupCodes);
      expect(twoFAUtils.getRemainingBackupCodes(updated)).toBe(9);
    });
  });
});
