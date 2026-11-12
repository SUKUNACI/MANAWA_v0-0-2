/**
 * Analytics Events Routes — Q79, Q80, Q81
 * Custom metrics, event tracking, user journey tracking
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

const eventsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Q80: Event Tracking ─────────────────────────────────────────────────────

/**
 * POST /api/v1/analytics/events
 * Track a user event (called by frontend/mobile on user actions)
 */
router.post(
  '/events',
  eventsLimiter,
  [
    body('type')
      .isString()
      .isIn([
        'search', 'profile_view', 'quote_sent', 'quote_accepted', 'quote_rejected',
        'booking_created', 'booking_confirmed', 'payment_initiated', 'payment_success',
        'payment_failed', 'login', 'logout', 'register', 'message_sent',
        'review_submitted', 'subscription_upgraded', 'subscription_cancelled',
        'portfolio_viewed', 'package_ordered', 'video_call_started',
      ])
      .withMessage('Invalid event type'),
    body('page').optional().isString().trim(),
    body('metadata').optional().isObject(),
    body('sessionId').optional().isString().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { type, page, metadata, sessionId } = req.body;

      await prisma.userEvent.create({
        data: {
          userId: req.user?.id || null,
          sessionId: sessionId || null,
          type,
          page: page || null,
          metadata: metadata || null,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      res.status(201).json({ success: true });
    } catch (err) {
      logger.error('[Events] Failed to track event', { error: err.message });
      res.status(500).json({ error: 'Failed to track event' });
    }
  }
);

/**
 * POST /api/v1/analytics/events/batch
 * Track multiple events at once (mobile offline sync)
 */
router.post(
  '/events/batch',
  eventsLimiter,
  requireAuth,
  [
    body('events').isArray({ min: 1, max: 100 }).withMessage('1-100 events required'),
    body('events.*.type').isString().notEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { events } = req.body;
      const userId = req.user.id;

      await prisma.userEvent.createMany({
        data: events.map(e => ({
          userId,
          sessionId: e.sessionId || null,
          type: e.type,
          page: e.page || null,
          metadata: e.metadata || null,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || null,
        })),
      });

      res.status(201).json({ success: true, count: events.length });
    } catch (err) {
      logger.error('[Events] Failed to batch track', { error: err.message });
      res.status(500).json({ error: 'Failed to batch track events' });
    }
  }
);

/**
 * GET /api/v1/analytics/events/summary (admin only)
 * Event counts grouped by type for a time range
 */
router.get(
  '/events/summary',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const where = {};
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }

      const events = await prisma.userEvent.groupBy({
        by: ['type'],
        where,
        _count: { type: true },
        orderBy: { _count: { type: 'desc' } },
      });

      const total = events.reduce((s, e) => s + e._count.type, 0);

      res.json({
        success: true,
        data: {
          total,
          byType: events.map(e => ({
            type: e.type,
            count: e._count.type,
            percentage: parseFloat(((e._count.type / total) * 100).toFixed(2)),
          })),
        },
      });
    } catch (err) {
      logger.error('[Events] Failed to summarize', { error: err.message });
      res.status(500).json({ error: 'Failed to summarize events' });
    }
  }
);

// ─── Q79: Custom Metrics ──────────────────────────────────────────────────────

/**
 * POST /api/v1/analytics/metrics (admin only)
 * Record a custom metric
 */
router.post(
  '/metrics',
  requireAuth,
  requireRole(['ADMIN']),
  [
    body('name').isString().trim().notEmpty(),
    body('category').isIn(['professional', 'platform', 'payment', 'search']),
    body('value').isFloat(),
    body('unit').optional().isString().trim(),
    body('dimensions').optional().isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, category, value, unit, dimensions } = req.body;

      const metric = await prisma.customMetric.create({
        data: { name, category, value, unit: unit || null, dimensions: dimensions || null },
      });

      res.status(201).json({ success: true, data: { metric } });
    } catch (err) {
      logger.error('[Metrics] Failed to record metric', { error: err.message });
      res.status(500).json({ error: 'Failed to record metric' });
    }
  }
);

