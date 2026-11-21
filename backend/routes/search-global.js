/**
 * Global Search Route — PostgreSQL full-text search
 *
 * GET /api/v1/search/global?q=&filters[]=
 *
 * Recherche combinée via PostgreSQL:
 * - professionals, projects, portfolio, packages, reviews
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

const globalSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de recherche, réessayez dans une minute' },
});

const searchValidationRules = [
  query('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
  query('offset').optional().isInt({ min: 0 }).withMessage('offset must be >= 0'),
];

const createSearchHandler = (type = null) => {
  return async (req, res, next) => {
    try {
      const { q, limit = 10, offset = 0 } = req.query;

      const termValidation = searchGlobalModule.validateSearchTerm(q);
      if (!termValidation.valid) {
        return res.status(400).json({ error: termValidation.errors[0] });
      }

      const paginationValidation = searchGlobalModule.validatePagination(limit, offset);
      const { clamped } = paginationValidation;

      if (type) {
        const typeValidation = searchGlobalModule.validateType(type);
        if (!typeValidation.valid) {
          return res.status(400).json({ error: typeValidation.errors[0] });
        }
      }

      const filters = searchGlobalModule.parseFilters(req.query);
      const term = q.trim();
      const pgLimit = clamped.limit;
      const pgSkip = clamped.offset;

      if (!type) {
        // Global search — query all 5 types in parallel via PostgreSQL
        const [professionals, projects, portfolio, packages, reviews] = await Promise.all([
          searchModule.searchProfessionals(term, { skip: pgSkip, take: pgLimit, filters }),
          searchModule.searchProjects(term, { skip: pgSkip, take: pgLimit, filters }),
          searchModule.searchPortfolio(term, { skip: pgSkip, take: pgLimit }),
          searchModule.searchPackages(term, { skip: pgSkip, take: pgLimit, filters }),
          searchModule.searchReviews(term, { skip: pgSkip, take: pgLimit }),
        ]);

        return res.json({
          query: term,
          filters,
          pagination: { limit: pgLimit, offset: pgSkip },
          results: {
            professionals: { hits: professionals, processingTimeMs: 0 },
            projects: { hits: projects, processingTimeMs: 0 },
            portfolio: { hits: portfolio, processingTimeMs: 0 },
            packages: { hits: packages, processingTimeMs: 0 },
            reviews: { hits: reviews, processingTimeMs: 0 },
          },
          total: professionals.length + projects.length + portfolio.length + packages.length + reviews.length,
        });
      }

      // Type-specific search via PostgreSQL
      const typeMethodMap = {
        professionals: () => searchModule.searchProfessionals(term, { skip: pgSkip, take: pgLimit, filters }),
        projects: () => searchModule.searchProjects(term, { skip: pgSkip, take: pgLimit, filters }),
        portfolio: () => searchModule.searchPortfolio(term, { skip: pgSkip, take: pgLimit }),
        packages: () => searchModule.searchPackages(term, { skip: pgSkip, take: pgLimit, filters }),
        reviews: () => searchModule.searchReviews(term, { skip: pgSkip, take: pgLimit }),
      };

      const hits = await typeMethodMap[type]();

      return res.json({
        query: term,
        filters,
        pagination: { limit: pgLimit, offset: pgSkip },
        [type]: hits,
        processingTimeMs: 0,
      });

    } catch (err) {
      logger.error('[SearchGlobal] Handler failed', {
        type: type || 'global',
        error: err.message,
      });
      next(err);
    }
  };
};

router.get('/', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler());
router.get('/professionals', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('professionals'));
router.get('/packages', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('packages'));
router.get('/portfolio', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('portfolio'));
router.get('/projects', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('projects'));
router.get('/reviews', globalSearchLimiter, optionalAuth, searchValidationRules, handleValidationErrors, createSearchHandler('reviews'));

module.exports = router;
