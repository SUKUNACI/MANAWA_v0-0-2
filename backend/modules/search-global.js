'use strict';

const logger = require('../utils/logger');

/**
 * SearchGlobalModule — Consolidates global search logic
 *
 * Delegates to SearchModule while providing:
 * - Unified error handling & logging
 * - Consistent filter parsing
 * - Type-specific search coordination
 *
 * Used by routes/search-global.js to eliminate duplication:
 * - searchGlobal(term, options) → searchModule.searchGlobal()
 * - searchByType(type, term, options) → searchModule.searchGlobalByType(type, ...)
 * - parseFilters(query) → searchModule.parseFiltersFromQuery()
 */

class SearchGlobalModule {
  constructor(searchModule, prisma, loggerInstance = logger) {
    if (!searchModule) {
      throw new Error('SearchGlobalModule: searchModule is required');
    }
    this.searchModule = searchModule;
    this.prisma = prisma;
    this.logger = loggerInstance;
  }

  /**
   * Parse filters from HTTP query parameters
   * @param {object} query - Express req.query object
   * @returns {object} Normalized filter object
   * @throws {Error} If filter parsing fails
   */
  parseFilters(query) {
    try {
      return this.searchModule.parseFiltersFromQuery(query);
    } catch (err) {
      this.logger.error('[SearchGlobalModule] Filter parsing failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Global search across all types
   * @param {string} term - Search term (2-200 chars)
   * @param {object} options - { limit, offset, filters }
   * @returns {Promise<object>} Aggregated results from all indices
   * @throws {Error} If search fails
   */
  async searchGlobal(term, options = {}) {
    if (!term || typeof term !== 'string') {
      throw new Error('SearchGlobalModule.searchGlobal: term must be a non-empty string');
    }

    if (term.trim().length < 2) {
      throw new Error('SearchGlobalModule.searchGlobal: term must be at least 2 characters');
    }

    const { limit = 10, offset = 0, filters = {} } = options;

    try {
      this.logger.debug('[SearchGlobalModule] Searching globally', {
        term: term.substring(0, 50),
        limit,
        offset,
        filterKeys: Object.keys(filters),
      });

      const result = await this.searchModule.searchGlobal(term, {
        limit,
        offset,
        filters,
      });

      return result;
    } catch (err) {
      this.logger.error('[SearchGlobalModule] Global search failed', {
        term: term.substring(0, 50),
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Search specific type (professionals, packages, portfolio, projects, reviews)
   * @param {string} type - Entity type to search
   * @param {string} term - Search term (2-200 chars)
   * @param {object} options - { limit, offset, filters }
   * @returns {Promise<object>} Type-specific results
   * @throws {Error} If type is invalid or search fails
   */
  async searchByType(type, term, options = {}) {
    if (!type || typeof type !== 'string') {
      throw new Error('SearchGlobalModule.searchByType: type must be a non-empty string');
    }

    if (!term || typeof term !== 'string') {
      throw new Error('SearchGlobalModule.searchByType: term must be a non-empty string');
    }

    if (term.trim().length < 2) {
      throw new Error('SearchGlobalModule.searchByType: term must be at least 2 characters');
    }

    const validTypes = ['professionals', 'packages', 'portfolio', 'projects', 'reviews'];
    if (!validTypes.includes(type)) {
      throw new Error(`SearchGlobalModule.searchByType: invalid type "${type}". Must be one of: ${validTypes.join(', ')}`);
    }

    const { limit = 10, offset = 0, filters = {} } = options;

    try {
      this.logger.debug('[SearchGlobalModule] Searching by type', {
        type,
        term: term.substring(0, 50),
        limit,
        offset,
        filterKeys: Object.keys(filters),
      });

      const result = await this.searchModule.searchGlobalByType(type, term, {
        limit,
        offset,
        filters,
      });

      return result;
    } catch (err) {
      this.logger.error('[SearchGlobalModule] Type-specific search failed', {
        type,
        term: term.substring(0, 50),
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Convenience method for global search with filter validation
   * @param {string} term - Search term
   * @param {object} query - Express req.query for filter extraction
   * @param {object} pagination - { limit, offset }
   * @returns {Promise<object>} Search results
   * @throws {Error} If validation or search fails
   */
  async searchWithParsedFilters(term, query = {}, pagination = {}) {
    if (!term || typeof term !== 'string') {
      throw new Error('SearchGlobalModule.searchWithParsedFilters: term required');
    }

    try {
      const filters = this.parseFilters(query);
      return await this.searchGlobal(term, {
        limit: pagination.limit || 10,
        offset: pagination.offset || 0,
        filters,
      });
    } catch (err) {
      this.logger.error('[SearchGlobalModule] searchWithParsedFilters failed', {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Convenience method for type-specific search with filter validation
   * @param {string} type - Entity type
   * @param {string} term - Search term
   * @param {object} query - Express req.query for filter extraction
   * @param {object} pagination - { limit, offset }
   * @returns {Promise<object>} Type-specific results
   * @throws {Error} If validation or search fails
   */
  async searchByTypeWithParsedFilters(type, term, query = {}, pagination = {}) {
    if (!type || typeof type !== 'string') {
      throw new Error('SearchGlobalModule.searchByTypeWithParsedFilters: type required');
    }

    if (!term || typeof term !== 'string') {
      throw new Error('SearchGlobalModule.searchByTypeWithParsedFilters: term required');
    }

    try {
      const filters = this.parseFilters(query);
      return await this.searchByType(type, term, {
        limit: pagination.limit || 10,
        offset: pagination.offset || 0,
        filters,
      });
    } catch (err) {
      this.logger.error('[SearchGlobalModule] searchByTypeWithParsedFilters failed', {
        type,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Validate search parameters
   * @param {string} term - Search term
   * @returns {object} { valid: boolean, errors: string[] }
   */
  validateSearchTerm(term) {
    const errors = [];

    if (!term || typeof term !== 'string') {
      errors.push('term must be a non-empty string');
    } else if (term.trim().length < 2) {
      errors.push('term must be at least 2 characters');
    } else if (term.trim().length > 200) {
      errors.push('term must not exceed 200 characters');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate type parameter
   * @param {string} type - Entity type
   * @returns {object} { valid: boolean, errors: string[] }
   */
  validateType(type) {
    const errors = [];
    const validTypes = ['professionals', 'packages', 'portfolio', 'projects', 'reviews'];

    if (!type || typeof type !== 'string') {
      errors.push('type must be a non-empty string');
    } else if (!validTypes.includes(type)) {
      errors.push(`type must be one of: ${validTypes.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate pagination parameters
   * @param {number} limit - Result limit
   * @param {number} offset - Result offset
   * @returns {object} { valid: boolean, errors: string[], clamped: { limit, offset } }
   */
  validatePagination(limit, offset) {
    const errors = [];
    const clamped = {
      limit: Math.max(1, Math.min(parseInt(limit) || 10, 50)),
      offset: Math.max(0, parseInt(offset) || 0),
    };

    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 50)) {
      errors.push('limit must be between 1 and 50');
    }

    if (offset !== undefined && (isNaN(offset) || offset < 0)) {
      errors.push('offset must be >= 0');
    }

    return {
      valid: errors.length === 0,
      errors,
      clamped,
    };
  }
}

module.exports = SearchGlobalModule;
