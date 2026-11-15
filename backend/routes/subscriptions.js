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
