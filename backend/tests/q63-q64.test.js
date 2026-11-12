/**
 * Q63 + Q64 Implementation Tests
 * Tests for Max Page Size and Sorting Options
 */

const { buildPaginationQuery, validatePageSize, validateSortParams, isValidSortField } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

describe('Q63 + Q64: Page Size and Sorting', () => {

  // ========== Q63 TESTS ==========

  describe('Q63: Max Page Size Validation', () => {

    describe('validatePageSize() - Regular Users', () => {
      it('should default to 20 when no limit provided', () => {
        expect(validatePageSize(undefined, false)).toBe(20);
      });

      it('should cap at 100 for regular users', () => {
        expect(validatePageSize(150, false)).toBe(100);
      });

      it('should allow valid limits under max', () => {
        expect(validatePageSize(50, false)).toBe(50);
      });

      it('should enforce minimum of 1', () => {
        expect(validatePageSize(0, false)).toBe(1);
        expect(validatePageSize(-10, false)).toBe(1);
      });

      it('should parse string numbers', () => {
        expect(validatePageSize('50', false)).toBe(50);
      });

      it('should default to 20 for invalid strings', () => {
        expect(validatePageSize('invalid', false)).toBe(20);
      });
    });

    describe('validatePageSize() - Admin Users', () => {
      it('should cap at 500 for admin users', () => {
        expect(validatePageSize(600, true)).toBe(500);
      });

      it('should allow limits up to 500', () => {
        expect(validatePageSize(500, true)).toBe(500);
      });

      it('should enforce minimum of 1 for admin', () => {
        expect(validatePageSize(0, true)).toBe(1);
      });

      it('should default to 20 for admin when invalid', () => {
        expect(validatePageSize('invalid', true)).toBe(20);
      });
    });

  });

  // ========== Q64 TESTS ==========

  describe('Q64: Sorting Options', () => {

    describe('isValidSortField()', () => {
      it('should accept valid field names', () => {
        expect(isValidSortField('createdAt')).toBe(true);
        expect(isValidSortField('id')).toBe(true);
        expect(isValidSortField('title')).toBe(true);
        expect(isValidSortField('_count')).toBe(true);
      });

      it('should reject injection attempts', () => {
        expect(isValidSortField('id; DROP TABLE')).toBe(false);
        expect(isValidSortField('id,createdAt')).toBe(false);
        expect(isValidSortField('id--')).toBe(false);
      });

      it('should reject field names starting with numbers', () => {
        expect(isValidSortField('1field')).toBe(false);
      });

      it('should validate against whitelist if provided', () => {
        const whitelist = ['id', 'name', 'createdAt'];
        expect(isValidSortField('id', whitelist)).toBe(true);
        expect(isValidSortField('name', whitelist)).toBe(true);
        expect(isValidSortField('email', whitelist)).toBe(false);
      });
    });

    describe('validateSortParams()', () => {
      it('should return null for empty sort param', () => {
        expect(validateSortParams('', '', [])).toBeNull();
        expect(validateSortParams(null, null, [])).toBeNull();
      });

      it('should handle single column sort', () => {
        const result = validateSortParams('createdAt', 'desc', ['createdAt', 'id']);
        expect(result).toEqual({ createdAt: 'desc' });
      });

      it('should default to ascending when no order provided', () => {
        const result = validateSortParams('createdAt', '', ['createdAt']);
        expect(result).toEqual({ createdAt: 'asc' });
      });

      it('should handle multi-column sort', () => {
        const result = validateSortParams(
          'status,createdAt',
          'asc,desc',
          ['status', 'createdAt', 'id']
        );
        expect(result).toEqual({
          status: 'asc',
          createdAt: 'desc',
        });
      });

      it('should pad missing orders with asc', () => {
        const result = validateSortParams(
          'status,createdAt,id',
          'desc',
          ['status', 'createdAt', 'id']
        );
        expect(result).toEqual({
          status: 'desc',
          createdAt: 'asc',
          id: 'asc',
        });
      });

      it('should reject invalid fields not in whitelist', () => {
        const result = validateSortParams(
          'password',
          'asc',
          ['id', 'name']
        );
        expect(result).toBeNull();
      });

      it('should reject invalid sort directions', () => {
        const result = validateSortParams(
          'createdAt',
          'invalid',
          ['createdAt']
        );
        expect(result).toBeNull();
      });

      it('should trim whitespace', () => {
        const result = validateSortParams(
          ' id , createdAt ',
          ' asc , desc ',
          ['id', 'createdAt']
        );
        expect(result).toEqual({
          id: 'asc',
          createdAt: 'desc',
        });
      });
    });

    describe('getSortableFields()', () => {
      it('should return sortable fields for known routes', () => {
        const fields = getSortableFields('GET /projects');
        expect(Array.isArray(fields)).toBe(true);
        expect(fields.length).toBeGreaterThan(0);
        expect(fields).toContain('id');
        expect(fields).toContain('createdAt');
      });

      it('should return empty array for unknown routes', () => {
        const fields = getSortableFields('GET /unknown-route');
        expect(fields).toEqual([]);
      });

      it('should prevent sorting on detail endpoints', () => {
        // Detail endpoints typically don't have pagination
        const fields = getSortableFields('GET /projects/:id');
        expect(fields).toEqual([]);
      });
    });

  });

  // ========== INTEGRATION TESTS ==========

  describe('buildPaginationQuery()', () => {
    it('should build complete pagination query with defaults', () => {
      const result = buildPaginationQuery({
        page: 1,
        limit: 20,
        isAdmin: false,
      });

      expect(result).toHaveProperty('take', 20);
      expect(result).toHaveProperty('skip', 0);
      expect(result).not.toHaveProperty('orderBy');
    });

    it('should apply default ordering when no sort provided', () => {
      const result = buildPaginationQuery({
        page: 1,
        limit: 20,
        defaultOrder: { createdAt: 'desc' },
      });

      expect(result.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('should apply custom sorting when provided', () => {
      const result = buildPaginationQuery({
        page: 1,
        limit: 20,
        sortParam: 'title',
        orderParam: 'asc',
        allowedFields: ['title', 'id'],
        defaultOrder: { createdAt: 'desc' },
      });

      expect(result.orderBy).toEqual({ title: 'asc' });
    });

    it('should handle pagination correctly', () => {
      const result = buildPaginationQuery({
        page: 3,
        limit: 25,
      });

      expect(result.take).toBe(25);
      expect(result.skip).toBe(50); // (3-1) * 25
    });

    it('should enforce max page size for regular users', () => {
      const result = buildPaginationQuery({
        page: 1,
        limit: 200,
        isAdmin: false,
      });

      expect(result.take).toBe(100);
    });

    it('should enforce max page size for admin users', () => {
      const result = buildPaginationQuery({
        page: 1,
        limit: 600,
        isAdmin: true,
      });

      expect(result.take).toBe(500);
    });

    it('should build multi-column sort', () => {
      const result = buildPaginationQuery({
        page: 1,
        limit: 20,
        sortParam: 'status,createdAt',
        orderParam: 'asc,desc',
        allowedFields: ['status', 'createdAt', 'id'],
      });

      expect(result.orderBy).toEqual({
        status: 'asc',
        createdAt: 'desc',
      });
    });
  });

  // ========== SECURITY TESTS ==========

  describe('Security', () => {
    it('should prevent injection via sort parameter', () => {
      const result = validateSortParams(
        "id; DROP TABLE projects; --",
        'asc',
        ['id']
      );
      expect(result).toBeNull();
    });

    it('should prevent comma injection in sort', () => {
      const result = validateSortParams(
        "id,createdAt; DROP TABLE",
        'asc,desc',
        ['id', 'createdAt']
      );
      expect(result).toBeNull();
    });

    it('should only allow whitelisted fields', () => {
      const result = validateSortParams(
        'password',
        'asc',
        ['id', 'name', 'email']
      );
      expect(result).toBeNull();
    });

    it('should handle edge cases in field validation', () => {
      // Empty string field
      expect(isValidSortField('')).toBe(false);
      // Special characters
      expect(isValidSortField('field$')).toBe(false);
      expect(isValidSortField('field-name')).toBe(false);
      expect(isValidSortField('field name')).toBe(false);
    });
  });

});
