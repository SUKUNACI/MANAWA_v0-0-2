'use strict';

const logger = require('../utils/logger');

/**
 * SearchFacetsModule — Thin wrapper around SearchModule for faceted search operations
 * Consolidates facet validation, normalization, and retrieval logic
 * Delegates core operations to SearchModule
 */

class SearchFacetsModule {
  /**
   * Constructor
   * @param {object} searchModule - Injected SearchModule instance (already instantiated)
   * @param {object} prisma - Prisma client (for future direct operations if needed)
   */
  constructor(searchModule, prisma) {
    if (!searchModule) {
      throw new Error('SearchFacetsModule: searchModule is required');
    }
    this.searchModule = searchModule;
    this.prisma = prisma;
  }

  /**
   * Validate facet filter ranges
   * Ensures min/max values are coherent and within acceptable bounds
   * @param {object} filters - Facet filters object
   * @returns {object} { valid: boolean, errors: [] }
   */
  validateFacetFilters(filters) {
    if (!filters || typeof filters !== 'object') {
      return { valid: false, errors: ['Filters must be an object'] };
    }

    try {
      // Delegate to SearchModule validation
      return this.searchModule.validateFacetFilters(filters);
    } catch (err) {
      logger.error('[SearchFacetsModule] Validation error', { error: err.message, filters });
      return { valid: false, errors: ['Validation failed: ' + err.message] };
    }
  }

  /**
   * Normalize facet filters with defaults
   * Applies boundaries and default values to user-provided filters
   * @param {object} bodyFilters - User-provided filters from request body
   * @param {string} q - Optional search query string
   * @returns {object} Normalized filters object
   */
  normalizeFacetFilters(bodyFilters = {}, q = '') {
    try {
      if (!bodyFilters || typeof bodyFilters !== 'object') {
        bodyFilters = {};
      }

      // Delegate to SearchModule normalization
      return this.searchModule.normalizeFacetFilters(bodyFilters, q);
    } catch (err) {
      logger.error('[SearchFacetsModule] Normalization error', { error: err.message, bodyFilters, q });
      // Return safe defaults on error
      return {
        q: q || '',
        city: null,
        trade: null,
        minRating: 0,
        maxRating: 5,
        minPrice: 0,
        maxPrice: 100000,
      };
    }
  }

  /**
   * Get facet counts for the provided filters
   * Returns aggregated counts for cities, trades, ratings, price ranges
   * @param {object} filters - Facet filters (city, trade, rating range, price range)
   * @returns {Promise<object>} Facets object with cities, trades, ratings, priceRanges, total
   */
  async getFacets(filters = {}) {
    try {
      if (!filters || typeof filters !== 'object') {
        filters = { q: '' };
      }

      // Delegate to SearchModule
      const facets = await this.searchModule.getFacets(filters);
      return facets;
    } catch (err) {
      logger.error('[SearchFacetsModule] Get facets error', { error: err.message, filters });
      throw err;
    }
  }

  /**
   * Get facets with full validation and normalization pipeline
   * Complete flow: validate → normalize → fetch
   * @param {object} filters - Raw filter object from request
   * @param {string} q - Optional search query
   * @returns {Promise<object>} Validated, normalized facets
   */
  async getFacetsWithValidation(filters = {}, q = '') {
    try {
      // Step 1: Normalize filters
      const normalizedFilters = this.normalizeFacetFilters(filters, q);

      // Step 2: Validate normalized filters
      const validation = this.validateFacetFilters(normalizedFilters);
      if (!validation.valid) {
        const error = new Error(validation.errors[0] || 'Filter validation failed');
        error.status = 400;
        throw error;
      }

      // Step 3: Get facets
      const facets = await this.getFacets(normalizedFilters);
      return facets;
    } catch (err) {
      logger.error('[SearchFacetsModule] Get facets with validation error', {
        error: err.message,
        filters,
        q,
      });
      throw err;
    }
  }

  /**
   * Get specific facet type (location, trade, rating, price)
   * Returns only the requested facet type from the full facets response
   * @param {string} facetType - 'locations' | 'trades' | 'ratings' | 'prices'
   * @param {object} filters - Facet filters
   * @returns {Promise<object>} { [facetType]: array, total: number }
   */
  async getFacetByType(facetType, filters = {}) {
    try {
      const validTypes = ['locations', 'trades', 'ratings', 'prices'];
      if (!validTypes.includes(facetType)) {
        const error = new Error(`Invalid facet type: ${facetType}. Must be one of: ${validTypes.join(', ')}`);
        error.status = 400;
        throw error;
      }

      // Map facetType to facets response key
      const facetKeyMap = {
        locations: 'cities',
        trades: 'trades',
        ratings: 'ratings',
        prices: 'priceRanges',
      };

      const facets = await this.getFacets(filters);
      const key = facetKeyMap[facetType];

      return {
        [facetType]: facets[key] || [],
        total: facets.total || 0,
      };
    } catch (err) {
      logger.error('[SearchFacetsModule] Get facet by type error', {
        error: err.message,
        facetType,
        filters,
      });
      throw err;
    }
  }
}

module.exports = SearchFacetsModule;
