/**
 * Analytics Retention & Revenue Routes — Q84, Q85, Q86
 * Retention metrics, churn prediction, revenue tracking (MRR/ARR/LTV)
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Q84: Retention Metrics ───────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/retention
 * DAU / WAU / MAU + D7 / D30 retention rates
 */
router.get(
  '/retention',
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const now = new Date();
      const d1  = new Date(now - 1  * 24 * 60 * 60 * 1000);
      const d7  = new Date(now - 7  * 24 * 60 * 60 * 1000);
      const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

      // Active = had at least one UserEvent in the period
      const [dau, wau, mau, totalUsers, newToday, newThisWeek, newThisMonth] =
        await Promise.all([
          prisma.userEvent
            .findMany({ where: { createdAt: { gte: d1 }  }, select: { userId: true }, distinct: ['userId'] })
            .then(r => r.filter(e => e.userId).length),

          prisma.userEvent
            .findMany({ where: { createdAt: { gte: d7 }  }, select: { userId: true }, distinct: ['userId'] })
            .then(r => r.filter(e => e.userId).length),

          prisma.userEvent
            .findMany({ where: { createdAt: { gte: d30 } }, select: { userId: true }, distinct: ['userId'] })
            .then(r => r.filter(e => e.userId).length),

          prisma.user.count({ where: { deletedAt: null } }),

          prisma.user.count({ where: { createdAt: { gte: d1  } } }),
          prisma.user.count({ where: { createdAt: { gte: d7  } } }),
          prisma.user.count({ where: { createdAt: { gte: d30 } } }),
        ]);

      // D7 retention: users registered >7 days ago who were active in last 7 days
      const d14 = new Date(now - 14 * 24 * 60 * 60 * 1000);
      const registeredBeforeD7 = await prisma.user.findMany({
        where: { createdAt: { gte: d14, lt: d7 } },
        select: { id: true },
      });
      const d7CohortIds = registeredBeforeD7.map(u => u.id);
      const d7Retained = d7CohortIds.length > 0
        ? await prisma.userEvent
            .findMany({ where: { userId: { in: d7CohortIds }, createdAt: { gte: d7 } }, select: { userId: true }, distinct: ['userId'] })
            .then(r => r.length)
        : 0;

      // D30 retention
      const d60 = new Date(now - 60 * 24 * 60 * 60 * 1000);
      const registeredBeforeD30 = await prisma.user.findMany({
        where: { createdAt: { gte: d60, lt: d30 } },
        select: { id: true },
      });
      const d30CohortIds = registeredBeforeD30.map(u => u.id);
      const d30Retained = d30CohortIds.length > 0
        ? await prisma.userEvent
            .findMany({ where: { userId: { in: d30CohortIds }, createdAt: { gte: d30 } }, select: { userId: true }, distinct: ['userId'] })
            .then(r => r.length)
        : 0;

      res.json({
        success: true,
        data: {
          activeUsers: { dau, wau, mau },
          newUsers: { today: newToday, thisWeek: newThisWeek, thisMonth: newThisMonth },
          totalUsers,
          retention: {
            d7: {
              cohortSize: d7CohortIds.length,
              retained: d7Retained,
              rate: d7CohortIds.length > 0
                ? parseFloat(((d7Retained / d7CohortIds.length) * 100).toFixed(2))
                : null,
            },
            d30: {
              cohortSize: d30CohortIds.length,
              retained: d30Retained,
              rate: d30CohortIds.length > 0
                ? parseFloat(((d30Retained / d30CohortIds.length) * 100).toFixed(2))
                : null,
            },
          },
          ratios: {
            dauMau: mau > 0 ? parseFloat((dau / mau * 100).toFixed(2)) : null,
            dauWau: wau > 0 ? parseFloat((dau / wau * 100).toFixed(2)) : null,
          },
        },
      });
    } catch (err) {
      logger.error('[Retention] Failed to compute', { error: err.message });
      res.status(500).json({ error: 'Failed to compute retention metrics' });
    }
  }
);

/**
 * GET /api/v1/analytics/retention/history
 * Past daily retention snapshots
 */
router.get(
  '/retention/history',
  requireAuth,
  requireRole(['ADMIN']),
  [query('days').optional().isInt({ min: 7, max: 90 })],
  async (req, res) => {
    try {
      const days = parseInt(req.query.days || '30');

      const snapshots = await prisma.retentionSnapshot.findMany({
        orderBy: { date: 'desc' },
        take: days,
      });

      res.json({ success: true, data: { snapshots: snapshots.reverse() } });
    } catch (err) {
      logger.error('[Retention] Failed to get history', { error: err.message });
      res.status(500).json({ error: 'Failed to get retention history' });
    }
  }
);

// ─── Q85: Churn Prediction ────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/churn
 * Users at risk of churning based on inactivity signals
 */
