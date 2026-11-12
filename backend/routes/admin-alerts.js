/**
 * Q89: Alert Thresholds & Alert Events Routes
 * History, acknowledge, silence, notification channels
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN']));

const VALID_TYPES     = ['error_rate', 'latency', 'memory', 'cpu', 'payment_failure', 'queue_depth'];
const VALID_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'];
const VALID_STATUSES  = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SILENCED'];

// ─── Alert Events ─────────────────────────────────────────────────────────────

/**
 * GET /admin/alerts/events
 * List alert events with filters
 */
router.get('/events', [
  query('status').optional().isIn(VALID_STATUSES),
  query('severity').optional().isIn(VALID_SEVERITIES),
  query('type').optional().isIn(VALID_TYPES),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { status, severity, type, from, to, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status)   where.status = status;
    if (severity) where.severity = severity;
    if (type)     where.type = type;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    const [events, total] = await Promise.all([
      prisma.alertEvent.findMany({ where, skip, take: parseInt(limit), orderBy: { createdAt: 'desc' } }),
      prisma.alertEvent.count({ where }),
    ]);

    // Open alert summary counts
    const [openCritical, openWarn] = await Promise.all([
      prisma.alertEvent.count({ where: { status: 'OPEN', severity: 'CRITICAL' } }),
      prisma.alertEvent.count({ where: { status: 'OPEN', severity: 'WARN' } }),
    ]);

    res.json({
      success: true,
      data: {
        events,
        openSummary: { critical: openCritical, warn: openWarn },
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    logger.error('[Alerts] Failed to list events', { error: err.message });
    res.status(500).json({ error: 'Failed to list alert events' });
  }
});

/**
 * POST /admin/alerts/events
 * Fire a new alert event (called by monitoring jobs/crons)
 */
router.post('/events', [
  body('type').isIn(VALID_TYPES),
  body('severity').isIn(VALID_SEVERITIES),
  body('message').isString().trim().notEmpty(),
  body('value').optional().isFloat(),
  body('threshold').optional().isFloat(),
  body('channel').optional().isIn(['slack', 'email', 'pagerduty']),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { type, severity, message, value, threshold, channel } = req.body;

    const event = await prisma.alertEvent.create({
      data: {
        type,
        severity,
        message,
        value:     value     !== undefined ? value     : null,
        threshold: threshold !== undefined ? threshold : null,
        channel:   channel   || null,
        status:    'OPEN',
      },
    });

    logger.warn('[Alerts] Event fired', { type, severity, message });
    res.status(201).json({ success: true, data: { event } });
  } catch (err) {
    logger.error('[Alerts] Failed to fire event', { error: err.message });
    res.status(500).json({ error: 'Failed to fire alert event' });
  }
});

/**
 * PATCH /admin/alerts/events/:id/acknowledge
 * Acknowledge an open alert
 */
router.patch('/events/:id/acknowledge', async (req, res) => {
  try {
    const event = await prisma.alertEvent.findUnique({ where: { id: req.params.id } });
    if (!event)              return res.status(404).json({ error: 'Alert event not found' });
    if (event.status !== 'OPEN') return res.status(400).json({ error: `Cannot acknowledge alert with status ${event.status}` });

    const updated = await prisma.alertEvent.update({
      where: { id: req.params.id },
      data: { status: 'ACKNOWLEDGED', acknowledgedBy: req.user.id, acknowledgedAt: new Date() },
    });

    logger.info('[Alerts] Acknowledged', { adminId: req.user.id, alertId: req.params.id });
    res.json({ success: true, data: { event: updated } });
  } catch (err) {
    logger.error('[Alerts] Acknowledge failed', { error: err.message });
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

/**
 * PATCH /admin/alerts/events/:id/resolve
 * Resolve an alert
 */
router.patch('/events/:id/resolve', async (req, res) => {
  try {
    const event = await prisma.alertEvent.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: 'Alert event not found' });
    if (event.status === 'RESOLVED') return res.status(400).json({ error: 'Alert already resolved' });

    const updated = await prisma.alertEvent.update({
      where: { id: req.params.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    logger.info('[Alerts] Resolved', { adminId: req.user.id, alertId: req.params.id });
    res.json({ success: true, data: { event: updated } });
  } catch (err) {
    logger.error('[Alerts] Resolve failed', { error: err.message });
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

/**
 * PATCH /admin/alerts/events/:id/silence
 * Silence an alert for N minutes
 */
router.patch('/events/:id/silence', [
  body('minutes').isInt({ min: 1, max: 1440 }).withMessage('1-1440 minutes required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const event = await prisma.alertEvent.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: 'Alert event not found' });

    const silencedUntil = new Date(Date.now() + req.body.minutes * 60 * 1000);

    const updated = await prisma.alertEvent.update({
      where: { id: req.params.id },
      data: { status: 'SILENCED', silencedUntil },
    });

    logger.info('[Alerts] Silenced', { adminId: req.user.id, alertId: req.params.id, minutes: req.body.minutes });
    res.json({ success: true, data: { event: updated, silencedUntil } });
  } catch (err) {
    logger.error('[Alerts] Silence failed', { error: err.message });
    res.status(500).json({ error: 'Failed to silence alert' });
  }
});

/**
 * GET /admin/alerts/stats
 * Alert statistics: counts by type, severity, mean time to acknowledge/resolve
 */
router.get('/stats', [
  query('days').optional().isInt({ min: 1, max: 90 }),
], async (req, res) => {
  try {
    const days   = parseInt(req.query.days || '30');
    const since  = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const events = await prisma.alertEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { type: true, severity: true, status: true, createdAt: true, acknowledgedAt: true, resolvedAt: true },
    });

    const byType     = {};
    const bySeverity = {};
    let   totalAckMs = 0, ackedCount = 0;
    let   totalResMs = 0, resolvedCount = 0;

    events.forEach(e => {
      byType[e.type]         = (byType[e.type]         || 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;

      if (e.acknowledgedAt) {
        totalAckMs += new Date(e.acknowledgedAt) - new Date(e.createdAt);
        ackedCount++;
      }
      if (e.resolvedAt) {
        totalResMs += new Date(e.resolvedAt) - new Date(e.createdAt);
        resolvedCount++;
      }
    });

    res.json({
      success: true,
      data: {
        period: `${days} days`,
        total: events.length,
        byType,
        bySeverity,
        meanTimeToAcknowledgeMs: ackedCount   > 0 ? Math.round(totalAckMs / ackedCount)   : null,
        meanTimeToResolveMs:     resolvedCount > 0 ? Math.round(totalResMs / resolvedCount) : null,
      },
    });
  } catch (err) {
    logger.error('[Alerts] Stats failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute alert stats' });
  }
});

module.exports = router;
