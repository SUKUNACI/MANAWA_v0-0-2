const express = require('express');
const rateLimit = require('express-rate-limit');
const { param } = require('express-validator');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { BADGES, computeBadges } = require('../utils/badges');
const BadgeModule = require('../modules/badge');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requetes, reessayez dans une minute' },
});

const badge = new BadgeModule(prisma, computeBadges, BADGES);

// GET /api/badges/:proId
router.get('/:proId', readLimiter, optionalAuth,
  [param('proId').trim().notEmpty().withMessage('proId requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const badges = await badge.getBadgesForPro(req.params.proId);
      res.json(badges);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      logger.error('GET /api/badges/:proId failed', { proId: req.params.proId, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la recuperation des badges', code: 'BADGE_FETCH_ERROR' });
    }
  }
);

// POST /api/badges/compute
router.post('/compute', requireAuth, requireRole('PROFESSIONAL'), handleValidationErrors, async (req, res, next) => {
  try {
    const result = await badge.computeForPro(req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    logger.error('POST /api/badges/compute failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors du recalcul des badges', code: 'BADGE_COMPUTE_ERROR' });
  }
});

module.exports = router;
