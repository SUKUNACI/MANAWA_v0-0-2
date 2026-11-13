/**
 * Tests for admin-experiments routes (A/B Testing)
 * Module: routes/admin-experiments.js — CRUD, status, results, delete
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  experiment: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
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

jest.mock('../../utils/experiment-engine', () => ({
  calculateExperimentStats: jest.fn(),
  testSignificance: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const experimentsRouter = require('../../routes/admin-experiments');

const app = express();
app.use(express.json());
app.use('/experiments', experimentsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const mockVariants = [
  { id: 'var-1', name: 'control', weight: 50 },
  { id: 'var-2', name: 'treatment', weight: 50 },
];

const mockExperiment = {
  id: 'exp-1',
  name: 'checkout-flow-test',
  description: 'Testing new checkout flow',
  trafficPercentage: 50,
  status: 'DRAFT',
  startedAt: null,
  endedAt: null,
  createdAt: new Date(),
  variants: mockVariants,
  _count: { assignments: 0 },
};

const mockStats = {
  variantStats: [
    { variantId: 'var-1', name: 'control', conversions: 10, impressions: 100, rate: 0.1 },
    { variantId: 'var-2', name: 'treatment', conversions: 15, impressions: 100, rate: 0.15 },
  ],
};

describe('Admin Experiments Routes', () => {
  let prisma;
  let experimentEngine;

  beforeEach(() => {
    prisma = require('../../config/db');
    experimentEngine = require('../../utils/experiment-engine');
    jest.clearAllMocks();
  });

  // ─── GET /experiments ─────────────────────────────────────────────────────

  describe('GET /experiments', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/experiments');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/experiments')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with experiments list for admin', async () => {
      prisma.experiment.findMany.mockResolvedValue([mockExperiment]);
      prisma.experiment.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.experiments).toHaveLength(1);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      prisma.experiment.findMany.mockResolvedValue([]);
      prisma.experiment.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/experiments?status=ACTIVE')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(prisma.experiment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'ACTIVE' } })
      );
    });

    it('should include variants and assignment count', async () => {
      prisma.experiment.findMany.mockResolvedValue([mockExperiment]);
      prisma.experiment.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.experiments[0].variants).toBeDefined();
    });

    it('should return 500 on database error', async () => {
      prisma.experiment.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to list experiments');
    });
  });

  // ─── GET /experiments/:id ─────────────────────────────────────────────────

  describe('GET /experiments/:id', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/experiments/exp-1');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/experiments/exp-1')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with experiment details and stats', async () => {
      prisma.experiment.findUnique.mockResolvedValue(mockExperiment);
      experimentEngine.calculateExperimentStats.mockResolvedValue(mockStats);

      const res = await request(app)
        .get('/experiments/exp-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.experiment).toBeDefined();
      expect(res.body.data.stats).toBeDefined();
      expect(experimentEngine.calculateExperimentStats).toHaveBeenCalledWith(expect.anything(), 'exp-1');
    });

    it('should return 404 when experiment not found', async () => {
      prisma.experiment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/experiments/nonexistent')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Experiment not found');
    });

    it('should return 500 on database error', async () => {
      prisma.experiment.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/experiments/exp-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /experiments ────────────────────────────────────────────────────

  describe('POST /experiments', () => {
    const validPayload = {
      name: 'new-onboarding-test',
      description: 'Testing new onboarding flow',
      trafficPercentage: 30,
      variants: [
        { name: 'control', weight: 50 },
        { name: 'variant_a', weight: 50 },
      ],
    };

    it('should return 401 without auth', async () => {
      const res = await request(app).post('/experiments').send(validPayload);
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send(validPayload);
      expect(res.status).toBe(403);
    });

    it('should return 201 and create experiment for admin', async () => {
      prisma.experiment.findUnique.mockResolvedValue(null);
      prisma.experiment.create.mockResolvedValue({
        ...mockExperiment,
        name: 'new-onboarding-test',
        variants: [
          { id: 'var-1', name: 'control', weight: 50 },
          { id: 'var-2', name: 'variant_a', weight: 50 },
        ],
      });

      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.experiment).toBeDefined();
      expect(res.body.data.experiment.status).toBe('DRAFT');
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ trafficPercentage: 50, variants: [{ name: 'a', weight: 50 }, { name: 'b', weight: 50 }] });
      expect(res.status).toBe(400);
    });

    it('should return 400 for missing trafficPercentage', async () => {
      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test', variants: [{ name: 'a', weight: 50 }, { name: 'b', weight: 50 }] });
      expect(res.status).toBe(400);
    });

    it('should return 400 when fewer than 2 variants provided', async () => {
      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validPayload, variants: [{ name: 'control', weight: 100 }] });
      expect(res.status).toBe(400);
    });

    it('should return 400 for trafficPercentage = 0', async () => {
      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validPayload, trafficPercentage: 0 });
      expect(res.status).toBe(400);
    });

    it('should return 400 for trafficPercentage > 100', async () => {
      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validPayload, trafficPercentage: 101 });
      expect(res.status).toBe(400);
    });

    it('should return 409 when experiment name already exists', async () => {
      prisma.experiment.findUnique.mockResolvedValue(mockExperiment);

      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validPayload, name: 'checkout-flow-test' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Experiment name already exists');
    });

    it('should return 500 on database error', async () => {
      prisma.experiment.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/experiments')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validPayload);

      expect(res.status).toBe(500);
    });
  });

  // ─── PATCH /experiments/:id/status ───────────────────────────────────────

  describe('PATCH /experiments/:id/status', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .patch('/experiments/exp-1/status')
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .patch('/experiments/exp-1/status')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(403);
    });

    it('should return 200 and activate a DRAFT experiment', async () => {
      prisma.experiment.findUnique.mockResolvedValue(mockExperiment);
      prisma.experiment.update.mockResolvedValue({
        ...mockExperiment, status: 'ACTIVE', startedAt: new Date(), variants: mockVariants,
      });

      const res = await request(app)
        .patch('/experiments/exp-1/status')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.experiment.status).toBe('ACTIVE');
    });

    it('should return 200 and pause an ACTIVE experiment', async () => {
      prisma.experiment.findUnique.mockResolvedValue({ ...mockExperiment, status: 'ACTIVE', startedAt: new Date() });
      prisma.experiment.update.mockResolvedValue({
        ...mockExperiment, status: 'PAUSED', variants: mockVariants,
      });

      const res = await request(app)
        .patch('/experiments/exp-1/status')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: 'PAUSED' });

      expect(res.status).toBe(200);
      expect(res.body.data.experiment.status).toBe('PAUSED');
    });

    it('should return 200 and complete an experiment (sets endedAt)', async () => {
      prisma.experiment.findUnique.mockResolvedValue({ ...mockExperiment, status: 'ACTIVE', startedAt: new Date() });
      const endedAt = new Date();
      prisma.experiment.update.mockResolvedValue({
        ...mockExperiment, status: 'COMPLETED', endedAt, variants: mockVariants,
      });

      const res = await request(app)
        .patch('/experiments/exp-1/status')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(200);
      expect(res.body.data.experiment.status).toBe('COMPLETED');
    });

    it('should return 400 for invalid status value', async () => {
      const res = await request(app)
        .patch('/experiments/exp-1/status')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: 'DRAFT' }); // DRAFT not allowed via this endpoint
      expect(res.status).toBe(400);
    });

    it('should return 400 for missing status', async () => {
      const res = await request(app)
        .patch('/experiments/exp-1/status')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 404 when experiment not found', async () => {
      prisma.experiment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/experiments/nonexistent/status')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Experiment not found');
    });

    it('should return 500 on database error', async () => {
      prisma.experiment.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .patch('/experiments/exp-1/status')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(500);
    });
  });

  // ─── GET /experiments/:id/results ─────────────────────────────────────────

  describe('GET /experiments/:id/results', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/experiments/exp-1/results');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/experiments/exp-1/results')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with results and stats for admin', async () => {
      prisma.experiment.findUnique.mockResolvedValue(mockExperiment);
      experimentEngine.calculateExperimentStats.mockResolvedValue(mockStats);

      const res = await request(app)
        .get('/experiments/exp-1/results')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.experiment).toBeDefined();
      expect(res.body.data.stats).toBeDefined();
      expect(res.body.data.totalAssignments).toBeDefined();
    });

    it('should compute significance when variant1 and variant2 params are provided', async () => {
      prisma.experiment.findUnique.mockResolvedValue(mockExperiment);
      experimentEngine.calculateExperimentStats.mockResolvedValue(mockStats);
      experimentEngine.testSignificance.mockResolvedValue({
        pValue: 0.03,
        significant: true,
        confidenceLevel: 0.95,
      });

      const res = await request(app)
        .get('/experiments/exp-1/results?variant1=var-1&variant2=var-2')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.significance).toBeDefined();
      expect(res.body.data.significance.significant).toBe(true);
      expect(experimentEngine.testSignificance).toHaveBeenCalledWith(
        expect.anything(), 'exp-1', 'var-1', 'var-2'
      );
    });

    it('should return null significance when no variant params provided', async () => {
      prisma.experiment.findUnique.mockResolvedValue(mockExperiment);
      experimentEngine.calculateExperimentStats.mockResolvedValue(mockStats);

      const res = await request(app)
        .get('/experiments/exp-1/results')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.significance).toBeNull();
      expect(experimentEngine.testSignificance).not.toHaveBeenCalled();
    });

    it('should return 404 when experiment not found', async () => {
      prisma.experiment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/experiments/nonexistent/results')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
    });

    it('should return 500 on database error', async () => {
      prisma.experiment.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/experiments/exp-1/results')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── DELETE /experiments/:id ──────────────────────────────────────────────

  describe('DELETE /experiments/:id', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).delete('/experiments/exp-1');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .delete('/experiments/exp-1')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 and delete a DRAFT experiment', async () => {
      prisma.experiment.findUnique.mockResolvedValue({ ...mockExperiment, status: 'DRAFT' });
      prisma.experiment.delete.mockResolvedValue(mockExperiment);

      const res = await request(app)
        .delete('/experiments/exp-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Experiment deleted');
    });

    it('should return 200 and delete a COMPLETED experiment', async () => {
      prisma.experiment.findUnique.mockResolvedValue({ ...mockExperiment, status: 'COMPLETED', endedAt: new Date() });
      prisma.experiment.delete.mockResolvedValue(mockExperiment);

      const res = await request(app)
        .delete('/experiments/exp-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 when experiment is ACTIVE', async () => {
      prisma.experiment.findUnique.mockResolvedValue({ ...mockExperiment, status: 'ACTIVE', startedAt: new Date() });

      const res = await request(app)
        .delete('/experiments/exp-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot delete an active experiment');
    });

    it('should return 404 when experiment not found', async () => {
      prisma.experiment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete('/experiments/nonexistent')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Experiment not found');
    });

    it('should return 500 on database error', async () => {
      prisma.experiment.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .delete('/experiments/exp-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });
});
