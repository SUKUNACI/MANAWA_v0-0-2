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
const AnalyticsEventsModule = require('../modules/analyticsEvents');

const router = express.Router();
const analyticsEvents = new AnalyticsEventsModule(prisma);

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
      await analyticsEvents.trackEvent(type, page, metadata, sessionId, req.user?.id || null, req.ip, req.headers['user-agent']);

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
      const result = await analyticsEvents.trackBatchEvents(events, req.user.id, req.ip, req.headers['user-agent']);

      res.status(201).json({ success: true, count: result.count });
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
      const summary = await analyticsEvents.getEventsSummary(from, to);

      res.json({ success: true, data: summary });
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
      const metric = await analyticsEvents.recordMetric(name, category, value, unit, dimensions);

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
      const result = await analyticsEvents.queryMetrics(name, category, from, to, parseInt(page), parseInt(limit));

      res.json({ success: true, data: result });
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

      try {
        const result = await analyticsEvents.getUserJourney(userId, from, to);
        res.json({ success: true, data: result });
      } catch (err) {
        if (err.message === 'User not found') {
          return res.status(404).json({ error: 'User not found' });
        }
        throw err;
      }
    } catch (err) {
      logger.error('[Journey] Failed to get journey', { error: err.message });
      res.status(500).json({ error: 'Failed to get user journey' });
    }
  }
);

module.exports = router;
