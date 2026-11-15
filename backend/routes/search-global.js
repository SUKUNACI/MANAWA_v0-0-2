/**
 * Global Search Route - Q66: Full-Text Search via MeiliSearch
 *
 * GET /api/v1/search/global?q=&filters[]=
 *
 * Recherche combinée dans tous les indices:
 * - professionals, projects, portfolio, packages, reviews
 *
 * Avec support des filtres définis dans Q65
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');
const { optionalAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const SearchModule = require('../modules/search');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();
const searchModule = new SearchModule(prisma);

// Rate limiters
const globalSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de recherche, réessayez dans une minute' },
});

// GET / — Global search across all indices
router.get('/', globalSearchLimiter, optionalAuth,
  [
    query('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be >= 0'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;
      if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q required, 2-200 chars' });

      const limit = req.query.limit || 10;
      const offset = req.query.offset || 0;

      const term = q.trim();
      const rawFilters = searchModule.parseFiltersFromQuery(req.query);

      const result = await searchModule.searchGlobal(term, { limit, offset, filters: rawFilters });
      res.json(result);
    } catch (err) {
      logger.error('[SearchGlobal] Global search failed', { error: err.message });
      next(err);
    }
  }
);

// GET /professionals — Search professionals only
router.get('/professionals', globalSearchLimiter, optionalAuth,
  [
    query('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be >= 0'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;
      if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q required, 2-200 chars' });

      const limit = req.query.limit || 10;
      const offset = req.query.offset || 0;

      const term = q.trim();
      const rawFilters = searchModule.parseFiltersFromQuery(req.query);

      const result = await searchModule.searchGlobalByType('professionals', term, { limit, offset, filters: rawFilters });
      res.json(result);
    } catch (err) {
      logger.error('[SearchGlobal] Professionals search failed', { error: err.message });
      next(err);
    }
  }
);

// GET /packages — Search packages only
router.get('/packages', globalSearchLimiter, optionalAuth,
  [
    query('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be >= 0'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;
      if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q required, 2-200 chars' });

      const limit = req.query.limit || 10;
      const offset = req.query.offset || 0;

      const term = q.trim();
      const rawFilters = searchModule.parseFiltersFromQuery(req.query);

      const result = await searchModule.searchGlobalByType('packages', term, { limit, offset, filters: rawFilters });
      res.json(result);
    } catch (err) {
      logger.error('[SearchGlobal] Packages search failed', { error: err.message });
      next(err);
    }
  }
);

// GET /portfolio — Search portfolio only
router.get('/portfolio', globalSearchLimiter, optionalAuth,
  [
    query('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be >= 0'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;
      if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q required, 2-200 chars' });

      const limit = req.query.limit || 10;
      const offset = req.query.offset || 0;

      const term = q.trim();
      const rawFilters = searchModule.parseFiltersFromQuery(req.query);

      const result = await searchModule.searchGlobalByType('portfolio', term, { limit, offset, filters: rawFilters });
      res.json(result);
    } catch (err) {
      logger.error('[SearchGlobal] Portfolio search failed', { error: err.message });
      next(err);
    }
  }
);

module.exports = router;
