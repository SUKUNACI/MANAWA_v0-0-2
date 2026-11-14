const express = require('express');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/professionals — liste publique
router.get('/', async (req, res, next) => {
  try {
    const { city, trade, page = 1, limit = 20 } = req.query;
    const take = Math.min(100, parseInt(limit) || 20);
    const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;

    const where = { user: { suspended: false } };
    if (city) where.user.city = city;
    if (trade) where.trade = trade;

    const professionals = await prisma.professional.findMany({
      where,
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true,
            email: true, city: true, avatarUrl: true, suspended: true,
          },
        },
        _count: { select: { followers: true } },
      },
      skip,
      take,
      orderBy: { averageRating: 'desc' },
    });

    res.json(professionals);
  } catch (err) {
    next(err);
  }
});

// GET /api/professionals/me/status — statut identité (PROFESSIONAL uniquement)
router.get('/me/status', requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const pro = await prisma.professional.findUnique({
      where: { userId: req.user.id },
      select: {
        id: true,
        identityStatus: true,
        identityRejectionReason: true,
        verifiedByAdmin: true,
        decennale: true,
        accountType: true,
      },
    });

    if (!pro) return res.status(404).json({ error: 'Profil professionnel introuvable' });

    res.json(pro);
  } catch (err) {
    next(err);
  }
});

// GET /api/professionals/:id — profil public d'un pro
router.get('/:id', async (req, res, next) => {
  try {
    const pro = await prisma.professional.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true,
            email: true, city: true, avatarUrl: true, phone: true, suspended: true,
          },
        },
        _count: { select: { followers: true } },
        companyMembers: true,
      },
    });

    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    res.json({
      ...pro,
      followerCount: pro._count.followers,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/professionals/:id/follow — toggle follow (auth requis)
router.post('/:id/follow', requireAuth, async (req, res, next) => {
  try {
    const proId = req.params.id;
    const userId = req.user.id;

    const pro = await prisma.professional.findUnique({ where: { id: proId } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    const existing = await prisma.follow.findUnique({
      where: { followerId_professionalId: { followerId: userId, professionalId: proId } },
    });

    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
      return res.json({ following: false });
    }

    await prisma.follow.create({ data: { followerId: userId, professionalId: proId } });

    prisma.notification.create({
      data: {
        userId: pro.userId,
        type: 'NEW_FOLLOWER',
        message: 'Quelqu\'un vous suit maintenant',
      },
    }).catch(() => {});

    res.json({ following: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
