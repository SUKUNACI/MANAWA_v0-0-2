/**
 * Q95: Data Anonymization
 * Q96: Data Aggregation for Privacy
 * Anonymize PII on demand, aggregate sensitive data into statistics
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const crypto = require('crypto');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN', 'SUPER_ADMIN']));

// ─── Anonymization ────────────────────────────────────────────────────────────

/**
 * POST /admin/anonymization/user/:userId
 * Anonymize a user's PII fields in-place (keeps account for audit trail)
 * Softer than GDPR hard delete — preserves transactions/reviews with neutral identity
 */
router.post('/user/:userId', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const anonId = crypto.createHash('sha256').update(user.id).digest('hex').slice(0, 12);

    await prisma.user.update({
      where: { id: req.params.userId },
      data: {
        email:             `anon_${anonId}@anonymized.invalid`,
        firstName:         'Anonymized',
        lastName:          'User',
        phone:             null,
        avatarUrl:         null,
        city:              null,
        latitude:          null,
        longitude:         null,
        passwordHash:      'ANONYMIZED',
        twoFASecret:       null,
        twoFABackupCodes:  null,
        securityQuestion:  null,
        securityAnswerHash: null,
        expoPushToken:     null,
        deletedAt:         new Date(),
      },
    });

    await prisma.dataRetentionLog.create({
      data: {
        entityType:  'User',
        entityId:    req.params.userId,
        action:      'anonymized',
        reason:      'manual',
        triggeredBy: req.user.id,
      },
    });

    logger.info('[Anonymization] User anonymized', { userId: req.params.userId, adminId: req.user.id });
    res.json({ success: true, data: { message: `User ${req.params.userId} anonymized`, anonId } });
  } catch (err) {
    logger.error('[Anonymization] Failed', { error: err.message });
    res.status(500).json({ error: 'Anonymization failed' });
  }
});

/**
 * POST /admin/anonymization/messages/bulk
 * Anonymize message content older than N days (replace with [message supprimé])
 */
router.post('/messages/bulk', [
  body('olderThanDays').isInt({ min: 1, max: 3650 }),
  body('dryRun').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { olderThanDays, dryRun = true } = req.body;
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const count = await prisma.message.count({
      where: { createdAt: { lt: cutoff }, content: { not: '[message supprimé]' } },
    });

    if (!dryRun && count > 0) {
      await prisma.message.updateMany({
        where: { createdAt: { lt: cutoff }, content: { not: '[message supprimé]' } },
        data:  { content: '[message supprimé]' },
      });
      await prisma.dataRetentionLog.create({
        data: {
          entityType:  'Message',
          entityId:    'bulk',
          action:      'anonymized',
          reason:      'retention_policy',
          triggeredBy: req.user.id,
        },
      });
    }

    res.json({
      success: true,
      data: {
        messagesAffected: count,
        dryRun,
        message: dryRun ? `${count} messages would be anonymized` : `${count} messages anonymized`,
      },
    });
  } catch (err) {
    logger.error('[Anonymization] Bulk messages failed', { error: err.message });
    res.status(500).json({ error: 'Bulk anonymization failed' });
  }
});

// ─── Privacy Aggregation ──────────────────────────────────────────────────────

/**
 * GET /admin/anonymization/aggregates/users
 * Return demographic stats without exposing individual PII
 */
router.get('/aggregates/users', async (req, res) => {
  try {
    const [total, byRole, byCityRaw, verifiedCount, suspendedCount] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.groupBy({ by: ['role'], _count: { id: true }, where: { deletedAt: null } }),
      prisma.user.groupBy({ by: ['city'], _count: { id: true }, where: { deletedAt: null, city: { not: null } }, orderBy: { _count: { id: 'desc' } }, take: 10 }),
      prisma.user.count({ where: { emailVerified: true, deletedAt: null } }),
      prisma.user.count({ where: { suspended: true, deletedAt: null } }),
    ]);

    // Suppress cities with <5 users (k-anonymity threshold)
    const byCity = byCityRaw
      .filter(r => r._count.id >= 5)
      .map(r => ({ city: r.city, count: r._count.id }));

    res.json({
      success: true,
      data: {
        total,
        verifiedPercent:  total > 0 ? parseFloat(((verifiedCount / total) * 100).toFixed(1)) : 0,
        suspendedPercent: total > 0 ? parseFloat(((suspendedCount / total) * 100).toFixed(1)) : 0,
        byRole: byRole.map(r => ({ role: r.role, count: r._count.id })),
        topCities: byCity,
        kAnonymityThreshold: 5,
        note: 'Cities with fewer than 5 users are suppressed for privacy',
      },
    });
  } catch (err) {
    logger.error('[Anonymization] User aggregates failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute user aggregates' });
  }
});

/**
 * GET /admin/anonymization/aggregates/payments
 * Revenue stats without exposing individual transaction amounts
 */
router.get('/aggregates/payments', [
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const now  = new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to   = req.query.to   ? new Date(req.query.to)   : now;

    const payments = await prisma.payment.findMany({
      where: { createdAt: { gte: from, lte: to }, status: 'COMPLETED' },
      select: { amount: true, currency: true },
    });

    const total  = payments.reduce((s, p) => s + p.amount, 0);
    const count  = payments.length;
    const avg    = count > 0 ? parseFloat((total / count).toFixed(2)) : 0;
    const sorted = payments.map(p => p.amount).sort((a, b) => a - b);
    const median = count > 0 ? sorted[Math.floor(count / 2)] : 0;

    res.json({
      success: true,
      data: {
        period: { from, to },
        transactionCount: count,
        totalAmountEur:   parseFloat(total.toFixed(2)),
        averageAmountEur: avg,
        medianAmountEur:  median,
        note: 'Individual transaction amounts are not exposed',
      },
    });
  } catch (err) {
    logger.error('[Anonymization] Payment aggregates failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute payment aggregates' });
  }
});

module.exports = router;
