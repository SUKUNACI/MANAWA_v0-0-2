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

  // Grace period: professional retains their tier while they still have time to pay.
  // Once gracePeriodEndsAt passes the cron job sets status to INACTIVE.
  if (
    subscription &&
    subscription.status === 'GRACE_PERIOD' &&
    subscription.gracePeriodEndsAt &&
    new Date(subscription.gracePeriodEndsAt) > new Date()
  ) {
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
  [
    body('tier').isIn(['ESSENTIEL', 'PRO', 'ELITE']).withMessage('Tier invalide'),
    body('billingCycle').optional().isIn(['MONTHLY', 'YEARLY']).withMessage('Cycle invalide (MONTHLY ou YEARLY)'),
    body('promoCode').optional().trim().isLength({ min: 3, max: 50 }).withMessage('Code promo 3-50 caractères'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const pro = await prisma.professional.findUnique({
        where: { userId: req.user.id },
        include: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } },
      });
      if (!pro) return res.status(404).json({ error: 'Professionnel non trouvé' });

      const billingCycle = req.body.billingCycle || 'MONTHLY';
      const result = await subscription.createCheckout(req.body.tier, req.body.promoCode, pro, billingCycle);
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

/**
 * GET /api/subscriptions/history
 * Returns the professional's full payment attempt history from SubscriptionPaymentAttempt.
 * Each attempt is returned as a record, ordered newest first.
 * Strictly scoped to the authenticated professional — no cross-professional data.
 */
router.get('/history', subscriptionReadLimiter, requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const pro = await prisma.professional.findUnique({
      where: { userId: req.user.id },
      include: {
        subscription: {
          select: {
            id: true,
            tier: true,
            billingCycle: true,
            status: true,
            expiresAt: true,
            gracePeriodEndsAt: true,
            paymentAttempts: {
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                geniuspayRef: true,
                provider: true,
                tier: true,
                billingCycle: true,
                expectedAmount: true,
                confirmedAmount: true,
                status: true,
                confirmedAt: true,
                createdAt: true,
                scheduledStartAt: true,
              },
            },
          },
        },
      },
    });

    if (!pro) return res.status(404).json({ error: 'Professionnel non trouvé' });
    if (!pro.subscription) return res.json({ payments: [], subscription: null });

    const sub = pro.subscription;
    const attempts = sub.paymentAttempts || [];

    const payments = attempts.map(a => ({
      id: a.id,
      reference: a.geniuspayRef,
      provider: a.provider,
      tier: a.tier,
      billingCycle: a.billingCycle,
      amount: a.confirmedAmount ?? a.expectedAmount,
      status: a.status,
      paidAt: a.confirmedAt,
      createdAt: a.createdAt,
      scheduledStartAt: a.scheduledStartAt,
    }));

    res.json({
      subscription: {
        id: sub.id,
        status: sub.status,
        tier: sub.tier,
        billingCycle: sub.billingCycle,
        expiresAt: sub.expiresAt,
        gracePeriodEndsAt: sub.gracePeriodEndsAt,
      },
      payments,
      total: payments.length,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/subscriptions/receipt?attemptId=<id>
 * Generates a PDF receipt for a specific confirmed SubscriptionPaymentAttempt.
 * If no attemptId is provided, returns the most recent SUCCEEDED attempt.
 * Returns 404 if no confirmed payment exists.
 */
router.get('/receipt', subscriptionReadLimiter, requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const pro = await prisma.professional.findUnique({
      where: { userId: req.user.id },
      include: {
        subscription: {
          select: { id: true, startedAt: true, expiresAt: true },
        },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    if (!pro) return res.status(404).json({ error: 'Professionnel non trouvé' });
    if (!pro.subscription) return res.status(404).json({ error: 'Aucun abonnement trouvé' });

    // Look up the requested attempt — must belong to this professional's subscription
    let attempt;
    if (req.query.attemptId) {
      attempt = await prisma.subscriptionPaymentAttempt.findUnique({
        where: { id: req.query.attemptId },
      });
      // Security: reject attempts that don't belong to this professional
      if (!attempt || attempt.subscriptionId !== pro.subscription.id) {
        return res.status(404).json({ error: 'Tentative non trouvée' });
      }
    } else {
      // Default: most recent SUCCEEDED attempt
      attempt = await prisma.subscriptionPaymentAttempt.findFirst({
        where: { subscriptionId: pro.subscription.id, status: 'SUCCEEDED' },
        orderBy: { confirmedAt: 'desc' },
      });
    }

    if (!attempt || attempt.status !== 'SUCCEEDED') {
      return res.status(404).json({ error: 'Aucun paiement confirmé' });
    }

    const { generateSubscriptionReceiptBuffer } = require('../utils/generateSubscriptionReceipt');
    const reference = attempt.geniuspayRef || attempt.id;
    const buffer = await generateSubscriptionReceiptBuffer({
      professionalName: `${pro.user.firstName || ''} ${pro.user.lastName || ''}`.trim() || pro.user.email,
      professionalEmail: pro.user.email,
      tier: attempt.tier,
      billingCycle: attempt.billingCycle || 'MONTHLY',
      amount: attempt.confirmedAmount ?? attempt.expectedAmount,
      reference,
      paymentDate: attempt.confirmedAt,
      startedAt: pro.subscription.startedAt,
      expiresAt: pro.subscription.expiresAt,
      receiptNumber: `SUB-${reference.slice(-8).toUpperCase()}`,
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="recu-abonnement-${attempt.tier}-${new Date(attempt.confirmedAt).toISOString().slice(0, 10)}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.getActiveTier = getActiveTier;
module.exports.getTierConfig = getTierConfig;
module.exports.TIERS = TIERS;
