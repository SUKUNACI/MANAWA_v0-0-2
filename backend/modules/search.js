'use strict';

const logger = require('../utils/logger');
const searchCache = require('../utils/search-cache');

/**
 * Search Module — Centralized search logic for professionals, projects, clients
 * Handles query construction, filtering, caching, and result formatting
 */

class SearchModule {
  constructor(prisma) {
    this.prisma = prisma;
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
    const filterKeys = ['minRating', 'maxRating', 'minPrice', 'maxPrice', 'city', 'verifiedOnly'];
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

}

module.exports = SearchModule;
