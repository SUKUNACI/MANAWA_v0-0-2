/**
 * SearchGlobalModule Tests
 *
 * Tests the new SearchGlobalModule class that consolidates
 * global search logic and eliminates duplication
 */

const SearchGlobalModule = require('../../modules/search-global');

// Mock SearchModule
const mockSearchModule = {
  parseFiltersFromQuery: jest.fn((query) => {
    const filters = {};
    if (query.minRating) filters.minRating = query.minRating;
    if (query.maxRating) filters.maxRating = query.maxRating;
    return filters;
  }),
  searchGlobal: jest.fn(async (term, opts) => {
    return {
      query: term,
      results: { professionals: { hits: [] } },
      total: 0,
    };
  }),
  searchGlobalByType: jest.fn(async (type, term, opts) => {
    return {
      query: term,
      [type]: [],
      total: 0,
    };
  }),
};

// Mock prisma
const mockPrisma = {};

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
};

describe('SearchGlobalModule', () => {
  let module;

  beforeEach(() => {
    jest.clearAllMocks();
    module = new SearchGlobalModule(mockSearchModule, mockPrisma, mockLogger);
  });

  describe('constructor', () => {
    it('should throw if searchModule is missing', () => {
      expect(() => {
        new SearchGlobalModule(null, mockPrisma, mockLogger);
      }).toThrow('SearchGlobalModule: searchModule is required');
    });

    it('should initialize with all dependencies', () => {
      expect(module.searchModule).toBe(mockSearchModule);
      expect(module.prisma).toBe(mockPrisma);
      expect(module.logger).toBe(mockLogger);
    });
  });

  describe('parseFilters', () => {
    it('should delegate to searchModule.parseFiltersFromQuery', () => {
      const query = { minRating: 4, maxRating: 5 };
      const result = module.parseFilters(query);

      expect(mockSearchModule.parseFiltersFromQuery).toHaveBeenCalledWith(query);
      expect(result).toEqual({ minRating: 4, maxRating: 5 });
    });

    it('should handle filter parsing errors', () => {
      mockSearchModule.parseFiltersFromQuery.mockImplementation(() => {
        throw new Error('Parsing error');
      });

      expect(() => module.parseFilters({})).toThrow('Parsing error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[SearchGlobalModule] Filter parsing failed',
        expect.objectContaining({ error: 'Parsing error' })
      );
    });
  });

  describe('searchGlobal', () => {
    it('should search globally with valid term', async () => {
      const result = await module.searchGlobal('test', { limit: 10, offset: 0 });

      expect(mockSearchModule.searchGlobal).toHaveBeenCalledWith('test', {
        limit: 10,
        offset: 0,
        filters: {},
      });
      expect(result).toEqual({
        query: 'test',
        results: { professionals: { hits: [] } },
        total: 0,
      });
    });

    it('should reject term shorter than 2 characters', async () => {
      expect(async () => {
        await module.searchGlobal('a');
      }).rejects.toThrow('term must be at least 2 characters');
    });

    it('should reject non-string term', async () => {
      expect(async () => {
        await module.searchGlobal(123);
      }).rejects.toThrow('term must be a non-empty string');
    });

    it('should log debug info on search', async () => {
      await module.searchGlobal('test', { limit: 10, offset: 0 });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[SearchGlobalModule] Searching globally',
        expect.objectContaining({
          term: 'test',
          limit: 10,
          offset: 0,
        })
      );
    });

    it('should handle search errors', async () => {
      mockSearchModule.searchGlobal.mockImplementation(() => {
        throw new Error('Search failed');
      });

      expect(async () => {
        await module.searchGlobal('test');
      }).rejects.toThrow('Search failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[SearchGlobalModule] Global search failed',
        expect.objectContaining({ error: 'Search failed' })
      );
    });
  });

  describe('searchByType', () => {
    it('should search by valid type', async () => {
      const result = await module.searchByType('professionals', 'doctor', { limit: 10 });

      expect(mockSearchModule.searchGlobalByType).toHaveBeenCalledWith('professionals', 'doctor', {
        limit: 10,
        offset: 0,
        filters: {},
      });
      expect(result).toEqual({
        query: 'doctor',
        professionals: [],
        total: 0,
      });
    });

    it('should reject invalid type', async () => {
      expect(async () => {
        await module.searchByType('invalid_type', 'test');
      }).rejects.toThrow('invalid type "invalid_type"');
    });

    it('should reject missing type', async () => {
      expect(async () => {
        await module.searchByType(null, 'test');
      }).rejects.toThrow('type must be a non-empty string');
    });

    it('should accept all valid types', async () => {
      const validTypes = ['professionals', 'packages', 'portfolio', 'projects', 'reviews'];

      for (const type of validTypes) {
        const result = await module.searchByType(type, 'test');
        expect(result[type] || result.query).toBeDefined();
      }
    });
  });

  describe('validateSearchTerm', () => {
    it('should validate valid terms', () => {
      const result = module.validateSearchTerm('valid term');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject terms shorter than 2 characters', () => {
      const result = module.validateSearchTerm('a');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('term must be at least 2 characters');
    });

    it('should reject empty terms', () => {
      const result = module.validateSearchTerm('');
      expect(result.valid).toBe(false);
    });

    it('should reject non-string terms', () => {
      const result = module.validateSearchTerm(123);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('term must be a non-empty string');
    });

    it('should reject terms longer than 200 characters', () => {
      const longTerm = 'a'.repeat(201);
      const result = module.validateSearchTerm(longTerm);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('term must not exceed 200 characters');
    });
  });

  describe('validateType', () => {
    it('should validate valid types', () => {
      const validTypes = ['professionals', 'packages', 'portfolio', 'projects', 'reviews'];
      for (const type of validTypes) {
        const result = module.validateType(type);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('should reject invalid types', () => {
      const result = module.validateType('invalid');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be one of');
    });

    it('should reject empty types', () => {
      const result = module.validateType('');
      expect(result.valid).toBe(false);
    });
  });

  describe('validatePagination', () => {
    it('should validate valid pagination', () => {
      const result = module.validatePagination(10, 0);
      expect(result.valid).toBe(true);
      expect(result.clamped).toEqual({ limit: 10, offset: 0 });
    });

    it('should clamp excessive limit', () => {
      const result = module.validatePagination(100, 0);
      expect(result.clamped.limit).toBe(50);
    });

    it('should clamp negative offset', () => {
      const result = module.validatePagination(10, -5);
      expect(result.clamped.offset).toBe(0);
    });

    it('should handle undefined values with defaults', () => {
      const result = module.validatePagination(undefined, undefined);
      expect(result.clamped).toEqual({ limit: 10, offset: 0 });
    });
  });
});
