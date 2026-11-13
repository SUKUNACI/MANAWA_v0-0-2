/**
 * Tests unitaires pour utils/sorting-helper.js
 * Couvre : validateSortParams, isValidSortField, validatePageSize, buildPaginationQuery
 */

const {
  validateSortParams,
  isValidSortField,
  validatePageSize,
  buildPaginationQuery,
} = require('../../utils/sorting-helper');

describe('SortingHelper', () => {
  // ---------------------------------------------------------------------------
  describe('isValidSortField', () => {
    describe('default allowed fields (no whitelist given)', () => {
      it('returns true for id', () => {
        expect(isValidSortField('id')).toBe(true);
      });

      it('returns true for createdAt', () => {
        expect(isValidSortField('createdAt')).toBe(true);
      });

      it('returns true for updatedAt', () => {
        expect(isValidSortField('updatedAt')).toBe(true);
      });

      it('returns true for name', () => {
        expect(isValidSortField('name')).toBe(true);
      });

      it('returns true for price', () => {
        expect(isValidSortField('price')).toBe(true);
      });

      it('returns false for a field not in defaults', () => {
        expect(isValidSortField('averageRating')).toBe(false);
      });
    });

    describe('with custom whitelist', () => {
      it('returns true when field is in whitelist', () => {
        expect(isValidSortField('averageRating', ['averageRating', 'createdAt'])).toBe(true);
      });

      it('returns false when field is NOT in whitelist', () => {
        expect(isValidSortField('id', ['averageRating'])).toBe(false);
      });

      it('handles empty whitelist (falls back to defaults)', () => {
        expect(isValidSortField('id', [])).toBe(true);
      });
    });

    describe('injection and format guards', () => {
      it('rejects field with SQL injection characters', () => {
        expect(isValidSortField('name; DROP TABLE users')).toBe(false);
      });

      it('rejects field with spaces', () => {
        expect(isValidSortField('field name')).toBe(false);
      });

      it('rejects field starting with a digit', () => {
        expect(isValidSortField('1field')).toBe(false);
      });

      it('rejects empty string', () => {
        expect(isValidSortField('')).toBe(false);
      });

      it('rejects field with dot notation', () => {
        expect(isValidSortField('user.id')).toBe(false);
      });

      it('rejects field with parentheses', () => {
        expect(isValidSortField('COUNT(*)')).toBe(false);
      });

      it('accepts field with underscore', () => {
        expect(isValidSortField('sort_order', ['sort_order'])).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('validateSortParams', () => {
    describe('null / empty input', () => {
      it('returns null when sortParam is undefined', () => {
        expect(validateSortParams(undefined, 'asc', [])).toBeNull();
      });

      it('returns null when sortParam is null', () => {
        expect(validateSortParams(null, 'asc', [])).toBeNull();
      });

      it('returns null when sortParam is empty string', () => {
        expect(validateSortParams('', 'asc', [])).toBeNull();
      });

      it('returns null when sortParam is whitespace only', () => {
        expect(validateSortParams('   ', 'asc', ['id'])).toBeNull();
      });
    });

    describe('single-field sorting', () => {
      it('returns { createdAt: "desc" } for valid field + order', () => {
        const result = validateSortParams('createdAt', 'desc', ['createdAt']);
        expect(result).toEqual({ createdAt: 'desc' });
      });

      it('returns { createdAt: "asc" } when orderParam is null', () => {
        const result = validateSortParams('createdAt', null, ['createdAt']);
        expect(result).toEqual({ createdAt: 'asc' });
      });

      it('lowercases order direction (DESC → desc)', () => {
        const result = validateSortParams('createdAt', 'DESC', ['createdAt']);
        expect(result).toEqual({ createdAt: 'desc' });
      });

      it('returns null when field is not in whitelist', () => {
        expect(validateSortParams('password', 'asc', ['createdAt'])).toBeNull();
      });

      it('returns null for invalid order direction', () => {
        expect(validateSortParams('createdAt', 'random', ['createdAt'])).toBeNull();
      });

      it('returns null for SQL injection in sort field', () => {
        expect(validateSortParams('name; DROP TABLE users', 'asc', ['name'])).toBeNull();
      });
    });

    describe('multi-field sorting', () => {
      it('returns multi-field orderBy object', () => {
        const result = validateSortParams('name,createdAt', 'asc,desc', ['name', 'createdAt']);
        expect(result).toEqual({ name: 'asc', createdAt: 'desc' });
      });

      it('defaults all directions to asc when orderParam is null', () => {
        const result = validateSortParams('name,createdAt', null, ['name', 'createdAt']);
        expect(result.name).toBe('asc');
        expect(result.createdAt).toBe('asc');
      });

      it('returns null when any field fails whitelist check', () => {
        const result = validateSortParams('name,password', 'asc,asc', ['name']);
        expect(result).toBeNull();
      });

      it('returns null when any direction is invalid', () => {
        const result = validateSortParams('name,createdAt', 'asc,badDir', ['name', 'createdAt']);
        expect(result).toBeNull();
      });

      it('handles three sort columns', () => {
        const result = validateSortParams('id,name,createdAt', 'asc,asc,desc', ['id', 'name', 'createdAt']);
        expect(result).toEqual({ id: 'asc', name: 'asc', createdAt: 'desc' });
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('validatePageSize', () => {
    it('returns default limit for NaN input', () => {
      const result = validatePageSize('abc');
      expect(result).toBeGreaterThan(0);
    });

    it('returns default limit for undefined input', () => {
      const result = validatePageSize(undefined);
      expect(result).toBeGreaterThan(0);
    });

    it('returns clamped value at MIN_LIMIT when below 1', () => {
      const result = validatePageSize(0);
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('returns clamped value at MAX_LIMIT for non-admin when above 100', () => {
      const result = validatePageSize(9999, false);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('respects valid limit within [1, 100]', () => {
      expect(validatePageSize(25)).toBe(25);
    });

    it('respects boundary value of 1', () => {
      expect(validatePageSize(1)).toBe(1);
    });

    it('respects boundary value of 100', () => {
      expect(validatePageSize(100)).toBe(100);
    });

    it('allows higher limit for admin (ADMIN_MAX_LIMIT = 500)', () => {
      const adminResult = validatePageSize(300, true);
      const userResult = validatePageSize(300, false);
      expect(adminResult).toBeGreaterThan(userResult);
    });

    it('applies endpoint-specific limit (reviews max = 20)', () => {
      const result = validatePageSize(50, false, 'reviews');
      expect(result).toBeLessThanOrEqual(20);
    });

    it('does not exceed global MAX_LIMIT for admin when endpoint limit is lower', () => {
      const result = validatePageSize(600, true, 'reviews');
      // min(endpoint=20, adminMax=500) = 20
      expect(result).toBeLessThanOrEqual(20);
    });
  });

  // ---------------------------------------------------------------------------
  describe('buildPaginationQuery', () => {
    it('returns take and skip for default options', () => {
      const result = buildPaginationQuery();
      expect(result).toHaveProperty('take');
      expect(result).toHaveProperty('skip');
      expect(result.skip).toBe(0);
    });

    it('page 1 → skip 0', () => {
      const result = buildPaginationQuery({ page: 1, limit: 20 });
      expect(result.skip).toBe(0);
      expect(result.take).toBe(20);
    });

    it('page 3 with limit 10 → skip 20', () => {
      const result = buildPaginationQuery({ page: 3, limit: 10 });
      expect(result.skip).toBe(20);
      expect(result.take).toBe(10);
    });

    it('page 0 is clamped to 1 → skip 0', () => {
      const result = buildPaginationQuery({ page: 0, limit: 10 });
      expect(result.skip).toBe(0);
    });

    it('applies orderBy from sort params', () => {
      const result = buildPaginationQuery({
        sortParam: 'createdAt',
        orderParam: 'desc',
        allowedFields: ['createdAt'],
      });
      expect(result.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('applies defaultOrder when sortParam is null', () => {
      const defaultOrder = { createdAt: 'desc' };
      const result = buildPaginationQuery({ defaultOrder });
      expect(result.orderBy).toEqual(defaultOrder);
    });

    it('does not set orderBy when neither sortParam nor defaultOrder is given', () => {
      const result = buildPaginationQuery({});
      expect(result.orderBy).toBeUndefined();
    });

    it('sortParam takes precedence over defaultOrder', () => {
      const result = buildPaginationQuery({
        sortParam: 'createdAt',
        orderParam: 'asc',
        allowedFields: ['createdAt'],
        defaultOrder: { name: 'desc' },
      });
      expect(result.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('admin can get higher take limit', () => {
      const userResult = buildPaginationQuery({ limit: 300, isAdmin: false });
      const adminResult = buildPaginationQuery({ limit: 300, isAdmin: true });
      expect(adminResult.take).toBeGreaterThan(userResult.take);
    });

    it('respects endpoint-specific limit', () => {
      const result = buildPaginationQuery({ limit: 50, endpoint: 'reviews' });
      expect(result.take).toBeLessThanOrEqual(20);
    });

    it('handles invalid sortParam gracefully (falls back to defaultOrder)', () => {
      const defaultOrder = { id: 'asc' };
      const result = buildPaginationQuery({
        sortParam: 'INVALID_FIELD$$',
        allowedFields: ['createdAt'],
        defaultOrder,
      });
      expect(result.orderBy).toEqual(defaultOrder);
    });
  });
});
