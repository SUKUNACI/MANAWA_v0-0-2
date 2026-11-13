/**
 * Tests unitaires — routes/auth.js
 *
 * Couvre :
 *   POST   /register
 *   POST   /login
 *   POST   /refresh
 *   POST   /logout
 *   POST   /admin-session
 *   GET    /admin-session
 *   POST   /admin-renew
 *   POST   /setup-admin     (ADMIN/SUPER uniquement)
 *   POST   /unlock          (ADMIN uniquement)
 *   GET    /login-history   (auth requise)
 *   GET    /admin/user/:id/security (ADMIN uniquement)
 *   GET    /debug/check-columns
 */

const request = require('supertest');
const express = require('express');
const jwt     = require('jsonwebtoken');
const { adminToken } = require('../helpers');

// ── Mock Prisma ───────────────────────────────────────────────────────────────
jest.mock('../../config/db', () => ({
  $executeRaw: jest.fn().mockResolvedValue(1),
  user: {
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  refreshToken: {
    create:     jest.fn().mockResolvedValue({ token: 'mock-refresh-token' }),
    findUnique: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete:     jest.fn(),
  },
  adminLog: {
    create: jest.fn().mockResolvedValue({}),
  },
  loginAttempt: {
    create:   jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
}));

// ── Mock bcryptjs ─────────────────────────────────────────────────────────────
jest.mock('bcryptjs', () => ({
  hash:    jest.fn().mockResolvedValue('$2b$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn().mockResolvedValue('salt'),
}));

// ── Mock bruteForceMiddleware ─────────────────────────────────────────────────
jest.mock('../../middleware/bruteForceMiddleware', () => ({
  bruteForceCheckMiddleware: () => (req, res, next) => next(),
  trackFailedLogin:   jest.fn().mockResolvedValue(1),
  logLoginAttempt:    jest.fn().mockResolvedValue(undefined),
  clearFailedAttempts: jest.fn().mockResolvedValue(undefined),
  lockAccount:         jest.fn().mockResolvedValue(undefined),
  clearLockout:        jest.fn().mockResolvedValue(undefined),
  getAttemptCount:     jest.fn().mockResolvedValue(0),
  checkLockout:        jest.fn().mockResolvedValue({ isLocked: false, remainingSeconds: 0 }),
  getLoginHistory:     jest.fn().mockResolvedValue([]),
}));

// ── Mock brute-force config ───────────────────────────────────────────────────
jest.mock('../../config/brute-force', () => ({
  maxAttempts:             5,
  lockoutDurationSeconds:  3600,
  attemptWindowSeconds:    900,
  messages: {
    loginFailed:   'Email ou mot de passe incorrect',
    accountLocked: 'Compte verrouillé. Réessayez plus tard.',
  },
  headers: {
    attemptsRemaining: 'X-Attempts-Remaining',
    retryAfter:        'Retry-After',
  },
  statusCodes: {
    tooManyRequests: 429,
  },
  keyPrefixes: {
    failedAttempts: 'brute:attempts:',
    lockout:        'brute:lockout:',
  },
}));

// ── Mock middleware/auth ──────────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const jwt = require('jsonwebtoken');
    try {
      req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token invalide' });
    }
  },
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
  requireEmailVerified: (req, res, next) => next(),
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock('../../utils/logger', () => ({
  info:  jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
}));

// ── Mock sorting helpers ──────────────────────────────────────────────────────
jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));
jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt']),
}));

const prisma           = require('../../config/db');
const bcrypt           = require('bcryptjs');
const bruteForce       = require('../../middleware/bruteForceMiddleware');
const cookieParser     = require('cookie-parser');
const authRoutes       = require('../../routes/auth');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

const TEST_PASSWORD = 'Test@Manawa2024!';
const JWT_SECRET    = process.env.JWT_SECRET;

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeAdminJwt(overrides = {}) {
  return jwt.sign(
    { id: 'admin-1', role: 'ADMIN', email: 'admin@manawa.com', ...overrides },
    JWT_SECRET,
  );
}

const mockClientUser = {
  id:            'user-1',
  email:         'test@manawa.com',
  passwordHash:  '$2b$10$hashedpassword',
  role:          'CLIENT',
  suspended:     false,
  deletedAt:     null,
  twoFAEnabled:  false,
  firstName:     'Jean',
  lastName:      'Dupont',
  phone:         null,
  city:          null,
  avatarUrl:     null,
  emailVerified: false,
  createdAt:     new Date(),
};

