/**
 * Tests for config-versions routes
 * Module: routes/config-versions.js (Q77-Q78)
 * Endpoints:
 *   GET  /           — liste des versions
 *   GET  /:version   — détail d'une version
 *   POST /           — créer une nouvelle version
 *   POST /:version/restore  — restaurer une version
 *   PATCH /:version/mark-stable — marquer comme stable
 *   GET  /history    — historique des rollbacks
 *   GET  /health-metrics — métriques système
 */

const request = require('supertest');
const express = require('express');
const { adminToken, proToken, clientToken } = require('../helpers');

// ── Mocks ─────────────────────────────────────────────────────────────────────

// config-versions.js définit son propre middleware requireAdmin inline
// (pas de requireAuth/requireRole importé), donc on mock seulement auth pour
// les cas où d'autres middlewares en dépendraient, mais surtout on doit
// alimenter req.user via un middleware custom dans notre app de test.

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifié' });
    const jwt = require('jsonwebtoken');
    try { req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); next(); }
    catch { return res.status(401).json({ error: 'Token invalide' }); }
  },
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  },
  optionalAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      try { req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); } catch {}
    }
    next();
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  init: jest.fn(),
}));

const mockVersions = [
  {
    id: 'cv-1',
    version: '1.0.0',
    createdAt: new Date('2026-01-01').toISOString(),
    createdBy: 'admin-1',
    tag: 'initial',
    changelog: 'Version initiale',
    isStable: true,
  },
  {
    id: 'cv-2',
    version: '1.1.0',
    createdAt: new Date('2026-02-01').toISOString(),
    createdBy: 'admin-1',
    tag: 'hotfix',
    changelog: 'Correctif de sécurité critique',
    isStable: false,
  },
];

const mockRollbackHistory = [
  {
    id: 'rh-1',
    fromVersion: '1.1.0',
    toVersion: '1.0.0',
    reason: 'Instabilité détectée',
    performedBy: 'admin-1',
    createdAt: new Date('2026-02-10').toISOString(),
  },
];

const mockHealthMetric = {
  id: 'hm-1',
  timestamp: new Date().toISOString(),
  cpuUsage: 45.2,
  memoryUsage: 68.5,
  dbResponseTime: 12,
  activeConnections: 23,
};

jest.mock('../../config/db', () => ({
  prisma: {
    configVersion: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    systemHealthMetric: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../utils/rollback-manager', () => ({
  saveConfigVersion: jest.fn(),
  rollbackConfiguration: jest.fn(),
  markVersionAsStable: jest.fn(),
  getRollbackHistory: jest.fn(),
}));

const { prisma } = require('../../config/db');
const rollbackManager = require('../../utils/rollback-manager');
const configVersionsRouter = require('../../routes/config-versions');

// App de test: le router config-versions utilise son propre `requireAdmin`
// qui vérifie req.user.role === 'ADMIN'. On utilise le mock auth pour
// alimenter req.user via un middleware placé avant le router.
const app = express();
app.use(express.json());

// Middleware qui décode le token et place req.user (simule ce que requireAuth ferait)
app.use((req, res, next) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const jwt = require('jsonwebtoken');
    try { req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); } catch {}
  }
  next();
});

app.use('/config/versions', configVersionsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── Helper reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  prisma.configVersion.findMany.mockResolvedValue(mockVersions);
  prisma.configVersion.count.mockResolvedValue(2);
  prisma.configVersion.findUnique.mockResolvedValue(mockVersions[0]);
  prisma.systemHealthMetric.findMany.mockResolvedValue([mockHealthMetric]);
  rollbackManager.saveConfigVersion.mockResolvedValue({
    id: 'cv-new',
    version: '2.0.0',
    changelog: 'Nouvelle version majeure avec 10 changements importants',
    createdBy: 'admin-1',
  });
  rollbackManager.rollbackConfiguration.mockResolvedValue({
    success: true,
    restoredVersion: '1.0.0',
    appliedAt: new Date().toISOString(),
  });
  rollbackManager.markVersionAsStable.mockResolvedValue({
    ...mockVersions[1],
    isStable: true,
  });
  rollbackManager.getRollbackHistory.mockResolvedValue(mockRollbackHistory);
});

// ── GET /config/versions ──────────────────────────────────────────────────────