router.get(
  '/churn',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('riskLevel').optional().isIn(['high', 'medium', 'low']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { riskLevel, page = 1, limit = 50 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const now = new Date();
      // Churn thresholds based on inactivity
      // High risk: no login > 14 days
      // Medium risk: no login 7-14 days
      // Low risk: no login 3-7 days
      const thresholds = {
        high:   new Date(now - 14 * 24 * 60 * 60 * 1000),
        medium: new Date(now -  7 * 24 * 60 * 60 * 1000),
        low:    new Date(now -  3 * 24 * 60 * 60 * 1000),
      };

      let lastLoginFilter;
      if (riskLevel === 'high') {
        lastLoginFilter = { lt: thresholds.high };
      } else if (riskLevel === 'medium') {
        lastLoginFilter = { gte: thresholds.high, lt: thresholds.medium };
      } else if (riskLevel === 'low') {
        lastLoginFilter = { gte: thresholds.medium, lt: thresholds.low };
      } else {
        lastLoginFilter = { lt: thresholds.low };
      }

      const where = {
        lastLoginAt: lastLoginFilter,
        deletedAt: null,
        suspended: false,
      };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take: parseInt(limit),
          orderBy: { lastLoginAt: 'asc' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            lastLoginAt: true,
            createdAt: true,
          },
        }),
        prisma.user.count({ where }),
      ]);

      // Assign churn risk score and label
      const usersWithRisk = users.map(u => {
        const daysSinceLogin = u.lastLoginAt
          ? Math.floor((now - new Date(u.lastLoginAt)) / (24 * 60 * 60 * 1000))
          : null;

        let risk = 'low';
        let score = 0;
        if (!u.lastLoginAt || daysSinceLogin > 14) {
          risk = 'high';
          score = 90;
        } else if (daysSinceLogin > 7) {
          risk = 'medium';
          score = 60;
        } else if (daysSinceLogin > 3) {
          risk = 'low';
          score = 30;
        }

        return { ...u, daysSinceLogin, churnRisk: risk, churnScore: score };
      });

      // Summary counts
      const [highCount, mediumCount, lowCount] = await Promise.all([
        prisma.user.count({ where: { lastLoginAt: { lt: thresholds.high }, deletedAt: null } }),
        prisma.user.count({ where: { lastLoginAt: { gte: thresholds.high, lt: thresholds.medium }, deletedAt: null } }),
        prisma.user.count({ where: { lastLoginAt: { gte: thresholds.medium, lt: thresholds.low }, deletedAt: null } }),
      ]);

      res.json({
        success: true,
        data: {
          users: usersWithRisk,
          summary: { high: highCount, medium: mediumCount, low: lowCount, total: highCount + mediumCount + lowCount },
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      logger.error('[Churn] Failed to compute', { error: err.message });
      res.status(500).json({ error: 'Failed to compute churn prediction' });
    }
  }
);

/**
 * GET /api/v1/analytics/churn/subscriptions
 * Subscription churn: expired without renewal
 */
router.get(
  '/churn/subscriptions',
  requireAuth,
  requireRole(['ADMIN']),
  [query('days').optional().isInt({ min: 1, max: 90 })],
  async (req, res) => {
    try {
      const days = parseInt(req.query.days || '30');
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [expired, activeSubscriptions, totalPros] = await Promise.all([
        prisma.subscription.count({
          where: {
            status: 'ACTIVE',
            expiresAt: { gte: cutoff, lt: new Date() },
          },
        }),
        prisma.subscription.count({ where: { status: 'ACTIVE' } }),
        prisma.professional.count(),
      ]);

      const churnRate = activeSubscriptions > 0
        ? parseFloat(((expired / activeSubscriptions) * 100).toFixed(2))
        : 0;

      res.json({
        success: true,
        data: {
          period: `${days} days`,
          expiredSubscriptions: expired,
          activeSubscriptions,
          totalProfessionals: totalPros,
          subscriptionChurnRate: churnRate,
        },
      });
    } catch (err) {
      logger.error('[Churn] Subscription churn failed', { error: err.message });
      res.status(500).json({ error: 'Failed to compute subscription churn' });
    }
  }
);

// ─── Q86: Revenue Tracking ────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/revenue/saas
 * MRR, ARR, ARPU, LTV — SaaS revenue metrics
 */
