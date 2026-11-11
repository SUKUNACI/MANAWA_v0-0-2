const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test@Manawa2024!';

// Mock Prisma avant tout import de route
jest.mock('../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  professional: {
    create: jest.fn(),
  },
  verificationCode: {
    findFirst: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  refreshToken: {
    create:     jest.fn().mockResolvedValue({ token: 'mock-refresh-token' }),
    findUnique: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete:     jest.fn(),
  },
  adminLog: {
    create: jest.fn(),
  },
}));

const prisma = require('../config/db');
const authRoutes = require('../routes/auth');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);

// ─── REGISTER ────────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(null); // email dispo par défaut
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'test@manawa.com',
      firstName: 'Jean',
      lastName: 'Dupont',
      role: 'CLIENT',
      phone: null,
      city: null,
      avatarUrl: null,
      emailVerified: false,
      phoneVerified: false,
      createdAt: new Date(),
    });
  });

  test('crée un compte CLIENT avec les champs requis', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@manawa.com',
        password: TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe('test@manawa.com');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  test('retourne 409 si email déjà utilisé', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'exist@manawa.com',
        password: TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/déjà utilisé/i);
  });

  test('retourne 400 si email invalide', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'pasunemail',
        password: TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('errors');
  });

  test('retourne 400 si mot de passe trop court', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@manawa.com',
        password: '123',
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      });

    expect(res.status).toBe(400);
  });

  test('retourne 400 si role invalide', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@manawa.com',
        password: TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'ADMIN',
      });

    expect(res.status).toBe(400);
  });

  test('crée un compte PROFESSIONAL', async () => {
    prisma.professional = { create: jest.fn().mockResolvedValue({ id: 'pro-1' }) };
    prisma.user.create.mockResolvedValue({
      id: 'user-2',
      email: 'pro@manawa.com',
      firstName: 'Marie',
      lastName: 'Martin',
      role: 'PROFESSIONAL',
      phone: null,
      city: null,
      avatarUrl: null,
      emailVerified: false,
      phoneVerified: false,
      createdAt: new Date(),
      professional: { id: 'pro-1', trade: 'Maçon', trades: [] },
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'pro@manawa.com',
        password: TEST_PASSWORD,
        firstName: 'Marie',
        lastName: 'Martin',
        role: 'PROFESSIONAL',
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
  });
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  const hashedPassword = bcrypt.hashSync(TEST_PASSWORD, 10);

  beforeEach(() => {
    const mockUser = {
      id: 'user-1',
      email: 'test@manawa.com',
      passwordHash: hashedPassword,
      role: 'CLIENT',
      suspended: false,
      deletedAt: null,
      firstName: 'Jean',
      lastName: 'Dupont',
      phone: null,
      city: null,
      avatarUrl: null,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    };
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.findFirst.mockResolvedValue(mockUser);
  });

  test('retourne un token avec les bons identifiants', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe('test@manawa.com');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  test('retourne 401 si mot de passe incorrect', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: 'mauvais' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('retourne 401 si email introuvable', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });

  test('retourne 403 si compte suspendu', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@manawa.com',
      passwordHash: hashedPassword,
      role: 'CLIENT',
      suspended: true,
      deletedAt: null,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspendu/i);
  });

  test('retourne 403 si compte supprimé', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'test@manawa.com',
      passwordHash: hashedPassword,
      role: 'CLIENT',
      suspended: false,
      deletedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/supprimé/i);
  });

  test('retourne 400 si email manquant', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });
});

// ─── ADMIN SESSION ────────────────────────────────────────────────────────────

describe('POST /api/auth/admin-session', () => {
  const jwt = require('jsonwebtoken');
  let adminToken;

  beforeEach(() => {
    // Create a valid JWT token for admin
    adminToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@manawa.com' },
      process.env.JWT_SECRET || 'test-secret'
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@manawa.com',
      role: 'ADMIN',
      adminLevel: 'SUPER',
      adminPermissions: null,
    });

    prisma.user.update.mockResolvedValue({
      id: 'admin-1',
      lastLoginAt: new Date(),
    });
  });

  test('retourne user, token et csrfToken pour un admin valide', async () => {
    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: adminToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('csrfToken');
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.user.email).toBe('admin@manawa.com');
  });

  test('retourne 403 si le token n\'est pas un admin', async () => {
    const userToken = jwt.sign(
      { id: 'user-1', role: 'CLIENT', email: 'user@manawa.com' },
      process.env.JWT_SECRET || 'test-secret'
    );

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: userToken });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/refusé/i);
  });

  test('retourne 400 si token manquant', async () => {
    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requis/i);
  });

  test('retourne 401 si token invalide', async () => {
    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('setie un cookie adminToken httpOnly', async () => {
    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: adminToken });

    expect(res.headers['set-cookie']).toBeDefined();
    const adminCookies = res.headers['set-cookie'].filter(c => c.includes('adminToken'));
    expect(adminCookies.length).toBeGreaterThan(0);
    expect(adminCookies[0]).toMatch(/HttpOnly/i);
  });
});

