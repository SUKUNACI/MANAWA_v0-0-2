/**
 * Q91: Data Retention Policy
 * Q92: Data Archival Strategy
 * Define per-entity TTLs, trigger archival/purge, audit trail
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN', 'SUPER_ADMIN']));

// Retention policy per entity type (days). -1 = keep forever
const RETENTION_POLICIES = {
  Message:          365,   // 1 year
  Notification:     90,
  UserEvent:        180,
  AdminLog:         730,   // 2 years (compliance)
  LoginAttempt:     90,
  SupportMessage:   365,
  ProfileView:      30,
  DataRetentionLog: 1825,  // 5 years (audit trail)
  PaymentAuditLog:  2555,  // 7 years (financial compliance)
  RefreshToken:     30,
  RetentionSnapshot: 365,
};

/**
 * GET /admin/data-retention/policies
 * List current retention policies
 */
router.get('/policies', (req, res) => {
  const policies = Object.entries(RETENTION_POLICIES).map(([entity, days]) => ({
    entity,
    retentionDays: days,
    keepForever: days === -1,
    archiveAfterDays: days > 0 ? Math.floor(days * 0.8) : null,
  }));
  res.json({ success: true, data: { policies } });
});

/**
 * GET /admin/data-retention/stats
 * Count rows eligible for archival / deletion per entity
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await Promise.all([
      prisma.message.count({ where: { createdAt: { lt: daysAgo(RETENTION_POLICIES.Message) } } }),
      prisma.notification.count({ where: { createdAt: { lt: daysAgo(RETENTION_POLICIES.Notification) } } }),
      prisma.loginAttempt.count({ where: { createdAt: { lt: daysAgo(RETENTION_POLICIES.LoginAttempt) } } }),
      prisma.profileView.count({ where: { createdAt: { lt: daysAgo(RETENTION_POLICIES.ProfileView) } } }),
      prisma.refreshToken.count({ where: { createdAt: { lt: daysAgo(RETENTION_POLICIES.RefreshToken) } } }),
    ]);

    res.json({
      success: true,
      data: {
        eligible: {
          Message:      stats[0],
          Notification: stats[1],
          LoginAttempt: stats[2],
          ProfileView:  stats[3],
          RefreshToken: stats[4],
        },
        totalEligible: stats.reduce((s, n) => s + n, 0),
      },
    });
  } catch (err) {
    logger.error('[DataRetention] Stats failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute retention stats' });
  }
});

/**
 * POST /admin/data-retention/purge
 * Purge expired records for a given entity (dry-run by default)
 */
router.post('/purge', [
  body('entity').isIn(Object.keys(RETENTION_POLICIES)),
  body('dryRun').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { entity, dryRun = true } = req.body;
  const days = RETENTION_POLICIES[entity];

  if (days === -1) {
    return res.status(400).json({ error: `${entity} has no retention limit (keep forever)` });
  }

  try {
    const cutoff = daysAgo(days);
    const model  = prisma[lcFirst(entity)];

    if (!model) return res.status(400).json({ error: `Unknown entity: ${entity}` });

    const count = await model.count({ where: { createdAt: { lt: cutoff } } });

    if (!dryRun && count > 0) {
      await model.deleteMany({ where: { createdAt: { lt: cutoff } } });
      await prisma.dataRetentionLog.create({
        data: {
          entityType: entity,
          entityId:   'bulk',
          action:     'deleted',
          reason:     'retention_policy',
          triggeredBy: req.user.id,
        },
      });
      logger.info('[DataRetention] Purged', { entity, count, adminId: req.user.id });
    }

    res.json({
      success: true,
      data: {
        entity,
        retentionDays: days,
        cutoffDate: cutoff,
        rowsAffected: count,
        dryRun,
        message: dryRun ? `${count} rows would be deleted (dry run)` : `${count} rows deleted`,
      },
    });
  } catch (err) {
    logger.error('[DataRetention] Purge failed', { entity, error: err.message });
    res.status(500).json({ error: 'Purge failed' });
  }
});

/**
 * GET /admin/data-retention/archive-report
 * Summary of archival actions in the last N days
 */
router.get('/archive-report', [
  query('days').optional().isInt({ min: 1, max: 365 }),
], async (req, res) => {
  try {
    const days  = parseInt(req.query.days || '30');
    const since = daysAgo(days);

    const logs = await prisma.dataRetentionLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });

    const byEntity = {};
    const byAction = {};
    logs.forEach(l => {
      byEntity[l.entityType] = (byEntity[l.entityType] || 0) + 1;
      byAction[l.action]     = (byAction[l.action]     || 0) + 1;
    });

    res.json({
      success: true,
      data: { period: `${days} days`, total: logs.length, byEntity, byAction, logs: logs.slice(0, 50) },
    });
  } catch (err) {
    logger.error('[DataRetention] Archive report failed', { error: err.message });
    res.status(500).json({ error: 'Failed to generate archive report' });
  }
});

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function lcFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

module.exports = router;
module.exports.RETENTION_POLICIES = RETENTION_POLICIES;