router.get(
  '/revenue/saas',
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      // Subscription tier prices (EUR/month)
      const TIER_PRICES = { ESSENTIEL: 25, PRO: 50, ELITE: 100, GRATUIT: 0 };
      const COMMISSION_RATE = 0.15; // 15% platform commission

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const yearStart  = new Date(now.getFullYear(), 0, 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 1);

      // MRR: sum of active subscription prices
      const activeSubscriptions = await prisma.subscription.findMany({
        where: { status: 'ACTIVE' },
        select: { tier: true },
      });

      const mrr = activeSubscriptions.reduce((sum, s) => sum + (TIER_PRICES[s.tier] || 0), 0);
      const arr = mrr * 12;

      // ARPU: MRR / active paying subscribers
      const payingCount = activeSubscriptions.filter(s => s.tier !== 'GRATUIT').length;
      const arpu = payingCount > 0 ? parseFloat((mrr / payingCount).toFixed(2)) : 0;

      // Commission revenue from payments
      const [commissionThisMonth, commissionThisYear, commissionPrevMonth] = await Promise.all([
        prisma.payment.aggregate({
          where: { status: 'succeeded', createdAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
        prisma.payment.aggregate({
          where: { status: 'succeeded', createdAt: { gte: yearStart } },
          _sum: { amount: true },
        }),
        prisma.payment.aggregate({
          where: { status: 'succeeded', createdAt: { gte: prevMonthStart, lt: prevMonthEnd } },
          _sum: { amount: true },
        }),
      ]);

      const commissionMonthly = parseFloat(((commissionThisMonth._sum.amount || 0) * COMMISSION_RATE).toFixed(2));
      const commissionYearly  = parseFloat(((commissionThisYear._sum.amount  || 0) * COMMISSION_RATE).toFixed(2));
      const commissionPrev    = parseFloat(((commissionPrevMonth._sum.amount || 0) * COMMISSION_RATE).toFixed(2));

      // MoM growth
      const prevMrr = await prisma.subscription.findMany({
        where: { status: 'ACTIVE', createdAt: { lt: prevMonthEnd } },
        select: { tier: true },
      }).then(subs => subs.reduce((sum, s) => sum + (TIER_PRICES[s.tier] || 0), 0));

      const mrrGrowth = prevMrr > 0
        ? parseFloat((((mrr - prevMrr) / prevMrr) * 100).toFixed(2))
        : null;

      // LTV estimate: ARPU * average subscription lifetime (months)
      const avgSubscriptionMonths = 6; // conservative estimate — refine with real churn data
      const ltv = parseFloat((arpu * avgSubscriptionMonths).toFixed(2));

      // Subscription breakdown by tier
      const tierBreakdown = {};
      activeSubscriptions.forEach(s => {
        tierBreakdown[s.tier] = (tierBreakdown[s.tier] || 0) + 1;
      });

      res.json({
        success: true,
        data: {
          subscriptionRevenue: {
            mrr,
            arr,
            arpu,
            ltv,
            mrrGrowth,
            activeSubscribers: activeSubscriptions.length,
            payingSubscribers: payingCount,
            tierBreakdown,
          },
          commissionRevenue: {
            thisMonth: commissionMonthly,
            thisYear: commissionYearly,
            prevMonth: commissionPrev,
            momGrowth: commissionPrev > 0
              ? parseFloat((((commissionMonthly - commissionPrev) / commissionPrev) * 100).toFixed(2))
              : null,
          },
          totalRevenue: {
            thisMonth: parseFloat((mrr + commissionMonthly).toFixed(2)),
            thisYear:  parseFloat(((mrr * 12) + commissionYearly).toFixed(2)),
          },
        },
      });
    } catch (err) {
      logger.error('[Revenue] Failed to compute SaaS metrics', { error: err.message });
      res.status(500).json({ error: 'Failed to compute revenue metrics' });
    }
  }
);

/**
 * GET /api/v1/analytics/revenue/transactions
 * Raw transaction revenue breakdown by period
 */
router.get(
  '/revenue/transactions',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('groupBy').optional().isIn(['day', 'week', 'month']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { from, to, groupBy = 'day' } = req.query;

      const now = new Date();
      const dateFrom = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
      const dateTo   = to   ? new Date(to)   : now;

      const payments = await prisma.payment.findMany({
        where: {
          status: 'succeeded',
          createdAt: { gte: dateFrom, lte: dateTo },
        },
        select: { amount: true, fees: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      // Group by period
      const grouped = {};
      payments.forEach(p => {
        const d = new Date(p.createdAt);
        let key;
        if (groupBy === 'month') {
          key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        } else if (groupBy === 'week') {
          const weekNum = Math.ceil(d.getDate() / 7);
          key = `${d.getFullYear()}-W${String(d.getMonth() * 4 + weekNum).padStart(2, '0')}`;
        } else {
          key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        if (!grouped[key]) grouped[key] = { period: key, volume: 0, commission: 0, count: 0 };
        grouped[key].volume     += p.amount;
        grouped[key].commission += p.amount * 0.15;
        grouped[key].count      += 1;
      });

      const series = Object.values(grouped).map(g => ({
        period: g.period,
        volume: parseFloat(g.volume.toFixed(2)),
        commission: parseFloat(g.commission.toFixed(2)),
        count: g.count,
      }));

      const totals = {
        volume:     parseFloat(payments.reduce((s, p) => s + p.amount, 0).toFixed(2)),
        commission: parseFloat(payments.reduce((s, p) => s + p.amount * 0.15, 0).toFixed(2)),
        count:      payments.length,
      };

      res.json({
        success: true,
        data: { series, totals, period: { from: dateFrom, to: dateTo, groupBy } },
      });
    } catch (err) {
      logger.error('[Revenue] Failed to compute transactions', { error: err.message });
      res.status(500).json({ error: 'Failed to compute transaction revenue' });
    }
  }
);

module.exports = router;
