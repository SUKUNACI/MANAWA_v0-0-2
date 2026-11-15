/**
 * Tests for analytics-retention routes (Q84, Q85, Q86)
 * Retention metrics, churn prediction, revenue tracking
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

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

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../modules/analyticsAdvanced', () => {
  return jest.fn().mockImplementation(() => ({
    getRetentionMetrics: jest.fn().mockResolvedValue({
      dau: 5000,
      d7_retention: 0.65,
      d30_retention: 0.45,
    }),
    getRetentionHistory: jest.fn().mockResolvedValue([]),
    getChurnPrediction: jest.fn().mockResolvedValue({ users: [], total: 0 }),
    getSubscriptionChurn: jest.fn().mockResolvedValue({ users: [], total: 0 }),
    getRevenueSummary: jest.fn().mockResolvedValue({
      mrr: 50000,
      arr: 600000,
      ltv: 1200,
    }),
  }));
});

const analyticsRetentionRouter = require('../../routes/analytics-retention');

const app = express();
app.use(express.json());
app.use('/retention', analyticsRetentionRouter);

describe('Analytics Retention Routes', () => {
  describe('GET /retention/retention', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/retention/retention');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/retention/retention')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with retention metrics', async () => {
      const res = await request(app)
        .get('/retention/retention')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /retention/retention/history', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/retention/retention/history');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/retention/retention/history')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with retention history', async () => {
      const res = await request(app)
        .get('/retention/retention/history?days=30')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /retention/churn', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/retention/churn');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/retention/churn')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with churn prediction', async () => {
      const res = await request(app)
        .get('/retention/churn?riskLevel=high')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /retention/churn/subscriptions', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/retention/churn/subscriptions');
      expect(res.status).toBe(401);
    });

    it('should return 200 with subscription churn', async () => {
      const res = await request(app)
        .get('/retention/churn/subscriptions')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });
});
