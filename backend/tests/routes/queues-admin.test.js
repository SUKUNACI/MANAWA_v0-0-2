/**
 * Tests pour routes/queues-admin.js
 * Endpoints:
 *   GET  /                            - liste tous les statuts des queues
 *   GET  /:queueName                  - statut d'une queue spécifique
 *   GET  /:queueName/jobs             - liste les jobs d'une queue
 *   GET  /:queueName/jobs/:jobId      - détail d'un job
 *   POST /:queueName/retry            - relancer les jobs en échec
 *   POST /:queueName/jobs/:jobId/retry - relancer un job spécifique
 *   DELETE /:queueName/jobs/:jobId    - supprimer un job
 *   POST /:queueName/clean            - nettoyer les vieux jobs
 *   POST /:queueName/pause            - mettre en pause une queue
 *   POST /:queueName/resume           - reprendre une queue
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { adminToken, clientToken, proToken } = require('../helpers');

// ─── MOCK DE LA QUEUE BULL ─────────────────────────────────────────────────────

const mockJob = {
  id: 'job-123',
  data: { type: 'email', to: 'user@test.com' },
  attemptsMade: 1,
  opts: { attempts: 3 },
  timestamp: Date.now(),
  finishedOn: null,
  startedOn: null,
  failedReason: null,
  returnvalue: null,
  progress: jest.fn().mockReturnValue(50),
  getState: jest.fn().mockResolvedValue('completed'),
  getLog: jest.fn().mockResolvedValue(['log line 1', 'log line 2']),
  retry: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
};

const mockQueueStats = {
  name: 'emails',
  active: 1,
  completed: 100,
  failed: 2,
  delayed: 0,
  waiting: 5,
  recentFailedJobs: 2,
  recentDelayedJobs: 0,
  timestamp: new Date().toISOString(),
};

const makeMockQueue = (name = 'emails') => ({
  name,
  getJobCounts: jest.fn().mockResolvedValue({
    active: 1, completed: 100, failed: 2, delayed: 0, waiting: 5,
  }),
  getActive: jest.fn().mockResolvedValue([mockJob]),
  getCompleted: jest.fn().mockResolvedValue([mockJob]),
  getFailed: jest.fn().mockResolvedValue([mockJob]),
  getDelayed: jest.fn().mockResolvedValue([]),
  getWaiting: jest.fn().mockResolvedValue([mockJob]),
  getJob: jest.fn().mockResolvedValue(mockJob),
  getJobCountByTypes: jest.fn().mockResolvedValue({ waiting: 10, active: 1 }),
  pause: jest.fn().mockResolvedValue(undefined),
  resume: jest.fn().mockResolvedValue(undefined),
  clean: jest.fn().mockResolvedValue([mockJob, mockJob]),
  on: jest.fn(),
});

// Mock config/queue avant tout import de route
jest.mock('../../config/queue', () => {
  const makeQ = (n) => ({
    name: n,
    getJobCounts: jest.fn().mockResolvedValue({ active: 1, completed: 100, failed: 2, delayed: 0, waiting: 5 }),
    getActive: jest.fn().mockResolvedValue([]),
    getCompleted: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
    getDelayed: jest.fn().mockResolvedValue([]),
    getWaiting: jest.fn().mockResolvedValue([]),
    getJob: jest.fn(),
    getJobCountByTypes: jest.fn().mockResolvedValue({ waiting: 0 }),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    clean: jest.fn().mockResolvedValue([]),
    on: jest.fn(),
  });

  return {
    emailQueue: makeQ('emails'),
    pdfQueue: makeQ('pdfs'),
    analyticsQueue: makeQ('analytics'),
    paymentQueue: makeQ('payments'),
    badgesQueue: makeQ('badges'),
    getQueueStats: jest.fn(),
    retryFailedJobs: jest.fn(),
    cleanOldJobs: jest.fn(),
  };
});

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const jwtLib = require('jsonwebtoken');
    try {
      req.user = jwtLib.verify(header.split(' ')[1], process.env.JWT_SECRET);
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
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 50 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue([]),
}));

jest.mock('../../utils/pagination-helper', () => ({
  applyPagination: jest.fn(),
  validatePaginationQuery: jest.fn((req, res, next) => next()),
  buildPaginatedResponse: jest.fn(),
}));

// ─── SETUP ─────────────────────────────────────────────────────────────────────

const queueModule = require('../../config/queue');

let app;

beforeAll(() => {
  app = express();
  app.use(express.json());

  const queuesAdminRoutes = require('../../routes/queues-admin');
  app.use('/api/admin/queues', queuesAdminRoutes);

  // Gestionnaire d'erreur global pour les tests
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  });
});

beforeEach(() => {
  jest.clearAllMocks();

  // Réinitialiser les mocks job
  mockJob.getState.mockResolvedValue('completed');
  mockJob.getLog.mockResolvedValue(['log line 1']);
  mockJob.progress.mockReturnValue(50);
  mockJob.retry.mockResolvedValue(undefined);
  mockJob.remove.mockResolvedValue(undefined);

  // Réinitialiser getQueueStats
  queueModule.getQueueStats.mockResolvedValue(mockQueueStats);
  queueModule.retryFailedJobs.mockResolvedValue([
    { jobId: 'job-1', data: {}, timestamp: new Date().toISOString() },
  ]);
  queueModule.cleanOldJobs.mockResolvedValue({ completed: 5, failed: 2 });

  // Réinitialiser getJob sur chaque queue
  ['emailQueue', 'pdfQueue', 'analyticsQueue', 'paymentQueue', 'badgesQueue'].forEach((qName) => {
    queueModule[qName].getJob.mockResolvedValue(mockJob);
    queueModule[qName].getWaiting.mockResolvedValue([mockJob]);
    queueModule[qName].getActive.mockResolvedValue([mockJob]);
    queueModule[qName].getFailed.mockResolvedValue([mockJob]);
    queueModule[qName].getCompleted.mockResolvedValue([mockJob]);
    queueModule[qName].getDelayed.mockResolvedValue([]);
    queueModule[qName].getJobCountByTypes.mockResolvedValue({ waiting: 10 });
  });
});

// ─── GET /api/admin/queues ─────────────────────────────────────────────────────

describe('GET /api/admin/queues — Toutes les queues', () => {
  test('200 — retourne les statuts de toutes les queues (ADMIN)', async () => {
    const res = await request(app)
      .get('/api/admin/queues')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.queues)).toBe(true);
    expect(res.body).toHaveProperty('timestamp');
  });

  test('200 — appelle getQueueStats pour les 5 queues', async () => {
    await request(app)
      .get('/api/admin/queues')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(queueModule.getQueueStats).toHaveBeenCalledTimes(5);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .get('/api/admin/queues');

    expect(res.status).toBe(401);
  });

  test('401 — token invalide', async () => {
    const res = await request(app)
      .get('/api/admin/queues')
      .set('Authorization', 'Bearer token.invalide.xxx');

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const res = await request(app)
      .get('/api/admin/queues')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });

  test('403 — PROFESSIONAL refusé', async () => {
    const res = await request(app)
      .get('/api/admin/queues')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/admin/queues/:queueName ─────────────────────────────────────────

describe('GET /api/admin/queues/:queueName — Statut d\'une queue', () => {
  test('200 — retourne le statut de la queue emails', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('queue');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('200 — fonctionne pour toutes les queues valides', async () => {
    const queues = ['emails', 'pdfs', 'analytics', 'payments', 'badges'];

    for (const qName of queues) {
      const res = await request(app)
        .get(`/api/admin/queues/${qName}`)
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    }
  });

  test('400 — queueName invalide retourne erreur de validation', async () => {
    const res = await request(app)
      .get('/api/admin/queues/queue-inexistante')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails');

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/admin/queues/:queueName/jobs ────────────────────────────────────

describe('GET /api/admin/queues/:queueName/jobs — Jobs d\'une queue', () => {
  test('200 — retourne les jobs en attente par défaut (status=waiting)', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.queueName).toBe('emails');
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body).toHaveProperty('timestamp');
  });

  test('200 — filtre par status=active', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=active')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(queueModule.emailQueue.getActive).toHaveBeenCalled();
  });

  test('200 — filtre par status=completed', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=completed')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(queueModule.emailQueue.getCompleted).toHaveBeenCalled();
  });

  test('200 — filtre par status=failed', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=failed')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(queueModule.emailQueue.getFailed).toHaveBeenCalled();
  });

  test('200 — filtre par status=delayed', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=delayed')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('delayed');
    expect(queueModule.emailQueue.getDelayed).toHaveBeenCalled();
  });

  test('200 — format des jobs dans la réponse', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=waiting')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    if (res.body.jobs.length > 0) {
      const job = res.body.jobs[0];
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('data');
      expect(job).toHaveProperty('attempts');
    }
  });

  test('400 — status invalide', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=running')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  test('400 — queueName invalide', async () => {
    const res = await request(app)
      .get('/api/admin/queues/queue-inconnue/jobs')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs');

    expect(res.status).toBe(401);
  });

  test('403 — non-admin refusé', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/admin/queues/:queueName/jobs/:jobId ─────────────────────────────

describe('GET /api/admin/queues/:queueName/jobs/:jobId — Détail d\'un job', () => {
  test('200 — retourne les détails complets d\'un job', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs/job-123')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.job).toBeDefined();
    expect(res.body.job.id).toBe('job-123');
    expect(res.body.job).toHaveProperty('data');
    expect(res.body.job).toHaveProperty('state');
    expect(res.body.job).toHaveProperty('progress');
    expect(res.body.job).toHaveProperty('attempts');
    expect(res.body.job).toHaveProperty('logs');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('200 — les logs sont limités aux 50 dernières entrées', async () => {
    const longLogs = Array.from({ length: 100 }, (_, i) => `log ${i}`);
    mockJob.getLog.mockResolvedValue(longLogs);

    const res = await request(app)
      .get('/api/admin/queues/emails/jobs/job-123')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.job.logs.length).toBeLessThanOrEqual(50);
  });

  test('404 — job inexistant', async () => {
    queueModule.emailQueue.getJob.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/admin/queues/emails/jobs/job-inexistant-999')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Job not found/i);
  });

  test('400 — queueName invalide', async () => {
    const res = await request(app)
      .get('/api/admin/queues/queue-inconnue/jobs/job-123')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs/job-123');

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const res = await request(app)
      .get('/api/admin/queues/emails/jobs/job-123')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/admin/queues/:queueName/retry ──────────────────────────────────

describe('POST /api/admin/queues/:queueName/retry — Relancer les jobs échoués', () => {
  test('200 — relance les jobs en échec', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('message');
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(res.body).toHaveProperty('timestamp');
  });

  test('200 — utilise limit=10 par défaut', async () => {
    await request(app)
      .post('/api/admin/queues/emails/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(queueModule.retryFailedJobs).toHaveBeenCalledWith(
      expect.anything(),
      'emails',
      10
    );
  });

  test('200 — fonctionne pour la queue pdfs', async () => {
    const res = await request(app)
      .post('/api/admin/queues/pdfs/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(queueModule.retryFailedJobs).toHaveBeenCalledWith(
      expect.anything(),
      'pdfs',
      10
    );
  });

  test('400 — queueName invalide', async () => {
    const res = await request(app)
      .post('/api/admin/queues/queue-invalide/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/retry')
      .send({});

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/retry')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({});

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/admin/queues/:queueName/jobs/:jobId/retry ──────────────────────

describe('POST /api/admin/queues/:queueName/jobs/:jobId/retry — Relancer un job', () => {
  test('200 — relance un job spécifique', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/jobs/job-123/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('message');
    expect(res.body.job.id).toBe('job-123');
    expect(mockJob.retry).toHaveBeenCalled();
  });

  test('404 — job inexistant', async () => {
    queueModule.emailQueue.getJob.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/admin/queues/emails/jobs/job-inexistant/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Job not found/i);
  });

  test('400 — queueName invalide', async () => {
    const res = await request(app)
      .post('/api/admin/queues/queue-invalide/jobs/job-123/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/jobs/job-123/retry')
      .send({});

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/jobs/job-123/retry')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({});

    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/admin/queues/:queueName/jobs/:jobId ──────────────────────────

describe('DELETE /api/admin/queues/:queueName/jobs/:jobId — Supprimer un job', () => {
  test('200 — supprime un job spécifique', async () => {
    const res = await request(app)
      .delete('/api/admin/queues/emails/jobs/job-123')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/removed/i);
    expect(mockJob.remove).toHaveBeenCalled();
  });

  test('404 — job inexistant', async () => {
    queueModule.emailQueue.getJob.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/admin/queues/emails/jobs/job-inexistant')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Job not found/i);
  });

  test('400 — queueName invalide', async () => {
    const res = await request(app)
      .delete('/api/admin/queues/queue-invalide/jobs/job-123')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .delete('/api/admin/queues/emails/jobs/job-123');

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const res = await request(app)
      .delete('/api/admin/queues/emails/jobs/job-123')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/admin/queues/:queueName/clean ──────────────────────────────────

describe('POST /api/admin/queues/:queueName/clean — Nettoyer les vieux jobs', () => {
  test('200 — nettoie les jobs plus anciens que 7 jours (défaut)', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/clean')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('cleaned');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('200 — utilise daysOld=7 par défaut', async () => {
    await request(app)
      .post('/api/admin/queues/emails/clean')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(queueModule.cleanOldJobs).toHaveBeenCalledWith(
      expect.anything(),
      'emails',
      7
    );
  });

  test('200 — accepte daysOld personnalisé', async () => {
    await request(app)
      .post('/api/admin/queues/emails/clean')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ daysOld: 30 });

    expect(queueModule.cleanOldJobs).toHaveBeenCalledWith(
      expect.anything(),
      'emails',
      30
    );
  });

  test('200 — résultat contient completed et failed nettoyés', async () => {
    queueModule.cleanOldJobs.mockResolvedValue({ completed: 10, failed: 3 });

    const res = await request(app)
      .post('/api/admin/queues/pdfs/clean')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.cleaned).toEqual({ completed: 10, failed: 3 });
  });

  test('400 — queueName invalide', async () => {
    const res = await request(app)
      .post('/api/admin/queues/queue-invalide/clean')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/clean')
      .send({});

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/clean')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({});

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/admin/queues/:queueName/pause ──────────────────────────────────

describe('POST /api/admin/queues/:queueName/pause — Mettre en pause', () => {
  test('200 — met en pause la queue emails', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/pause')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/paused/i);
    expect(queueModule.emailQueue.pause).toHaveBeenCalled();
  });

  test('200 — fonctionne pour analytics', async () => {
    const res = await request(app)
      .post('/api/admin/queues/analytics/pause')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(queueModule.analyticsQueue.pause).toHaveBeenCalled();
  });

  test('400 — queueName invalide', async () => {
    const res = await request(app)
      .post('/api/admin/queues/queue-invalide/pause')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/pause');

    expect(res.status).toBe(401);
  });

  test('403 — CLIENT refusé', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/pause')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/admin/queues/:queueName/resume ─────────────────────────────────

describe('POST /api/admin/queues/:queueName/resume — Reprendre une queue', () => {
  test('200 — reprend la queue emails', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/resume')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/resumed/i);
    expect(queueModule.emailQueue.resume).toHaveBeenCalled();
  });

  test('200 — fonctionne pour payments', async () => {
    const res = await request(app)
      .post('/api/admin/queues/payments/resume')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(queueModule.paymentQueue.resume).toHaveBeenCalled();
  });

  test('400 — queueName invalide', async () => {
    const res = await request(app)
      .post('/api/admin/queues/queue-invalide/resume')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/resume');

    expect(res.status).toBe(401);
  });

  test('403 — PROFESSIONAL refusé', async () => {
    const res = await request(app)
      .post('/api/admin/queues/emails/resume')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── EDGE CASES ───────────────────────────────────────────────────────────────

describe('Edge Cases — queues-admin', () => {
  test('GET /api/admin/queues — gère l\'erreur de getQueueStats gracieusement', async () => {
    queueModule.getQueueStats.mockRejectedValue(new Error('Redis unavailable'));

    const res = await request(app)
      .get('/api/admin/queues')
      .set('Authorization', `Bearer ${adminToken()}`);

    // Doit propager l'erreur ou retourner 500
    expect([200, 500]).toContain(res.status);
  });

  test('POST /:queueName/retry — gère l\'erreur retryFailedJobs', async () => {
    queueModule.retryFailedJobs.mockRejectedValue(new Error('Retry failed'));

    const res = await request(app)
      .post('/api/admin/queues/emails/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(500);
  });

  test('POST /:queueName/clean — gère l\'erreur cleanOldJobs', async () => {
    queueModule.cleanOldJobs.mockRejectedValue(new Error('Clean failed'));

    const res = await request(app)
      .post('/api/admin/queues/emails/clean')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(500);
  });

  test('GET /:queueName/jobs/:jobId — gère job.getState() rejetée', async () => {
    mockJob.getState.mockRejectedValue(new Error('State error'));

    const res = await request(app)
      .get('/api/admin/queues/emails/jobs/job-123')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });

  test('DELETE /:queueName/jobs/:jobId — gère job.remove() rejetée', async () => {
    mockJob.remove.mockRejectedValue(new Error('Remove failed'));

    const res = await request(app)
      .delete('/api/admin/queues/emails/jobs/job-123')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });

  test('GET /:queueName/jobs — retourne liste vide si queue vide', async () => {
    queueModule.emailQueue.getWaiting.mockResolvedValue([]);
    queueModule.emailQueue.getJobCountByTypes.mockResolvedValue({ waiting: 0 });

    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=waiting')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual([]);
  });

  test('GET /:queueName/jobs — mappe correctement les jobs sans getState (branche ternaire)', async () => {
    const jobSansGetState = {
      id: 'job-no-state',
      data: { type: 'pdf' },
      attemptsMade: 0,
      opts: { attempts: 1 },
      timestamp: Date.now(),
      finishedOn: null,
      failedReason: null,
      // getState absent intentionnellement → branche ternaire status fallback
      progress: jest.fn().mockReturnValue(0),
    };
    queueModule.emailQueue.getWaiting.mockResolvedValue([jobSansGetState]);
    queueModule.emailQueue.getJobCountByTypes.mockResolvedValue({ waiting: 1 });

    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=waiting')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    // Sans getState, le status du job doit tomber sur le fallback 'waiting'
    expect(res.body.jobs[0].status).toBe('waiting');
  });

  test('GET /:queueName/jobs — mappe correctement les jobs sans progress (branche ternaire)', async () => {
    const jobSansProgress = {
      id: 'job-no-progress',
      data: { type: 'badge' },
      attemptsMade: 0,
      opts: { attempts: 1 },
      timestamp: Date.now(),
      finishedOn: null,
      failedReason: null,
      getState: jest.fn().mockReturnValue('waiting'),
      // progress absent intentionnellement → fallback 0
    };
    queueModule.emailQueue.getActive.mockResolvedValue([jobSansProgress]);
    queueModule.emailQueue.getJobCountByTypes.mockResolvedValue({ active: 1 });

    const res = await request(app)
      .get('/api/admin/queues/emails/jobs?status=active')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.jobs[0].progress).toBe(0);
  });

  test('POST /:queueName/pause — gère l\'erreur queue.pause()', async () => {
    queueModule.emailQueue.pause.mockRejectedValue(new Error('Pause failed'));

    const res = await request(app)
      .post('/api/admin/queues/emails/pause')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });

  test('POST /:queueName/resume — gère l\'erreur queue.resume()', async () => {
    queueModule.emailQueue.resume.mockRejectedValue(new Error('Resume failed'));

    const res = await request(app)
      .post('/api/admin/queues/emails/resume')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });

  test('POST /:queueName/jobs/:jobId/retry — gère job.retry() rejetée', async () => {
    mockJob.retry.mockRejectedValue(new Error('Retry failed'));

    const res = await request(app)
      .post('/api/admin/queues/emails/jobs/job-123/retry')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(500);
  });

  test('GET /:queueName — gère l\'erreur getQueueStats pour une queue spécifique', async () => {
    queueModule.getQueueStats.mockRejectedValue(new Error('Stats error'));

    const res = await request(app)
      .get('/api/admin/queues/pdfs')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });
});
