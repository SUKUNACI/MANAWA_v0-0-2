const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');
const { optionalAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { createModules } = require('../modules');
const prisma = require('../config/db');

const router = express.Router();
const modules = createModules(prisma);
const facetsModule = modules.searchFacets;

const facetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de recherche, réessayez dans une minute' },
});

// GET /facets — Get all facet counts
router.get('/facets', facetLimiter, optionalAuth,
  [
    query('q').optional().isString().trim().isLength({ max: 100 }),
    query('city').optional().isString().trim().isLength({ max: 50 }),
    query('trade').optional().isString().trim().isLength({ max: 100 }),
    query('minRating').optional().isFloat({ min: 0, max: 5 }),
    query('maxRating').optional().isFloat({ min: 0, max: 5 }),
    query('minPrice').optional().isFloat({ min: 0 }),
    query('maxPrice').optional().isFloat({ min: 0 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q, city, trade, minRating, maxRating, minPrice, maxPrice } = req.query;
      const filters = { q: q || '', city: city || null, trade: trade || null, minRating: parseFloat(minRating) || 0, maxRating: parseFloat(maxRating) || 5, minPrice: parseFloat(minPrice) || 0, maxPrice: parseFloat(maxPrice) || 100000 };

      const validation = facetsModule.validateFacetFilters(filters);
      if (!validation.valid) return res.status(400).json({ error: validation.errors[0] });

      const facets = await facetsModule.getFacets(filters);
      res.json({
        success: true,
        data: {
          facets,
          appliedFilters: { query: filters.q, city: filters.city, trade: filters.trade, ratingRange: [filters.minRating, filters.maxRating], priceRange: [filters.minPrice, filters.maxPrice] },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /facets/combined — Advanced faceted search
router.post('/facets/combined', facetLimiter, optionalAuth,
  [query('q').optional().isString().trim().isLength({ max: 100 })],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { filters: bodyFilters } = req.body || {};
      const { q } = req.query;

      if (!bodyFilters || typeof bodyFilters !== 'object') {
        return res.status(400).json({ error: 'filters object required in request body' });
      }

      const filters = facetsModule.normalizeFacetFilters(bodyFilters, q);
      const facets = await facetsModule.getFacets(filters);

      res.json({
        success: true,
        data: {
          facets,
          appliedFilters: { query: filters.q, city: filters.city, trade: filters.trade, ratingRange: [filters.minRating, filters.maxRating], priceRange: [filters.minPrice, filters.maxPrice] },
          totalResults: facets.total,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /facets/locations — Location facets only
router.get('/facets/locations', facetLimiter, optionalAuth,
  [query('q').optional().isString().trim().isLength({ max: 100 })],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;
      const facets = await facetsModule.getFacets({ q: q || '' });
      res.json({
        success: true,
        data: { locations: facets.locations, total: facets.total, timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /facets/trades — Trade facets only
router.get('/facets/trades', facetLimiter, optionalAuth,
  [query('q').optional().isString().trim().isLength({ max: 100 })],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;
      const facets = await facetsModule.getFacets({ q: q || '' });
      res.json({
        success: true,
        data: { trades: facets.trades, total: facets.total, timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /facets/ratings — Rating facets only
router.get('/facets/ratings', facetLimiter, optionalAuth,
  [query('q').optional().isString().trim().isLength({ max: 100 })],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;
      const facets = await facetsModule.getFacets({ q: q || '' });
      res.json({
        success: true,
        data: { ratings: facets.ratings, total: facets.total, timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /facets/prices — Price facets only
router.get('/facets/prices', facetLimiter, optionalAuth,
  [query('q').optional().isString().trim().isLength({ max: 100 })],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { q } = req.query;
      const facets = await facetsModule.getFacets({ q: q || '' });
      res.json({
        success: true,
        data: { priceRanges: facets.priceRanges, total: facets.total, timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
