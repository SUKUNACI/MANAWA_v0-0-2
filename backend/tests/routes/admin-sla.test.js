/**
 * Tests for admin-sla routes
 * Module: routes/admin-sla.js
 * Endpoints:
 *   GET   /targets
 *   POST  /targets
 *   POST  /breaches
 *   PATCH /breaches/:id/resolve
 *   GET   /report
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken, proToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  slaTarget: {
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    upsert:     jest.fn(),
  },
  slaBreach: {
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

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
}));

const slaRoutes = require('../../routes/admin-sla');

const app = express();
app.use(express.json());
app.use('/admin/sla', slaRoutes);

describe('Admin SLA Routes', () => {
  let prisma;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = require('../../config/db');
  });

  // ─── GET /targets ─────────────────────────────────────────────────────────

  describe('GET /admin/sla/targets', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/sla/targets');
      expect(res.status).toBe(401);
    });

    it('returns 403 for CLIENT role', async () => {
      const res = await request(app)
        .get('/admin/sla/targets')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 for PROFESSIONAL role', async () => {
      const res = await request(app)
        .get('/admin/sla/targets')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with existing targets', async () => {
      const targets = [
        { id: 't1', name: 'api_p95_latency', category: 'latency', targetValue: 500, unit: 'ms', windowHours: 1 },
      ];
      prisma.slaTarget.findMany.mockResolvedValue(targets);

      const res = await request(app)
        .get('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.targets).toHaveLength(1);
    });

    it('seeds default targets when none exist and returns them', async () => {
      // First call (check if empty): returns []
      // After seeding: second call returns seeded defaults
      const seededTargets = [
        { id: 't1', name: 'api_p95_latency', category: 'latency', targetValue: 500, unit: 'ms', windowHours: 1 },
        { id: 't2', name: 'uptime', category: 'availability', targetValue: 99.9, unit: '%', windowHours: 720 },
      ];
      prisma.slaTarget.findMany
        .mockResolvedValueOnce([])        // first call: empty
        .mockResolvedValueOnce(seededTargets); // second call: after seed
      prisma.slaTarget.upsert.mockResolvedValue({});

      const res = await request(app)
        .get('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(prisma.slaTarget.upsert).toHaveBeenCalled();
      expect(res.body.data.targets).toHaveLength(2);
    });

    it('returns 500 on database error', async () => {
      prisma.slaTarget.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to list SLA targets');
    });
  });

  // ─── POST /targets ────────────────────────────────────────────────────────

  describe('POST /admin/sla/targets', () => {
    const validTarget = {
      name:        'custom_latency',
      category:    'latency',
      targetValue: 300,
      unit:        'ms',
    };

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/admin/sla/targets').send(validTarget);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .post('/admin/sla/targets')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send(validTarget);
      expect(res.status).toBe(403);
    });

    it('returns 400 when name is empty', async () => {
      const res = await request(app)
        .post('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validTarget, name: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when category is invalid', async () => {
      const res = await request(app)
        .post('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validTarget, category: 'invalid_category' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when targetValue is negative', async () => {
      const res = await request(app)
        .post('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validTarget, targetValue: -1 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when unit is missing', async () => {
      const res = await request(app)
        .post('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test', category: 'latency', targetValue: 100 });
      expect(res.status).toBe(400);
    });

    it('returns 201 and creates SLA target', async () => {
      const created = { id: 'target-1', ...validTarget, windowHours: 24 };
      prisma.slaTarget.upsert.mockResolvedValue(created);

      const res = await request(app)
        .post('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validTarget);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.target.id).toBe('target-1');
    });

    it('returns 201 with valid categories: availability, error_rate, throughput', async () => {
      for (const category of ['availability', 'error_rate', 'throughput']) {
        prisma.slaTarget.upsert.mockResolvedValue({ id: 'target-x', ...validTarget, category });

        const res = await request(app)
          .post('/admin/sla/targets')
          .set('Authorization', `Bearer ${adminToken()}`)
          .send({ ...validTarget, category });

        expect(res.status).toBe(201);
      }
    });

    it('returns 500 on database error', async () => {
      prisma.slaTarget.upsert.mockRejectedValue(new Error('upsert failed'));

      const res = await request(app)
        .post('/admin/sla/targets')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validTarget);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to upsert SLA target');
    });
  });

  // ─── POST /breaches ───────────────────────────────────────────────────────

  describe('POST /admin/sla/breaches', () => {
    const validBreach = {
      slaTargetId:   'target-1',
      measuredValue: 750,
    };

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/admin/sla/breaches').send(validBreach);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .post('/admin/sla/breaches')
        .set('Authorization', `Bearer ${proToken()}`)
        .send(validBreach);
      expect(res.status).toBe(403);
    });

    it('returns 400 when slaTargetId is missing', async () => {
      const res = await request(app)
        .post('/admin/sla/breaches')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ measuredValue: 500 });
      expect(res.status).toBe(400);
    });

    it('returns 404 when SLA target does not exist', async () => {
      prisma.slaTarget.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/sla/breaches')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validBreach);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('SLA target not found');
    });

    it('returns 201 and records breach', async () => {
      prisma.slaTarget.findUnique.mockResolvedValue({
        id: 'target-1', name: 'api_p95_latency', targetValue: 500,
      });
      prisma.slaBreach.create.mockResolvedValue({
        id: 'breach-1', slaTargetId: 'target-1', measuredValue: 750, durationMs: null,
      });

      const res = await request(app)
        .post('/admin/sla/breaches')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validBreach);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.breach.id).toBe('breach-1');
    });

    it('returns 201 with optional durationMs', async () => {
      prisma.slaTarget.findUnique.mockResolvedValue({ id: 'target-1', name: 'uptime', targetValue: 99.9 });
      prisma.slaBreach.create.mockResolvedValue({
        id: 'breach-2', slaTargetId: 'target-1', measuredValue: 98.5, durationMs: 300000,
      });

      const res = await request(app)
        .post('/admin/sla/breaches')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validBreach, durationMs: 300000 });

      expect(res.status).toBe(201);
      expect(res.body.data.breach.durationMs).toBe(300000);
    });

    it('returns 500 on database error', async () => {
      prisma.slaTarget.findUnique.mockResolvedValue({ id: 'target-1' });
      prisma.slaBreach.create.mockRejectedValue(new Error('create failed'));

      const res = await request(app)
        .post('/admin/sla/breaches')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validBreach);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to record SLA breach');
    });
  });

  // ─── PATCH /breaches/:id/resolve ─────────────────────────────────────────

  describe('PATCH /admin/sla/breaches/:id/resolve', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).patch('/admin/sla/breaches/breach-1/resolve');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .patch('/admin/sla/breaches/breach-1/resolve')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 404 when breach does not exist', async () => {
      prisma.slaBreach.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/admin/sla/breaches/nonexistent/resolve')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Breach not found');
    });

    it('returns 200 and resolves an open breach (no resolvedAt yet)', async () => {
      const breachedAt = new Date(Date.now() - 60000); // 1 minute ago
      prisma.slaBreach.findUnique.mockResolvedValue({
        id: 'breach-1', resolvedAt: null, breachedAt, durationMs: null,
      });
      prisma.slaBreach.update.mockResolvedValue({
        id: 'breach-1', resolvedAt: new Date(), durationMs: 60000,
      });

      const res = await request(app)
        .patch('/admin/sla/breaches/breach-1/resolve')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.breach.id).toBe('breach-1');
      expect(prisma.slaBreach.update).toHaveBeenCalled();
    });

    it('returns 200 and keeps existing durationMs when already resolved', async () => {
      prisma.slaBreach.findUnique.mockResolvedValue({
        id: 'breach-2', resolvedAt: new Date(), breachedAt: new Date(), durationMs: 5000,
      });
      prisma.slaBreach.update.mockResolvedValue({
        id: 'breach-2', resolvedAt: new Date(), durationMs: 5000,
      });

      const res = await request(app)
        .patch('/admin/sla/breaches/breach-2/resolve')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.breach.durationMs).toBe(5000);
    });

    it('returns 500 on database error', async () => {
      prisma.slaBreach.findUnique.mockResolvedValue({ id: 'breach-1', resolvedAt: null, breachedAt: new Date() });
      prisma.slaBreach.update.mockRejectedValue(new Error('update failed'));

      const res = await request(app)
        .patch('/admin/sla/breaches/breach-1/resolve')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to resolve breach');
    });
  });

  // ─── GET /report ──────────────────────────────────────────────────────────

  describe('GET /admin/sla/report', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/sla/report');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/sla/report')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 400 for invalid ISO8601 from date', async () => {
      const res = await request(app)
        .get('/admin/sla/report?from=not-a-date')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('returns 200 with 100% compliance when no targets', async () => {
      prisma.slaTarget.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/sla/report')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.overallCompliance).toBe(100);
      expect(res.body.data.totalBreaches).toBe(0);
    });

    it('returns 200 with compliance report per target', async () => {
      prisma.slaTarget.findMany.mockResolvedValue([
        {
          id: 't1', name: 'api_p95_latency', category: 'latency',
          targetValue: 500, unit: 'ms', enabled: true,
          breaches: [
            { id: 'b1', durationMs: 60000, resolvedAt: new Date(), breachedAt: new Date() },
          ],
        },
        {
          id: 't2', name: 'uptime', category: 'availability',
          targetValue: 99.9, unit: '%', enabled: true,
          breaches: [],
        },
      ]);

      const res = await request(app)
        .get('/admin/sla/report')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.targets).toHaveLength(2);
      expect(res.body.data.totalBreaches).toBe(1);

      const latencyTarget = res.body.data.targets.find(t => t.name === 'api_p95_latency');
      expect(latencyTarget.breachCount).toBe(1);
      expect(latencyTarget.mttrMs).toBeGreaterThan(0);
    });

    it('returns 200 and calculates MTTR only for resolved breaches', async () => {
      prisma.slaTarget.findMany.mockResolvedValue([
        {
          id: 't1', name: 'error_rate', category: 'error_rate',
          targetValue: 0.1, unit: '%', enabled: true,
          breaches: [
            { id: 'b1', durationMs: 30000, resolvedAt: new Date(), breachedAt: new Date() },
            { id: 'b2', durationMs: null,  resolvedAt: null,        breachedAt: new Date() }, // unresolved
          ],
        },
      ]);

      const res = await request(app)
        .get('/admin/sla/report')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      const target = res.body.data.targets[0];
      // MTTR should only count resolved breach (b1 = 30000ms)
      expect(target.mttrMs).toBe(30000);
    });

    it('returns 500 on database error', async () => {
      prisma.slaTarget.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/admin/sla/report')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to generate SLA report');
    });
  });
});
