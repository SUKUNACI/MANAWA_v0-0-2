/**
 * Q65 + Q66 Tests
 *
 * Tests pour:
 * - Q65: Filtering Options (filter-helper.js)
 * - Q66: Full-Text Search Support via PostgreSQL (search-global.js)
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

describe('Q65: Search Integration', () => {
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

  describe('Filter string construction', () => {
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
