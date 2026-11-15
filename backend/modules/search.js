'use strict';

const logger = require('../utils/logger');
const searchCache = require('../utils/search-cache');
const { globalSearch } = require('../config/meilisearch');
const { getFacetedCounts } = require('../utils/aggregation-helper');

/**
 * Search Module — Centralized search logic for professionals, projects, clients
 * Handles:
 * - Local PostgreSQL search (professionals, portfolio, packages)
 * - Global MeiliSearch (all entities)
 * - Faceted search aggregation
 * - Query construction, filtering, caching, result formatting
 */

class SearchModule {
  constructor(prisma) {
    this.prisma = prisma;
    this.MAX_LIMIT = 50;
    this.DEFAULT_LIMIT = 10;
    this.DEFAULT_LIMIT_LOCAL = 5;
  }

  /**
   * Search professionals by query + filters
   * @param {string} q - Search query
   * @param {object} opts - { skip, take, filters }
   * @returns {Promise<Array>} Cached results
   */
  async searchProfessionals(q, { skip = 0, take = 20, filters = {} } = {}) {
    return searchCache.getOrExecute('professionals', q, { skip, take, filters }, async () => {
      const { applyFilters } = require('../utils/filter-helper');
      let where = {
        user: { deletedAt: null },
        OR: [
          { user: { firstName: { contains: q, mode: 'insensitive' } } },
          { user: { lastName: { contains: q, mode: 'insensitive' } } },
          { trade: { contains: q, mode: 'insensitive' } },
          { trades: { has: q } },
          { description: { contains: q, mode: 'insensitive' } },
          { companyName: { contains: q, mode: 'insensitive' } },
          { user: { city: { contains: q, mode: 'insensitive' } } },
        ],
      };

      where = applyFilters('professionals', where, filters);

      return this.prisma.professional.findMany({
        where,
        select: {
          id: true,
          userId: true,
          trade: true,
          trades: true,
          companyName: true,
          averageRating: true,
          reviewCount: true,
          verifiedByAdmin: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              avatarUrl: true,
              city: true,
            },
          },
          subscription: {
            select: { tier: true },
          },
        },
        skip,
        take,
      });
    });
  }

  async countProfessionals(q, filters = {}) {
    const { applyFilters } = require('../utils/filter-helper');
    let where = {
      user: { deletedAt: null },
      OR: [
        { user: { firstName: { contains: q, mode: 'insensitive' } } },
        { user: { lastName: { contains: q, mode: 'insensitive' } } },
        { trade: { contains: q, mode: 'insensitive' } },
        { trades: { has: q } },
        { description: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { user: { city: { contains: q, mode: 'insensitive' } } },
      ],
    };

    where = applyFilters('professionals', where, filters);
    return this.prisma.professional.count({ where });
  }

  async searchPortfolio(q, { skip = 0, take = 20 } = {}) {
    return this.prisma.portfolioProject.findMany({
      where: {
        professional: { user: { deletedAt: null } },
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tradeCategory: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        title: true,
        description: true,
        tradeCategory: true,
        images: {
          select: { imageUrl: true },
          orderBy: { sortOrder: 'asc' },
          take: 3,
        },
        professional: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      skip,
      take,
    });
  }

  async countPortfolio(q) {
    return this.prisma.portfolioProject.count({
      where: {
        professional: { user: { deletedAt: null } },
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tradeCategory: { contains: q, mode: 'insensitive' } },
        ],
      },
    });
  }

  async searchPackages(q, { skip = 0, take = 20, filters = {} } = {}) {
    const { applyFilters } = require('../utils/filter-helper');
    let where = {
      active: true,
      professional: { user: { deletedAt: null } },
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
      ],
    };

    where = applyFilters('packages', where, filters);

    return this.prisma.servicePackage.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        duration: true,
        category: true,
        images: true,
        ordersCount: true,
        professional: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      skip,
      take,
    });
  }

  async countPackages(q, filters = {}) {
    const { applyFilters } = require('../utils/filter-helper');
    let where = {
      active: true,
      professional: { user: { deletedAt: null } },
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
      ],
    };

    where = applyFilters('packages', where, filters);
    return this.prisma.servicePackage.count({ where });
  }

  async getHistory(userId) {
    const row = await this.prisma.appConfig.findUnique({ where: { key: `search_history_${userId}` } });
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveHistory(userId, q) {
    const key = `search_history_${userId}`;
    const existing = await this.getHistory(userId);
    const updated = [q, ...existing.filter(t => t !== q)].slice(0, 10);
    await this.prisma.appConfig.upsert({
      where: { key },
      create: { key, value: JSON.stringify(updated), description: `Historique recherches utilisateur ${userId}` },
      update: { value: JSON.stringify(updated) },
    });
    return updated;
  }

  async clearHistory(userId) {
    const key = `search_history_${userId}`;
    await this.prisma.appConfig.deleteMany({ where: { key } });
  }

  parseFiltersFromQuery(queryParams) {
    const filters = {};
    if (queryParams.filters && typeof queryParams.filters === 'object') {
      Object.assign(filters, queryParams.filters);
    }
    const filterKeys = ['minRating', 'maxRating', 'minPrice', 'maxPrice', 'city', 'verifiedOnly', 'category'];
    for (const key of filterKeys) {
      if (queryParams[key] !== undefined) {
        filters[key] = queryParams[key];
      }
    }
    return filters;
  }

  clampLimit(raw) {
    const n = parseInt(raw) || 5;
    return Math.min(Math.max(1, n), 20);
  }

  clampPage(raw) {
    return Math.max(1, parseInt(raw) || 1);
  }

  /**
   * MeiliSearch Utilities
   */

  clampLimitGlobal(raw, defaultLimit = this.DEFAULT_LIMIT) {
    const n = parseInt(raw) || defaultLimit;
    return Math.min(Math.max(1, n), this.MAX_LIMIT);
  }

  buildMeilisearchFilters(queryFilters = {}) {
    if (!queryFilters) return [];

    const filters = [];

    // Rating filters
    if (queryFilters.minRating !== undefined) {
      filters.push(`averageRating >= ${parseFloat(queryFilters.minRating)}`);
    }
    if (queryFilters.maxRating !== undefined) {
      filters.push(`averageRating <= ${parseFloat(queryFilters.maxRating)}`);
    }

    // Price filters
    if (queryFilters.minPrice !== undefined) {
      filters.push(`price >= ${parseFloat(queryFilters.minPrice)}`);
      filters.push(`subscription.monthlyPrice >= ${parseFloat(queryFilters.minPrice)}`);
    }
    if (queryFilters.maxPrice !== undefined) {
      filters.push(`price <= ${parseFloat(queryFilters.maxPrice)}`);
      filters.push(`subscription.monthlyPrice <= ${parseFloat(queryFilters.maxPrice)}`);
    }

    // Verified filter
    if (queryFilters.verifiedOnly === 'true' || queryFilters.verifiedOnly === true) {
      filters.push('verifiedByAdmin = true');
    }

    // City filter
    if (queryFilters.city) {
      const city = String(queryFilters.city).trim();
      filters.push(`city = "${city}"`);
    }

    // Category filter
    if (queryFilters.category) {
      const category = String(queryFilters.category).trim();
      filters.push(`category = "${category}"`);
    }

    return filters;
  }

  /**
   * Global search via MeiliSearch
   * @param {string} q - Search query
   * @param {object} opts - { limit, offset, filters }
   * @returns {Promise<object>} Aggregated results from all indices
   */
  async searchGlobal(q, { limit = this.DEFAULT_LIMIT, offset = 0, filters = {} } = {}) {
    try {
      const clampedLimit = this.clampLimitGlobal(limit);
      const clampedOffset = Math.max(0, parseInt(offset) || 0);

      const meilisearchFilters = this.buildMeilisearchFilters(filters);

      logger.debug('[SearchModule] Global search', {
        query: q,
        limit: clampedLimit,
        offset: clampedOffset,
        filters: meilisearchFilters,
      });

      const results = await globalSearch(q, {
        limit: clampedLimit,
        offset: clampedOffset,
        filters: meilisearchFilters.length > 0 ? meilisearchFilters : undefined,
      });

      return {
        query: q,
        filters,
        pagination: { limit: clampedLimit, offset: clampedOffset },
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
    } catch (err) {
      logger.error('[SearchModule] Global search failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Search specific type via MeiliSearch
   * @param {string} type - Entity type (professionals, packages, portfolio)
   * @param {string} q - Search query
   * @param {object} opts - { limit, offset, filters }
   * @returns {Promise<object>} Type-specific results
   */
  async searchGlobalByType(type, q, { limit = this.DEFAULT_LIMIT, offset = 0, filters = {} } = {}) {
    try {
      const clampedLimit = this.clampLimitGlobal(limit);
      const clampedOffset = Math.max(0, parseInt(offset) || 0);

      const meilisearchFilters = this.buildMeilisearchFilters(filters);

      const results = await globalSearch(q, {
        limit: clampedLimit,
        offset: clampedOffset,
        filters: meilisearchFilters.length > 0 ? meilisearchFilters : undefined,
      });

      const typeResults = results[type] || { hits: [], processingTimeMs: 0 };

      return {
        query: q,
        filters,
        pagination: { limit: clampedLimit, offset: clampedOffset },
        [type]: typeResults.hits || [],
        processingTimeMs: typeResults.processingTimeMs || 0,
      };
    } catch (err) {
      logger.error('[SearchModule] Global search by type failed', { type, error: err.message });
      throw err;
    }
  }

  /**
   * Get faceted search counts
   * @param {object} filters - Search filters { q, city, trade, minRating, maxRating, minPrice, maxPrice }
   * @returns {Promise<object>} Faceted counts
   */
  async getFacets(filters = {}) {
    try {
      return await getFacetedCounts(filters);
    } catch (err) {
      logger.error('[SearchModule] Facets query failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Validate facet filter ranges
   * @param {object} filters - Facet filters
   * @returns {object} { valid: boolean, errors: [] }
   */
  validateFacetFilters(filters = {}) {
    const errors = [];

    if (filters.minRating !== undefined && filters.maxRating !== undefined) {
      if (parseFloat(filters.minRating) > parseFloat(filters.maxRating)) {
        errors.push('minRating must be <= maxRating');
      }
    }

    if (filters.minPrice !== undefined && filters.maxPrice !== undefined) {
      if (parseFloat(filters.minPrice) > parseFloat(filters.maxPrice)) {
        errors.push('minPrice must be <= maxPrice');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Normalize facet filters with defaults
   * @param {object} bodyFilters - User-provided filters
   * @param {string} q - Optional search query
   * @returns {object} Normalized filters
   */
  normalizeFacetFilters(bodyFilters = {}, q = '') {
    return {
      q: q || '',
      city: bodyFilters.city || null,
      trade: bodyFilters.trade || null,
      minRating: Math.max(0, Math.min(5, parseFloat(bodyFilters.minRating) || 0)),
      maxRating: Math.max(0, Math.min(5, parseFloat(bodyFilters.maxRating) || 5)),
      minPrice: Math.max(0, parseFloat(bodyFilters.minPrice) || 0),
      maxPrice: Math.max(0, parseFloat(bodyFilters.maxPrice) || 100000),
    };
  }

}

module.exports = SearchModule;
