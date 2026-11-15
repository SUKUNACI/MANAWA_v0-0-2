const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const SubscriptionModule = require('../modules/subscription');
const prisma = require('../config/db');

const router = express.Router();
const subscription = new SubscriptionModule(prisma);

const subscriptionReadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// ─── Tier configuration ────────────────────────────────────────────────────────
// These are exported so other routes (quotes, analytics, projects) can reuse
// the same tier logic without duplicating it.

const TIERS = {
  GRATUIT:   { label: 'Gratuit',   price: 0,     maxQuotesPerMonth: 5,    maxTrades: 2, projectsDelayMs: 48 * 60 * 60 * 1000 },
  ESSENTIEL: { label: 'Essentiel', price: 2500,  maxQuotesPerMonth: 20,   maxTrades: 4, projectsDelayMs: 24 * 60 * 60 * 1000 },
  PRO:       { label: 'Pro',       price: 5000,  maxQuotesPerMonth: null, maxTrades: 6, projectsDelayMs: 0 },
  ELITE:     { label: 'Elite',     price: 10000, maxQuotesPerMonth: null, maxTrades: 10, projectsDelayMs: 0 },
};

/**
 * Returns the effective subscription tier for a professional.
 * Priority: active trial > active paid subscription > GRATUIT.
 *
 * @param {object|null} subscription - The professional's subscription row (may be null).
 * @param {object}      pro          - The professional row; must have `trialEndsAt`.
 * @returns {string} One of 'GRATUIT' | 'ESSENTIEL' | 'PRO' | 'ELITE'.
 */
function getActiveTier(subscription, pro) {
  // Trial takes priority over paid subscription
  if (pro && pro.trialEndsAt && new Date(pro.trialEndsAt) > new Date()) {
    return 'PRO';
  }

  if (
    subscription &&
    subscription.status === 'ACTIVE' &&
    subscription.expiresAt &&
    new Date(subscription.expiresAt) > new Date()
  ) {
    // Default to ESSENTIEL if tier field is null but subscription is active
    return subscription.tier || 'ESSENTIEL';
  }

  return 'GRATUIT';
}

/**
 * Returns the configuration object for a given tier.
 * Optionally applies dynamic pricing (from app config) over the defaults.
 *
 * @param {string}      tier          - Tier key ('GRATUIT', 'ESSENTIEL', 'PRO', 'ELITE').
 * @param {object|null} dynamicPrices - Optional price overrides { essentiel, pro, elite }.
 * @returns {object} A copy of the tier config with any dynamic prices merged in.
 */
function getTierConfig(tier, dynamicPrices) {
  const base = TIERS[tier] || TIERS.GRATUIT;
  const config = { ...base };

  if (dynamicPrices && config.price > 0) {
    const key = tier.toLowerCase();
    if (dynamicPrices[key] != null) {
      config.price = dynamicPrices[key];
    }
  }

  return config;
}

// ─── Routes ────────────────────────────────────────────────────────────────────

router.get('/me', subscriptionReadLimiter, requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const result = await subscription.getCurrentStatus(req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status) res.status(err.status).json({ error: err.message });
    else next(err);
  }
});

router.post('/validate-promo', paymentLimiter, requireAuth, requireRole('PROFESSIONAL'),
  [body('code').trim().notEmpty().withMessage('Code requis').isLength({ min: 3, max: 50 }).withMessage('Code 3-50 caractères'), body('tier').optional().isIn(['GRATUIT', 'ESSENTIEL', 'PRO', 'ELITE']).withMessage('Tier invalide')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
      if (!pro) return res.status(404).json({ error: 'Professionnel non trouvé' });

      const result = await subscription.validatePromoForCheckout(req.body.code, req.body.tier || 'PRO', pro.id);
      res.json(result);
    } catch (err) {
      if (err.status) res.status(err.status).json({ error: err.message });
      else next(err);
    }
  }
);

router.post('/checkout', paymentLimiter, requireAuth, requireRole('PROFESSIONAL'),
  [body('tier').isIn(['ESSENTIEL', 'PRO', 'ELITE']).withMessage('Tier invalide'), body('promoCode').optional().trim().isLength({ min: 3, max: 50 }).withMessage('Code promo 3-50 caractères')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const pro = await prisma.professional.findUnique({
        where: { userId: req.user.id },
        include: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } },
      });
      if (!pro) return res.status(404).json({ error: 'Professionnel non trouvé' });

      const result = await subscription.createCheckout(req.body.tier, req.body.promoCode, pro);
      res.json(result);
    } catch (err) {
      if (err.status) res.status(err.status).json({ error: err.message });
      else next(err);
    }
  }
);

router.get('/success', async (req, res) => {
  res.json({ success: true, message: 'Paiement complété avec succès' });
});

router.get('/error', async (req, res) => {
  res.json({ success: false, message: 'Paiement annulé ou échoué' });
});

module.exports = router;
module.exports.getActiveTier = getActiveTier;
module.exports.getTierConfig = getTierConfig;
module.exports.TIERS = TIERS;
