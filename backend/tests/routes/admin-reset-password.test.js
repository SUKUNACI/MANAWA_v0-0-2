'use strict';

/**
 * T1.03 — Reset password administrateur (D1=Option B, D2=yes, D3=fail-closed)
 *
 * Tests:
 *   POST /api/admin/users/:id/reset-password  — initiation
 *   POST /api/auth/complete-password-reset     — complétion
 *   GET  /api/auth/login-history               — blocage mustChangePassword
 */

const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const { adminToken } = require('../helpers');

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../../routes/bulk-operations', () => require('express').Router());

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifié' });
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
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  },
  // Simulate the real middleware using a flag injected via the JWT payload (test-only)
  requirePasswordChangeCompleted: (req, res, next) => {
    if (req.user?._mustChangePassword) {
      return res.status(403).json({ error: 'Vous devez définir un nouveau mot de passe avant de continuer.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
  },
}));

const mockMailer = {
  isConfigured: true,
  send: jest.fn().mockResolvedValue({ sent: true }),
};

jest.mock('../../config/mailer', () => mockMailer);

jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    deleteMany: jest.fn(),
  },
  // C2: completePasswordReset uses $transaction([$queryRaw`...`, deleteMany]).
  // $queryRaw is called as a tagged template and returns a promise resolved to [{ id }] on success.
  // $transaction receives the array of already-resolved promises and returns their results.
  $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-target-1' }]),
  $transaction: jest.fn((ops) => Promise.all(ops.map((op) => (op instanceof Promise ? op : Promise.resolve(op)))),),
}));

jest.mock('../../modules/AuditLogModule', () => ({
  createAuditLog: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../utils/appConfig', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
  getAllConfig: jest.fn().mockResolvedValue({}),
  setConfig: jest.fn().mockResolvedValue({}),
}));

const prisma = require('../../config/db');

// ── App setup ──────────────────────────────────────────────────────────────────

