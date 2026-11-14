'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, body } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { validateFilters } = require('../utils/filter-helper');
const SearchModule = require('../modules/search');
const logger = require('../utils/logger');

const router = express.Router();
const searchModule = new SearchModule(prisma);

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de recherche, réessayez dans une minute' },
});

// GET /api/search — Search all entities (professionals, portfolio, packages)
router.get('/', searchLimiter, optionalAuth,
  [
    query('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars'),
    query('type').optional().isIn(['all', 'professionals', 'portfolio', 'packages']).withMessage('invalid type'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be >= 1'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q, type = 'all', page, limit } = req.query;
      const term = q.trim();

      const take = searchModule.clampLimit(limit);
      const pageNum = searchModule.clampPage(page);
      const skip = (pageNum - 1) * take;

      // Parse and validate filters
      const rawFilters = searchModule.parseFiltersFromQuery(req.query);
      const professionalFilters = validateFilters('professionals', rawFilters);
      const packageFilters = validateFilters('packages', rawFilters);

      if (professionalFilters.errors.length > 0 || packageFilters.errors.length > 0) {
        const allErrors = [...professionalFilters.errors, ...packageFilters.errors];
        return res.status(400).json({ error: 'Filtres invalides', details: allErrors });
      }

      if (type === 'all') {
        const [professionals, portfolio, packages] = await Promise.all([
          searchModule.searchProfessionals(term, { skip: 0, take, filters: professionalFilters.validated }),
          searchModule.searchPortfolio(term, { skip: 0, take }),
          searchModule.searchPackages(term, { skip: 0, take, filters: packageFilters.validated }),
        ]);

        return res.json({
          query: term,
          professionals,
          portfolio,
          packages,
          total: professionals.length + portfolio.length + packages.length,
        });
      }

      if (type === 'professionals') {
        const [results, total] = await Promise.all([
          searchModule.searchProfessionals(term, { skip, take, filters: professionalFilters.validated }),
          searchModule.countProfessionals(term, professionalFilters.validated),
        ]);
        return res.json({
          query: term,
          professionals: results,
          pagination: { page: pageNum, limit: take, total, totalPages: Math.ceil(total / take) },
        });
      }

      if (type === 'portfolio') {
        const [results, total] = await Promise.all([
          searchModule.searchPortfolio(term, { skip, take }),
          searchModule.countPortfolio(term),
        ]);
        return res.json({
          query: term,
          portfolio: results,
          pagination: { page: pageNum, limit: take, total, totalPages: Math.ceil(total / take) },
        });
      }

      if (type === 'packages') {
        const [results, total] = await Promise.all([
          searchModule.searchPackages(term, { skip, take, filters: packageFilters.validated }),
          searchModule.countPackages(term, packageFilters.validated),
        ]);
        return res.json({
          query: term,
          packages: results,
          pagination: { page: pageNum, limit: take, total, totalPages: Math.ceil(total / take) },
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/search/history — Save search to history (auth required)
router.post('/history', searchLimiter, requireAuth,
  [body('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const history = await searchModule.saveHistory(req.user.id, req.body.q.trim());
      res.json({ success: true, history });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/search/history — Get user's search history
router.get('/history', searchLimiter, requireAuth, async (req, res, next) => {
  try {
    const history = await searchModule.getHistory(req.user.id);
    res.json({ history });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/search/history — Clear user's search history
router.delete('/history', searchLimiter, requireAuth, async (req, res, next) => {
  try {
    await searchModule.clearHistory(req.user.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
