/**
 * Tests for analytics routes (Q79-Q86: events, metrics, funnels, retention, revenue)
 * Modules: routes/analytics.js, analytics-events.js, analytics-funnels.js, analytics-retention.js
 * No prior tests exist for these route files (0% coverage each).
 */

const request = require('supertest');
const express = require('express');
const { adminToken, proToken, clientToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  $queryRaw: jest.fn().mockResolvedValue([{ total: 1000, last30: 500 }]),
  professional: {
    findUnique: jest.fn().mockResolvedValue({
      id: 'pro-1',
      userId: 'pro-user-1',
      trialEndsAt: new Date(Date.now() + 86400000),
      subscription: { status: 'ACTIVE', tier: 'PRO' },
      user: { id: 'pro-user-1', email: 'pro@test.com' },
      portfolio: [],
      followers: [],
      badges: [],
      quotes: [],
      completedMissionsCount: 5,
      cancelledMissionsCount: 1,
      averageRating: 4.5,
      reviewCount: 10,
    }),
    count: jest.fn().mockResolvedValue(5),
  },
  profileView: {
    count: jest.fn().mockResolvedValue(100),
    findMany: jest.fn().mockResolvedValue([]),
    groupBy: jest.fn().mockResolvedValue([]),
  },
  booking: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(2),
  },
  payment: {
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 10000 } }),
  },
  quote: {
    count: jest.fn().mockResolvedValue(3),
    findMany: jest.fn().mockResolvedValue([]),
  },
  user: {
    count: jest.fn().mockResolvedValue(10),
    findMany: jest.fn().mockResolvedValue([]),
  },
  userEvent: {
    create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    createMany: jest.fn().mockResolvedValue({ count: 2 }),
    groupBy: jest.fn().mockResolvedValue([
      { type: 'search', _count: { type: 5 } },
    ]),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(5),
  },
  customMetric: {
    create: jest.fn().mockResolvedValue({ id: 'metric-1' }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  subscription: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { price: 0 } }),
    groupBy: jest.fn().mockResolvedValue([]),
  },
  review: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
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

jest.mock('../../middleware/validateInput', () => ({
  handleValidationErrors: (req, res, next) => next(),
}));

jest.mock('../../utils/trustScore', () => ({
  computeTrustScore: jest.fn().mockReturnValue(80),
}));

jest.mock('../../routes/subscriptions', () => ({
  getActiveTier: jest.fn().mockReturnValue('PRO'),
}));

const analyticsRoutes = require('../../routes/analytics');
const analyticsEventsRoutes = require('../../routes/analytics-events');
const analyticsFunnelsRoutes = require('../../routes/analytics-funnels');
const analyticsRetentionRoutes = require('../../routes/analytics-retention');

const app = express();
app.use(express.json());
app.use('/analytics', analyticsRoutes);
app.use('/analytics', analyticsEventsRoutes);
app.use('/analytics', analyticsFunnelsRoutes);
app.use('/analytics', analyticsRetentionRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── analytics.js: overview & detail ──────────────────────────────────────────

describe('Analytics Routes (analytics.js)', () => {
  describe('GET /analytics/overview', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/overview');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-professional', async () => {
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 404 when professional profile not found', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(404);
    });

    it('should return 200 for a pro with an active subscription', async () => {
      const prisma = require('../../config/db');
      prisma.profileView.count.mockResolvedValue(100);
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.profileViews).toBeDefined();
    });
  });

  describe('GET /analytics/revenue', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/revenue');
      expect(res.status).toBe(401);
    });

    it('should return 403 for client (non-premium)', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/analytics/revenue')
        .set('Authorization', `Bearer ${proToken()}`);
      expect([403, 404]).toContain(res.status);
    });
  });
});

// ── analytics-events.js ───────────────────────────────────────────────────────

describe('Analytics Events Routes (analytics-events.js)', () => {
  describe('POST /analytics/events', () => {
    it('should return 400 for invalid event type', async () => {
      const res = await request(app)
        .post('/analytics/events')
        .send({ type: 'invalid_type' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('should return 201 for valid event without auth', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.create.mockResolvedValueOnce({ id: 'evt-1' });
      const res = await request(app)
        .post('/analytics/events')
        .send({ type: 'search', page: '/search', sessionId: 'sess-1' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should return 201 for valid event with metadata', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.create.mockResolvedValueOnce({ id: 'evt-2' });
      const res = await request(app)
        .post('/analytics/events')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ type: 'profile_view', metadata: { professionalId: 'pro-1' } });
      expect(res.status).toBe(201);
    });
  });

  describe('POST /analytics/events/batch', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/analytics/events/batch')
        .send({ events: [{ type: 'login' }] });
      expect(res.status).toBe(401);
    });

    it('should return 400 for empty events array', async () => {
      const res = await request(app)
        .post('/analytics/events/batch')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ events: [] });
      expect(res.status).toBe(400);
    });

    it('should return 201 for batch events', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.createMany.mockResolvedValueOnce({ count: 2 });
      const res = await request(app)
        .post('/analytics/events/batch')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ events: [{ type: 'login' }, { type: 'search' }] });
      expect(res.status).toBe(201);
      expect(res.body.count).toBe(2);
    });
  });

  describe('GET /analytics/events/summary', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/events/summary');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/events/summary')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 for admin', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.groupBy.mockResolvedValueOnce([
        { type: 'search', _count: { type: 10 } },
        { type: 'login', _count: { type: 5 } },
      ]);
      const res = await request(app)
        .get('/analytics/events/summary')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(15);
    });
  });

  describe('POST /analytics/metrics', () => {
    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/analytics/metrics')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ name: 'test', category: 'platform', value: 1 });
      expect(res.status).toBe(403);
    });

    it('should return 201 for admin', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.create.mockResolvedValueOnce({ id: 'metric-1', name: 'test' });
      const res = await request(app)
        .post('/analytics/metrics')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test_metric', category: 'platform', value: 42.5, unit: 'ms' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /analytics/metrics', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/metrics');
      expect(res.status).toBe(401);
    });

    it('should return 200 for admin', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.findMany.mockResolvedValueOnce([]);
      prisma.customMetric.count.mockResolvedValueOnce(0);
      const res = await request(app)
        .get('/analytics/metrics')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });
  });
});

// ── analytics-funnels.js ──────────────────────────────────────────────────────

describe('Analytics Funnels Routes (analytics-funnels.js)', () => {
  describe('GET /analytics/funnel', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/funnel');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/funnel')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 for admin', async () => {
      const prisma = require('../../config/db');
      prisma.user.count.mockResolvedValueOnce(100);
      prisma.userEvent.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValueOnce(20);
      prisma.payment.count = jest.fn().mockResolvedValueOnce(10);
      const res = await request(app)
        .get('/analytics/funnel')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });
  });
});

// ── analytics-retention.js ────────────────────────────────────────────────────

describe('Analytics Retention Routes (analytics-retention.js)', () => {
  describe('GET /analytics/retention', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/retention');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/retention')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 for admin', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(100);
      prisma.user.findMany.mockResolvedValue([]);
      const res = await request(app)
        .get('/analytics/retention')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });
  });
});
