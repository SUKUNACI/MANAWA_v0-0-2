const express = require('express');
const { query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { cacheGet, cacheInvalidate } = require('../middleware/cacheMiddleware');
const { CACHE_TTL } = require('../config/performance-optimization');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================
// OPTIMIZATION #36: Full-Page Caching
// Group 9 separate KPI queries into 1 endpoint
// Cache the entire dashboard KPIs result for 5 minutes
// Invalidate only when specific events occur
// ============================================

/**
 * GET /api/admin/kpis/dashboard
 *
 * Aggregates 9 separate KPI metrics into one response:
 * 1. totalUsers
 * 2. totalProfessionals
 * 3. totalProjects
 * 4. totalBookings
 * 5. totalRevenue (last 30 days)
 * 6. activeSubscriptions
 * 7. pendingPayments
 * 8. disputesOpen
 * 9. recentSignups (last 7 days)
 *
 * All queries run in PARALLEL with Promise.all()
 * Result cached for 5 minutes
 * Cache invalidated on: booking create, payment success, admin changes
 */
router.get(
  '/dashboard',
  requireAuth,
  requireRole('ADMIN'),
  cacheGet({ skipCache: false }), // ENABLE CACHING
  async (req, res, next) => {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      logger.debug('[KPIs] Starting dashboard KPI aggregation');

      // OPTIMIZATION #35: Run all 9 queries in parallel, not sequentially
      // This reduces query time from 9x to ~1x (network round trips)
      const [
        totalUsers,
        totalProfessionals,
        totalProjects,
        totalBookings,
        revenueData,
        activeSubscriptions,
        pendingPayments,
        openDisputes,
        recentSignups,
      ] = await Promise.all([
        // 1. Total users (all time)
        prisma.user.count(),

        // 2. Total professionals (all time)
        prisma.professional.count(),

        // 3. Total projects (all time)
        prisma.project.count(),

        // 4. Total bookings (all time)
        prisma.booking.count(),

        // 5. Revenue (last 30 days) - use aggregation, not loop
        prisma.payment.aggregate({
          where: {
            status: 'succeeded',
            createdAt: { gte: thirtyDaysAgo },
          },
          _sum: { amount: true },
          _count: true,
        }),

        // 6. Active subscriptions (status = ACTIVE)
        prisma.subscription.count({
          where: { status: 'ACTIVE' },
        }),

        // 7. Pending payments (status = pending)
        prisma.payment.count({
          where: { status: 'pending' },
        }),

        // 8. Open disputes (status = open)
        prisma.dispute.count({
          where: { status: 'open' },
        }),

        // 9. Recent signups (last 7 days)
        prisma.user.count({
          where: { createdAt: { gte: sevenDaysAgo } },
        }),
      ]);

      const totalRevenue = revenueData._sum?.amount || 0;
      const totalPaymentCount = revenueData._count;

      logger.info('[KPIs] Dashboard KPI aggregation complete', {
        totalUsers,
        totalProfessionals,
        totalProjects,
        totalBookings,
        totalRevenue,
        activeSubscriptions,
        pendingPayments,
        openDisputes,
        recentSignups,
      });

      // Format response
      const kpis = {
        timestamp: now.toISOString(),
        users: {
          total: totalUsers,
          recentSignups,
          trend: 0, // Would need previous period comparison
        },
        professionals: {
          total: totalProfessionals,
          ratio: totalProfessionals > 0 ? ((totalProfessionals / totalUsers) * 100).toFixed(1) + '%' : '0%',
        },
        projects: {
          total: totalProjects,
          active: await prisma.project.count({ where: { status: { not: 'COMPLETED' } } }),
        },
        bookings: {
          total: totalBookings,
          completed: await prisma.booking.count({ where: { status: 'COMPLETED' } }),
        },
        revenue: {
          last30Days: totalRevenue,
          currency: 'XOF',
          paymentCount: totalPaymentCount,
          average: totalPaymentCount > 0 ? (totalRevenue / totalPaymentCount).toFixed(2) : 0,
        },
        subscriptions: {
          active: activeSubscriptions,
          inactive: await prisma.subscription.count({ where: { status: { not: 'ACTIVE' } } }),
        },
        payments: {
          pending: pendingPayments,
          recent: await prisma.payment.count({
            where: { createdAt: { gte: sevenDaysAgo } },
          }),
        },
        disputes: {
          open: openDisputes,
          total: await prisma.dispute.count(),
        },
      };

      res.json(kpis);
    } catch (err) {
      logger.error('[KPIs] Error fetching dashboard KPIs', { error: err.message });
      next(err);
    }
  }
);

