/**
 * Q90: On-Call Rotation Routes
 * Schedule, current on-call, escalation logic
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN']));

/**
 * GET /admin/oncall/current
 * Who is on-call right now (level 1 = primary, level 2 = escalation)
 */
router.get('/current', async (req, res) => {
  try {
    const now = new Date();

    const slots = await prisma.onCallSchedule.findMany({
      where: { startAt: { lte: now }, endAt: { gt: now } },
      orderBy: { level: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      },
    });

    const primary   = slots.find(s => s.level === 1) || null;
    const secondary = slots.find(s => s.level === 2) || null;

    res.json({
      success: true,
      data: {
        currentTime: now,
        primary:   primary   ? { ...primary.user,   startAt: primary.startAt,   endAt: primary.endAt,   timezone: primary.timezone   } : null,
        secondary: secondary ? { ...secondary.user, startAt: secondary.startAt, endAt: secondary.endAt, timezone: secondary.timezone } : null,
        hasOnCall: !!primary,
      },
    });
  } catch (err) {
    logger.error('[OnCall] Failed to get current', { error: err.message });
    res.status(500).json({ error: 'Failed to get current on-call' });
  }
});

/**
 * GET /admin/oncall/schedule
 * List upcoming on-call schedule
 */
router.get('/schedule', [
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('userId').optional().isString(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const now  = new Date();
    const from = req.query.from ? new Date(req.query.from) : now;
    const to   = req.query.to   ? new Date(req.query.to)   : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const where = { startAt: { gte: from }, endAt: { lte: to } };
    if (req.query.userId) where.userId = req.query.userId;

    const schedule = await prisma.onCallSchedule.findMany({
      where,
      orderBy: [{ startAt: 'asc' }, { level: 'asc' }],
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    res.json({ success: true, data: { schedule, period: { from, to } } });
  } catch (err) {
    logger.error('[OnCall] Failed to list schedule', { error: err.message });
    res.status(500).json({ error: 'Failed to list on-call schedule' });
  }
});

/**
 * POST /admin/oncall/schedule
 * Create an on-call slot
 */
router.post('/schedule', [
  body('userId').isString().notEmpty(),
  body('startAt').isISO8601(),
  body('endAt').isISO8601(),
  body('timezone').optional().isString().trim(),
  body('level').optional().isInt({ min: 1, max: 3 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { userId, startAt, endAt, timezone, level } = req.body;

    if (new Date(endAt) <= new Date(startAt)) {
      return res.status(400).json({ error: 'endAt must be after startAt' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check for overlapping slots at the same level for the same user
    const overlap = await prisma.onCallSchedule.findFirst({
      where: {
        userId,
        level: level || 1,
        OR: [
          { startAt: { lte: new Date(startAt) }, endAt: { gt: new Date(startAt) } },
          { startAt: { lt: new Date(endAt) },    endAt: { gte: new Date(endAt) } },
          { startAt: { gte: new Date(startAt) }, endAt: { lte: new Date(endAt) } },
        ],
      },
    });

    if (overlap) {
      return res.status(409).json({ error: 'On-call slot overlaps with existing schedule for this user and level' });
    }

    const slot = await prisma.onCallSchedule.create({
      data: {
        userId,
        startAt: new Date(startAt),
        endAt:   new Date(endAt),
        timezone: timezone || 'Europe/Paris',
        level:    level    || 1,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    logger.info('[OnCall] Slot created', { adminId: req.user.id, userId, startAt, endAt });
    res.status(201).json({ success: true, data: { slot } });
  } catch (err) {
    logger.error('[OnCall] Failed to create slot', { error: err.message });
    res.status(500).json({ error: 'Failed to create on-call slot' });
  }
});

/**
 * DELETE /admin/oncall/schedule/:id
 * Remove an on-call slot
 */
router.delete('/schedule/:id', async (req, res) => {
  try {
    const slot = await prisma.onCallSchedule.findUnique({ where: { id: req.params.id } });
    if (!slot) return res.status(404).json({ error: 'On-call slot not found' });

    await prisma.onCallSchedule.delete({ where: { id: req.params.id } });
    logger.info('[OnCall] Slot deleted', { adminId: req.user.id, id: req.params.id });
    res.json({ success: true, message: 'On-call slot deleted' });
  } catch (err) {
    logger.error('[OnCall] Delete failed', { error: err.message });
    res.status(500).json({ error: 'Failed to delete on-call slot' });
  }
});

/**
 * POST /admin/oncall/escalate
 * Trigger escalation: notify secondary if primary hasn't acknowledged an alert
 */
router.post('/escalate', [
  body('alertEventId').isString().notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { alertEventId } = req.body;
    const now = new Date();

    // Get alert
    const alert = await prisma.alertEvent.findUnique({ where: { id: alertEventId } });
    if (!alert) return res.status(404).json({ error: 'Alert event not found' });
    if (alert.status !== 'OPEN') {
      return res.status(400).json({ error: `Alert is already ${alert.status}` });
    }

    // Get current secondary on-call
    const secondary = await prisma.onCallSchedule.findFirst({
      where: { startAt: { lte: now }, endAt: { gt: now }, level: 2 },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    if (!secondary) {
      return res.status(404).json({ error: 'No secondary on-call person found for current time' });
    }

    // Log escalation action
    logger.warn('[OnCall] Escalation triggered', {
      alertId: alertEventId,
      escalatedTo: secondary.user.email,
      triggeredBy: req.user.id,
    });

    res.json({
      success: true,
      data: {
        escalatedTo: secondary.user,
        alertId:     alertEventId,
        message:     `Escalation triggered to ${secondary.user.firstName} ${secondary.user.lastName} (${secondary.user.email})`,
      },
    });
  } catch (err) {
    logger.error('[OnCall] Escalation failed', { error: err.message });
    res.status(500).json({ error: 'Failed to trigger escalation' });
  }
});

/**
 * GET /admin/oncall/gaps
 * Find time gaps in the on-call schedule (periods with no primary coverage)
 */
router.get('/gaps', [
  query('from').optional().isISO8601(),
  query('days').optional().isInt({ min: 1, max: 90 }),
], async (req, res) => {
  try {
    const now  = new Date();
    const from = req.query.from ? new Date(req.query.from) : now;
    const days = parseInt(req.query.days || '14');
    const to   = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

    const slots = await prisma.onCallSchedule.findMany({
      where: { level: 1, startAt: { lt: to }, endAt: { gt: from } },
      orderBy: { startAt: 'asc' },
    });

    const gaps = [];
    let cursor = from;

    for (const slot of slots) {
      if (new Date(slot.startAt) > cursor) {
        gaps.push({ from: cursor, to: new Date(slot.startAt), durationHours: parseFloat(((new Date(slot.startAt) - cursor) / 3600000).toFixed(2)) });
      }
      if (new Date(slot.endAt) > cursor) cursor = new Date(slot.endAt);
    }

    if (cursor < to) {
      gaps.push({ from: cursor, to, durationHours: parseFloat(((to - cursor) / 3600000).toFixed(2)) });
    }

    res.json({
      success: true,
      data: {
        period: { from, to, days },
        gaps,
        totalGapHours: parseFloat(gaps.reduce((s, g) => s + g.durationHours, 0).toFixed(2)),
        coveragePercent: parseFloat((Math.max(0, 1 - gaps.reduce((s, g) => s + g.durationHours, 0) / (days * 24)) * 100).toFixed(2)),
      },
    });
  } catch (err) {
    logger.error('[OnCall] Gaps check failed', { error: err.message });
    res.status(500).json({ error: 'Failed to find schedule gaps' });
  }
});

module.exports = router;
