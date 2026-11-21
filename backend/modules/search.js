'use strict';

const logger = require('../utils/logger');
const searchCache = require('../utils/search-cache');
const { getFacetedCounts } = require('../utils/aggregation-helper');

/**
 * Search Module — Centralized search logic for professionals, projects, clients
 * Handles:
 * - PostgreSQL full-text search (professionals, projects, portfolio, packages, reviews)
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

  async searchProjects(q, { skip = 0, take = 20, filters = {} } = {}) {
    const { applyFilters } = require('../utils/filter-helper');
    let where = {
      client: { deletedAt: null },
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tradeNeeded: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ],
    };

    where = applyFilters('projects', where, filters);

    return this.prisma.project.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        tradeNeeded: true,
        budgetMin: true,
        budgetMax: true,
        city: true,
        status: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
      skip,
      take,
    });
  }

  async countProjects(q, filters = {}) {
    const { applyFilters } = require('../utils/filter-helper');
    let where = {
      client: { deletedAt: null },
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tradeNeeded: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ],
    };

    where = applyFilters('projects', where, filters);
    return this.prisma.project.count({ where });
  }

  async searchReviews(q, { skip = 0, take = 20, filters = {} } = {}) {
    const { applyFilters } = require('../utils/filter-helper');
    let where = {
      flags: { none: {} },
      professional: { isNot: null },
      author: { isNot: null },
      OR: [
        { comment: { contains: q, mode: 'insensitive' } },
        { professional: { user: { firstName: { contains: q, mode: 'insensitive' } } } },
        { professional: { user: { lastName: { contains: q, mode: 'insensitive' } } } },
        { author: { firstName: { contains: q, mode: 'insensitive' } } },
        { author: { lastName: { contains: q, mode: 'insensitive' } } },
      ],
    };

    where = applyFilters('reviews', where, filters);

    return this.prisma.review.findMany({
      where,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        professional: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      skip,
      take,
    });
  }

  async countReviews(q, filters = {}) {
    const { applyFilters } = require('../utils/filter-helper');
    let where = {
      flags: { none: {} },
      professional: { isNot: null },
      author: { isNot: null },
      OR: [
        { comment: { contains: q, mode: 'insensitive' } },
        { professional: { user: { firstName: { contains: q, mode: 'insensitive' } } } },
        { professional: { user: { lastName: { contains: q, mode: 'insensitive' } } } },
        { author: { firstName: { contains: q, mode: 'insensitive' } } },
        { author: { lastName: { contains: q, mode: 'insensitive' } } },
      ],
    };

    where = applyFilters('reviews', where, filters);
    return this.prisma.review.count({ where });
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