describe('GET /config/versions', () => {
  it('retourne 403 sans auth (pas de req.user)', async () => {
    const res = await request(app).get('/config/versions');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ADMIN role required/i);
  });

  it('retourne 403 pour un CLIENT', async () => {
    const res = await request(app)
      .get('/config/versions')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 403 pour un PROFESSIONAL', async () => {
    const res = await request(app)
      .get('/config/versions')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 200 pour un ADMIN', async () => {
    const res = await request(app)
      .get('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(2);
  });

  it('utilise limit=20 et offset=0 par défaut', async () => {
    await request(app)
      .get('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(prisma.configVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 0 })
    );
  });

  it('accepte limit et offset en query param', async () => {
    const res = await request(app)
      .get('/config/versions?limit=5&offset=10')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(prisma.configVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 })
    );
    expect(res.body.pagination.limit).toBe(5);
    expect(res.body.pagination.offset).toBe(10);
  });

  it('retourne timestamp dans la réponse', async () => {
    const res = await request(app)
      .get('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.body.timestamp).toBeTruthy();
  });

  it('retourne 500 si Prisma échoue', async () => {
    prisma.configVersion.findMany.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app)
      .get('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });
});

// ── GET /config/versions/history ─────────────────────────────────────────────
// NOTA: Dans config-versions.js, GET /history est défini APRÈS GET /:version
// donc Express intercepte "history" comme :version et le redirige vers
// GET /:version (findUnique). Ce describe teste le comportement réel du router.

describe('GET /config/versions/history (capturé par /:version)', () => {
  it('retourne 403 sans auth', async () => {
    const res = await request(app).get('/config/versions/history');
    expect(res.status).toBe(403);
  });

  it('retourne 403 pour un CLIENT', async () => {
    const res = await request(app)
      .get('/config/versions/history')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 200 pour un ADMIN (route /:version avec version="history")', async () => {
    // GET /:version est intercepté avant GET /history dans le router
    prisma.configVersion.findUnique.mockResolvedValueOnce({
      id: 'cv-history',
      version: 'history',
      createdAt: new Date().toISOString(),
      createdBy: 'admin-1',
      tag: null,
      changelog: 'test',
      isStable: false,
    });
    const res = await request(app)
      .get('/config/versions/history')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('retourne 404 si version="history" n\'existe pas dans la DB', async () => {
    prisma.configVersion.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/config/versions/history')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /config/versions/health-metrics ──────────────────────────────────────
// NOTA: Même situation — GET /health-metrics est défini après GET /:version
// donc Express capture "health-metrics" comme :version via GET /:version.

describe('GET /config/versions/health-metrics (capturé par /:version)', () => {
  it('retourne 403 sans auth', async () => {
    const res = await request(app).get('/config/versions/health-metrics');
    expect(res.status).toBe(403);
  });

  it('retourne 403 pour un CLIENT', async () => {
    const res = await request(app)
      .get('/config/versions/health-metrics')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 200 pour un ADMIN (route /:version avec version="health-metrics")', async () => {
    prisma.configVersion.findUnique.mockResolvedValueOnce({
      id: 'cv-hm',
      version: 'health-metrics',
      createdAt: new Date().toISOString(),
      createdBy: 'admin-1',
      tag: null,
      changelog: 'test',
      isStable: false,
    });
    const res = await request(app)
      .get('/config/versions/health-metrics')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.timestamp).toBeTruthy();
  });

  it('retourne 404 si version="health-metrics" n\'existe pas dans la DB', async () => {
    prisma.configVersion.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/config/versions/health-metrics')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /config/versions/:version ────────────────────────────────────────────

describe('GET /config/versions/:version', () => {
  it('retourne 403 sans auth', async () => {
    const res = await request(app).get('/config/versions/1.0.0');
    expect(res.status).toBe(403);
  });

  it('retourne 403 pour un CLIENT', async () => {
    const res = await request(app)
      .get('/config/versions/1.0.0')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 200 pour un ADMIN avec version existante', async () => {
    const res = await request(app)
      .get('/config/versions/1.0.0')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.version).toBe('1.0.0');
    expect(res.body.data.isStable).toBe(true);
    expect(res.body.timestamp).toBeTruthy();
  });

  it('retourne 404 si la version n\'existe pas', async () => {
    prisma.configVersion.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/config/versions/99.99.99')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('retourne 500 si Prisma échoue', async () => {
    prisma.configVersion.findUnique.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app)
      .get('/config/versions/1.0.0')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });
});

// ── POST /config/versions ─────────────────────────────────────────────────────

describe('POST /config/versions', () => {
  it('retourne 403 sans auth', async () => {
    const res = await request(app)
      .post('/config/versions')
      .send({ version: '2.0.0', changelog: 'Nouvelle version avec 10 changements importants.' });
    expect(res.status).toBe(403);
  });

  it('retourne 403 pour un CLIENT', async () => {
    const res = await request(app)
      .post('/config/versions')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ version: '2.0.0', changelog: 'Nouvelle version avec 10 changements importants.' });
    expect(res.status).toBe(403);
  });

  it('retourne 400 si version n\'est pas sémantique', async () => {
    const res = await request(app)
      .post('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ version: 'v2.0', changelog: 'Changelog avec au moins 10 caractères.' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('retourne 400 si changelog est trop court (< 10 chars)', async () => {
    const res = await request(app)
      .post('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ version: '2.0.0', changelog: 'Court' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('retourne 400 si changelog est trop long (> 1000 chars)', async () => {
    const res = await request(app)
      .post('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ version: '2.0.0', changelog: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('retourne 409 si la version existe déjà', async () => {
    prisma.configVersion.findUnique.mockResolvedValueOnce(mockVersions[0]);
    const res = await request(app)
      .post('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ version: '1.0.0', changelog: 'Tentative de recréer une version existante.' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('retourne 201 pour un ADMIN avec données valides', async () => {
    prisma.configVersion.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ version: '2.0.0', changelog: 'Nouvelle version majeure avec 10 changements importants.' });
    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.message).toMatch(/2.0.0/);
    expect(res.body.timestamp).toBeTruthy();
  });

  it('appelle rollbackManager.saveConfigVersion avec les bons arguments', async () => {
    prisma.configVersion.findUnique.mockResolvedValueOnce(null);
    await request(app)
      .post('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ version: '2.0.0', changelog: 'Nouvelle version majeure avec tous les changements.' });
    expect(rollbackManager.saveConfigVersion).toHaveBeenCalledWith(
      '2.0.0',
      'admin-1',
      expect.any(String)
    );
  });

  it('retourne 500 si rollbackManager.saveConfigVersion échoue', async () => {
    prisma.configVersion.findUnique.mockResolvedValueOnce(null);
    rollbackManager.saveConfigVersion.mockRejectedValueOnce(new Error('Save failed'));
    const res = await request(app)
      .post('/config/versions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ version: '3.0.0', changelog: 'Changelog suffisamment long pour passer la validation.' });
    expect(res.status).toBe(500);
  });
});

// ── POST /config/versions/:version/restore ────────────────────────────────────

describe('POST /config/versions/:version/restore', () => {
  it('retourne 403 sans auth', async () => {
    const res = await request(app)
      .post('/config/versions/1.0.0/restore')
      .send({ reason: 'Instabilité critique' });
    expect(res.status).toBe(403);
  });

  it('retourne 403 pour un PROFESSIONAL', async () => {
    const res = await request(app)
      .post('/config/versions/1.0.0/restore')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ reason: 'Instabilité critique' });
    expect(res.status).toBe(403);
  });

  it('retourne 400 si reason est trop courte (< 5 chars)', async () => {
    const res = await request(app)
      .post('/config/versions/1.0.0/restore')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'Bug' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('retourne 400 si reason est trop longue (> 500 chars)', async () => {
    const res = await request(app)
      .post('/config/versions/1.0.0/restore')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('retourne 200 pour un ADMIN avec données valides', async () => {
    const res = await request(app)
      .post('/config/versions/1.0.0/restore')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'Instabilité critique détectée en production' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.message).toMatch(/1.0.0/);
    expect(res.body.timestamp).toBeTruthy();
  });

  it('appelle rollbackManager.rollbackConfiguration avec les bons arguments', async () => {
    await request(app)
      .post('/config/versions/1.0.0/restore')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'Instabilité critique détectée en production' });
    expect(rollbackManager.rollbackConfiguration).toHaveBeenCalledWith(
      '1.0.0',
      'admin-1',
      'Instabilité critique détectée en production'
    );
  });

  it('retourne 500 si rollbackManager.rollbackConfiguration échoue', async () => {
    rollbackManager.rollbackConfiguration.mockRejectedValueOnce(new Error('Rollback failed'));
    const res = await request(app)
      .post('/config/versions/1.0.0/restore')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'Raison suffisamment longue pour la validation' });
    expect(res.status).toBe(500);
  });
});

// ── PATCH /config/versions/:version/mark-stable ───────────────────────────────

describe('PATCH /config/versions/:version/mark-stable', () => {
  it('retourne 403 sans auth', async () => {
    const res = await request(app).patch('/config/versions/1.1.0/mark-stable');
    expect(res.status).toBe(403);
  });

  it('retourne 403 pour un CLIENT', async () => {
    const res = await request(app)
      .patch('/config/versions/1.1.0/mark-stable')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 200 pour un ADMIN', async () => {
    const res = await request(app)
      .patch('/config/versions/1.1.0/mark-stable')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.isStable).toBe(true);
    expect(res.body.message).toMatch(/1.1.0/);
    expect(res.body.timestamp).toBeTruthy();
  });

  it('appelle rollbackManager.markVersionAsStable avec la bonne version', async () => {
    await request(app)
      .patch('/config/versions/1.1.0/mark-stable')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(rollbackManager.markVersionAsStable).toHaveBeenCalledWith('1.1.0');
  });

  it('retourne 500 si rollbackManager.markVersionAsStable échoue', async () => {
    rollbackManager.markVersionAsStable.mockRejectedValueOnce(new Error('Version not found'));
    const res = await request(app)
      .patch('/config/versions/99.99.99/mark-stable')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
  });
});
