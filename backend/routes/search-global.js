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
const SearchGlobalModule = require('../modules/search-global');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();
const searchModule = new SearchModule(prisma);
const searchGlobalModule = new SearchGlobalModule(searchModule, prisma, logger);

// Rate limiters
const globalSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de recherche, réessayez dans une minute' },
});

/**
 * Validation rules for all search endpoints
 */
const searchValidationRules = [
  query('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
  query('offset').optional().isInt({ min: 0 }).withMessage('offset must be >= 0'),
];

/**
 * Generic search handler factory
 * Supports both global search and type-specific search
 */
const createSearchHandler = (type = null) => {
  return async (req, res, next) => {
    try {
      const { q, limit = 10, offset = 0 } = req.query;

      // Extract and validate search term
      const termValidation = searchGlobalModule.validateSearchTerm(q);
      if (!termValidation.valid) {
        return res.status(400).json({ error: termValidation.errors[0] });
      }

      // Validate and clamp pagination
      const paginationValidation = searchGlobalModule.validatePagination(limit, offset);
      const { clamped } = paginationValidation;

      // Parse filters from query parameters
      const filters = searchGlobalModule.parseFilters(req.query);

      // Execute search based on type
      let result;
      if (type) {
        // Type-specific search
        const typeValidation = searchGlobalModule.validateType(type);
        if (!typeValidation.valid) {
          return res.status(400).json({ error: typeValidation.errors[0] });
        }
        result = await searchGlobalModule.searchByType(type, q.trim(), {
          limit: clamped.limit,
          offset: clamped.offset,
          filters,
        });
      } else {
        // Global search across all types
        result = await searchGlobalModule.searchGlobal(q.trim(), {
          limit: clamped.limit,
          offset: clamped.offset,
          filters,
        });
      }

      res.json(result);
    } catch (err) {
      logger.error('[SearchGlobal] Search failed', {
        type: type || 'global',
        error: err.message,
      });
      next(err);
    }
  };
};

// GET / — Global search across all indices
router.get('/', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler());

// GET /professionals — Search professionals only
router.get('/professionals', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('professionals'));

// GET /packages — Search packages only
router.get('/packages', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('packages'));

// GET /portfolio — Search portfolio only
router.get('/portfolio', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('portfolio'));

// GET /projects — Search projects only
router.get('/projects', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('projects'));

// GET /reviews — Search reviews only
router.get('/reviews', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('reviews'));

module.exports = router;
