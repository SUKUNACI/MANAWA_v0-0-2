'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { computeTrustScore } = require('../utils/trustScore');
const { getActiveTier } = require('./subscriptions');
const requirePremiumPro = require('../middleware/requirePremiumPro');

const router = express.Router();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// GET /api/analytics/overview — basic metrics for all professionals
router.get(
  '/overview',
  analyticsLimiter,
  requireAuth,
  requireRole('PROFESSIONAL'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const pro = await prisma.professional.findUnique({
        where: { userId: req.user.id },
        include: {
          user: { select: { id: true, email: true, avatarUrl: true, emailVerified: true } },
          portfolio: { select: { id: true } },
          followers: { select: { id: true } },
          badges: true,
          quotes: { select: { id: true, status: true } },
          subscription: true,
        },
      });

      if (!pro) return res.status(404).json({ error: 'Profil pro introuvable' });

      const now = new Date();
      const thirtyDaysAgo = new Date(now - 30 * MS_PER_DAY);
      const sixtyDaysAgo  = new Date(now - 60 * MS_PER_DAY);

      const [totalViews, last30Views, prev30Views, revenueAgg] = await Promise.all([
        prisma.profileView.count({ where: { professionalId: pro.id } }),
        prisma.profileView.count({ where: { professionalId: pro.id, createdAt: { gte: thirtyDaysAgo } } }),
        prisma.profileView.count({ where: { professionalId: pro.id, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
        prisma.payment.aggregate({
          where: { status: 'succeeded', booking: { professionalId: pro.id } },
          _sum: { amount: true },
        }),
      ]);

      let trend;
      if (prev30Views === 0 && last30Views > 0) {
        trend = '+100%';
      } else if (prev30Views > 0) {
        const pct = ((last30Views - prev30Views) / prev30Views) * 100;
        trend = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
      } else {
        trend = '0%';
      }

      const quotes = pro.quotes || [];
      const acceptedCount = quotes.filter(q => q.status === 'ACCEPTED').length;
      const acceptRate = quotes.length > 0
        ? `${((acceptedCount / quotes.length) * 100).toFixed(1)}%`
        : '0%';

      const totalMissions = pro.completedMissionsCount + pro.cancelledMissionsCount;
      const completionRate = totalMissions > 0
        ? `${((pro.completedMissionsCount / totalMissions) * 100).toFixed(1)}%`
        : '0%';

      res.json({
        profileViews: { total: totalViews, last30: last30Views, prev30: prev30Views, trend },
        quotes:   { total: quotes.length, accepted: acceptedCount, acceptRate },
        missions: { completed: pro.completedMissionsCount, cancelled: pro.cancelledMissionsCount, completionRate },
        revenue:  { total: revenueAgg._sum.amount || 0 },
        rating:   { average: pro.averageRating, count: pro.reviewCount },
        followers:  (pro.followers || []).length,
        trustScore: computeTrustScore(pro),
        badges:     pro.badges || [],
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/analytics/views — profile views timeline [PREMIUM]
router.get(
  '/views',
  analyticsLimiter,
  requireAuth,
  requireRole('PROFESSIONAL'),
  requirePremiumPro,
  async (req, res, next) => {
    try {
      const { pro } = req;
      const thirtyDaysAgo = new Date(Date.now() - 30 * MS_PER_DAY);
      const views = await prisma.$queryRaw`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM profile_views
        WHERE professional_id = ${pro.id}
          AND created_at >= ${thirtyDaysAgo}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `;

      res.json({ success: true, data: { views } });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/analytics/revenue — monthly revenue over 12 months [PREMIUM]
router.get(
  '/revenue',
  analyticsLimiter,
  requireAuth,
  requireRole('PROFESSIONAL'),
  requirePremiumPro,
  async (req, res, next) => {
    try {
      const { pro } = req;
      const twelveMonthsAgo = new Date(Date.now() - 365 * MS_PER_DAY);
      const timeline = await prisma.$queryRaw`
        SELECT DATE_FORMAT(p.created_at, '%Y-%m') as month, SUM(p.amount) as amount
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        WHERE b.professional_id = ${pro.id}
          AND p.status = 'succeeded'
          AND p.created_at >= ${twelveMonthsAgo}
        GROUP BY DATE_FORMAT(p.created_at, '%Y-%m')
        ORDER BY month ASC
      `;

      const totalRevenue = Array.isArray(timeline)
        ? timeline.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
        : 0;
      const averagePerMission = pro.completedMissionsCount > 0
        ? parseFloat((totalRevenue / pro.completedMissionsCount).toFixed(2))
        : 0;

      res.json({ success: true, data: { timeline, totalRevenue, averagePerMission } });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/analytics/quotes — quote funnel analysis [PREMIUM]
router.get(
  '/quotes',
  analyticsLimiter,
  requireAuth,
  requireRole('PROFESSIONAL'),
  requirePremiumPro,
  async (req, res, next) => {
    try {
      const { pro } = req;
      const quotes = await prisma.quote.findMany({
        where: { professionalId: pro.id },
        select: {
          id: true, status: true, createdAt: true, updatedAt: true,
          project: { select: { tradeNeeded: true } },
        },
      });

      const byStatus = quotes.reduce((acc, q) => {
        acc[q.status] = (acc[q.status] || 0) + 1;
        return acc;
      }, {});

      const accepted = quotes.filter(q => q.status === 'ACCEPTED').length;
      const acceptRate = quotes.length > 0
        ? parseFloat(((accepted / quotes.length) * 100).toFixed(1))
        : 0;

      const expiredPending = quotes.filter(
        q => q.status === 'PENDING' && Date.now() - new Date(q.createdAt) > 30 * MS_PER_DAY
      ).length;

      res.json({
        success: true,
        data: { total: quotes.length, byStatus, acceptRate, expiredPending, quotes },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/analytics/competitors — anonymised peer comparison [ELITE only]
router.get(
  '/competitors',
  analyticsLimiter,
  requireAuth,
  requireRole('PROFESSIONAL'),
  async (req, res, next) => {
    try {
      const pro = await prisma.professional.findUnique({
        where: { userId: req.user.id },
        include: {
          subscription: true,
          portfolio: { select: { id: true } },
          badges: { select: { id: true } },
        },
      });

      if (!pro) return res.status(404).json({ error: 'Profil pro introuvable' });

      const tier = getActiveTier(pro.subscription, pro);
      if (tier !== 'ELITE') {
        return res.status(403).json({ error: 'Fonctionnalité réservée aux abonnés ELITE', upgrade: true });
      }

      const peers = await prisma.professional.findMany({
        where: { trade: pro.trade, id: { not: pro.id } },
        select: {
          id: true,
          averageRating: true,
          completedMissionsCount: true,
          portfolio: { select: { id: true } },
          badges: { select: { id: true } },
        },
        take: 50,
      });

      const allPros = [pro, ...peers];

      const byRating   = [...allPros].sort((a, b) => (b.averageRating           || 0) - (a.averageRating           || 0));
      const byMissions = [...allPros].sort((a, b) => (b.completedMissionsCount  || 0) - (a.completedMissionsCount  || 0));

      const ratingRank   = byRating.findIndex(p => p.id === pro.id)   + 1;
      const missionsRank = byMissions.findIndex(p => p.id === pro.id) + 1;

      const peerStats = peers.length > 0 ? {
        averageRating:    parseFloat((peers.reduce((s, p) => s + (p.averageRating           || 0), 0) / peers.length).toFixed(2)),
        averageMissions:  parseFloat((peers.reduce((s, p) => s + (p.completedMissionsCount  || 0), 0) / peers.length).toFixed(1)),
      } : null;

      res.json({
        myRank: { rating: ratingRank, missions: missionsRank, totalPeers: allPros.length },
        peerStats,
        peers: peers.map(p => ({
          averageRating:          p.averageRating,
          completedMissionsCount: p.completedMissionsCount,
          portfolioCount:         (p.portfolio || []).length,
          badgeCount:             (p.badges    || []).length,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
