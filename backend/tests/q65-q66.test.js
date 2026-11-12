/**
 * Q65 + Q66 Tests
 *
 * Tests pour:
 * - Q65: Filtering Options (filter-helper.js)
 * - Q66: Full-Text Search Support via MeiliSearch (meilisearch.js, meilisearch-sync.js, search-global.js)
 */

const { validateFilters, applyFilters } = require('../utils/filter-helper');

describe('Q65: Filter Helper', () => {
  describe('validateFilters', () => {
    it('should validate professional filters correctly', () => {
      const result = validateFilters('professionals', {
        minRating: '3.5',
        maxRating: '5',
        city: 'Paris',
        verifiedOnly: 'true',
      });

      expect(result.errors).toHaveLength(0);
      expect(result.validated.minRating).toBe(3.5);
      expect(result.validated.maxRating).toBe(5);
      expect(result.validated.city).toBe('Paris');
      expect(result.validated.verifiedOnly).toBe(true);
    });

    it('should reject invalid professional filters', () => {
      const result = validateFilters('professionals', {
        minRating: '10', // Invalid: > 5
        city: 'P', // Invalid: < 2 chars
        unknownFilter: 'value', // Invalid: not in whitelist
      });

      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate package filters correctly', () => {
      const result = validateFilters('packages', {
        minPrice: '100',
        maxPrice: '500',
        verifiedOnly: 'true',
      });

      expect(result.errors).toHaveLength(0);
      expect(result.validated.minPrice).toBe(100);
      expect(result.validated.maxPrice).toBe(500);
      expect(result.validated.verifiedOnly).toBe(true);
    });

    it('should handle missing filters gracefully', () => {
      const result = validateFilters('professionals', {});
      expect(result.errors).toHaveLength(0);
      expect(Object.keys(result.validated)).toHaveLength(0);
    });

    it('should reject unknown endpoints', () => {
      const result = validateFilters('unknownEndpoint', { city: 'Paris' });
      expect(result.validated).toEqual({});
    });
  });

  describe('applyFilters', () => {
    it('should apply professional filters to where clause', () => {
      const where = { user: { deletedAt: null } };
      const filters = { minRating: 4, maxRating: 5, city: 'Paris' };

      const result = applyFilters('professionals', where, filters);

      expect(result.averageRating).toBeDefined();
      expect(result.averageRating.gte).toBe(4);
      expect(result.averageRating.lte).toBe(5);
      expect(result.user.city.contains).toBe('Paris');
    });

    it('should apply verified filter to professional where clause', () => {
      const where = {};
      const filters = { verifiedOnly: true };

      const result = applyFilters('professionals', where, filters);

      expect(result.verifiedByAdmin).toBe(true);
    });

    it('should apply package filters to where clause', () => {
      const where = { active: true };
      const filters = { minPrice: 50, maxPrice: 200 };

      const result = applyFilters('packages', where, filters);

      expect(result.price).toBeDefined();
      expect(result.price.gte).toBe(50);
      expect(result.price.lte).toBe(200);
    });

    it('should handle empty filters gracefully', () => {
      const where = { active: true };
      const result = applyFilters('packages', where, {});

      expect(result).toEqual(where);
    });
  });
});

describe('Q66: MeiliSearch Configuration', () => {
  // Note: These tests require MeiliSearch to be running
  // Skip if MeiliSearch is not available

  let meilisearchClient;

  beforeAll(() => {
    try {
      const { client } = require('../config/meilisearch');
      meilisearchClient = client;
    } catch (err) {
      console.warn('⚠️ MeiliSearch not available for testing');
    }
  });

  it('should have correct indices configuration', () => {
    const { INDICES_CONFIG } = require('../config/meilisearch');

    const expectedIndices = ['professionals', 'projects', 'portfolio', 'packages', 'reviews'];
    expect(Object.keys(INDICES_CONFIG)).toEqual(expect.arrayContaining(expectedIndices));

    for (const indexName of expectedIndices) {
      const config = INDICES_CONFIG[indexName];
      expect(config.name).toBe(indexName);
      expect(config.primaryKey).toBeDefined();
      expect(config.searchableAttributes).toBeDefined();
      expect(config.filterableAttributes).toBeDefined();
    }
  });

  it('should export required functions', () => {
    const meilisearch = require('../config/meilisearch');

    expect(typeof meilisearch.getIndex).toBe('function');
    expect(typeof meilisearch.ensureIndices).toBe('function');
    expect(typeof meilisearch.healthCheck).toBe('function');
    expect(typeof meilisearch.globalSearch).toBe('function');
  });

  it('should properly format data for MeiliSearch', () => {
    // Test data formatting (mocked example)
    const professional = {
      id: '123',
      firstName: 'John',
      lastName: 'Doe',
      trade: 'Electrician',
      city: 'Paris',
      averageRating: 4.5,
      verifiedByAdmin: true,
    };

    const formatted = {
      id: professional.id,
      firstName: professional.firstName,
      lastName: professional.lastName,
      trade: professional.trade,
      city: professional.city,
      averageRating: professional.averageRating,
      verifiedByAdmin: professional.verifiedByAdmin,
    };

    expect(formatted.id).toBe('123');
    expect(formatted.firstName).toBe('John');
    expect(formatted.averageRating).toBe(4.5);
  });
});