/**
 * GET /api/v1/analytics/metrics (admin only)
 * Query custom metrics with time range and aggregation
 */
router.get(
  '/metrics',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('name').optional().isString(),
    query('category').optional().isIn(['professional', 'platform', 'payment', 'search']),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, category, from, to, page = 1, limit = 100 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = {};
      if (name) where.name = name;
      if (category) where.category = category;
      if (from || to) {
        where.recordedAt = {};
        if (from) where.recordedAt.gte = new Date(from);
        if (to) where.recordedAt.lte = new Date(to);
      }

      const [metrics, total] = await Promise.all([
        prisma.customMetric.findMany({
          where,
          skip,
          take: parseInt(limit),
          orderBy: { recordedAt: 'desc' },
        }),
        prisma.customMetric.count({ where }),
      ]);

      // Build summary: mean, min, max per metric name
      const aggregated = {};
      metrics.forEach(m => {
        if (!aggregated[m.name]) {
          aggregated[m.name] = { name: m.name, unit: m.unit, values: [] };
        }
        aggregated[m.name].values.push(m.value);
      });

      const summary = Object.values(aggregated).map(a => ({
        name: a.name,
        unit: a.unit,
        count: a.values.length,
        mean: parseFloat((a.values.reduce((s, v) => s + v, 0) / a.values.length).toFixed(4)),
        min: Math.min(...a.values),
        max: Math.max(...a.values),
      }));

      res.json({
        success: true,
        data: {
          metrics,
          summary,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      logger.error('[Metrics] Failed to list metrics', { error: err.message });
      res.status(500).json({ error: 'Failed to list metrics' });
    }
  }
);

// ─── Q81: User Journey Tracking ──────────────────────────────────────────────

/**
 * GET /api/v1/analytics/journey/:userId (admin only)
 * Reconstruct a user's full journey from events
 */
router.get(
  '/journey/:userId',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId } = req.params;
      const { from, to } = req.query;

      const where = { userId };
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }

      const [user, events] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true, email: true, firstName: true, lastName: true,
            role: true, createdAt: true, lastLoginAt: true,
          },
        }),
        prisma.userEvent.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take: 500,
        }),
      ]);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Group events into sessions (30 min inactivity = new session)
      const SESSION_GAP_MS = 30 * 60 * 1000;
      const sessions = [];
      let currentSession = null;

      for (const event of events) {
        const ts = new Date(event.createdAt).getTime();

        if (!currentSession || ts - currentSession.lastTs > SESSION_GAP_MS) {
          currentSession = {
            sessionId: event.sessionId || `auto-${sessions.length + 1}`,
            startedAt: event.createdAt,
            lastTs: ts,
            events: [],
          };
          sessions.push(currentSession);
        }

        currentSession.lastTs = ts;
        currentSession.events.push({
          type: event.type,
          page: event.page,
          metadata: event.metadata,
          createdAt: event.createdAt,
        });
      }

      // Milestone detection
      const eventTypes = new Set(events.map(e => e.type));
      const milestones = {
        registered: true,
        searched: eventTypes.has('search'),
        viewedProfile: eventTypes.has('profile_view'),
        sentQuote: eventTypes.has('quote_sent'),
        acceptedQuote: eventTypes.has('quote_accepted'),
        createdBooking: eventTypes.has('booking_created'),
        madePayment: eventTypes.has('payment_success'),
        leftReview: eventTypes.has('review_submitted'),
        upgradedSubscription: eventTypes.has('subscription_upgraded'),
      };

      res.json({
        success: true,
        data: {
          user,
          totalEvents: events.length,
          totalSessions: sessions.length,
          milestones,
          completedMilestones: Object.values(milestones).filter(Boolean).length,
          sessions,
        },
      });
    } catch (err) {
      logger.error('[Journey] Failed to get journey', { error: err.message });
      res.status(500).json({ error: 'Failed to get user journey' });
    }
  }
);

module.exports = router;
