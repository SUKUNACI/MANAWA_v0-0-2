/**
 * Tests unitaires pour utils/pagination-helper.js
 * Couvre : applyPagination, applyPageBasedPagination, buildPaginatedResponse,
 *          applyCursorPagination, validatePaginationValues, getPaginationDefaults
 */

jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock express-validator so the middleware factory functions can be tested
// without a real Express server.
const mockChain = {
  optional: () => mockChain,
  isInt: () => mockChain,
  withMessage: () => mockChain,
  toInt: () => mockChain,
};
jest.mock('express-validator', () => ({
  query: jest.fn(() => mockChain),
}), { virtual: true });

const {
  applyPagination,
  applyPageBasedPagination,
  buildPaginatedResponse,
  applyCursorPagination,
  validatePaginationValues,
  validatePaginationQuery,
  validatePageBasedPaginationQuery,
  getPaginationDefaults,
} = require('../../utils/pagination-helper');

describe('PaginationHelper', () => {
  // ---------------------------------------------------------------------------
  describe('applyPagination', () => {
    it('returns default limit and offset when no params provided', () => {
      const result = applyPagination({}, 'professionals');
      expect(result.limit).toBeGreaterThan(0);
      expect(result.offset).toBe(0);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(result.limit);
    });

    it('respects limit and offset from queryParams', () => {
      const result = applyPagination({ limit: '10', offset: '20' }, 'professionals');
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(result.skip).toBe(20);
      expect(result.take).toBe(10);
    });

    it('enforces max limit (capped at 100)', () => {
      const result = applyPagination({ limit: '9999' }, 'professionals');
      expect(result.limit).toBeLessThanOrEqual(100);
    });

    it('enforces min limit (at least 1)', () => {
      const result = applyPagination({ limit: '0' }, 'professionals');
      expect(result.limit).toBeGreaterThanOrEqual(1);
    });

    it('skip aliases offset and take aliases limit', () => {
      const result = applyPagination({ limit: '5', offset: '15' }, 'professionals');
      expect(result.skip).toBe(result.offset);
      expect(result.take).toBe(result.limit);
    });

    it('handles undefined endpoint gracefully', () => {
      const result = applyPagination({ limit: '10' }, undefined);
      expect(result.limit).toBeGreaterThan(0);
    });

    it('handles empty queryParams', () => {
      const result = applyPagination({}, 'reviews');
      expect(result.limit).toBeGreaterThanOrEqual(1);
      expect(result.offset).toBeGreaterThanOrEqual(0);
    });

    it('suppresses debug log when logPagination=false', () => {
      const logger = require('../../utils/logger');
      logger.debug.mockClear();
      applyPagination({ limit: '5' }, 'reviews', { logPagination: false });
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it('emits debug log by default', () => {
      const logger = require('../../utils/logger');
      logger.debug.mockClear();
      applyPagination({ limit: '5' }, 'reviews');
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('applyPageBasedPagination', () => {
    it('converts page 1 to offset 0', () => {
      const result = applyPageBasedPagination({ page: '1', limit: '10' }, 'professionals');
      expect(result.offset).toBe(0);
      expect(result.page).toBe(1);
    });

    it('converts page 2 with limit 10 to offset 10', () => {
      const result = applyPageBasedPagination({ page: '2', limit: '10' }, 'professionals');
      expect(result.offset).toBe(10);
    });

    it('converts page 3 with limit 5 to offset 10', () => {
      const result = applyPageBasedPagination({ page: '3', limit: '5' }, 'professionals');
      expect(result.offset).toBe(10);
    });

    it('defaults to page 1 when page is absent', () => {
      const result = applyPageBasedPagination({ limit: '10' }, 'professionals');
      expect(result.page).toBe(1);
      expect(result.offset).toBe(0);
    });

    it('clamps negative page to 1', () => {
      const result = applyPageBasedPagination({ page: '-5', limit: '10' }, 'professionals');
      expect(result.page).toBeGreaterThanOrEqual(1);
      expect(result.offset).toBeGreaterThanOrEqual(0);
    });

    it('respects endpoint default limit when no limit given', () => {
      const result = applyPageBasedPagination({}, 'reviews');
      expect(result.limit).toBeGreaterThan(0);
    });

    it('enforces max limit', () => {
      const result = applyPageBasedPagination({ limit: '9999' }, 'professionals');
      expect(result.limit).toBeLessThanOrEqual(100);
    });

    it('enforces min limit', () => {
      const result = applyPageBasedPagination({ limit: '0' }, 'professionals');
      expect(result.limit).toBeGreaterThanOrEqual(1);
    });

    it('skip and take alias offset and limit', () => {
      const result = applyPageBasedPagination({ page: '3', limit: '5' }, 'professionals');
      expect(result.skip).toBe(result.offset);
      expect(result.take).toBe(result.limit);
    });
  });

  // ---------------------------------------------------------------------------
  describe('buildPaginatedResponse', () => {
    it('returns data and pagination fields', () => {
      const result = buildPaginatedResponse(['a', 'b', 'c'], 20, 0, 50);
      expect(result.data).toEqual(['a', 'b', 'c']);
      expect(result.pagination).toBeDefined();
    });

    it('calculates page 1 for offset 0', () => {
      const result = buildPaginatedResponse([], 20, 0, 100);
      expect(result.pagination.page).toBe(1);
    });

    it('calculates page 2 for offset equal to limit', () => {
      const result = buildPaginatedResponse([], 20, 20, 100);
      expect(result.pagination.page).toBe(2);
    });

    it('calculates totalPages = ceil(total / limit)', () => {
      const result = buildPaginatedResponse([], 10, 0, 35);
      expect(result.pagination.totalPages).toBe(4);
    });

    it('totalPages = 1 when total <= limit', () => {
      const result = buildPaginatedResponse([], 20, 0, 5);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('sets hasMore=true when there are more items beyond this page', () => {
      const result = buildPaginatedResponse([], 10, 0, 50);
      expect(result.pagination.hasMore).toBe(true);
    });

    it('sets hasMore=false on last page', () => {
      const result = buildPaginatedResponse([], 10, 40, 50);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('handles total=0', () => {
      const result = buildPaginatedResponse([], 20, 0, 0);
      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('pagination contains limit, offset, total', () => {
      const result = buildPaginatedResponse([], 15, 30, 100);
      expect(result.pagination.limit).toBe(15);
      expect(result.pagination.offset).toBe(30);
      expect(result.pagination.total).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  describe('applyCursorPagination', () => {
    it('returns null cursor when no cursor provided', () => {
      const result = applyCursorPagination({}, 'reviews');
      expect(result.cursor).toBeNull();
    });

    it('returns provided cursor string', () => {
      const result = applyCursorPagination({ cursor: 'abc123' }, 'reviews');
      expect(result.cursor).toBe('abc123');
    });

    it('returns limit from query param', () => {
      const result = applyCursorPagination({ limit: '15' }, 'reviews');
      expect(result.limit).toBe(15);
    });

    it('enforces max limit for cursor pagination', () => {
      const result = applyCursorPagination({ limit: '9999' }, 'reviews');
      expect(result.limit).toBeLessThanOrEqual(100);
    });

    it('defaults to a positive limit when none given', () => {
      const result = applyCursorPagination({}, 'reviews');
      expect(result.limit).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('validatePaginationValues', () => {
    it('returns null for valid limit=20 and offset=0', () => {
      expect(validatePaginationValues(20, 0)).toBeNull();
    });

    it('returns null for boundary limit=1 and offset=0', () => {
      expect(validatePaginationValues(1, 0)).toBeNull();
    });

    it('returns null for boundary limit=100 and offset=0', () => {
      expect(validatePaginationValues(100, 0)).toBeNull();
    });

    it('returns error message for limit < 1', () => {
      const error = validatePaginationValues(0, 0);
      expect(typeof error).toBe('string');
      expect(error.length).toBeGreaterThan(0);
    });

    it('returns error message for limit > 100', () => {
      const error = validatePaginationValues(101, 0);
      expect(typeof error).toBe('string');
    });

    it('returns error message for offset < 0', () => {
      const error = validatePaginationValues(10, -1);
      expect(typeof error).toBe('string');
      expect(error).toContain('offset');
    });

    it('returns null for large valid offset', () => {
      expect(validatePaginationValues(10, 10000)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('validatePaginationQuery', () => {
    it('returns an array of express-validator rules', () => {
      const rules = validatePaginationQuery();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(0);
    });

    it('contains two rules (limit and offset)', () => {
      const rules = validatePaginationQuery();
      expect(rules).toHaveLength(2);
    });
  });

  describe('validatePageBasedPaginationQuery', () => {
    it('returns an array of express-validator rules', () => {
      const rules = validatePageBasedPaginationQuery();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(0);
    });

    it('contains two rules (page and limit)', () => {
      const rules = validatePageBasedPaginationQuery();
      expect(rules).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  describe('getPaginationDefaults', () => {
    it('returns an object with the four expected keys', () => {
      const defaults = getPaginationDefaults();
      expect(defaults).toHaveProperty('defaultLimit');
      expect(defaults).toHaveProperty('maxLimit');
      expect(defaults).toHaveProperty('minLimit');
      expect(defaults).toHaveProperty('defaultOffset');
    });

    it('defaultLimit is a positive number', () => {
      const { defaultLimit } = getPaginationDefaults();
      expect(defaultLimit).toBeGreaterThan(0);
    });

    it('maxLimit >= defaultLimit', () => {
      const { maxLimit, defaultLimit } = getPaginationDefaults();
      expect(maxLimit).toBeGreaterThanOrEqual(defaultLimit);
    });

    it('minLimit is 1', () => {
      expect(getPaginationDefaults().minLimit).toBe(1);
    });

    it('defaultOffset is 0', () => {
      expect(getPaginationDefaults().defaultOffset).toBe(0);
    });

    it('maxLimit is 100', () => {
      expect(getPaginationDefaults().maxLimit).toBe(100);
    });
  });
});
