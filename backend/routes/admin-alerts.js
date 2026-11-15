/**
 * Q89: Alert Events Routes (Refactored)
 * Thin route layer using AdminAlertsModule
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const AdminAlertsModule = require('../modules/AdminAlertsModule');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN']));

const alertsModule = new AdminAlertsModule(prisma);
const { getValidTypes, getValidSeverities, getValidStatuses } = AdminAlertsModule;

// GET /events — List alert events
router.get('/events', [
  query('status').optional().isIn(getValidStatuses()),
  query('severity').optional().isIn(getValidSeverities()),
  query('type').optional().isIn(getValidTypes()),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { page = 1, limit = 50 } = req.query;
    const result = await alertsModule.getEvents(req.query, { page: parseInt(page), limit: parseInt(limit) });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list alert events' });
  }
});

// POST /events — Create event
router.post('/events', [
  body('type').isIn(getValidTypes()),
  body('severity').isIn(getValidSeverities()),
  body('message').isString().trim().notEmpty(),
  body('value').optional().isFloat(),
  body('threshold').optional().isFloat(),
  body('channel').optional().isIn(['slack', 'email', 'pagerduty']),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const event = await alertsModule.createEvent(req.body);
    res.status(201).json({ success: true, data: { event } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fire alert event' });
  }
});

// PATCH /events/:id/acknowledge — Acknowledge event
router.patch('/events/:id/acknowledge', async (req, res) => {
  try {
    const event = await alertsModule.acknowledgeEvent(req.params.id, req.user.id);
    res.json({ success: true, data: { event } });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: 'Alert event not found' });
    if (err.message.includes('Cannot')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

// PATCH /events/:id/resolve — Resolve event
router.patch('/events/:id/resolve', async (req, res) => {
  try {
    const event = await alertsModule.resolveEvent(req.params.id);
    res.json({ success: true, data: { event } });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: 'Alert event not found' });
    if (err.message.includes('already resolved')) return res.status(400).json({ error: 'Alert already resolved' });
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

// PATCH /events/:id/silence — Silence event
router.patch('/events/:id/silence', [
  body('minutes').isInt({ min: 1, max: 1440 }).withMessage('1-1440 minutes required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const event = await alertsModule.silenceEvent(req.params.id, req.body.minutes);
    res.json({ success: true, data: { event, silencedUntil: event.silencedUntil } });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: 'Alert event not found' });
    res.status(500).json({ error: 'Failed to silence alert' });
  }
});

// GET /stats — Get stats
router.get('/stats', [
  query('days').optional().isInt({ min: 1, max: 90 }),
], async (req, res) => {
  try {
    const days = parseInt(req.query.days || '30');
    const data = await alertsModule.getStats(days);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute alert stats' });
  }
});

module.exports = router;
