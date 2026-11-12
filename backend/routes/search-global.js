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
const { query, validationResult } = require('express-validator');
const { optionalAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { globalSearch } = require('../config/meilisearch');
const { validateFilters } = require('../utils/filter-helper');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiters
const globalSearchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de recherche, réessayez dans une minute' },
});

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

function clampLimit(raw) {
  const n = parseInt(raw) || DEFAULT_LIMIT;
  return Math.min(Math.max(1, n), MAX_LIMIT);
}

function clampPage(raw) {
  return Math.max(1, parseInt(raw) || 1);
}

/**
 * Construit les filtres pour MeiliSearch à partir des paramètres de requête
 * @param {object} queryFilters - Filtres depuis la requête
 * @returns {array} Tableau des filtres formatés pour MeiliSearch
 */
function buildMeilisearchFilters(queryFilters) {
  if (!queryFilters) return [];

  const filters = [];

  // Filtres numériques de rating
  if (queryFilters.minRating !== undefined) {
    filters.push(`averageRating >= ${parseFloat(queryFilters.minRating)}`);
  }
  if (queryFilters.maxRating !== undefined) {
    filters.push(`averageRating <= ${parseFloat(queryFilters.maxRating)}`);
  }

  // Filtres numériques de prix
  if (queryFilters.minPrice !== undefined) {
    filters.push(`price >= ${parseFloat(queryFilters.minPrice)}`);
    filters.push(`subscription.monthlyPrice >= ${parseFloat(queryFilters.minPrice)}`);
  }
  if (queryFilters.maxPrice !== undefined) {
    filters.push(`price <= ${parseFloat(queryFilters.maxPrice)}`);
    filters.push(`subscription.monthlyPrice <= ${parseFloat(queryFilters.maxPrice)}`);
  }

  // Filtres de vérification
  if (queryFilters.verifiedOnly === 'true' || queryFilters.verifiedOnly === true) {
    filters.push('verifiedByAdmin = true');
  }

  // Filtres de ville
  if (queryFilters.city) {
    const city = String(queryFilters.city).trim();
    // Note: MeiliSearch supporte les filtres texte avec `LIKE` en version récente
    // Pour la compatibilité, on utilise une recherche simple
    filters.push(`city = "${city}"`);
  }

  // Filtres de catégorie
  if (queryFilters.category) {
    const category = String(queryFilters.category).trim();
    filters.push(`category = "${category}"`);
  }

  return filters;
}

/**
 * Parseur de filtres depuis les paramètres de requête
 * Support: ?filters[minPrice]=100&filters[maxPrice]=500
 * ou: ?minPrice=100&maxPrice=500
 *
 * @param {object} req - Objet request Express
 * @returns {object} Filtres parsés
 */
function parseFiltersFromQuery(req) {
  const filters = {};

  // Support du format filters[key]=value
  if (req.query.filters && typeof req.query.filters === 'object') {
    Object.assign(filters, req.query.filters);
  }

  // Support du format direct: key=value
  const filterKeys = ['minRating', 'maxRating', 'minPrice', 'maxPrice', 'city', 'verifiedOnly', 'category'];
  for (const key of filterKeys) {
    if (req.query[key] !== undefined) {
      filters[key] = req.query[key];
    }
  }

  return filters;
}

