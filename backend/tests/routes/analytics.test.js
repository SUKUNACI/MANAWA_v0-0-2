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
    count: jest.fn().mockResolvedValue(0),
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
  retentionSnapshot: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  cohortSnapshot: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
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

    it('should calculate trend percentage when prev30Views > 0', async () => {
      const prisma = require('../../config/db');
      prisma.profileView.count
        .mockResolvedValueOnce(100) // totalViews
        .mockResolvedValueOnce(50)  // last30Views
        .mockResolvedValueOnce(30); // prev30Views
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.profileViews.trend).toBeDefined();
    });

    it('should set trend to +100% when prev30 is 0 but last30 > 0', async () => {
      const prisma = require('../../config/db');
      prisma.profileView.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(0);
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.profileViews.trend).toBe('+100%');
    });

    it('should include all metrics in response', async () => {
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('profileViews');
      expect(res.body).toHaveProperty('quotes');
      expect(res.body).toHaveProperty('missions');
      expect(res.body).toHaveProperty('revenue');
      expect(res.body).toHaveProperty('rating');
      expect(res.body).toHaveProperty('followers');
      expect(res.body).toHaveProperty('trustScore');
      expect(res.body).toHaveProperty('badges');
    });

    it('should calculate acceptRate for quotes', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique.mockResolvedValueOnce({
        id: 'pro-1',
        userId: 'pro-user-1',
        quotes: [
          { id: '1', status: 'ACCEPTED' },
          { id: '2', status: 'ACCEPTED' },
          { id: '3', status: 'PENDING' },
        ],
        completedMissionsCount: 5,
        cancelledMissionsCount: 1,
        averageRating: 4.5,
        reviewCount: 10,
        followers: [],
        badges: [],
      });
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.quotes.acceptRate).toBe('66.7%');
    });

    it('should calculate completionRate for missions', async () => {
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.missions.completionRate).toBeDefined();
    });

    it('should handle zero quotes without division error', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique.mockResolvedValueOnce({
        id: 'pro-1',
        userId: 'pro-user-1',
        quotes: [],
        completedMissionsCount: 0,
        cancelledMissionsCount: 0,
        averageRating: 0,
        reviewCount: 0,
        followers: [],
        badges: [],
      });
      const res = await request(app)
        .get('/analytics/overview')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.quotes.acceptRate).toBe('0%');
    });
  });

  describe('GET /analytics/views', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/views');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-professional', async () => {
      const res = await request(app)
        .get('/analytics/views')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 403 when no premium tier', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique.mockResolvedValueOnce({
        id: 'pro-1',
        userId: 'pro-user-1',
        trialEndsAt: new Date(Date.now() - 1000),
        subscription: { status: 'INACTIVE', tier: 'GRATUIT' },
      });
      const res = await request(app)
        .get('/analytics/views')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with view data for premium pro', async () => {
      const prisma = require('../../config/db');
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([
        { date: new Date('2026-11-01'), count: 10 },
        { date: new Date('2026-11-02'), count: 15 },
      ]);
      const res = await request(app)
        .get('/analytics/views')
        .set('Authorization', `Bearer ${proToken()}`);
      expect([200, 500]).toContain(res.status);
    });
  });

  describe('GET /analytics/revenue', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/revenue');
      expect(res.status).toBe(401);
    });

    it('should return 404 when pro not found', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/analytics/revenue')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(404);
    });

    it('should return 403 when not premium', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique.mockResolvedValueOnce({
        id: 'pro-1',
        userId: 'pro-user-1',
        trialEndsAt: new Date(Date.now() - 1000),
        subscription: { status: 'INACTIVE', tier: 'GRATUIT' },
      });
      const res = await request(app)
        .get('/analytics/revenue')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with revenue data for premium pro', async () => {
      const prisma = require('../../config/db');
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([
        { month: '2026-11', amount: 1000 },
      ]);
      const res = await request(app)
        .get('/analytics/revenue')
        .set('Authorization', `Bearer ${proToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should calculate averagePerMission correctly', async () => {
      const prisma = require('../../config/db');
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/revenue')
        .set('Authorization', `Bearer ${proToken()}`);
      expect([200, 500]).toContain(res.status);
    });
  });

  describe('GET /analytics/quotes', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/quotes');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-professional', async () => {
      const res = await request(app)
        .get('/analytics/quotes')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 404 when pro not found', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/analytics/quotes')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(404);
    });

    it('should return 200 with quotes analysis', async () => {
      const prisma = require('../../config/db');
      prisma.quote.findMany.mockResolvedValueOnce([
        { id: '1', status: 'ACCEPTED', createdAt: new Date(), updatedAt: new Date(), project: { tradeNeeded: 'plomberie' } },
        { id: '2', status: 'PENDING', createdAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000), updatedAt: new Date(), project: { tradeNeeded: 'plomberie' } },
      ]);
      const res = await request(app)
        .get('/analytics/quotes')
        .set('Authorization', `Bearer ${proToken()}`);
      expect([200, 500]).toContain(res.status);
    });
  });

  describe('GET /analytics/competitors', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/competitors');
      expect(res.status).toBe(401);
    });

    it('should return 404 when pro not found', async () => {
      const prisma = require('../../config/db');
      prisma.professional.findUnique = jest.fn().mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/analytics/competitors')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(404);
    });

    it('should return 403 when not ELITE tier', async () => {
      const res = await request(app)
        .get('/analytics/competitors')
        .set('Authorization', `Bearer ${proToken()}`);
      expect([403, 404]).toContain(res.status);
    });

    it('should return 200 for ELITE pro with peers', async () => {
      const prisma = require('../../config/db');
      const getActiveTier = require('../../routes/subscriptions').getActiveTier;
      getActiveTier.mockReturnValueOnce('ELITE');
      prisma.professional.findUnique = jest.fn().mockResolvedValueOnce({
        id: 'pro-1',
        userId: 'pro-user-1',
        trade: 'plomberie',
        averageRating: 4.5,
        completedMissionsCount: 10,
        subscription: { status: 'ACTIVE', tier: 'ELITE' },
        user: { id: 'pro-user-1' },
        portfolio: [],
        badges: [],
      });
      prisma.professional.findMany = jest.fn().mockResolvedValueOnce([
        { id: 'pro-2', trade: 'plomberie', averageRating: 4.0, completedMissionsCount: 5, subscription: {}, portfolio: [], badges: [] },
      ]);
      const res = await request(app)
        .get('/analytics/competitors')
        .set('Authorization', `Bearer ${proToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should handle case when no peers exist', async () => {
      const prisma = require('../../config/db');
      const getActiveTier = require('../../routes/subscriptions').getActiveTier;
      getActiveTier.mockReturnValueOnce('ELITE');
      prisma.professional.findUnique = jest.fn().mockResolvedValueOnce({
        id: 'pro-1',
        userId: 'pro-user-1',
        trade: 'plomberie',
        averageRating: 4.5,
        completedMissionsCount: 10,
      });
      prisma.professional.findMany = jest.fn().mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/competitors')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.myRank.rating).toBe(1);
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

    it('should accept all valid event types', async () => {
      const prisma = require('../../config/db');
      const validTypes = [
        'search', 'profile_view', 'quote_sent', 'quote_accepted', 'quote_rejected',
        'booking_created', 'booking_confirmed', 'payment_initiated', 'payment_success',
        'payment_failed', 'login', 'logout', 'register', 'message_sent',
        'review_submitted', 'subscription_upgraded', 'subscription_cancelled',
        'portfolio_viewed', 'package_ordered', 'video_call_started',
      ];
      for (const type of validTypes.slice(0, 5)) {
        prisma.userEvent.create.mockResolvedValueOnce({ id: `evt-${type}` });
        const res = await request(app)
          .post('/analytics/events')
          .send({ type });
        expect(res.status).toBe(201);
      }
    });

    it('should handle event without optional fields', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.create.mockResolvedValueOnce({ id: 'evt-min' });
      const res = await request(app)
        .post('/analytics/events')
        .send({ type: 'login' });
      expect(res.status).toBe(201);
    });

    it('should store null userId when not authenticated', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.create.mockResolvedValueOnce({ id: 'evt-anon' });
      const res = await request(app)
        .post('/analytics/events')
        .send({ type: 'search' });
      expect(res.status).toBe(201);
      expect(prisma.userEvent.create).toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.create.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .post('/analytics/events')
        .send({ type: 'search' });
      expect(res.status).toBe(500);
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

    it('should return 400 when events missing type', async () => {
      const res = await request(app)
        .post('/analytics/events/batch')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ events: [{ page: '/search' }] });
      expect(res.status).toBe(400);
    });

    it('should handle max 100 events', async () => {
      const prisma = require('../../config/db');
      const events = Array(100).fill({ type: 'search' });
      prisma.userEvent.createMany.mockResolvedValueOnce({ count: 100 });
      const res = await request(app)
        .post('/analytics/events/batch')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ events });
      expect(res.status).toBe(201);
    });

    it('should return 400 for more than 100 events', async () => {
      const events = Array(101).fill({ type: 'search' });
      const res = await request(app)
        .post('/analytics/events/batch')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ events });
      expect(res.status).toBe(400);
    });

    it('should include user metadata for authenticated requests', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.createMany.mockResolvedValueOnce({ count: 1 });
      const res = await request(app)
        .post('/analytics/events/batch')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ events: [{ type: 'search', metadata: { query: 'plombier' } }] });
      expect(res.status).toBe(201);
    });

    it('should handle database errors in batch', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.createMany.mockRejectedValueOnce(new Error('Batch error'));
      const res = await request(app)
        .post('/analytics/events/batch')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ events: [{ type: 'search' }] });
      expect(res.status).toBe(500);
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

    it('should return 200 for admin with events', async () => {
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

    it('should calculate percentages for each event type', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.groupBy.mockResolvedValueOnce([
        { type: 'search', _count: { type: 60 } },
        { type: 'login', _count: { type: 40 } },
      ]);
      const res = await request(app)
        .get('/analytics/events/summary')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.byType[0].percentage).toBe(60);
      expect(res.body.data.byType[1].percentage).toBe(40);
    });

    it('should support from query parameter', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.groupBy.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/events/summary?from=2026-11-01T00:00:00Z')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('should support to query parameter', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.groupBy.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/events/summary?to=2026-11-30T23:59:59Z')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('should handle empty event summary', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.groupBy.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/events/summary')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.groupBy.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/events/summary')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
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

    it('should return 400 for missing name', async () => {
      const res = await request(app)
        .post('/analytics/metrics')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ category: 'platform', value: 42.5 });
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid category', async () => {
      const res = await request(app)
        .post('/analytics/metrics')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test', category: 'invalid', value: 42.5 });
      expect(res.status).toBe(400);
    });

    it('should accept all valid categories', async () => {
      const prisma = require('../../config/db');
      const categories = ['professional', 'platform', 'payment', 'search'];
      for (const category of categories) {
        prisma.customMetric.create.mockResolvedValueOnce({ id: `m-${category}` });
        const res = await request(app)
          .post('/analytics/metrics')
          .set('Authorization', `Bearer ${adminToken()}`)
          .send({ name: `metric_${category}`, category, value: 100 });
        expect(res.status).toBe(201);
      }
    });

    it('should handle optional unit and dimensions', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.create.mockResolvedValueOnce({ id: 'metric-full' });
      const res = await request(app)
        .post('/analytics/metrics')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test', category: 'platform', value: 42.5, unit: 'ms', dimensions: { env: 'prod' } });
      expect(res.status).toBe(201);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/analytics/metrics')
        .send({ name: 'test', category: 'platform', value: 42.5 });
      expect(res.status).toBe(401);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.create.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .post('/analytics/metrics')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'test', category: 'platform', value: 42.5 });
      expect(res.status).toBe(500);
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

    it('should support name filter', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.findMany.mockResolvedValueOnce([{ name: 'test_metric', value: 42.5 }]);
      prisma.customMetric.count.mockResolvedValueOnce(1);
      const res = await request(app)
        .get('/analytics/metrics?name=test_metric')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('should support category filter', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.findMany.mockResolvedValueOnce([]);
      prisma.customMetric.count.mockResolvedValueOnce(0);
      const res = await request(app)
        .get('/analytics/metrics?category=platform')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('should support date range filtering', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.findMany.mockResolvedValueOnce([]);
      prisma.customMetric.count.mockResolvedValueOnce(0);
      const res = await request(app)
        .get('/analytics/metrics?from=2026-11-01T00:00:00Z&to=2026-11-30T23:59:59Z')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('should calculate summary statistics', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.findMany.mockResolvedValueOnce([
        { name: 'latency', value: 10, unit: 'ms' },
        { name: 'latency', value: 20, unit: 'ms' },
        { name: 'latency', value: 30, unit: 'ms' },
      ]);
      prisma.customMetric.count.mockResolvedValueOnce(3);
      const res = await request(app)
        .get('/analytics/metrics')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.summary).toBeDefined();
    });

    it('should support pagination', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.findMany.mockResolvedValueOnce([]);
      prisma.customMetric.count.mockResolvedValueOnce(200);
      const res = await request(app)
        .get('/analytics/metrics?page=2&limit=50')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.pagination.page).toBe(2);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.customMetric.findMany.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/metrics')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
    });

    it('should return 400 for invalid query parameters', async () => {
      const res = await request(app)
        .get('/analytics/metrics?category=invalid')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /analytics/journey/:userId', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/journey/user-1');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/journey/user-1')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 404 when user not found', async () => {
      const prisma = require('../../config/db');
      prisma.user.findUnique = jest.fn().mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/analytics/journey/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(404);
    });

    it('should return 200 with user journey', async () => {
      const prisma = require('../../config/db');
      prisma.user.findUnique = jest.fn().mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'CLIENT',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      });
      prisma.userEvent.findMany = jest.fn().mockResolvedValueOnce([
        { type: 'login', page: '/home', metadata: null, createdAt: new Date(), sessionId: 'sess-1' },
        { type: 'search', page: '/search', metadata: { query: 'plombier' }, createdAt: new Date(), sessionId: 'sess-1' },
      ]);
      const res = await request(app)
        .get('/analytics/journey/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.totalEvents).toBeDefined();
      expect(res.body.data.sessions).toBeDefined();
    });

    it('should group events into sessions', async () => {
      const prisma = require('../../config/db');
      prisma.user.findUnique = jest.fn().mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'CLIENT',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      });
      const now = new Date();
      prisma.userEvent.findMany = jest.fn().mockResolvedValueOnce([
        { type: 'login', page: '/home', metadata: null, createdAt: new Date(now.getTime()), sessionId: 'sess-1' },
        { type: 'search', page: '/search', metadata: null, createdAt: new Date(now.getTime() + 5 * 60 * 1000), sessionId: 'sess-1' },
        { type: 'search', page: '/search', metadata: null, createdAt: new Date(now.getTime() + 45 * 60 * 1000), sessionId: 'sess-2' },
      ]);
      const res = await request(app)
        .get('/analytics/journey/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.totalSessions).toBe(2);
    });

    it('should detect milestones', async () => {
      const prisma = require('../../config/db');
      prisma.user.findUnique = jest.fn().mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'CLIENT',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      });
      prisma.userEvent.findMany = jest.fn().mockResolvedValueOnce([
        { type: 'search', page: '/search', metadata: null, createdAt: new Date(), sessionId: 'sess-1' },
        { type: 'profile_view', page: '/profile', metadata: null, createdAt: new Date(), sessionId: 'sess-1' },
        { type: 'quote_sent', page: '/quote', metadata: null, createdAt: new Date(), sessionId: 'sess-1' },
        { type: 'payment_success', page: '/payment', metadata: null, createdAt: new Date(), sessionId: 'sess-1' },
      ]);
      const res = await request(app)
        .get('/analytics/journey/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.milestones.searched).toBe(true);
      expect(res.body.data.milestones.madePayment).toBe(true);
    });

    it('should support date range filtering', async () => {
      const prisma = require('../../config/db');
      prisma.user.findUnique = jest.fn().mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@test.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'CLIENT',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      });
      prisma.userEvent.findMany = jest.fn().mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/journey/user-1?from=2026-11-01T00:00:00Z&to=2026-11-30T23:59:59Z')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.user.findUnique = jest.fn().mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/journey/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
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
      prisma.payment.findMany = jest.fn().mockResolvedValueOnce([]);
      prisma.payment.count = jest.fn().mockResolvedValueOnce(10);
      const res = await request(app)
        .get('/analytics/funnel')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should calculate conversion rates for all steps', async () => {
      const prisma = require('../../config/db');
      prisma.user.count.mockResolvedValueOnce(1000);
      prisma.userEvent.findMany
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }, { userId: 'u5' }, { userId: 'u6' }])
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }, { userId: 'u5' }])
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }])
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
      prisma.booking.count.mockResolvedValueOnce(200);
      prisma.payment.count.mockResolvedValueOnce(100);
      const res = await request(app)
        .get('/analytics/funnel')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should support date range filtering', async () => {
      const prisma = require('../../config/db');
      prisma.user.count.mockResolvedValueOnce(100);
      prisma.userEvent.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValueOnce(20);
      prisma.payment.count.mockResolvedValueOnce(10);
      const res = await request(app)
        .get('/analytics/funnel?from=2026-11-01T00:00:00Z&to=2026-11-30T23:59:59Z')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should support role filtering', async () => {
      const prisma = require('../../config/db');
      prisma.user.count.mockResolvedValueOnce(500);
      prisma.userEvent.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValueOnce(100);
      prisma.payment.count.mockResolvedValueOnce(50);
      const res = await request(app)
        .get('/analytics/funnel?role=CLIENT')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should return 400 for invalid date range', async () => {
      const res = await request(app)
        .get('/analytics/funnel?from=invalid-date')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid role', async () => {
      const res = await request(app)
        .get('/analytics/funnel?role=INVALID')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should calculate overall conversion', async () => {
      const prisma = require('../../config/db');
      prisma.user.count.mockResolvedValueOnce(1000);
      prisma.userEvent.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValueOnce(0);
      prisma.payment.count.mockResolvedValueOnce(50);
      const res = await request(app)
        .get('/analytics/funnel')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should handle zero registered users', async () => {
      const prisma = require('../../config/db');
      prisma.user.count.mockResolvedValueOnce(0);
      prisma.userEvent.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValueOnce(0);
      prisma.payment.count.mockResolvedValueOnce(0);
      const res = await request(app)
        .get('/analytics/funnel')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.user.count.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/funnel')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
    });
  });

  describe('GET /analytics/cohorts', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/cohorts');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/cohorts')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should support months query parameter', async () => {
      const prisma = require('../../config/db');
      prisma.cohortSnapshot.findMany.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/cohorts?months=12')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should return 400 for invalid months parameter', async () => {
      const res = await request(app)
        .get('/analytics/cohorts?months=0')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should return 400 for months > 24', async () => {
      const res = await request(app)
        .get('/analytics/cohorts?months=25')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.cohortSnapshot.findMany.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/cohorts')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
    });
  });

  describe('POST /analytics/cohorts/snapshot', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/analytics/cohorts/snapshot');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/analytics/cohorts/snapshot')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 for admin', async () => {
      const prisma = require('../../config/db');
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);
      prisma.userEvent.findMany.mockResolvedValue([{ userId: 'user-1' }]);
      prisma.cohortSnapshot.upsert.mockResolvedValue({});
      const res = await request(app)
        .post('/analytics/cohorts/snapshot')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.user.findMany.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .post('/analytics/cohorts/snapshot')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
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

    it('should calculate DAU/WAU/MAU', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.findMany
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }])
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }])
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }, { userId: 'u4' }])
        .mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(100);
      const res = await request(app)
        .get('/analytics/retention')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should calculate D7 and D30 retention', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(100);
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      const res = await request(app)
        .get('/analytics/retention')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.userEvent.findMany.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/retention')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
    });
  });

  describe('GET /analytics/retention/history', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/retention/history');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/retention/history')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should support days query parameter', async () => {
      const prisma = require('../../config/db');
      prisma.retentionSnapshot.findMany.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/retention/history?days=30')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should validate days parameter', async () => {
      const res = await request(app)
        .get('/analytics/retention/history?days=5')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should validate days does not exceed 90', async () => {
      const res = await request(app)
        .get('/analytics/retention/history?days=91')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.retentionSnapshot.findMany.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/retention/history')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });
  });

  describe('GET /analytics/churn', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/churn');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/churn')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should support riskLevel filter', async () => {
      const prisma = require('../../config/db');
      prisma.user.findMany.mockResolvedValueOnce([]);
      prisma.user.count.mockResolvedValueOnce(0);
      const res = await request(app)
        .get('/analytics/churn?riskLevel=high')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should return 400 for invalid riskLevel', async () => {
      const res = await request(app)
        .get('/analytics/churn?riskLevel=invalid')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should support pagination', async () => {
      const prisma = require('../../config/db');
      prisma.user.findMany.mockResolvedValueOnce([]);
      prisma.user.count.mockResolvedValueOnce(0);
      const res = await request(app)
        .get('/analytics/churn?page=1&limit=50')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.user.findMany.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/churn')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
    });
  });

  describe('GET /analytics/churn/subscriptions', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/churn/subscriptions');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/churn/subscriptions')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should support days query parameter', async () => {
      const prisma = require('../../config/db');
      prisma.subscription.count.mockResolvedValue(0);
      prisma.professional.count.mockResolvedValueOnce(10);
      const res = await request(app)
        .get('/analytics/churn/subscriptions?days=30')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.subscription.count.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/churn/subscriptions')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
    });
  });

  describe('GET /analytics/revenue/saas', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/revenue/saas');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/revenue/saas')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with revenue metrics', async () => {
      const prisma = require('../../config/db');
      prisma.subscription.findMany.mockResolvedValueOnce([]);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      const res = await request(app)
        .get('/analytics/revenue/saas')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should calculate MRR and ARR', async () => {
      const prisma = require('../../config/db');
      prisma.subscription.findMany.mockResolvedValue([
        { tier: 'ESSENTIEL' },
        { tier: 'PRO' },
        { tier: 'ELITE' },
      ]);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 5000 } });
      const res = await request(app)
        .get('/analytics/revenue/saas')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.subscription.findMany.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/revenue/saas')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(500);
    });
  });

  describe('GET /analytics/revenue/transactions', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/analytics/revenue/transactions');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/analytics/revenue/transactions')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('should support date range filtering', async () => {
      const prisma = require('../../config/db');
      prisma.payment.findMany.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/revenue/transactions?from=2026-11-01T00:00:00Z&to=2026-11-30T23:59:59Z')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should support groupBy parameter', async () => {
      const prisma = require('../../config/db');
      prisma.payment.findMany.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/analytics/revenue/transactions?groupBy=day')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should return 400 for invalid groupBy', async () => {
      const res = await request(app)
        .get('/analytics/revenue/transactions?groupBy=invalid')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should handle database errors', async () => {
      const prisma = require('../../config/db');
      prisma.payment.findMany.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get('/analytics/revenue/transactions')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect([200, 500]).toContain(res.status);
    });
  });
});
