const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const { BADGES, computeBadges } = require('../utils/badges');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiters
const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

/**
 * GET /api/badges/:proId
 * Public (optionalAuth) — retourne les badges d'un professionnel avec métadonnées.
 * Lance un recalcul non-bloquant en arrière-plan, puis retourne les badges existants.
 */
router.get('/:proId', readLimiter, optionalAuth,
  [
    param('proId').trim().notEmpty().withMessage('proId requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const pro = await prisma.professional.findUnique({
      where: { id: req.params.proId },
      select: { id: true },
    });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable', code: 'PRO_NOT_FOUND' });

    // Recalcul non-bloquant
    computeBadges(pro.id).catch(() => {});

    // Retourner les badges actuellement en base
    const badges = await prisma.professionalBadge.findMany({
      where: { professionalId: pro.id },
      orderBy: { earnedAt: 'asc' },
    });

    res.json(badges.map(b => ({ ...b, ...BADGES[b.badgeKey] })).filter(b => b.label));
  } catch (err) {
    logger.error('GET /api/badges/:proId failed', { proId: req.params.proId, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération des badges', code: 'BADGE_FETCH_ERROR' });
  }
});

/**
 * POST /api/badges/compute
 * Authentifié (PROFESSIONAL) — force le recalcul et retourne les badges nouvellement débloqués.
 */
router.post('/compute', requireAuth, requireRole('PROFESSIONAL'), handleValidationErrors, async (req, res, next) => {
  try {
    const pro = await prisma.professional.findUnique({
      where: { userId: req.user.id },
      select: { id: true },
    });
    if (!pro) {
      logger.error('POST /api/badges/compute - professional profile not found', { userId: req.user.id });
      return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
    }

    // Badges actuels avant recalcul
    const before = await prisma.professionalBadge.findMany({
      where: { professionalId: pro.id },
      select: { badgeKey: true },
    });
    const beforeKeys = new Set(before.map(b => b.badgeKey));

    // Recalcul complet
    const allBadges = await computeBadges(pro.id);

    // Nouvellement débloqués = présents après mais absents avant
    const newBadges = allBadges.filter(b => !beforeKeys.has(b.badgeKey));

    res.json({ badges: allBadges, newBadges });
  } catch (err) {
    logger.error('POST /api/badges/compute failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors du recalcul des badges', code: 'BADGE_COMPUTE_ERROR' });
  }
});

module.exports = router;