/**
 * GET /api/v1/search/global?q=&filters[]=&limit=&offset=
 *
 * Recherche globale via MeiliSearch dans tous les indices
 */
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
      const limit = clampLimit(req.query.limit);
      const offset = Math.max(0, parseInt(req.query.offset) || 0);

      if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: 'Le terme de recherche doit contenir au moins 2 caractères' });
      }

      const term = q.trim();

      // Parser les filtres depuis la requête
      const rawFilters = parseFiltersFromQuery(req);

      // Construire les filtres pour MeiliSearch
      const meilisearchFilters = buildMeilisearchFilters(rawFilters);

      logger.debug('[SearchGlobal] Recherche lancée', {
        query: term,
        limit,
        offset,
        filters: meilisearchFilters,
      });

      // Effectuer la recherche globale
      const results = await globalSearch(term, {
        limit,
        offset,
        filters: meilisearchFilters.length > 0 ? meilisearchFilters : undefined,
      });

      // Agréger les résultats
      const aggregated = {
        query: term,
        filters: rawFilters,
        pagination: {
          limit,
          offset,
        },
        results: {
          professionals: {
            hits: results.professionals?.hits || [],
            processingTimeMs: results.professionals?.processingTimeMs || 0,
          },
          projects: {
            hits: results.projects?.hits || [],
            processingTimeMs: results.projects?.processingTimeMs || 0,
          },
          portfolio: {
            hits: results.portfolio?.hits || [],
            processingTimeMs: results.portfolio?.processingTimeMs || 0,
          },
          packages: {
            hits: results.packages?.hits || [],
            processingTimeMs: results.packages?.processingTimeMs || 0,
          },
          reviews: {
            hits: results.reviews?.hits || [],
            processingTimeMs: results.reviews?.processingTimeMs || 0,
          },
        },
        total: (results.professionals?.hits?.length || 0) +
               (results.projects?.hits?.length || 0) +
               (results.portfolio?.hits?.length || 0) +
               (results.packages?.hits?.length || 0) +
               (results.reviews?.hits?.length || 0),
      };

      res.json(aggregated);
    } catch (err) {
      logger.error('[SearchGlobal] Erreur recherche globale', { error: err.message });
      next(err);
    }
  }
);

/**
 * GET /api/v1/search/global/professionals
 * Recherche dans les professionnels uniquement
 */
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
      const limit = clampLimit(req.query.limit);
      const offset = Math.max(0, parseInt(req.query.offset) || 0);

      const term = q.trim();
      const rawFilters = parseFiltersFromQuery(req);
      const meilisearchFilters = buildMeilisearchFilters(rawFilters);

      const { professionals } = await globalSearch(term, {
        limit,
        offset,
        filters: meilisearchFilters.length > 0 ? meilisearchFilters : undefined,
      });

      res.json({
        query: term,
        filters: rawFilters,
        pagination: { limit, offset },
        professionals: professionals?.hits || [],
        processingTimeMs: professionals?.processingTimeMs || 0,
      });
    } catch (err) {
      logger.error('[SearchGlobal] Erreur recherche professionnels', { error: err.message });
      next(err);
    }
  }
);

/**
 * GET /api/v1/search/global/packages
 * Recherche dans les forfaits uniquement
 */
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
      const limit = clampLimit(req.query.limit);
      const offset = Math.max(0, parseInt(req.query.offset) || 0);

      const term = q.trim();
      const rawFilters = parseFiltersFromQuery(req);
      const meilisearchFilters = buildMeilisearchFilters(rawFilters);

      const { packages } = await globalSearch(term, {
        limit,
        offset,
        filters: meilisearchFilters.length > 0 ? meilisearchFilters : undefined,
      });

      res.json({
        query: term,
        filters: rawFilters,
        pagination: { limit, offset },
        packages: packages?.hits || [],
        processingTimeMs: packages?.processingTimeMs || 0,
      });
    } catch (err) {
      logger.error('[SearchGlobal] Erreur recherche packages', { error: err.message });
      next(err);
    }
  }
);

/**
 * GET /api/v1/search/global/portfolio
 * Recherche dans le portfolio uniquement
 */
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
      const limit = clampLimit(req.query.limit);
      const offset = Math.max(0, parseInt(req.query.offset) || 0);

      const term = q.trim();
      const rawFilters = parseFiltersFromQuery(req);
      const meilisearchFilters = buildMeilisearchFilters(rawFilters);

      const { portfolio } = await globalSearch(term, {
        limit,
        offset,
        filters: meilisearchFilters.length > 0 ? meilisearchFilters : undefined,
      });

      res.json({
        query: term,
        filters: rawFilters,
        pagination: { limit, offset },
        portfolio: portfolio?.hits || [],
        processingTimeMs: portfolio?.processingTimeMs || 0,
      });
    } catch (err) {
      logger.error('[SearchGlobal] Erreur recherche portfolio', { error: err.message });
      next(err);
    }
  }
);

module.exports = router;
