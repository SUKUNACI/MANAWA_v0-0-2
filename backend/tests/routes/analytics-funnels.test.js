/**
 * Tests for analytics-funnels routes (Q82, Q83)
 * Funnel analysis, cohort analysis
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

jest.mock('../../modules/analyticsFunnels', () => {
  return jest.fn().mockImplementation(() => ({
    getFunnelAnalysis: jest.fn().mockResolvedValue({
      steps: [{ step: 'register', count: 1000 }, { step: 'search', count: 800 }],
    }),
    getCohortAnalysis: jest.fn().mockResolvedValue({
      cohorts: [],
    }),
    createCohortSnapshot: jest.fn().mockResolvedValue({ success: true }),
  }));
});

const analyticsFunnelsRouter = require('../../routes/analytics-funnels');

const app = express();
app.use(express.json());
app.use('/funnels', analyticsFunnelsRouter);

describe('Analytics Funnels Routes', () => {
  describe('GET /funnels/funnel', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/funnels/funnel');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/funnels/funnel')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with funnel analysis', async () => {
      const res = await request(app)
        .get('/funnels/funnel')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /funnels/cohorts', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/funnels/cohorts');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/funnels/cohorts')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with cohort analysis', async () => {
      const res = await request(app)
        .get('/funnels/cohorts')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('POST /funnels/cohorts/snapshot', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/funnels/cohorts/snapshot');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/funnels/cohorts/snapshot')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 and create snapshot', async () => {
      const res = await request(app)
        .post('/funnels/cohorts/snapshot')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
