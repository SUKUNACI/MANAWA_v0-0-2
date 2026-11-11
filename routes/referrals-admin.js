const express = require('express');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Tous les endpoints referrals-admin nécessitent auth + rôle admin
router.use(requireAuth, requireRole('ADMIN'));

/**
 * GET /admin/referrals/stats
 * Statistiques globales sur le parrainage
 */
router.get('/stats', async (req, res, next) => {
  try {
    const totalReferrals = await prisma.referral.count();
    const pendingReferrals = await prisma.referral.count({
      where: { status: 'PENDING' }
    });
    const qualifiedReferrals = await prisma.referral.count({
      where: { status: { in: ['QUALIFIED', 'REWARDED'] } }
    });
    const rewardedReferrals = await prisma.referral.count({
      where: { status: 'REWARDED' }
    });

    // Somme des récompenses versées
    const rewardedRecords = await prisma.referral.findMany({
      where: { status: 'REWARDED' },
      select: { rewardValue: true },
    });
    const totalRewardsPaid = rewardedRecords.reduce((sum, r) => sum + (parseFloat(r.rewardValue) || 0), 0);

    // Top referrers (par nombre de filleuls qualifiés)
    const topReferrers = await prisma.referral.groupBy({
      by: ['referrerId'],
      where: { status: { in: ['QUALIFIED', 'REWARDED'] } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    const topReferrerIds = topReferrers.map(r => r.referrerId);
    const topReferrerUsers = await prisma.user.findMany({
      where: { id: { in: topReferrerIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const topReferrerMap = Object.fromEntries(topReferrerUsers.map(u => [u.id, u]));
    const topReferrerList = topReferrers.map(r => ({
      ...topReferrerMap[r.referrerId],
      count: r._count.id,
    }));

    res.json({
      totalReferrals,
      pendingReferrals,
      qualifiedReferrals,
      rewardedReferrals,
      totalRewardsPaid,
      conversionRate: totalReferrals > 0 ? ((qualifiedReferrals / totalReferrals) * 100).toFixed(1) : 0,
      topReferrers: topReferrerList,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/referrals/list
 * Liste complète des referrals avec pagination
 */
router.get('/list', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const status = req.query.status || '';
    const search = req.query.search || '';

    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { referrer: { firstName: { contains: search, mode: 'insensitive' } } },
        { referrer: { lastName: { contains: search, mode: 'insensitive' } } },
        { referrer: { email: { contains: search, mode: 'insensitive' } } },
        { referred: { firstName: { contains: search, mode: 'insensitive' } } },
        { referred: { lastName: { contains: search, mode: 'insensitive' } } },
        { referred: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [referrals, total] = await Promise.all([
      prisma.referral.findMany({
        where,
        include: {
          referrer: { select: { id: true, firstName: true, lastName: true, email: true } },
          referred: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.referral.count({ where }),
    ]);

    const mapped = referrals.map(r => ({
      id: r.id,
      code: r.code,
      status: r.status,
      referrer: r.referrer,
      referred: r.referred,
      createdAt: r.createdAt,
      qualifiedAt: r.qualifiedAt,
      rewardedAt: r.rewardedAt,
      rewardType: r.rewardType,
      rewardValue: r.rewardValue,
    }));

    res.json({
      referrals: mapped,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/referrals/by-month
 * Statistiques temporelles: referrals par mois (derniers 12 mois)
 * MUST BE BEFORE /:id to avoid being caught as an ID
 */
router.get('/by-month', async (req, res, next) => {
  try {
    const now = new Date();
    const monthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const referrals = await prisma.referral.findMany({
      where: { createdAt: { gte: monthsAgo } },
      select: { createdAt: true, status: true },
    });

    const byMonth = {};
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = date.toISOString().slice(0, 7); // YYYY-MM
      byMonth[monthKey] = { created: 0, qualified: 0, rewarded: 0 };
    }

    referrals.forEach(r => {
      const monthKey = r.createdAt.toISOString().slice(0, 7);
      if (byMonth[monthKey]) {
        byMonth[monthKey].created++;
        if (r.status === 'QUALIFIED') byMonth[monthKey].qualified++;
        if (r.status === 'REWARDED') byMonth[monthKey].rewarded++;
      }
    });

    res.json(Object.entries(byMonth).map(([month, data]) => ({ month, ...data })));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/referrals/referrer/:userId
 * Tous les filleuls d'un artisan spécifique
 */
router.get('/referrer/:userId', async (req, res, next) => {
  try {
    const referrer = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (!referrer) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const referrals = await prisma.referral.findMany({
      where: { referrerId: req.params.userId },
      include: {
        referred: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const stats = {
      total: referrals.length,
      pending: referrals.filter(r => r.status === 'PENDING').length,
      qualified: referrals.filter(r => r.status === 'QUALIFIED').length,
      rewarded: referrals.filter(r => r.status === 'REWARDED').length,
    };

    const totalRewardsPaid = referrals
      .filter(r => r.status === 'REWARDED')
      .reduce((sum, r) => sum + (parseFloat(r.rewardValue) || 0), 0);

    res.json({
      referrer,
      stats,
      totalRewardsPaid,
      referrals: referrals.map(r => ({
        id: r.id,
        code: r.code,
        status: r.status,
        referred: r.referred,
        createdAt: r.createdAt,
        qualifiedAt: r.qualifiedAt,
        rewardedAt: r.rewardedAt,
        rewardType: r.rewardType,
        rewardValue: r.rewardValue,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/referrals/:id
 * Récupérer un referral spécifique
 */
router.get('/:id', async (req, res, next) => {
  try {
    const referral = await prisma.referral.findUnique({
      where: { id: req.params.id },
      include: {
        referrer: { select: { id: true, firstName: true, lastName: true, email: true } },
        referred: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!referral) {
      return res.status(404).json({ error: 'Referral introuvable' });
    }

    res.json(referral);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/referrals/:id/status
 * Mettre à jour le statut d'un referral (PENDING → QUALIFIED → REWARDED)
 */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status, rewardType, rewardValue } = req.body;
    if (!status || !['PENDING', 'QUALIFIED', 'REWARDED'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const referral = await prisma.referral.findUnique({
      where: { id: req.params.id },
    });

    if (!referral) {
      return res.status(404).json({ error: 'Referral introuvable' });
    }

    const updateData = { status };
    if (status === 'QUALIFIED') updateData.qualifiedAt = new Date();
    if (status === 'REWARDED') {
      updateData.rewardedAt = new Date();
      if (rewardType) updateData.rewardType = rewardType;
      if (rewardValue) updateData.rewardValue = parseFloat(rewardValue);
    }

    const updated = await prisma.referral.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        referrer: { select: { id: true, firstName: true, lastName: true } },
        referred: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
