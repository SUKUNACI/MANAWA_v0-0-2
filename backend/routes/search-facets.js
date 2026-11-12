const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, validationResult } = require('express-validator');
const { optionalAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { getFacetedCounts } = require('../utils/aggregation-helper');

const router = express.Router();

// Rate limiters
const facetLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de recherche, réessayez dans une minute' },
});

// ============================================================================
// GET /api/v1/search/facets
// Retourne les counts agrégés pour faceted search
// Supports: ?q=recherche&city=Dakar&trade=Electricité&minRating=3&maxRating=5&minPrice=50&maxPrice=500
// ============================================================================
router.get(
  '/facets',
  facetLimiter,
  optionalAuth,
  [
    query('q')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Query max 100 characters'),
    query('city')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 })
      .withMessage('City max 50 characters'),
    query('trade')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Trade max 100 characters'),
    query('minRating')
      .optional()
      .isFloat({ min: 0, max: 5 })
      .withMessage('minRating must be between 0 and 5'),
    query('maxRating')
      .optional()
      .isFloat({ min: 0, max: 5 })
      .withMessage('maxRating must be between 0 and 5'),
    query('minPrice')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('minPrice must be >= 0'),
    query('maxPrice')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('maxPrice must be >= 0'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q, city, trade, minRating, maxRating, minPrice, maxPrice } = req.query;

      // Parse filters with defaults
      const filters = {
        q: q || '',
        city: city || null,
        trade: trade || null,
        minRating: parseFloat(minRating) || 0,
        maxRating: parseFloat(maxRating) || 5,
        minPrice: parseFloat(minPrice) || 0,
        maxPrice: parseFloat(maxPrice) || 100000,
      };

      // Validate filter ranges
      if (filters.minRating > filters.maxRating) {
        return res.status(400).json({
          error: 'minRating must be <= maxRating',
        });
      }

      if (filters.minPrice > filters.maxPrice) {
        return res.status(400).json({
          error: 'minPrice must be <= maxPrice',
        });
      }

      // Get faceted counts
      const facets = await getFacetedCounts(filters);

      // Construct response with applied filters
      res.status(200).json({
        success: true,
        data: {
          facets,
          appliedFilters: {
            query: filters.q,
            city: filters.city,
            trade: filters.trade,
            ratingRange: [filters.minRating, filters.maxRating],
            priceRange: [filters.minPrice, filters.maxPrice],
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[SearchFacets] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// POST /api/v1/search/facets/combined
// Advanced faceted search with combined filters
// Body: { filters: { city, trade, minRating, maxRating }, q }
// ============================================================================
router.post(
  '/facets/combined',
  facetLimiter,
  optionalAuth,
  [
    query('q')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Query max 100 characters'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { filters: bodyFilters } = req.body || {};
      const { q } = req.query;

      if (!bodyFilters || typeof bodyFilters !== 'object') {
        return res.status(400).json({
          error: 'filters object required in request body',
        });
      }

      // Normalize and validate filters
      const filters = {
        q: q || '',
        city: bodyFilters.city || null,
        trade: bodyFilters.trade || null,
        minRating: Math.max(0, Math.min(5, parseFloat(bodyFilters.minRating) || 0)),
        maxRating: Math.max(0, Math.min(5, parseFloat(bodyFilters.maxRating) || 5)),
        minPrice: Math.max(0, parseFloat(bodyFilters.minPrice) || 0),
        maxPrice: Math.max(0, parseFloat(bodyFilters.maxPrice) || 100000),
      };

      // Get faceted counts with combined filters
      const facets = await getFacetedCounts(filters);

      res.status(200).json({
        success: true,
        data: {
          facets,
          appliedFilters: {
            query: filters.q,
            city: filters.city,
            trade: filters.trade,
            ratingRange: [filters.minRating, filters.maxRating],
            priceRange: [filters.minPrice, filters.maxPrice],
          },
          totalResults: facets.total,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[SearchFacets Combined] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/search/facets/locations
// Returns location facets only (optimized endpoint)
// ============================================================================
router.get(
  '/facets/locations',
  facetLimiter,
  optionalAuth,
  [
    query('q')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;

      const facets = await getFacetedCounts({ q: q || '' });

      res.status(200).json({
        success: true,
        data: {
          locations: facets.locations,
          total: facets.total,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[SearchFacets Locations] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/search/facets/trades
// Returns trade facets only (optimized endpoint)
// ============================================================================
router.get(
  '/facets/trades',
  facetLimiter,
  optionalAuth,
  [
    query('q')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;

      const facets = await getFacetedCounts({ q: q || '' });

      res.status(200).json({
        success: true,
        data: {
          trades: facets.trades,
          total: facets.total,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[SearchFacets Trades] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/search/facets/ratings
// Returns rating distribution only
// ============================================================================
router.get(
  '/facets/ratings',
  facetLimiter,
  optionalAuth,
  [
    query('q')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;

      const facets = await getFacetedCounts({ q: q || '' });

      res.status(200).json({
        success: true,
        data: {
          ratings: facets.ratings,
          total: facets.total,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[SearchFacets Ratings] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/search/facets/prices
// Returns price distribution only
// ============================================================================
router.get(
  '/facets/prices',
  facetLimiter,
  optionalAuth,
  [
    query('q')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;

      const facets = await getFacetedCounts({ q: q || '' });

      res.status(200).json({
        success: true,
        data: {
          priceRanges: facets.priceRanges,
          total: facets.total,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[SearchFacets Prices] Error:', err.message);
      next(err);
    }
  }
);

module.exports = router;
