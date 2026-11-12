/**
 * Analytics Funnels & Cohorts Routes — Q82, Q83
 * Funnel analysis, cohort analysis
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Q82: Funnel Analysis ─────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/funnel
 * Conversion funnel: register → search → profile_view → quote_sent → payment
 * Returns count and drop-off % at each step
 */
router.get(
  '/funnel',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('role').optional().isIn(['CLIENT', 'PROFESSIONAL']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { from, to, role } = req.query;

      const dateFilter = {};
      if (from || to) {
        dateFilter.createdAt = {};
        if (from) dateFilter.createdAt.gte = new Date(from);
        if (to) dateFilter.createdAt.lte = new Date(to);
      }

      const userFilter = { ...dateFilter };
      if (role) userFilter.role = role;

      // Step 1: Total registered users
      const registered = await prisma.user.count({ where: userFilter });

      // Step 2: Users who searched (via event)
      const eventWhere = {};
      if (from || to) {
        eventWhere.createdAt = {};
        if (from) eventWhere.createdAt.gte = new Date(from);
        if (to) eventWhere.createdAt.lte = new Date(to);
      }

      const [searchedUsers, viewedProfileUsers, sentQuoteUsers, bookedUsers, paidUsers] =
        await Promise.all([
          prisma.userEvent
            .findMany({
              where: { ...eventWhere, type: 'search' },
              select: { userId: true },
              distinct: ['userId'],
            })
            .then(r => r.filter(e => e.userId).length),

          prisma.userEvent
            .findMany({
              where: { ...eventWhere, type: 'profile_view' },
              select: { userId: true },
              distinct: ['userId'],
            })
            .then(r => r.filter(e => e.userId).length),

          prisma.userEvent
            .findMany({
              where: { ...eventWhere, type: 'quote_sent' },
              select: { userId: true },
              distinct: ['userId'],
            })
            .then(r => r.filter(e => e.userId).length),

          prisma.booking.count({
            where: {
              createdAt: eventWhere.createdAt,
            },
          }),

          prisma.payment.count({
            where: {
              status: 'succeeded',
              createdAt: eventWhere.createdAt,
            },
          }),
        ]);

      const steps = [
        { step: 'registered', label: 'Inscription', count: registered },
        { step: 'searched', label: 'Première recherche', count: searchedUsers },
        { step: 'viewed_profile', label: 'Profil consulté', count: viewedProfileUsers },
        { step: 'quote_sent', label: 'Devis envoyé', count: sentQuoteUsers },
        { step: 'booking_created', label: 'Réservation créée', count: bookedUsers },
        { step: 'payment_success', label: 'Paiement effectué', count: paidUsers },
      ];

      // Add conversion rates between steps
      const funnel = steps.map((step, i) => {
        const prev = i === 0 ? step.count : steps[i - 1].count;
        const fromFirst = registered > 0 ? (step.count / registered) * 100 : 0;
        const fromPrev = prev > 0 ? (step.count / prev) * 100 : 0;
        const dropOff = i === 0 ? 0 : steps[i - 1].count - step.count;

        return {
          ...step,
          conversionFromFirst: parseFloat(fromFirst.toFixed(2)),
          conversionFromPrev: parseFloat(fromPrev.toFixed(2)),
          dropOff,
        };
      });

      res.json({
        success: true,
        data: {
          funnel,
          overallConversion: registered > 0
            ? parseFloat(((paidUsers / registered) * 100).toFixed(2))
            : 0,
          period: { from, to },
        },
      });
    } catch (err) {
      logger.error('[Funnel] Failed to compute funnel', { error: err.message });
      res.status(500).json({ error: 'Failed to compute funnel analysis' });
    }
  }
);

// ─── Q83: Cohort Analysis ─────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/cohorts
 * Cohort retention: users grouped by registration month, tracked over time
 */