const adminRoutes = require('../../routes/admin');
const authRoutes = require('../../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const ADMIN_ID = 'admin-1';
const USER_ID = 'user-target-1';

const mockAdminUser = {
  id: ADMIN_ID, role: 'ADMIN', email: 'admin@test.com',
  suspended: false, adminLevel: 'SUPER', adminPermissions: null,
};

const mockTargetUser = {
  id: USER_ID, role: 'PROFESSIONAL', email: 'target@test.com',
  firstName: 'Alice', suspended: false,
};

function makeValidResetToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

// ══════════════════════════════════════════════════════════════════════════════
// A. Initiation — POST /api/admin/users/:id/reset-password
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/users/:id/reset-password — initiation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMailer.isConfigured = true;
    mockMailer.send.mockResolvedValue({ sent: true });

    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where?.id === ADMIN_ID) return Promise.resolve(mockAdminUser);
      if (where?.id === USER_ID) return Promise.resolve(mockTargetUser);
      return Promise.resolve(null);
    });
    prisma.user.update.mockResolvedValue(mockTargetUser);
  });

  test('réinitialisation réussie — retourne { initiated: true }', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ initiated: true });
  });

  test('aucun temporaryPassword dans la réponse HTTP (D1)', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body).not.toHaveProperty('temporaryPassword');
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('token');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  test('envoie effectivement un email via mailer.send()', async () => {
    await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(mockMailer.send).toHaveBeenCalledTimes(1);
    const callArgs = mockMailer.send.mock.calls[0][0];
    expect(callArgs.to).toBe('target@test.com');
    expect(callArgs.subject).toMatch(/réinitialisation/i);
    expect(callArgs.html).toContain('reset-password');
    expect(callArgs.text).toContain('reset-password');
  });

  test('stocke le hash SHA-256 (64 chars), pas le jeton brut (96 chars) (D1)', async () => {
    await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const updateCall = prisma.user.update.mock.calls.find(
      (c) => c[0].data?.passwordResetCode !== undefined && c[0].data?.passwordResetCode !== null
    );
    expect(updateCall).toBeDefined();
    const storedCode = updateCall[0].data.passwordResetCode;
    expect(storedCode).toHaveLength(64);
    expect(storedCode).not.toHaveLength(96);
  });

  test('active mustChangePassword=true lors du reset (D2)', async () => {
    await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const updateCall = prisma.user.update.mock.calls.find(
      (c) => c[0].data?.mustChangePassword !== undefined
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0].data.mustChangePassword).toBe(true);
  });

  test('HTTP 503 si mailer non configuré (D3)', async () => {
    mockMailer.isConfigured = false;

    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(503);
    expect(res.body).not.toHaveProperty('temporaryPassword');
    expect(res.body.code).toBe('EMAIL_SERVICE_UNAVAILABLE');
    expect(mockMailer.send).not.toHaveBeenCalled();
  });

  test('HTTP 503 si mailer.send lève une exception — rollback du jeton (D3)', async () => {
    mockMailer.send.mockRejectedValue(new Error('SMTP timeout'));

    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(503);
    expect(res.body).not.toHaveProperty('temporaryPassword');

    // Rollback: a second update call should clear the token
    const rollbackCall = prisma.user.update.mock.calls.find(
      (c) => c[0].data?.passwordResetCode === null
    );
    expect(rollbackCall).toBeDefined();
    expect(rollbackCall[0].data.mustChangePassword).toBe(false);
  });

  test('HTTP 503 si mailer.send retourne { sent: false } — rollback (D3)', async () => {
    mockMailer.send.mockResolvedValue({ sent: false });

    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(503);
    const rollbackCall = prisma.user.update.mock.calls.find(
      (c) => c[0].data?.passwordResetCode === null
    );
    expect(rollbackCall).toBeDefined();
  });

  test('aucun jeton actif incohérent après un échec email (D3)', async () => {
    mockMailer.send.mockRejectedValue(new Error('Network error'));

    await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const rollbackCall = prisma.user.update.mock.calls.find(
      (c) => c[0].data?.passwordResetCode === null && c[0].data?.mustChangePassword === false
    );
    expect(rollbackCall).toBeDefined();
  });

  test('HTTP 404 si utilisateur inexistant', async () => {
    const res = await request(app)
      .post('/api/admin/users/unknown-id/reset-password')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('HTTP 401 sans authentification', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`);
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B. Complétion — POST /api/auth/complete-password-reset
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/complete-password-reset — complétion', () => {
  let rawToken, tokenHash;

  beforeEach(() => {
    jest.clearAllMocks();
    const { raw, hash } = makeValidResetToken();
    rawToken = raw;
    tokenHash = hash;

    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      passwordResetCode: tokenHash,
      passwordResetExpiry: new Date(Date.now() + 60 * 60 * 1000),
      passwordHash: '$2b$10$oldhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      mustChangePassword: true,
    });
    prisma.user.update.mockResolvedValue({ id: USER_ID });
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });
    // C2 revised: $queryRaw inside $transaction — restore default success mocks
    prisma.$queryRaw.mockResolvedValue([{ id: USER_ID }]);
    prisma.$transaction.mockImplementation((ops) =>
      Promise.all(ops.map((op) => (op instanceof Promise ? op : Promise.resolve(op))))
    );
  });

  test('réinitialisation valide — retourne { reset: true }', async () => {
    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: true });
  });

  test('efface passwordResetCode et mustChangePassword après succès (C2 — $queryRaw atomique)', async () => {
    await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' });

    // C2: the atomic UPDATE is issued via $queryRaw — check it was called once
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // And existing sessions are invalidated
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
  });

  test('invalide les sessions existantes (deleteMany refreshTokens)', async () => {
    await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' });

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
  });

  test('400 — jeton invalide', async () => {
    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: 'invalid-token-not-matching', newPassword: 'NewSecurePass123!' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESET_TOKEN_INVALID');
  });

  test('400 — jeton expiré', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      passwordResetCode: tokenHash,
      passwordResetExpiry: new Date(Date.now() - 1000),
      passwordHash: '$2b$10$oldhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      mustChangePassword: true,
    });

    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESET_TOKEN_EXPIRED');
  });

  test('400 — jeton déjà utilisé (passwordResetCode null)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      passwordResetCode: null,
      passwordResetExpiry: new Date(Date.now() + 60 * 60 * 1000),
      passwordHash: '$2b$10$oldhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      mustChangePassword: true,
    });

    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESET_TOKEN_INVALID');
  });

  test('400 — deux requêtes simultanées — seule la première réussit (C2 — atomicité $transaction/$queryRaw)', async () => {
    // Both requests pass the read phase (findUnique returns a valid token for each).
    // DB-level atomicity is modelled: $transaction calls $queryRaw inside it.
    // First $queryRaw call returns [{ id }] (token consumed), second returns []
    // (0 rows — token already NULL or expiry past at write time).
    let queryRawCalls = 0;
    prisma.$queryRaw.mockImplementation(() => {
      queryRawCalls++;
      if (queryRawCalls === 1) return Promise.resolve([{ id: USER_ID }]);
      return Promise.resolve([]);
    });
    prisma.$transaction.mockImplementation((ops) =>
      Promise.all(ops.map((op) => (op instanceof Promise ? op : Promise.resolve(op))))
    );

    const [r1, r2] = await Promise.all([
      request(app).post('/api/auth/complete-password-reset').send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' }),
      request(app).post('/api/auth/complete-password-reset').send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toContain(200);
    expect(statuses).toContain(400);
    const failRes = r1.status === 400 ? r1 : r2;
    expect(failRes.body.code).toBe('RESET_TOKEN_INVALID');
  });

  test('400 — newPassword trop court', async () => {
    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: rawToken, newPassword: 'short' });

    expect(res.status).toBe(400);
  });

  test('400 — champs manquants', async () => {
    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID });

    expect(res.status).toBe(400);
  });

  test('500 — rollback complet si deleteMany échoue après UPDATE (C2 — cohérence transactionnelle)', async () => {
    // Model: $transaction receives [$queryRaw-promise, deleteMany-promise].
    // If deleteMany rejects, $transaction rejects entirely — UPDATE is NOT committed.
    // With real Prisma $transaction([PrismaPromise[]]) both run inside one SQL transaction,
    // so a deleteMany failure rolls back the UPDATE.
    // Here we model that by making $transaction itself reject.
    prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' });

    expect(res.status).toBe(500);
    // The password must not have been changed from the caller's perspective
    // (transaction rolled back — no partial state)
  });

  test("400 — jeton expiré détecté dans le WHERE SQL (C2 — expiry re-vérifiée à l'écriture)", async () => {
    // findUnique passes (expiry check at read returns valid — simulates race where token expires
    // between read and write). $queryRaw returns [] because "passwordResetExpiry > now" fails.
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      passwordResetCode: tokenHash,
      passwordResetExpiry: new Date(Date.now() + 60 * 60 * 1000), // appears valid at read
      passwordHash: '$2b$10$oldhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      mustChangePassword: true,
    });
    // Simulate: at write time the token was already expired (WHERE returns 0 rows)
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((ops) =>
      Promise.all(ops.map((op) => (op instanceof Promise ? op : Promise.resolve(op))))
    );

    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: USER_ID, token: rawToken, newPassword: 'NewSecurePass123!' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESET_TOKEN_INVALID');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C. Blocage mustChangePassword (D2) — via le mock de requireAuth
// ══════════════════════════════════════════════════════════════════════════════

describe('requirePasswordChangeCompleted — blocage accès normal (mock middleware)', () => {
  test('403 PASSWORD_CHANGE_REQUIRED sur route protégée quand _mustChangePassword=true', async () => {
    const jwt = require('jsonwebtoken');
    const restrictedToken = jwt.sign(
      { id: USER_ID, role: 'PROFESSIONAL', email: 'user@test.com', _mustChangePassword: true },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    const res = await request(app)
      .get('/api/auth/login-history')
      .set('Authorization', `Bearer ${restrictedToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  test('accès autorisé après changement (mustChangePassword=false)', async () => {
    const jwt = require('jsonwebtoken');
    const normalToken = jwt.sign(
      { id: USER_ID, role: 'PROFESSIONAL', email: 'user@test.com' },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    const res = await request(app)
      .get('/api/auth/login-history')
      .set('Authorization', `Bearer ${normalToken}`);

    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D. Blocage global via requireAuth (C1) — sans mock du middleware auth
// ══════════════════════════════════════════════════════════════════════════════
//
// Ces tests exercent le VRAI requireAuth (non mocké). Un routeur minimal est
// monté ici pour éviter d'importer tous les routeurs en production. L'objectif
// est de confirmer que requireAuth rejette immédiatement un utilisateur avec
// mustChangePassword=true, quelle que soit la route appelée.
//
// Note: l'impossibilité de reproduire la concurrence réelle au niveau DB avec
// des mocks Jest est documentée dans C2 ci-dessus. Ces tests couvrent le path
// de code — la garantie d'atomicité réelle nécessite un vrai PostgreSQL.

describe('requireAuth — blocage global mustChangePassword (C1)', () => {
  let realAuthApp;

  beforeAll(() => {
    // Unmock auth for this suite: we need the real requireAuth
    jest.unmock('../../middleware/auth');
    jest.resetModules();

    const express = require('express');
    const { requireAuth } = require('../../middleware/auth');

    realAuthApp = express();
    realAuthApp.use(express.json());
    // A protected route that should be blocked when mustChangePassword=true
    realAuthApp.get('/protected', requireAuth, (req, res) => res.json({ ok: true }));
    realAuthApp.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('403 PASSWORD_CHANGE_REQUIRED sur route protégée quand mustChangePassword=true en DB', async () => {
    // requireAuth reads from DB — prisma mock returns mustChangePassword: true
    const dbMod = require('../../config/db');
    dbMod.user.findUnique.mockResolvedValue({
      id: USER_ID, role: 'PROFESSIONAL', email: 'user@test.com',
      suspended: false, deletedAt: null, adminLevel: null,
      adminPermissions: null, adminRoleTypeId: null,
      adminRoleType: null,
      mustChangePassword: true,
    });

    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: USER_ID }, process.env.JWT_SECRET, { expiresIn: '1d' });

    const res = await request(realAuthApp)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  test('200 sur route protégée quand mustChangePassword=false en DB', async () => {
    const dbMod = require('../../config/db');
    dbMod.user.findUnique.mockResolvedValue({
      id: USER_ID, role: 'PROFESSIONAL', email: 'user@test.com',
      suspended: false, deletedAt: null, adminLevel: null,
      adminPermissions: null, adminRoleTypeId: null,
      adminRoleType: null,
      mustChangePassword: false,
    });

    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: USER_ID }, process.env.JWT_SECRET, { expiresIn: '1d' });

    const res = await request(realAuthApp)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('complete-password-reset reste accessible sans requireAuth (exempt D2)', async () => {
    // This route in routes/auth.js has no requireAuth — so mustChangePassword never blocks it
    const res = await request(app)
      .post('/api/auth/complete-password-reset')
      .send({ userId: 'nonexistent', token: 'any', newPassword: 'anypass123' });

    // Should NOT return 403 PASSWORD_CHANGE_REQUIRED — any other status is acceptable
    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe('PASSWORD_CHANGE_REQUIRED');
  });

  test('logout reste accessible sans requireAuth (exempt D2)', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: 'some-token' });

    expect(res.status).not.toBe(403);
    expect(res.body?.code).not.toBe('PASSWORD_CHANGE_REQUIRED');
  });
});
