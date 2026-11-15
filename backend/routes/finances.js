const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const FinanceModule = require('../modules/finance');

const router = express.Router();
const finance = new FinanceModule(prisma);

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

router.get('/', adminLimiter, requireAuth, requirePermission('finances'),
  [
    query('startDate').optional().isISO8601().withMessage('invalid startDate format'),
    query('endDate').optional().isISO8601().withMessage('invalid endDate format'),
    query('status').optional().isIn(['PENDING', 'COMPLETED', 'FAILED']).withMessage('invalid status'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit) : 50;
      const filters = {
        status: req.query.status,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      };

      const result = await finance.getTransactions(page, limit, filters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/summary', adminLimiter, requireAuth, requirePermission('finances'), async (req, res, next) => {
  try {
    const result = await finance.getSummary();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
