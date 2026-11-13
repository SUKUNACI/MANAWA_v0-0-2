/**
 * Tests for admin-feature-flags routes
 * Module: routes/admin-feature-flags.js — CRUD + rollout endpoints
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  featureFlag: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  adminLog: {
    create: jest.fn().mockResolvedValue({ id: 'log-1' }),
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

jest.mock('../../utils/feature-flag-manager', () => ({
  invalidateCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../config/feature-flags', () => ({
  defaultFlags: {},
  getAll: jest.fn().mockReturnValue({}),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const featureFlagsRouter = require('../../routes/admin-feature-flags');

const app = express();
app.use(express.json());
app.use('/feature-flags', featureFlagsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const mockFlag = {
  id: 'flag-1',
  name: 'new-checkout',
  description: 'New checkout flow',
  enabled: false,
  rolloutPercentage: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Admin Feature Flags Routes', () => {
  let prisma;
  let featureFlagManager;

  beforeEach(() => {
    prisma = require('../../config/db');
    featureFlagManager = require('../../utils/feature-flag-manager');
    jest.clearAllMocks();
    prisma.adminLog.create.mockResolvedValue({ id: 'log-1' });
    featureFlagManager.invalidateCache.mockResolvedValue(undefined);
  });

  // ─── GET /feature-flags ───────────────────────────────────────────────────

  describe('GET /feature-flags', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/feature-flags');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/feature-flags')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with flags list for admin', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([mockFlag]);
      prisma.featureFlag.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.flags).toHaveLength(1);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('should filter by enabled=true', async () => {
      const enabledFlag = { ...mockFlag, enabled: true };
      prisma.featureFlag.findMany.mockResolvedValue([enabledFlag]);
      prisma.featureFlag.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/feature-flags?enabled=true')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(prisma.featureFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enabled: true } })
      );
    });

    it('should filter by enabled=false', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([mockFlag]);
      prisma.featureFlag.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/feature-flags?enabled=false')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(prisma.featureFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enabled: false } })
      );
    });

    it('should respect pagination params', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([]);
      prisma.featureFlag.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/feature-flags?page=2&limit=5')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.pagination.page).toBe(2);
    });

    it('should return 500 on database error', async () => {
      prisma.featureFlag.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to list feature flags');
    });
  });

  // ─── GET /feature-flags/:name ─────────────────────────────────────────────

  describe('GET /feature-flags/:name', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/feature-flags/new-checkout');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with flag details for admin', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(mockFlag);

      const res = await request(app)
        .get('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.flag.name).toBe('new-checkout');
    });

    it('should return 404 when flag not found', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/feature-flags/nonexistent-flag')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Feature flag not found');
    });

    it('should return 500 on database error', async () => {
      prisma.featureFlag.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /feature-flags ──────────────────────────────────────────────────

  describe('POST /feature-flags', () => {
    const validPayload = {
      name: 'dark-mode',
      description: 'Enable dark mode',
      enabled: false,
      rolloutPercentage: 0,
    };

    it('should return 401 without auth', async () => {
      const res = await request(app).post('/feature-flags').send(validPayload);
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/feature-flags')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send(validPayload);
      expect(res.status).toBe(403);
    });

    it('should return 201 and create a feature flag', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);
      prisma.featureFlag.create.mockResolvedValue({ ...mockFlag, name: 'dark-mode' });

      const res = await request(app)
        .post('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.flag).toBeDefined();
      expect(featureFlagManager.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app)
        .post('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ enabled: false, rolloutPercentage: 0 });
      expect(res.status).toBe(400);
    });

    it('should return 400 for missing enabled field', async () => {
      const res = await request(app)
        .post('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test-flag', rolloutPercentage: 50 });
      expect(res.status).toBe(400);
    });

    it('should return 400 for rolloutPercentage out of range (> 100)', async () => {
      const res = await request(app)
        .post('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test-flag', enabled: true, rolloutPercentage: 150 });
      expect(res.status).toBe(400);
    });

    it('should return 400 for rolloutPercentage out of range (< 0)', async () => {
      const res = await request(app)
        .post('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test-flag', enabled: true, rolloutPercentage: -1 });
      expect(res.status).toBe(400);
    });

    it('should return 409 when flag already exists', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(mockFlag);

      const res = await request(app)
        .post('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validPayload);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Feature flag already exists');
    });

    it('should return 500 on database error', async () => {
      prisma.featureFlag.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/feature-flags')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validPayload);

      expect(res.status).toBe(500);
    });
  });

  // ─── PATCH /feature-flags/:name ───────────────────────────────────────────

  describe('PATCH /feature-flags/:name', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .patch('/feature-flags/new-checkout')
        .send({ enabled: true });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .patch('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ enabled: true });
      expect(res.status).toBe(403);
    });

    it('should return 200 and update enabled field', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      prisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: true });

      const res = await request(app)
        .patch('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.flag.enabled).toBe(true);
      expect(featureFlagManager.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('should return 200 and update rolloutPercentage', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      prisma.featureFlag.update.mockResolvedValue({ ...mockFlag, rolloutPercentage: 50 });

      const res = await request(app)
        .patch('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rolloutPercentage: 50 });

      expect(res.status).toBe(200);
    });

    it('should return 404 when flag not found', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/feature-flags/nonexistent')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ enabled: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Feature flag not found');
    });

    it('should return 400 for invalid rolloutPercentage', async () => {
      const res = await request(app)
        .patch('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rolloutPercentage: 200 });
      expect(res.status).toBe(400);
    });

    it('should return 500 on database error', async () => {
      prisma.featureFlag.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .patch('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ enabled: true });

      expect(res.status).toBe(500);
    });
  });

  // ─── DELETE /feature-flags/:name ──────────────────────────────────────────

  describe('DELETE /feature-flags/:name', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).delete('/feature-flags/new-checkout');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .delete('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 and delete the flag', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      prisma.featureFlag.delete.mockResolvedValue(mockFlag);

      const res = await request(app)
        .delete('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Feature flag deleted');
      expect(featureFlagManager.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('should return 404 when flag not found', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete('/feature-flags/nonexistent')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Feature flag not found');
    });

    it('should return 500 on database error', async () => {
      prisma.featureFlag.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .delete('/feature-flags/new-checkout')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /feature-flags/:name/rollout ────────────────────────────────────

  describe('POST /feature-flags/:name/rollout', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/feature-flags/new-checkout/rollout')
        .send({ rolloutPercentage: 50 });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/feature-flags/new-checkout/rollout')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ rolloutPercentage: 50 });
      expect(res.status).toBe(403);
    });

    it('should return 200 and update rollout percentage', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      prisma.featureFlag.update.mockResolvedValue({ ...mockFlag, rolloutPercentage: 50 });

      const res = await request(app)
        .post('/feature-flags/new-checkout/rollout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rolloutPercentage: 50 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.flag.rolloutPercentage).toBe(50);
      expect(featureFlagManager.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('should return 200 for 0% rollout (disable gradually)', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      prisma.featureFlag.update.mockResolvedValue({ ...mockFlag, rolloutPercentage: 0 });

      const res = await request(app)
        .post('/feature-flags/new-checkout/rollout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rolloutPercentage: 0 });

      expect(res.status).toBe(200);
    });

    it('should return 200 for 100% rollout (full rollout)', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      prisma.featureFlag.update.mockResolvedValue({ ...mockFlag, rolloutPercentage: 100 });

      const res = await request(app)
        .post('/feature-flags/new-checkout/rollout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rolloutPercentage: 100 });

      expect(res.status).toBe(200);
    });

    it('should return 400 for missing rolloutPercentage', async () => {
      const res = await request(app)
        .post('/feature-flags/new-checkout/rollout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 400 for rolloutPercentage > 100', async () => {
      const res = await request(app)
        .post('/feature-flags/new-checkout/rollout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rolloutPercentage: 101 });
      expect(res.status).toBe(400);
    });

    it('should return 404 when flag not found', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/feature-flags/nonexistent/rollout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rolloutPercentage: 50 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Feature flag not found');
    });

    it('should return 500 on database error', async () => {
      prisma.featureFlag.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/feature-flags/new-checkout/rollout')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rolloutPercentage: 50 });

      expect(res.status).toBe(500);
    });
  });
});
