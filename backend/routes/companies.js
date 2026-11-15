const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, query } = require('express-validator');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery } = require('../utils/pagination-helper');
const CompanyModule = require('../modules/company');
const prisma = require('../config/db');

const router = express.Router();

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requetes, reessayez dans une minute' },
});

const company = new CompanyModule(prisma);

// GET /api/companies
router.get('/', adminLimiter, requireAuth, requirePermission('companies'),
  [
    ...validatePageBasedPaginationQuery(),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('search too long'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { search } = req.query;
      const { limit, skip, offset } = applyPageBasedPagination(req.query, 'companies');
      const { companies, total } = await company.list({ search, limit, skip });
      const page = Math.floor(offset / limit) + 1;
      res.json({ companies, total, page, totalPages: Math.ceil(total / limit) });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/companies/:id
router.get('/:id', requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const result = await company.getProfile(req.params.id);
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

module.exports = router;
