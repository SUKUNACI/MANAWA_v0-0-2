const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { sendPushNotification } = require('../config/pushNotifications');
const ReferralModule = require('../modules/referral');
const prisma = require('../config/db');

const router = express.Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requetes, reessayez dans une minute' },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requetes, reessayez dans une minute' },
});

const referral = new ReferralModule(prisma, sendPushNotification);

// GET /api/referrals/my-code
router.get('/my-code', readLimiter, requireAuth, requireRole('PROFESSIONAL'), handleValidationErrors, async (req, res, next) => {
  try {
    const result = await referral.getOrCreateCode(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/referrals/use
router.post('/use', writeLimiter, requireAuth, requireRole('PROFESSIONAL'),
  [body('code').trim().notEmpty().isLength({ min: 5, max: 20 }).withMessage('code required, 5-20 chars')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const result = await referral.useCode({ userId: req.user.id, code: req.body.code });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

// GET /api/referrals/mine
router.get('/mine', readLimiter, requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const result = await referral.listReferrals(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/referrals/my-referrer
router.get('/my-referrer', readLimiter, requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const result = await referral.getReferrer(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
