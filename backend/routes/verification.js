const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { sendVerificationEmail } = require('../config/mailer');
const { sendVerificationSms } = require('../config/sms');
const { requireAuth } = require('../middleware/auth');
const VerificationModule = require('../modules/verification');

const router = express.Router();
const verification = new VerificationModule(prisma);

// Rate limiters
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes de code, réessayez dans 15 minutes' },
});

router.post('/email/send', requireAuth, otpLimiter, async (req, res, next) => {
  try {
    const result = await verification.sendEmailVerification(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/email/confirm', requireAuth,
  [
    body('code').trim().notEmpty().withMessage('Code requis').isLength({ min: 6, max: 6 }).withMessage('Code 6 chiffres').isNumeric().withMessage('Code must be numeric'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const result = await verification.confirmEmailVerification(req.user.id, req.body.code);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

router.post('/phone/send', requireAuth, otpLimiter, async (req, res, next) => {
  try {
    const result = await verification.sendPhoneVerification(req.user.id, req.body.phone);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/phone/confirm', requireAuth, async (req, res, next) => {
  try {
    const result = await verification.confirmPhoneVerification(req.user.id, req.body.code);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/password/request-reset', otpLimiter, async (req, res, next) => {
  try {
    const result = await verification.requestPasswordReset(req.body.email);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/password/reset', otpLimiter, async (req, res, next) => {
  try {
    const result = await verification.resetPassword(req.body.email, req.body.code, req.body.newPassword);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const result = await verification.getVerificationStatus(req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
