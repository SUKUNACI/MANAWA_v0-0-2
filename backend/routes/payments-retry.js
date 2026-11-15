const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const PaymentRetryModule = require('../modules/paymentRetry');
const prisma = require('../config/db');

const router = express.Router();
const paymentRetry = new PaymentRetryModule(prisma);

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

router.post('/:paymentId/retry', requireAuth, paymentLimiter,
  [param('paymentId').trim().notEmpty()],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const result = await paymentRetry.retryPayment(req.params.paymentId, req.user.id);
      res.json(result);
    } catch (err) {
      if (err.status) res.status(err.status).json({ error: err.message });
      else next(err);
    }
  }
);

module.exports = router;
