/**
 * Tests for analytics-events routes (Q79, Q80, Q81)
 * Event tracking, custom metrics, user journey
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  event: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  metric: {
    create: jest.fn(),
    findMany: jest.fn(),
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

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../modules/analyticsEvents', () => {
  return jest.fn().mockImplementation(() => ({
    trackEvent: jest.fn().mockResolvedValue({ success: true }),
    trackBatchEvents: jest.fn().mockResolvedValue({ count: 5 }),
    getEventsSummary: jest.fn().mockResolvedValue({ 'search': 100, 'login': 50 }),
    recordMetric: jest.fn().mockResolvedValue({ id: 'metric-1', name: 'conversion_rate' }),
    queryMetrics: jest.fn().mockResolvedValue({ metrics: [], total: 0 }),
    getUserJourney: jest.fn().mockResolvedValue({ userId: 'user-1', events: [] }),
  }));
});

const analyticsEventsRouter = require('../../routes/analytics-events');

const app = express();
app.use(express.json());
app.use('/events', analyticsEventsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

describe('Analytics Events Routes', () => {
  describe('POST /events/events', () => {
    it('should return 201 and track event', async () => {
      const res = await request(app)
        .post('/events/events')
        .send({ type: 'login', page: '/', metadata: { source: 'web' } });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 for invalid event type', async () => {
      const res = await request(app)
        .post('/events/events')
        .send({ type: 'invalid_type', page: '/' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /events/events/batch', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/events/events/batch')
        .send({ events: [{ type: 'login' }] });

      expect(res.status).toBe(401);
    });

    it('should return 201 and batch track events', async () => {
      const res = await request(app)
        .post('/events/events/batch')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ events: [{ type: 'login' }, { type: 'search' }] });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(5);
    });
  });

  describe('GET /events/events/summary', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/events/events/summary');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/events/events/summary')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with events summary', async () => {
      const res = await request(app)
        .get('/events/events/summary')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('POST /events/metrics', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/events/metrics')
        .send({ name: 'conversion_rate', category: 'platform', value: 0.85 });

      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/events/metrics')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ name: 'conversion_rate', category: 'platform', value: 0.85 });

      expect(res.status).toBe(403);
    });

    it('should return 201 and record metric', async () => {
      const res = await request(app)
        .post('/events/metrics')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'conversion_rate', category: 'platform', value: 0.85 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metric).toBeDefined();
    });
  });

  describe('GET /events/metrics', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/events/metrics');
      expect(res.status).toBe(401);
    });

    it('should return 200 with metrics', async () => {
      const res = await request(app)
        .get('/events/metrics')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /events/journey/:userId', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/events/journey/user-1');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/events/journey/user-1')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with user journey', async () => {
      const res = await request(app)
        .get('/events/journey/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });
});
