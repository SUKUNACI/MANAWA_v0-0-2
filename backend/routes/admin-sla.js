/**
 * Q88: Performance SLA Targets Routes
 * Define SLA targets, record breaches, generate compliance reports
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN']));

const VALID_CATEGORIES = ['latency', 'availability', 'error_rate', 'throughput'];

// Default SLA targets seeded on first request if none exist
const DEFAULT_SLA_TARGETS = [
  { name: 'api_p95_latency',    category: 'latency',      targetValue: 500,  unit: 'ms',    windowHours: 1  },
  { name: 'api_p99_latency',    category: 'latency',      targetValue: 2000, unit: 'ms',    windowHours: 1  },
  { name: 'uptime',             category: 'availability', targetValue: 99.9, unit: '%',     windowHours: 720 },
  { name: 'error_rate',         category: 'error_rate',   targetValue: 0.1,  unit: '%',     windowHours: 1  },
  { name: 'payment_error_rate', category: 'error_rate',   targetValue: 0.5,  unit: '%',     windowHours: 24 },
];

async function seedDefaultTargets() {
  for (const t of DEFAULT_SLA_TARGETS) {
    await prisma.slaTarget.upsert({
      where: { name: t.name },
      create: t,
      update: {},
    });
  }
}

/**
 * GET /admin/sla/targets
 * List all SLA targets
 */
router.get('/targets', async (req, res) => {
  try {
    let targets = await prisma.slaTarget.findMany({ orderBy: { category: 'asc' } });

    if (targets.length === 0) {
      await seedDefaultTargets();
      targets = await prisma.slaTarget.findMany({ orderBy: { category: 'asc' } });
    }

    res.json({ success: true, data: { targets } });
  } catch (err) {
    logger.error('[SLA] Failed to list targets', { error: err.message });
    res.status(500).json({ error: 'Failed to list SLA targets' });
  }
});

/**
 * POST /admin/sla/targets
 * Create or update an SLA target
 */
router.post('/targets', [
  body('name').isString().trim().notEmpty(),
  body('category').isIn(VALID_CATEGORIES),
  body('targetValue').isFloat({ min: 0 }),
  body('unit').isString().trim().notEmpty(),
  body('windowHours').optional().isInt({ min: 1, max: 8760 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, category, targetValue, unit, windowHours } = req.body;

    const target = await prisma.slaTarget.upsert({
      where: { name },
      create: { name, category, targetValue, unit, windowHours: windowHours || 24 },
      update: { category, targetValue, unit, windowHours: windowHours || 24 },
    });

    logger.info('[SLA] Target upserted', { adminId: req.user.id, name, targetValue });
    res.status(201).json({ success: true, data: { target } });
  } catch (err) {
    logger.error('[SLA] Failed to upsert target', { error: err.message });
    res.status(500).json({ error: 'Failed to upsert SLA target' });
  }
});

/**
 * POST /admin/sla/breaches
 * Record an SLA breach (called by monitoring cron or manually)
 */
router.post('/breaches', [
  body('slaTargetId').isString().notEmpty(),
  body('measuredValue').isFloat(),
  body('durationMs').optional().isInt({ min: 0 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { slaTargetId, measuredValue, durationMs } = req.body;

    const target = await prisma.slaTarget.findUnique({ where: { id: slaTargetId } });
    if (!target) return res.status(404).json({ error: 'SLA target not found' });

    const breach = await prisma.slaBreach.create({
      data: {
        slaTargetId,
        measuredValue,
        durationMs: durationMs || null,
      },
    });

    logger.warn('[SLA] Breach recorded', { targetName: target.name, measuredValue, targetValue: target.targetValue });
    res.status(201).json({ success: true, data: { breach } });
  } catch (err) {
    logger.error('[SLA] Failed to record breach', { error: err.message });
    res.status(500).json({ error: 'Failed to record SLA breach' });
  }
});

/**
 * PATCH /admin/sla/breaches/:id/resolve
 * Mark a breach as resolved
 */
router.patch('/breaches/:id/resolve', async (req, res) => {
  try {
    const breach = await prisma.slaBreach.findUnique({ where: { id: req.params.id } });
    if (!breach) return res.status(404).json({ error: 'Breach not found' });

    const durationMs = breach.resolvedAt
      ? breach.durationMs
      : new Date() - new Date(breach.breachedAt);

    const updated = await prisma.slaBreach.update({
      where: { id: req.params.id },
      data: { resolvedAt: new Date(), durationMs },
    });

    res.json({ success: true, data: { breach: updated } });
  } catch (err) {
    logger.error('[SLA] Failed to resolve breach', { error: err.message });
    res.status(500).json({ error: 'Failed to resolve breach' });
  }
});

/**
 * GET /admin/sla/report
 * SLA compliance report for a time range
 * Returns: compliance %, breach count, MTTR per target
 */
router.get('/report', [
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const now    = new Date();
    const from   = req.query.from ? new Date(req.query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to     = req.query.to   ? new Date(req.query.to)   : now;
    const windowMs = to - from;

    const targets = await prisma.slaTarget.findMany({
      where: { enabled: true },
      include: {
        breaches: {
          where: { breachedAt: { gte: from, lte: to } },
        },
      },
    });

    const report = targets.map(t => {
      const breaches   = t.breaches;
      const totalDownMs = breaches.reduce((s, b) => s + (b.durationMs || 0), 0);
      const resolvedBreaches = breaches.filter(b => b.resolvedAt && b.durationMs);
      const mttrMs = resolvedBreaches.length > 0
        ? Math.round(resolvedBreaches.reduce((s, b) => s + b.durationMs, 0) / resolvedBreaches.length)
        : null;

      // Uptime/compliance: for latency/error targets, rough compliance = (window - downtime) / window
      const compliancePct = windowMs > 0
        ? parseFloat((Math.max(0, ((windowMs - totalDownMs) / windowMs) * 100)).toFixed(3))
        : 100;

      return {
        name:          t.name,
        category:      t.category,
        targetValue:   t.targetValue,
        unit:          t.unit,
        breachCount:   breaches.length,
        totalDownMs,
        mttrMs,
        compliancePct,
        meetsSla:      compliancePct >= (t.category === 'availability' ? t.targetValue : 99),
      };
    });

    const overallCompliance = report.length > 0
      ? parseFloat((report.reduce((s, r) => s + r.compliancePct, 0) / report.length).toFixed(2))
      : 100;

    res.json({
      success: true,
      data: {
        period: { from, to },
        overallCompliance,
        targets: report,
        totalBreaches: report.reduce((s, r) => s + r.breachCount, 0),
      },
    });
  } catch (err) {
    logger.error('[SLA] Report failed', { error: err.message });
    res.status(500).json({ error: 'Failed to generate SLA report' });
  }
});

module.exports = router;