/**
 * GET /api/admin/kpis/revenue
 * Revenue breakdown by subscription tier
 * Cached for 10 minutes
 */
router.get(
  '/revenue',
  requireAuth,
  requireRole('ADMIN'),
  cacheGet({ skipCache: false }),
  async (req, res, next) => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Query revenue grouped by subscription tier
      const revenueByTier = await prisma.$queryRaw`
        SELECT s.tier, COUNT(*)::int as subscription_count, SUM(p.amount)::float as total_revenue
        FROM "Subscription" s
        LEFT JOIN "Payment" p ON p."subscriptionId" = s.id AND p.status = 'succeeded'
        WHERE p."createdAt" >= ${thirtyDaysAgo} OR p."createdAt" IS NULL
        GROUP BY s.tier
        ORDER BY total_revenue DESC NULLS LAST
      `;

      res.json({
        period: '30_days',
        byTier: revenueByTier || [],
        total: await prisma.payment.aggregate({
          where: { status: 'succeeded', createdAt: { gte: thirtyDaysAgo } },
          _sum: { amount: true },
        }),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/kpis/growth
 * User growth metrics
 * Cached for 5 minutes
 */
router.get(
  '/growth',
  requireAuth,
  requireRole('ADMIN'),
  cacheGet({ skipCache: false }),
  async (req, res, next) => {
    try {
      // Run growth queries in parallel
      const [
        weeklySignups,
        monthlySignups,
        activeProfs,
        activeUsers,
      ] = await Promise.all([
        prisma.user.count({
          where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        }),
        prisma.user.count({
          where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        }),
        prisma.professional.count({
          where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        }),
        prisma.user.count({
          where: { lastLoginAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        }),
      ]);

      res.json({
        weekly_signups: weeklySignups,
        monthly_signups: monthlySignups,
        new_professionals_month: activeProfs,
        active_users_week: activeUsers,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/kpis/engagement
 * User engagement metrics (projects, quotes, bookings)
 * Cached for 10 minutes
 */
router.get(
  '/engagement',
  requireAuth,
  requireRole('ADMIN'),
  cacheGet({ skipCache: false }),
  async (req, res, next) => {
    try {
      const [
        totalProjects,
        activeProjects,
        totalQuotes,
        acceptedQuotes,
        totalBookings,
        completedBookings,
      ] = await Promise.all([
        prisma.project.count(),
        prisma.project.count({ where: { status: { not: 'COMPLETED' } } }),
        prisma.quote.count(),
        prisma.quote.count({ where: { status: 'ACCEPTED' } }),
        prisma.booking.count(),
        prisma.booking.count({ where: { status: 'COMPLETED' } }),
      ]);

      res.json({
        projects: {
          total: totalProjects,
          active: activeProjects,
          completion_rate: totalProjects > 0 ? (((totalProjects - activeProjects) / totalProjects) * 100).toFixed(1) : 0,
        },
        quotes: {
          total: totalQuotes,
          accepted: acceptedQuotes,
          acceptance_rate: totalQuotes > 0 ? ((acceptedQuotes / totalQuotes) * 100).toFixed(1) : 0,
        },
        bookings: {
          total: totalBookings,
          completed: completedBookings,
          completion_rate: totalBookings > 0 ? ((completedBookings / totalBookings) * 100).toFixed(1) : 0,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