router.get(
  '/cohorts',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('months').optional().isInt({ min: 1, max: 24 }).withMessage('1-24 months'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const monthsBack = parseInt(req.query.months || '6');

      // Get snapshots from DB if available
      const snapshots = await prisma.cohortSnapshot.findMany({
        orderBy: [{ cohortMonth: 'asc' }, { periodOffset: 'asc' }],
        take: monthsBack * 12,
      });

      if (snapshots.length > 0) {
        // Build matrix from snapshots
        const cohortMap = {};
        snapshots.forEach(s => {
          if (!cohortMap[s.cohortMonth]) cohortMap[s.cohortMonth] = [];
          cohortMap[s.cohortMonth].push({
            periodMonth: s.periodMonth,
            offset: s.periodOffset,
            userCount: s.userCount,
            activeCount: s.activeCount,
            retainedRate: parseFloat((s.retainedRate * 100).toFixed(2)),
            revenue: s.revenue,
          });
        });

        return res.json({
          success: true,
          data: { cohorts: cohortMap, source: 'snapshots' },
        });
      }

      // Compute live from raw data (up to monthsBack months)
      const now = new Date();
      const cohorts = {};

      for (let m = monthsBack - 1; m >= 0; m--) {
        const cohortDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const cohortKey = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`;

        const cohortEnd = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + 1, 1);

        // Users registered in this cohort month
        const cohortUsers = await prisma.user.findMany({
          where: {
            createdAt: { gte: cohortDate, lt: cohortEnd },
            role: 'CLIENT',
          },
          select: { id: true },
        });

        const userIds = cohortUsers.map(u => u.id);
        if (userIds.length === 0) continue;

        cohorts[cohortKey] = { userCount: userIds.length, periods: [] };

        // For each subsequent month, check retention via lastLoginAt
        const periodsToCheck = now.getMonth() - cohortDate.getMonth() +
          (now.getFullYear() - cohortDate.getFullYear()) * 12;

        for (let p = 0; p <= Math.min(periodsToCheck, 11); p++) {
          const periodStart = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + p, 1);
          const periodEnd = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + p + 1, 1);
          const periodKey = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;

          const activeInPeriod = await prisma.userEvent.findMany({
            where: {
              userId: { in: userIds },
              createdAt: { gte: periodStart, lt: periodEnd },
            },
            select: { userId: true },
            distinct: ['userId'],
          });

          const activeCount = activeInPeriod.length;
          cohorts[cohortKey].periods.push({
            periodMonth: periodKey,
            offset: p,
            activeCount,
            retainedRate: parseFloat(((activeCount / userIds.length) * 100).toFixed(2)),
          });
        }
      }

      res.json({
        success: true,
        data: { cohorts, source: 'live', monthsAnalyzed: monthsBack },
      });
    } catch (err) {
      logger.error('[Cohort] Failed to compute cohorts', { error: err.message });
      res.status(500).json({ error: 'Failed to compute cohort analysis' });
    }
  }
);

/**
 * POST /api/v1/analytics/cohorts/snapshot (admin only)
 * Save cohort snapshot for faster future queries
 */
router.post(
  '/cohorts/snapshot',
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const now = new Date();
      const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Compute for last 6 cohort months
      const created = [];
      for (let m = 5; m >= 0; m--) {
        const cohortDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const cohortKey = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`;
        const cohortEnd = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + 1, 1);

        const cohortUsers = await prisma.user.findMany({
          where: { createdAt: { gte: cohortDate, lt: cohortEnd }, role: 'CLIENT' },
          select: { id: true },
        });

        if (cohortUsers.length === 0) continue;

        const userIds = cohortUsers.map(u => u.id);
        const periodOffset = now.getMonth() - cohortDate.getMonth() +
          (now.getFullYear() - cohortDate.getFullYear()) * 12;

        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const activeUsers = await prisma.userEvent.findMany({
          where: { userId: { in: userIds }, createdAt: { gte: periodStart } },
          select: { userId: true },
          distinct: ['userId'],
        });

        await prisma.cohortSnapshot.upsert({
          where: { cohortMonth_periodMonth: { cohortMonth: cohortKey, periodMonth } },
          create: {
            cohortMonth: cohortKey,
            periodMonth,
            periodOffset,
            userCount: userIds.length,
            activeCount: activeUsers.length,
            retainedRate: activeUsers.length / userIds.length,
          },
          update: {
            activeCount: activeUsers.length,
            retainedRate: activeUsers.length / userIds.length,
          },
        });

        created.push(cohortKey);
      }

      res.json({ success: true, data: { snapshotsCreated: created.length, cohorts: created } });
    } catch (err) {
      logger.error('[Cohort] Failed to snapshot', { error: err.message });
      res.status(500).json({ error: 'Failed to create cohort snapshot' });
    }
  }
);

module.exports = router;
