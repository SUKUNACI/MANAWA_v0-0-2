/**
 * Tests pour routes/bulk-operations.js
 * Endpoints: POST / (bulk create), PATCH / (bulk update), DELETE / (bulk delete)
 * Authentification via middleware interne (bulkRateLimitMiddleware)
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// ─── MOCKS ─────────────────────────────────────────────────────────────────────

jest.mock('../../config/db', () => ({
  project: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../config/redis', () => ({
  getRedisClient: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue([]),
}));

// ─── SETUP ─────────────────────────────────────────────────────────────────────

const prisma = require('../../config/db');
const redisModule = require('../../config/redis');

let app;
let mockRedisClient;

function makeAdminToken(id = 'admin-1') {
  return jwt.sign(
    { id, role: 'ADMIN', email: 'admin@test.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeClientToken(id = 'client-1') {
  return jwt.sign(
    { id, role: 'CLIENT', email: 'client@test.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

beforeAll(() => {
  mockRedisClient = {
    get: jest.fn().mockResolvedValue('0'),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(3500),
    lpush: jest.fn().mockResolvedValue(1),
    ltrim: jest.fn().mockResolvedValue(0),
  };
  redisModule.getRedisClient.mockReturnValue(mockRedisClient);

  app = express();
  app.use(express.json());

  // Middleware JWT pour injecter req.user avant que bulkRateLimitMiddleware s'exécute
  app.use((req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return next();
    const token = header.split(' ')[1];
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // req.user reste undefined → bulkRateLimitMiddleware renverra 401
    }
    next();
  });

  const bulkRoutes = require('../../routes/bulk-operations');
  app.use('/projects/bulk', bulkRoutes);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisClient.get.mockResolvedValue('0');
  mockRedisClient.incr.mockResolvedValue(1);
  mockRedisClient.expire.mockResolvedValue(1);
  mockRedisClient.ttl.mockResolvedValue(3500);
  mockRedisClient.lpush.mockResolvedValue(1);
  mockRedisClient.ltrim.mockResolvedValue(0);
  redisModule.getRedisClient.mockReturnValue(mockRedisClient);
});

// ─── DONNÉES DE TEST ───────────────────────────────────────────────────────────

const validProject = {
  title: 'Rénovation cuisine',
  budget: 8000,
  city: 'Paris',
  description: 'Rénover la cuisine complète',
};

const mockCreatedProject = {
  id: 'proj-uuid-1',
  title: 'Rénovation cuisine',
  budget: 8000,
  city: 'Paris',
  status: 'OPEN',
  createdAt: new Date().toISOString(),
};

const mockUpdatedProject = {
  id: 'proj-uuid-1',
  title: 'Titre modifié',
  status: 'IN_PROGRESS',
};

// ─── POST /projects/bulk — BULK CREATE ────────────────────────────────────────

describe('POST /projects/bulk — Bulk Create', () => {
  test('201 — crée plusieurs projets avec succès', async () => {
    prisma.project.create.mockResolvedValue(mockCreatedProject);

    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([
        validProject,
        { title: 'Toiture neuve', budget: 15000, city: 'Lyon' },
      ]);

    expect(res.status).toBe(201);
    expect(res.body.operation).toBe('bulk_create');
    expect(res.body.created).toBe(2);
    expect(res.body.failed).toBe(0);
    expect(res.body.totalItems).toBe(2);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.durationMs).toBe('number');
  });

  test('201 — retourne les headers X-Bulk-RateLimit', async () => {
    prisma.project.create.mockResolvedValue(mockCreatedProject);

    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([validProject]);

    expect(res.status).toBe(201);
    expect(res.headers['x-bulk-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-bulk-ratelimit-reset']).toBeDefined();
  });

  test('201 — succès partiel quand certaines créations échouent', async () => {
    prisma.project.create
      .mockResolvedValueOnce(mockCreatedProject)
      .mockRejectedValueOnce(new Error('Contrainte unique violée'));

    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([
        validProject,
        { title: 'Doublon titre', budget: 999, city: 'Marseille' },
      ]);

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect(res.body.failed).toBe(1);
  });

  test('400 — tableau vide', async () => {
    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  test('400 — plus de 50 items (max dépassé)', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      title: `Projet ${i}`,
      budget: 1000,
      city: 'Paris',
    }));

    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send(items);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  test('400 — champ title manquant', async () => {
    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([{ budget: 5000, city: 'Paris' }]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].error).toMatch(/title/i);
  });

  test('400 — champ city manquant', async () => {
    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([{ title: 'Mon projet', budget: 5000 }]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].error).toMatch(/city/i);
  });

  test('400 — budget non numérique', async () => {
    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([{ title: 'Projet', budget: 'pas-un-nombre', city: 'Paris' }]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  test('401 — sans header Authorization', async () => {
    const res = await request(app)
      .post('/projects/bulk')
      .send([validProject]);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Non authentifié/i);
  });

  test('401 — token JWT invalide', async () => {
    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', 'Bearer token.invalide.xxx')
      .send([validProject]);

    expect(res.status).toBe(401);
  });

  test('403 — rôle CLIENT refusé', async () => {
    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeClientToken()}`)
      .send([validProject]);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administrateur/i);
  });

  test('429 — rate limit dépassé après 5 appels par heure', async () => {
    mockRedisClient.get.mockResolvedValue('5');
    mockRedisClient.ttl.mockResolvedValue(1800);

    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([validProject]);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('BULK_RATE_LIMIT_EXCEEDED');
    expect(res.headers['x-bulk-ratelimit-remaining']).toBe('0');
    expect(res.body).toHaveProperty('resetIn');
  });
});

// ─── PATCH /projects/bulk — BULK UPDATE ───────────────────────────────────────

describe('PATCH /projects/bulk — Bulk Update', () => {
  test('200 — met à jour plusieurs projets avec succès', async () => {
    prisma.project.update.mockResolvedValue(mockUpdatedProject);

    const res = await request(app)
      .patch('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([
        { id: 'proj-uuid-1', title: 'Mise à jour 1', status: 'IN_PROGRESS' },
        { id: 'proj-uuid-2', status: 'COMPLETED', budget: 12000 },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('bulk_update');
    expect(res.body.updated).toBe(2);
    expect(res.body.failed).toBe(0);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('200 — succès partiel quand un update échoue', async () => {
    prisma.project.update
      .mockResolvedValueOnce(mockUpdatedProject)
      .mockRejectedValueOnce(new Error('Record not found'));

    const res = await request(app)
      .patch('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([
        { id: 'proj-uuid-1', title: 'OK' },
        { id: 'proj-uuid-404', title: 'Fail' },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.failed).toBe(1);
  });

  test('400 — tableau vide', async () => {
    const res = await request(app)
      .patch('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  test('400 — IDs dupliqués dans le batch', async () => {
    const res = await request(app)
      .patch('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([
        { id: 'proj-uuid-1', title: 'Version A' },
        { id: 'proj-uuid-1', title: 'Version B' },
      ]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].error).toMatch(/uniques/i);
  });

  test('400 — plus de 50 items', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      id: `proj-${i}`,
      title: `Titre ${i}`,
    }));

    const res = await request(app)
      .patch('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send(items);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .patch('/projects/bulk')
      .send([{ id: 'proj-1', title: 'Update' }]);

    expect(res.status).toBe(401);
  });

  test('403 — rôle non-admin', async () => {
    const res = await request(app)
      .patch('/projects/bulk')
      .set('Authorization', `Bearer ${makeClientToken()}`)
      .send([{ id: 'proj-1', title: 'Update' }]);

    expect(res.status).toBe(403);
  });

  test('429 — rate limit dépassé', async () => {
    mockRedisClient.get.mockResolvedValue('5');

    const res = await request(app)
      .patch('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([{ id: 'proj-1', title: 'Update' }]);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('BULK_RATE_LIMIT_EXCEEDED');
  });

  test('200 — retourne durationMs dans la réponse', async () => {
    prisma.project.update.mockResolvedValue(mockUpdatedProject);

    const res = await request(app)
      .patch('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([{ id: 'proj-uuid-1', title: 'Nouveau titre' }]);

    expect(res.status).toBe(200);
    expect(typeof res.body.durationMs).toBe('number');
  });
});

// ─── DELETE /projects/bulk — BULK DELETE ──────────────────────────────────────

describe('DELETE /projects/bulk — Bulk Delete', () => {
  test('200 — supprime plusieurs projets par IDs', async () => {
    prisma.project.delete.mockResolvedValue({ id: 'proj-uuid-1' });

    const res = await request(app)
      .delete('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send({ ids: ['proj-uuid-1', 'proj-uuid-2', 'proj-uuid-3'] });

    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('bulk_delete');
    expect(res.body.deleted).toBe(3);
    expect(res.body.failed).toBe(0);
    expect(res.body.totalItems).toBe(3);
    expect(Array.isArray(res.body.deletedIds)).toBe(true);
  });

  test('200 — retourne durationMs', async () => {
    prisma.project.delete.mockResolvedValue({ id: 'proj-uuid-1' });

    const res = await request(app)
      .delete('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send({ ids: ['proj-uuid-1'] });

    expect(res.status).toBe(200);
    expect(typeof res.body.durationMs).toBe('number');
  });

  test('200 — succès partiel quand certains deletes échouent', async () => {
    prisma.project.delete
      .mockResolvedValueOnce({ id: 'proj-uuid-1' })
      .mockRejectedValueOnce(new Error('Record not found'));

    const res = await request(app)
      .delete('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send({ ids: ['proj-uuid-1', 'proj-uuid-404'] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(res.body.failed).toBe(1);
  });

  test('400 — IDs tableau vide', async () => {
    const res = await request(app)
      .delete('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send({ ids: [] });

    expect(res.status).toBe(400);
  });

  test('400 — plus de 50 IDs', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `proj-${i}`);

    const res = await request(app)
      .delete('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send({ ids });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY_ITEMS');
  });

  test('400 — IDs dupliqués', async () => {
    const res = await request(app)
      .delete('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send({ ids: ['proj-uuid-1', 'proj-uuid-1', 'proj-uuid-2'] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DUPLICATE_IDS');
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .delete('/projects/bulk')
      .send({ ids: ['proj-uuid-1'] });

    expect(res.status).toBe(401);
  });

  test('403 — rôle CLIENT refusé', async () => {
    const res = await request(app)
      .delete('/projects/bulk')
      .set('Authorization', `Bearer ${makeClientToken()}`)
      .send({ ids: ['proj-uuid-1'] });

    expect(res.status).toBe(403);
  });

  test('429 — rate limit dépassé', async () => {
    mockRedisClient.get.mockResolvedValue('5');

    const res = await request(app)
      .delete('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send({ ids: ['proj-uuid-1'] });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('BULK_RATE_LIMIT_EXCEEDED');
  });
});

// ─── RATE LIMIT — comportement du compteur ────────────────────────────────────

describe('Rate Limit — compteur et headers', () => {
  test('calcule correctement le remaining après 1 appel déjà effectué', async () => {
    prisma.project.create.mockResolvedValue(mockCreatedProject);
    mockRedisClient.get.mockResolvedValue('1'); // 1 appel déjà fait → 3 restants après cet appel

    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([validProject]);

    expect(res.status).toBe(201);
    expect(mockRedisClient.incr).toHaveBeenCalled();
    // remaining = 5 - (1 + 1) = 3
    expect(res.headers['x-bulk-ratelimit-remaining']).toBe('3');
  });

  test('erreur Redis → la requête passe quand même (allow on error)', async () => {
    prisma.project.create.mockResolvedValue(mockCreatedProject);
    mockRedisClient.get.mockRejectedValue(new Error('Redis unavailable'));

    const res = await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([validProject]);

    // On Redis error: allowed = true, donc 201
    expect(res.status).toBe(201);
  });

  test('expire est appelé uniquement au premier appel (count === 0)', async () => {
    prisma.project.create.mockResolvedValue(mockCreatedProject);
    mockRedisClient.get.mockResolvedValue('0'); // premier appel

    await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([validProject]);

    expect(mockRedisClient.expire).toHaveBeenCalled();
  });

  test('expire NON appelé sur la clé rate-limit si count > 0 (fenêtre déjà initialisée)', async () => {
    prisma.project.create.mockResolvedValue(mockCreatedProject);
    mockRedisClient.get.mockResolvedValue('2'); // déjà 2 appels

    await request(app)
      .post('/projects/bulk')
      .set('Authorization', `Bearer ${makeAdminToken()}`)
      .send([validProject]);

    // La clé rate-limit ne doit PAS recevoir expire (seulement logBulkOperation appelle expire pour le log)
    const rateLimitCalls = mockRedisClient.expire.mock.calls.filter((args) =>
      args[0].includes('bulk_ops:rate_limit:')
    );
    expect(rateLimitCalls).toHaveLength(0);
  });
});