const mockAdminUser = {
  id:               'admin-1',
  email:            'admin@manawa.com',
  role:             'ADMIN',
  adminLevel:       'SUPER',
  adminPermissions: null,
  suspended:        false,
  deletedAt:        null,
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/register
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/register', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(mockClientUser);
    prisma.refreshToken.create.mockResolvedValue({ token: 'mock-refresh-token' });
  });

  test('201 — crée un compte CLIENT avec les champs requis', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:     'test@manawa.com',
        password:  TEST_PASSWORD,
        firstName: 'Jean',
        lastName:  'Dupont',
        role:      'CLIENT',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe('test@manawa.com');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  test('201 — crée un compte PROFESSIONAL avec métier', async () => {
    const proUser = {
      ...mockClientUser,
      id:    'user-2',
      email: 'pro@manawa.com',
      role:  'PROFESSIONAL',
      professional: { id: 'pro-1', trade: 'Maçon', trades: ['Maçon'] },
    };
    prisma.user.create.mockResolvedValue(proUser);

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:       'pro@manawa.com',
        password:    TEST_PASSWORD,
        firstName:   'Marie',
        lastName:    'Martin',
        role:        'PROFESSIONAL',
        trades:      ['Maçon'],
        accountType: 'INDEPENDENT',
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
  });

  test('409 — email déjà utilisé (findUnique renvoie un user)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:     'exist@manawa.com',
        password:  TEST_PASSWORD,
        firstName: 'Jean',
        lastName:  'Dupont',
        role:      'CLIENT',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/déjà utilisé/i);
  });

  test('409 — unique constraint Prisma → EMAIL_EXISTS', async () => {
    prisma.user.create.mockRejectedValue(
      new Error('Unique constraint failed on the fields: (`email`)')
    );

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:     'dup@manawa.com',
        password:  TEST_PASSWORD,
        firstName: 'A',
        lastName:  'B',
        role:      'CLIENT',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_EXISTS');
  });

  test('400 — email invalide', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:     'pasunemail',
        password:  TEST_PASSWORD,
        firstName: 'Jean',
        lastName:  'Dupont',
        role:      'CLIENT',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('errors');
  });

  test('400 — mot de passe trop court (< 8 caractères)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:     'test@manawa.com',
        password:  '1234',
        firstName: 'Jean',
        lastName:  'Dupont',
        role:      'CLIENT',
      });

    expect(res.status).toBe(400);
  });

  test('400 — rôle invalide (ADMIN interdit à l\'inscription)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:     'test@manawa.com',
        password:  TEST_PASSWORD,
        firstName: 'Jean',
        lastName:  'Dupont',
        role:      'ADMIN',
      });

    expect(res.status).toBe(400);
  });

  test('400 — prénom manquant', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:    'test@manawa.com',
        password: TEST_PASSWORD,
        lastName: 'Dupont',
        role:     'CLIENT',
      });

    expect(res.status).toBe(400);
  });

  test('500 — erreur inattendue Prisma', async () => {
    prisma.user.create.mockRejectedValue(new Error('DB crashed'));

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:     'crash@manawa.com',
        password:  TEST_PASSWORD,
        firstName: 'A',
        lastName:  'B',
        role:      'CLIENT',
      });

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('requestId');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockClientUser);
    bcrypt.compare.mockResolvedValue(true);
    prisma.refreshToken.create.mockResolvedValue({ token: 'mock-refresh-token' });
    bruteForce.trackFailedLogin.mockResolvedValue(1);
    bruteForce.clearFailedAttempts.mockResolvedValue(undefined);
    bruteForce.logLoginAttempt.mockResolvedValue(undefined);
  });

  test('200 — retourne token + refreshToken avec bons identifiants', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe('test@manawa.com');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  test('401 — mot de passe incorrect', async () => {
    bcrypt.compare.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: 'mauvais' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('401 — email introuvable', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });

  test('403 — compte suspendu', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockClientUser, suspended: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspendu/i);
  });

  test('403 — compte supprimé', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockClientUser, deletedAt: new Date() });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/supprimé/i);
  });

  test('400 — email manquant', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });

  test('400 — password manquant', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com' });

    expect(res.status).toBe(400);
  });

  test('200 requiresTwoFA — 2FA activé, retourne twoFAToken', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockClientUser, twoFAEnabled: true });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFA).toBe(true);
    expect(res.body).toHaveProperty('twoFAToken');
  });

  test('lockAccount appelé quand maxAttempts atteint', async () => {
    bruteForce.trackFailedLogin.mockResolvedValue(5);
    bcrypt.compare.mockResolvedValue(false);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: 'wrong' });

    expect(bruteForce.lockAccount).toHaveBeenCalled();
  });

  test('500 — erreur Prisma sur findUnique', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@manawa.com', password: TEST_PASSWORD });

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('requestId');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/refresh
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/refresh', () => {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id:        'rt-1',
      token:     'valid-refresh-token',
      expiresAt: futureDate,
      user:      mockClientUser,
    });
    prisma.refreshToken.delete.mockResolvedValue({});
    prisma.refreshToken.create.mockResolvedValue({ token: 'new-refresh-token' });
  });

  test('200 — échange un refresh token valide contre un nouvel access token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
  });

  test('400 — refreshToken absent', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requis/i);
  });

  test('401 — refresh token inexistant en base', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'unknown-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide|expiré/i);
  });

  test('401 — refresh token expiré', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id:        'rt-2',
      token:     'expired-token',
      expiresAt: new Date('2020-01-01'),
      user:      mockClientUser,
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'expired-token' });

    expect(res.status).toBe(401);
  });

  test('401 — utilisateur du token a deletedAt', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id:        'rt-3',
      token:     'valid-refresh-token',
      expiresAt: futureDate,
      user:      { ...mockClientUser, deletedAt: new Date() },
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/supprimé/i);
  });

  test('403 — utilisateur suspendu', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id:        'rt-4',
      token:     'valid-refresh-token',
      expiresAt: futureDate,
      user:      { ...mockClientUser, suspended: true },
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspendu/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/logout', () => {
  test('200 — logout sans refreshToken, efface les cookies', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
  });

  test('200 — logout avec refreshToken, le révoque', async () => {
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'valid-refresh-token' } })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/admin-session
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/admin-session', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockAdminUser);
    prisma.user.update.mockResolvedValue({ id: 'admin-1', lastLoginAt: new Date() });
  });

  test('200 — retourne user, token et csrfToken pour un admin SUPER valide', async () => {
    const token = makeAdminJwt();

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('csrfToken');
    expect(res.body.user.role).toBe('ADMIN');
  });

  test('200 — pose un cookie adminToken httpOnly', async () => {
    const token = makeAdminJwt();

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token });

    expect(res.status).toBe(200);
    const adminCookies = (res.headers['set-cookie'] || []).filter(c =>
      c.includes('adminToken')
    );
    expect(adminCookies.length).toBeGreaterThan(0);
    expect(adminCookies[0]).toMatch(/HttpOnly/i);
  });

  test('400 — token absent', async () => {
    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requis/i);
  });

  test('401 — token invalide (mauvaise signature)', async () => {
    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: 'bad-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('401 — token trop ancien (iat il y a > 1h)', async () => {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 7200;
    const oldToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@manawa.com', iat: twoHoursAgo },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: oldToken });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/ancien|invalide/i);
  });

  test('403 — token d\'un CLIENT (non ADMIN)', async () => {
    const clientJwt = jwt.sign(
      { id: 'client-1', role: 'CLIENT', email: 'client@manawa.com' },
      JWT_SECRET,
    );

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token: clientJwt });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/refusé/i);
  });

  test('403 — user en base avec role CLIENT alors que token dit ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockAdminUser, role: 'CLIENT' });
    const token = makeAdminJwt();

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token });

    expect(res.status).toBe(403);
  });

  test('403 — escalade de privilèges : token SUPER, DB STANDARD', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockAdminUser,
      adminLevel: 'STANDARD',
    });
    const token = makeAdminJwt({ adminLevel: 'SUPER' });

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/niveau|insuffisant/i);
  });

  test('403 — compte supprimé', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockAdminUser,
      deletedAt: new Date(),
    });
    const token = makeAdminJwt();

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/supprimé/i);
  });

  test('403 — compte suspendu', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockAdminUser,
      suspended: true,
    });
    const token = makeAdminJwt();

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspendu/i);
  });

  test('404 — utilisateur non trouvé en base', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const token = makeAdminJwt();

    const res = await request(app)
      .post('/api/auth/admin-session')
      .send({ token });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/admin-session
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/auth/admin-session', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockAdminUser);
  });

  test('200 — vérifie la session depuis cookie adminToken valide', async () => {
    const token = makeAdminJwt();

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.role).toBe('ADMIN');
  });

  test('401 — pas de cookie adminToken', async () => {
    const res = await request(app).get('/api/auth/admin-session');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentifié/i);
  });

  test('401 — token invalide dans le cookie', async () => {
    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', 'adminToken=garbage');

    expect(res.status).toBe(401);
  });

  test('401 — utilisateur introuvable en base (deletedAt)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const token = makeAdminJwt();

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${token}`);

    expect(res.status).toBe(401);
  });

  test('403 — token d\'un CLIENT dans le cookie', async () => {
    const userToken = jwt.sign(
      { id: 'user-1', role: 'CLIENT', email: 'user@manawa.com' },
      JWT_SECRET,
    );

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${userToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/refusé/i);
  });

  test('403 — compte suspendu', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockAdminUser, suspended: true });
    const token = makeAdminJwt();

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspendu/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/admin-renew
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/admin-renew', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockAdminUser);
  });

  test('200 — renouvelle le token admin, retourne token + csrfToken', async () => {
    const token = makeAdminJwt();

    const res = await request(app)
      .post('/api/auth/admin-renew')
      .set('Cookie', `adminToken=${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('csrfToken');
  });

  test('401 — pas de cookie adminToken', async () => {
    const res = await request(app).post('/api/auth/admin-renew');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentifié/i);
  });

  test('401 — token invalide', async () => {
    const res = await request(app)
      .post('/api/auth/admin-renew')
      .set('Cookie', 'adminToken=garbage');

    expect(res.status).toBe(401);
  });

  test('403 — compte suspendu', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockAdminUser, suspended: true });
    const token = makeAdminJwt();

    const res = await request(app)
      .post('/api/auth/admin-renew')
      .set('Cookie', `adminToken=${token}`);

    expect(res.status).toBe(403);
  });

  test('403 — token d\'un CLIENT dans le cookie', async () => {
    const clientToken = jwt.sign(
      { id: 'c1', role: 'CLIENT', email: 'c@test.com' },
      JWT_SECRET,
    );

    const res = await request(app)
      .post('/api/auth/admin-renew')
      .set('Cookie', `adminToken=${clientToken}`);

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/setup-admin  (ADMIN + SUPER + secret requis)
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/setup-admin', () => {
  beforeEach(() => {
    process.env.SUPER_ADMIN_SETUP_SECRET = 'super-secret-123';
    // findUnique est appelé avec req.user.id (l'admin qui envoie la requête)
    prisma.user.findUnique.mockResolvedValue({
      ...mockAdminUser,
      adminLevel: 'SUPER',
    });
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.adminLog.create.mockResolvedValue({});
  });

  test('200 — SUPER admin peut créer l\'admin initial', async () => {
    const res = await request(app)
      .post('/api/auth/setup-admin')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ superAdminSecret: 'super-secret-123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('403 — STANDARD admin refusé', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockAdminUser,
      adminLevel: 'STANDARD',
    });

    const res = await request(app)
      .post('/api/auth/setup-admin')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ superAdminSecret: 'super-secret-123' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/super administrateur/i);
  });

  test('403 — secret superAdmin incorrect', async () => {
    const res = await request(app)
      .post('/api/auth/setup-admin')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ superAdminSecret: 'wrong-secret' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/secret/i);
  });

  test('401 — non authentifié', async () => {
    const res = await request(app)
      .post('/api/auth/setup-admin')
      .send({ superAdminSecret: 'super-secret-123' });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/unlock  (ADMIN uniquement)
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/unlock', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue({
      id:    'target-user',
      email: 'locked@manawa.com',
    });
    bruteForce.clearLockout.mockResolvedValue(undefined);
    bruteForce.clearFailedAttempts.mockResolvedValue(undefined);
    prisma.adminLog.create.mockResolvedValue({});
  });

  test('200 — ADMIN peut déverrouiller un compte', async () => {
    const res = await request(app)
      .post('/api/auth/unlock')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'locked@manawa.com', reason: 'manual_test' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.email).toBe('locked@manawa.com');
  });

  test('400 — email absent', async () => {
    const res = await request(app)
      .post('/api/auth/unlock')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email requis/i);
  });

  test('404 — utilisateur introuvable', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/unlock')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'unknown@manawa.com' });

    expect(res.status).toBe(404);
  });

  test('401 — non authentifié', async () => {
    const res = await request(app)
      .post('/api/auth/unlock')
      .send({ email: 'locked@manawa.com' });

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT ne peut pas unlock', async () => {
    const { clientToken } = require('../helpers');

    const res = await request(app)
      .post('/api/auth/unlock')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ email: 'locked@manawa.com' });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/login-history
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/auth/login-history', () => {
  beforeEach(() => {
    bruteForce.getLoginHistory.mockResolvedValue([
      { id: 'la-1', status: 'success', ipAddress: '127.0.0.1', timestamp: new Date() },
    ]);
  });

  test('200 — retourne l\'historique pour l\'utilisateur authentifié', async () => {
    const { clientToken } = require('../helpers');

    const res = await request(app)
      .get('/api/auth/login-history')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.attempts)).toBe(true);
    expect(typeof res.body.count).toBe('number');
  });

  test('401 — non authentifié', async () => {
    const res = await request(app).get('/api/auth/login-history');

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/admin/user/:id/security  (ADMIN uniquement)
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/auth/admin/user/:id/security', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue({
      id:          'target-1',
      email:       'target@manawa.com',
      lastLoginAt: new Date(),
      suspended:   false,
    });
    bruteForce.getAttemptCount.mockResolvedValue(2);
    bruteForce.checkLockout.mockResolvedValue({ isLocked: false, remainingSeconds: 0 });
    bruteForce.getLoginHistory.mockResolvedValue([]);
  });

  test('200 — ADMIN obtient le statut sécurité d\'un utilisateur', async () => {
    const res = await request(app)
      .get('/api/auth/admin/user/target-1/security')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('security');
    expect(res.body.security.failedAttempts).toBe(2);
  });

  test('404 — utilisateur introuvable', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/auth/admin/user/no-such-id/security')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
  });

  test('401 — non authentifié', async () => {
    const res = await request(app).get('/api/auth/admin/user/target-1/security');

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const { clientToken } = require('../helpers');

    const res = await request(app)
      .get('/api/auth/admin/user/target-1/security')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/debug/check-columns
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/auth/debug/check-columns', () => {
  test('200 ok:true quand user.findFirst réussit', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'a@b.com' });

    const res = await request(app).get('/api/auth/debug/check-columns');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.columns)).toBe(true);
  });

  test('200 ok:false quand une colonne est manquante (erreur Prisma)', async () => {
    prisma.user.findFirst.mockRejectedValue(
      new Error('column "emailVerified" does not exist')
    );

    const res = await request(app).get('/api/auth/debug/check-columns');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('emailVerified');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY: JWT validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('SECURITY — Validation JWT', () => {
  test('rejette un token expiré dans le cookie adminToken', async () => {
    const expiredToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@test.com' },
      JWT_SECRET,
      { expiresIn: '-1d' }
    );

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${expiredToken}`);

    expect(res.status).toBe(401);
  });

  test('rejette un token signé avec un mauvais secret', async () => {
    const badToken = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@test.com' },
      'wrong-secret-xyz',
    );

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${badToken}`);

    expect(res.status).toBe(401);
  });

  test('rejette un token avec payload modifié (signature brisée)', async () => {
    const valid = jwt.sign(
      { id: 'admin-1', role: 'ADMIN', email: 'admin@test.com' },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
    const [header, , sig] = valid.split('.');
    const tampered = `${header}.${Buffer.from(JSON.stringify({ id: 'admin-1', role: 'ADMIN', email: 'hacked@evil.com' })).toString('base64')}.${sig}`;

    const res = await request(app)
      .get('/api/auth/admin-session')
      .set('Cookie', `adminToken=${tampered}`);

    expect(res.status).toBe(401);
  });
});