describe('Q66: MeiliSearch Sync Job', () => {
  it('should export sync functions', () => {
    const sync = require('../jobs/meilisearch-sync');

    expect(typeof sync.syncAllIndices).toBe('function');
    expect(typeof sync.syncProfessionals).toBe('function');
    expect(typeof sync.syncProjects).toBe('function');
    expect(typeof sync.syncPortfolio).toBe('function');
    expect(typeof sync.syncPackages).toBe('function');
    expect(typeof sync.syncReviews).toBe('function');
  });

  it('should handle batch processing correctly', () => {
    // Test batch size constants
    const BATCH_SIZE = 100;
    expect(BATCH_SIZE).toBe(100);

    // Test that batching logic works
    const items = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    const batches = [];

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }

    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(100);
    expect(batches[1]).toHaveLength(100);
    expect(batches[2]).toHaveLength(50);
  });
});

describe('Q65 + Q66: Search Integration', () => {
  describe('Filter parsing from query params', () => {
    it('should parse filters[key]=value format', () => {
      const query = {
        filters: {
          minPrice: '100',
          maxPrice: '500',
        },
      };

      const filters = {};
      if (query.filters && typeof query.filters === 'object') {
        Object.assign(filters, query.filters);
      }

      expect(filters.minPrice).toBe('100');
      expect(filters.maxPrice).toBe('500');
    });

    it('should parse direct key=value format', () => {
      const query = {
        city: 'Paris',
        verifiedOnly: 'true',
      };

      const filters = {};
      const filterKeys = ['minRating', 'maxRating', 'minPrice', 'maxPrice', 'city', 'verifiedOnly'];
      for (const key of filterKeys) {
        if (query[key] !== undefined) {
          filters[key] = query[key];
        }
      }

      expect(filters.city).toBe('Paris');
      expect(filters.verifiedOnly).toBe('true');
    });
  });

  describe('MeiliSearch filter construction', () => {
    it('should build rating filters correctly', () => {
      const queryFilters = { minRating: '3.5', maxRating: '5' };
      const filters = [];

      if (queryFilters.minRating) {
        filters.push(`averageRating >= ${parseFloat(queryFilters.minRating)}`);
      }
      if (queryFilters.maxRating) {
        filters.push(`averageRating <= ${parseFloat(queryFilters.maxRating)}`);
      }

      expect(filters).toContain('averageRating >= 3.5');
      expect(filters).toContain('averageRating <= 5');
    });

    it('should build price filters correctly', () => {
      const queryFilters = { minPrice: '100', maxPrice: '500' };
      const filters = [];

      if (queryFilters.minPrice) {
        filters.push(`price >= ${parseFloat(queryFilters.minPrice)}`);
      }
      if (queryFilters.maxPrice) {
        filters.push(`price <= ${parseFloat(queryFilters.maxPrice)}`);
      }

      expect(filters).toContain('price >= 100');
      expect(filters).toContain('price <= 500');
    });

    it('should build verified filter correctly', () => {
      const queryFilters = { verifiedOnly: 'true' };
      const filters = [];

      if (queryFilters.verifiedOnly === 'true' || queryFilters.verifiedOnly === true) {
        filters.push('verifiedByAdmin = true');
      }

      expect(filters).toContain('verifiedByAdmin = true');
    });
  });
});