// ─── ADMIN SESSION GET ────────────────────────────────────────────────────────

describe('GET /api/auth/admin-session', () => {
  const jwt = require('jsonwebtoken');
  let adminToken;

  beforeEach(() => {
    adminToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@manawa.com' },
      process.env.JWT_SECRET || 'test-secret'
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@manawa.com',
      role: 'ADMIN',
      adminLevel: 'SUPER',
      adminPermissions: null,
    });
  });

  test('vérifie la session admin et retourne user et token', async () => {
    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.role).toBe('ADMIN');
  });

  test('retourne 401 si adminToken cookie manquant', async () => {
    const res = await request(app)
      .get('/api/auth/admin-session');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentifié/i);
  });

  test('retourne 403 si token n\'est pas admin', async () => {
    const userToken = jwt.sign(
      { id: 'user-1', role: 'CLIENT', email: 'user@manawa.com' },
      process.env.JWT_SECRET || 'test-secret'
    );

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${userToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/refusé/i);
  });
});

// ─── ADMIN RENEW ────────────────────────────────────────────────────────────

describe('POST /api/auth/admin-renew', () => {
  const jwt = require('jsonwebtoken');
  let adminToken;

  beforeEach(() => {
    adminToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@manawa.com' },
      process.env.JWT_SECRET || 'test-secret'
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@manawa.com',
      role: 'ADMIN',
      adminLevel: 'SUPER',
      adminPermissions: null,
      suspended: false,
    });
  });

  test('renouvelle le token admin et retourne nouveau token + csrf', async () => {
    const res = await request(app)
      .post('/api/auth/admin-renew')
      .set('Cookie', `adminToken=${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('csrfToken');
  });

  test('retourne 401 si adminToken cookie manquant', async () => {
    const res = await request(app)
      .post('/api/auth/admin-renew');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentifié/i);
  });

  test('retourne 403 si compte suspendu', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@manawa.com',
      role: 'ADMIN',
      suspended: true,
    });

    const res = await request(app)
      .post('/api/auth/admin-renew')
      .set('Cookie', `adminToken=${adminToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── SECURITY: JWT Token Validation & Auth Bypass ────────────────────────────────

describe('SECURITY: JWT Token Validation & Auth Bypass', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('EXPIRED JWT: Should reject expired tokens', async () => {
    const expiredToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@test.com' },
      process.env.JWT_SECRET,
      { expiresIn: '-1d' }
    );

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Token|expiré|invalid/i);
  });

  test('INVALID SIGNATURE: Should reject tokens signed with wrong secret', async () => {
    const invalidToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@test.com' },
      'wrong-secret-key',
      { expiresIn: '1d' }
    );

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${invalidToken}`);

    expect(res.status).toBe(401);
  });

  test('TAMPERED TOKEN: Should reject tokens with modified payload', async () => {
    const validToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@test.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1d' }
    );
    const [header, payload, signature] = validToken.split('.');
    const modifiedPayload = Buffer.from(
      JSON.stringify({ id: 'admin-1', role: 'ADMIN', email: 'hacked@attacker.com' })
    ).toString('base64');
    const tamperedToken = `${header}.${modifiedPayload}.${signature}`;

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${tamperedToken}`);

    expect(res.status).toBe(401);
  });

  test('MISSING JWT: Should reject requests without Bearer token', async () => {
    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Authorization', 'NotBearer token');

    expect(res.status).toBe(401);
  });

  test('NO AUTH HEADER: Should reject when no Authorization header', async () => {
    const res = await request(app).get('/api/auth/admin-session');
    expect(res.status).toBe(401);
  });
});

// ─── SECURITY: Authorization Escalation Prevention ────────────────────────────────

describe('SECURITY: Authorization Escalation Prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('CLIENT role cannot escalate to ADMIN via token claim', async () => {
    const fakeAdminToken = jwt.sign(
      { id: 'client-1', role: 'ADMIN', email: 'fake@test.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1d' }
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 'client-1', role: 'CLIENT', email: 'client@test.com',
    });

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: fakeAdminToken });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/refusé|role|permission/i);
  });

  test('STANDARD ADMIN cannot claim SUPER status in token', async () => {
    const fakeToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', adminLevel: 'SUPER', email: 'admin@test.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1d' }
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1', role: 'ADMIN', adminLevel: 'STANDARD', email: 'admin@test.com',
    });

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: fakeToken });

    // Should fail or check DB value, not token value
    expect(res.status).toBe(403);
  });

  test('Suspended admin should not be able to access admin-session', async () => {
    const adminTokenValid = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@test.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1d' }
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1', role: 'ADMIN', suspended: true, deletedAt: null,
    });

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${adminTokenValid}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspend|suspended/i);
  });

  test('Deleted user should not be able to access admin-session', async () => {
    const adminTokenValid = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@test.com' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1d' }
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1', role: 'ADMIN', suspended: false, deletedAt: new Date('2024-01-01'),
    });

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${adminTokenValid}`);

    expect(res.status).toBe(401);
  });
});
