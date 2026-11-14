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
   * @returns {Promise<{results, total, cached: boolean}>}
   */
  async searchProfessionals(q, { skip = 0, take = 20, filters = {} } = {}) {
    return searchCache.getOrExecute('professionals', q, { skip, take, filters }, async () => {
      let where = {
        user: { deletedAt: null },
        OR: [
          { user: { firstName: { contains: q, mode: 'insensitive' } } },
          { user: { lastName: { contains: q, mode: 'insensitive' } } },
          { trades: { has: q } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      };

      if (filters.city) where.user.city = filters.city;
      if (filters.trade) where.trades = { has: filters.trade };
      if (filters.verifiedOnly) where.verifiedByAdmin = true;
      if (filters.minRating) where.averageRating = { gte: filters.minRating };

      const [results, total] = await Promise.all([
        this.prisma.professional.findMany({
          where,
          include: {
            user: { select: { firstName: true, lastName: true, city: true, avatarUrl: true } },
            _count: { select: { followers: true } },
          },
          skip,
          take,
          orderBy: { averageRating: 'desc' },
        }),
        this.prisma.professional.count({ where }),
      ]);

      return { results, total };
    });
  }

  /**
   * Search projects by query + filters
   * @param {string} q - Search query
   * @param {object} opts - { skip, take, filters }
   * @returns {Promise<{results, total, cached: boolean}>}
   */
  async searchProjects(q, { skip = 0, take = 20, filters = {} } = {}) {
    return searchCache.getOrExecute('projects', q, { skip, take, filters }, async () => {
      let where = {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tradeNeeded: { has: q } },
        ],
      };

      if (filters.city) where.city = filters.city;
      if (filters.status) where.status = filters.status;
      if (filters.tradeNeeded) where.tradeNeeded = { has: filters.tradeNeeded };
      if (filters.minBudget) where.estimatedBudget = { gte: filters.minBudget };

      const [results, total] = await Promise.all([
        this.prisma.project.findMany({
          where,
          include: {
            client: { select: { firstName: true, lastName: true, city: true } },
            _count: { select: { quotes: true, photos: true } },
          },
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.project.count({ where }),
      ]);

      return { results, total };
    });
  }

  /**
   * Search clients by query
   * @param {string} q - Search query
   * @param {object} opts - { skip, take }
   * @returns {Promise<{results, total, cached: boolean}>}
   */
  async searchClients(q, { skip = 0, take = 20 } = {}) {
    return searchCache.getOrExecute('clients', q, { skip, take }, async () => {
      const where = {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
        role: 'CLIENT',
      };

      const [results, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            city: true,
            avatarUrl: true,
          },
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.user.count({ where }),
      ]);

      return { results, total };
    });
  }

  /**
   * Get facet counts for search filters
   * @returns {Promise<{trades, cities}>}
   */
  async getFacets() {
    try {
      const [tradeStats, cityStats] = await Promise.all([
        this.prisma.professional.groupBy({
          by: ['trades'],
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 20,
        }),
        this.prisma.professional.groupBy({
          by: ['user'],
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 20,
        }),
      ]);

      return { trades: tradeStats, cities: cityStats };
    } catch (err) {
      logger.error('[SearchModule] getFacets failed', { error: err.message });
      return { trades: [], cities: [] };
    }
  }
}

module.exports = SearchModule;
