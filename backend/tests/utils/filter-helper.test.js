/**
 * Tests unitaires pour utils/filter-helper.js
 * Couvre : validateFilters, applyFilters, et les 5 fonctions apply* spécialisées
 */

jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  validateFilters,
  applyFilters,
  applyProfessionalFilters,
  applyPackageFilters,
  applyPortfolioFilters,
  applyProjectFilters,
  applyReviewFilters,
  FILTER_WHITELIST,
} = require('../../utils/filter-helper');

describe('FilterHelper', () => {
  // ---------------------------------------------------------------------------
  describe('FILTER_WHITELIST', () => {
    it('should export a non-empty whitelist', () => {
      expect(FILTER_WHITELIST).toBeDefined();
      expect(typeof FILTER_WHITELIST).toBe('object');
      expect(Object.keys(FILTER_WHITELIST).length).toBeGreaterThan(0);
    });

    it('should include the professionals endpoint', () => {
      expect(FILTER_WHITELIST.professionals).toEqual(
        expect.arrayContaining(['minRating', 'maxRating', 'minPrice', 'maxPrice', 'city', 'verifiedOnly'])
      );
    });

    it('should include the reviews endpoint', () => {
      expect(FILTER_WHITELIST.reviews).toEqual(
        expect.arrayContaining(['minRating', 'maxRating'])
      );
    });

    it('should include packages, portfolio and projects endpoints', () => {
      expect(FILTER_WHITELIST.packages).toBeDefined();
      expect(FILTER_WHITELIST.portfolio).toBeDefined();
      expect(FILTER_WHITELIST.projects).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  describe('validateFilters', () => {
    describe('unknown / missing endpoint', () => {
      it('returns empty validated and no errors for unknown endpoint', () => {
        const result = validateFilters('nonExistentEndpoint', { city: 'Paris' });
        expect(result.validated).toEqual({});
        expect(result.errors).toEqual([]);
      });

      it('returns empty validated when rawFilters is omitted', () => {
        const result = validateFilters('professionals');
        expect(result.validated).toEqual({});
        expect(result.errors).toEqual([]);
      });

      it('returns empty validated and no errors for empty rawFilters', () => {
        const result = validateFilters('professionals', {});
        expect(result.validated).toEqual({});
        expect(result.errors).toEqual([]);
      });
    });

    describe('professionals – minRating / maxRating', () => {
      it('validates minRating in [0, 5]', () => {
        const result = validateFilters('professionals', { minRating: '3' });
        expect(result.validated.minRating).toBe(3);
        expect(result.errors).toHaveLength(0);
      });

      it('validates maxRating = 5 (boundary)', () => {
        const result = validateFilters('professionals', { maxRating: '5' });
        expect(result.validated.maxRating).toBe(5);
      });

      it('validates minRating = 0 (boundary)', () => {
        const result = validateFilters('professionals', { minRating: '0' });
        expect(result.validated.minRating).toBe(0);
      });

      it('rejects minRating > 5', () => {
        const result = validateFilters('professionals', { minRating: '6' });
        expect(result.validated.minRating).toBeUndefined();
        expect(result.errors).toHaveLength(1);
      });

      it('rejects minRating < 0', () => {
        const result = validateFilters('professionals', { minRating: '-1' });
        expect(result.validated.minRating).toBeUndefined();
        expect(result.errors).toHaveLength(1);
      });

      it('rejects non-numeric minRating', () => {
        const result = validateFilters('professionals', { minRating: 'abc' });
        expect(result.validated.minRating).toBeUndefined();
        expect(result.errors).toHaveLength(1);
      });
    });

    describe('professionals – minPrice / maxPrice', () => {
      it('validates minPrice >= 0', () => {
        const result = validateFilters('professionals', { minPrice: '50' });
        expect(result.validated.minPrice).toBe(50);
      });

      it('validates minPrice = 0 (boundary)', () => {
        const result = validateFilters('professionals', { minPrice: '0' });
        expect(result.validated.minPrice).toBe(0);
      });

      it('rejects minPrice < 0', () => {
        const result = validateFilters('professionals', { minPrice: '-10' });
        expect(result.validated.minPrice).toBeUndefined();
        expect(result.errors).toHaveLength(1);
      });
    });

    describe('professionals – city', () => {
      it('validates city with 2–100 chars', () => {
        const result = validateFilters('professionals', { city: 'Paris' });
        expect(result.validated.city).toBe('Paris');
      });

      it('validates minimum-length city (2 chars)', () => {
        const result = validateFilters('professionals', { city: 'AB' });
        expect(result.validated.city).toBe('AB');
      });

      it('rejects city with 1 char', () => {
        const result = validateFilters('professionals', { city: 'A' });
        expect(result.validated.city).toBeUndefined();
        expect(result.errors).toHaveLength(1);
      });

      it('rejects city longer than 100 chars', () => {
        const result = validateFilters('professionals', { city: 'A'.repeat(101) });
        expect(result.validated.city).toBeUndefined();
        expect(result.errors).toHaveLength(1);
      });
    });

    describe('professionals – verifiedOnly', () => {
      it('validates verifiedOnly="true" string', () => {
        const result = validateFilters('professionals', { verifiedOnly: 'true' });
        expect(result.validated.verifiedOnly).toBe(true);
      });

      it('validates verifiedOnly="false" string', () => {
        const result = validateFilters('professionals', { verifiedOnly: 'false' });
        expect(result.validated.verifiedOnly).toBe(false);
      });

      it('validates verifiedOnly=true boolean', () => {
        const result = validateFilters('professionals', { verifiedOnly: true });
        expect(result.validated.verifiedOnly).toBe(true);
      });

      it('validates verifiedOnly=false boolean', () => {
        const result = validateFilters('professionals', { verifiedOnly: false });
        expect(result.validated.verifiedOnly).toBe(false);
      });

      it('rejects verifiedOnly invalid value', () => {
        const result = validateFilters('professionals', { verifiedOnly: 'maybe' });
        expect(result.validated.verifiedOnly).toBeUndefined();
        expect(result.errors).toHaveLength(1);
      });
    });

    describe('professionals – whitelist enforcement', () => {
      it('rejects filters not in whitelist', () => {
        const result = validateFilters('professionals', { unknownFilter: 'value' });
        expect(result.validated.unknownFilter).toBeUndefined();
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('non autorisé');
      });

      it('handles multiple valid filters simultaneously', () => {
        const result = validateFilters('professionals', {
          minRating: '2',
          maxRating: '4',
          city: 'Lyon',
          verifiedOnly: 'true',
        });
        expect(result.validated).toEqual({
          minRating: 2,
          maxRating: 4,
          city: 'Lyon',
          verifiedOnly: true,
        });
        expect(result.errors).toHaveLength(0);
      });

      it('accumulates multiple errors independently', () => {
        const result = validateFilters('professionals', {
          minRating: '99',
          unknownFilter: 'x',
        });
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('reviews endpoint', () => {
      it('validates minRating and maxRating', () => {
        const result = validateFilters('reviews', { minRating: '1', maxRating: '5' });
        expect(result.validated.minRating).toBe(1);
        expect(result.validated.maxRating).toBe(5);
      });

      it('rejects city filter not in reviews whitelist', () => {
        const result = validateFilters('reviews', { city: 'Paris' });
        expect(result.validated.city).toBeUndefined();
        expect(result.errors).toHaveLength(1);
      });
    });

    describe('packages endpoint', () => {
      it('validates minPrice, maxPrice, category', () => {
        const result = validateFilters('packages', {
          minPrice: '10',
          maxPrice: '200',
          category: 'Plomberie',
        });
        expect(result.validated.minPrice).toBe(10);
        expect(result.validated.maxPrice).toBe(200);
        expect(result.validated.category).toBe('Plomberie');
      });
    });

    describe('projects endpoint', () => {
      it('validates city, minBudget, maxBudget, category', () => {
        const result = validateFilters('projects', {
          city: 'Marseille',
          minBudget: '500',
          maxBudget: '5000',
          category: 'Rénovation',
        });
        expect(result.validated.city).toBe('Marseille');
        expect(result.validated.minBudget).toBe(500);
        expect(result.validated.maxBudget).toBe(5000);
        expect(result.validated.category).toBe('Rénovation');
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('applyProfessionalFilters', () => {
    it('returns where unchanged when filters is empty', () => {
      const where = { active: true };
      expect(applyProfessionalFilters(where, {})).toEqual({ active: true });
    });

    it('returns where unchanged when filters is null', () => {
      const where = { active: true };
      expect(applyProfessionalFilters(where, null)).toEqual({ active: true });
    });

    it('applies minRating → averageRating.gte', () => {
      const result = applyProfessionalFilters({}, { minRating: 3 });
      expect(result.averageRating).toEqual({ gte: 3 });
    });

    it('applies maxRating → averageRating.lte', () => {
      const result = applyProfessionalFilters({}, { maxRating: 4 });
      expect(result.averageRating).toEqual({ lte: 4 });
    });

    it('applies both minRating and maxRating', () => {
      const result = applyProfessionalFilters({}, { minRating: 2, maxRating: 5 });
      expect(result.averageRating.gte).toBe(2);
      expect(result.averageRating.lte).toBe(5);
    });

    it('applies city filter through user.city with insensitive mode', () => {
      const result = applyProfessionalFilters({}, { city: 'Paris' });
      expect(result.user.city).toEqual({ contains: 'Paris', mode: 'insensitive' });
    });

    it('applies verifiedOnly=true → verifiedByAdmin=true', () => {
      const result = applyProfessionalFilters({}, { verifiedOnly: true });
      expect(result.verifiedByAdmin).toBe(true);
    });

    it('does NOT set verifiedByAdmin when verifiedOnly is false', () => {
      const result = applyProfessionalFilters({}, { verifiedOnly: false });
      expect(result.verifiedByAdmin).toBeUndefined();
    });

    it('applies minPrice via subscription.OR', () => {
      const result = applyProfessionalFilters({}, { minPrice: 50 });
      expect(result.subscription.OR).toEqual(
        expect.arrayContaining([{ monthlyPrice: { gte: 50 } }])
      );
    });

    it('applies maxPrice via subscription.OR', () => {
      const result = applyProfessionalFilters({}, { maxPrice: 200 });
      expect(result.subscription.OR).toEqual(
        expect.arrayContaining([{ monthlyPrice: { lte: 200 } }])
      );
    });

    it('preserves existing where properties', () => {
      const where = { status: 'ACTIVE' };
      const result = applyProfessionalFilters(where, { verifiedOnly: true });
      expect(result.status).toBe('ACTIVE');
      expect(result.verifiedByAdmin).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('applyPackageFilters', () => {
    it('returns where unchanged when filters is empty', () => {
      const where = { isActive: true };
      expect(applyPackageFilters(where, {})).toEqual({ isActive: true });
    });

    it('returns where unchanged when filters is null', () => {
      expect(applyPackageFilters({ x: 1 }, null)).toEqual({ x: 1 });
    });

    it('applies minPrice and maxPrice to price field', () => {
      const result = applyPackageFilters({}, { minPrice: 20, maxPrice: 150 });
      expect(result.price).toEqual({ gte: 20, lte: 150 });
    });

    it('applies only minPrice when maxPrice is absent', () => {
      const result = applyPackageFilters({}, { minPrice: 30 });
      expect(result.price.gte).toBe(30);
      expect(result.price.lte).toBeUndefined();
    });

    it('applies category filter with insensitive mode', () => {
      const result = applyPackageFilters({}, { category: 'Menuiserie' });
      expect(result.category).toEqual({ contains: 'Menuiserie', mode: 'insensitive' });
    });

    it('applies verifiedOnly via professional.verifiedByAdmin', () => {
      const result = applyPackageFilters({}, { verifiedOnly: true });
      expect(result.professional.verifiedByAdmin).toBe(true);
    });

    it('does NOT set professional.verifiedByAdmin when verifiedOnly is false', () => {
      const result = applyPackageFilters({}, { verifiedOnly: false });
      expect(result.professional).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  describe('applyPortfolioFilters', () => {
    it('returns where unchanged when filters is empty', () => {
      expect(applyPortfolioFilters({}, {})).toEqual({});
    });

    it('returns where unchanged when filters is null', () => {
      expect(applyPortfolioFilters({ vis: true }, null)).toEqual({ vis: true });
    });

    it('applies city filter through professional.user.city', () => {
      const result = applyPortfolioFilters({}, { city: 'Nice' });
      expect(result.professional.user.city).toEqual({ contains: 'Nice', mode: 'insensitive' });
    });

    it('applies category filter via tradeCategory', () => {
      const result = applyPortfolioFilters({}, { category: 'Peinture' });
      expect(result.tradeCategory).toEqual({ contains: 'Peinture', mode: 'insensitive' });
    });

    it('applies both city and category together', () => {
      const result = applyPortfolioFilters({}, { city: 'Bordeaux', category: 'Carrelage' });
      expect(result.professional.user.city.contains).toBe('Bordeaux');
      expect(result.tradeCategory.contains).toBe('Carrelage');
    });
  });

  // ---------------------------------------------------------------------------
  describe('applyProjectFilters', () => {
    it('returns where unchanged when filters is empty', () => {
      expect(applyProjectFilters({ status: 'OPEN' }, {})).toEqual({ status: 'OPEN' });
    });

    it('returns where unchanged when filters is null', () => {
      expect(applyProjectFilters({ status: 'OPEN' }, null)).toEqual({ status: 'OPEN' });
    });

    it('applies city via location field', () => {
      const result = applyProjectFilters({}, { city: 'Toulouse' });
      expect(result.location).toEqual({ contains: 'Toulouse', mode: 'insensitive' });
    });

    it('applies minBudget and maxBudget', () => {
      const result = applyProjectFilters({}, { minBudget: 1000, maxBudget: 5000 });
      expect(result.budget).toEqual({ gte: 1000, lte: 5000 });
    });

    it('applies only minBudget when maxBudget is absent', () => {
      const result = applyProjectFilters({}, { minBudget: 500 });
      expect(result.budget.gte).toBe(500);
      expect(result.budget.lte).toBeUndefined();
    });

    it('applies category filter', () => {
      const result = applyProjectFilters({}, { category: 'Toiture' });
      expect(result.category).toEqual({ contains: 'Toiture', mode: 'insensitive' });
    });
  });

  // ---------------------------------------------------------------------------
  describe('applyReviewFilters', () => {
    it('returns where unchanged when filters is empty', () => {
      expect(applyReviewFilters({}, {})).toEqual({});
    });

    it('returns where unchanged when filters is null', () => {
      expect(applyReviewFilters({ vis: true }, null)).toEqual({ vis: true });
    });

    it('applies minRating → rating.gte', () => {
      const result = applyReviewFilters({}, { minRating: 3 });
      expect(result.rating.gte).toBe(3);
    });

    it('applies maxRating → rating.lte', () => {
      const result = applyReviewFilters({}, { maxRating: 5 });
      expect(result.rating.lte).toBe(5);
    });

    it('applies both minRating and maxRating', () => {
      const result = applyReviewFilters({}, { minRating: 2, maxRating: 4 });
      expect(result.rating).toEqual({ gte: 2, lte: 4 });
    });
  });

  // ---------------------------------------------------------------------------
  describe('applyFilters (dispatcher)', () => {
    it('dispatches to applyProfessionalFilters', () => {
      const result = applyFilters('professionals', {}, { minRating: 4 });
      expect(result.averageRating).toBeDefined();
    });

    it('dispatches to applyPackageFilters', () => {
      const result = applyFilters('packages', {}, { minPrice: 50 });
      expect(result.price).toBeDefined();
    });

    it('dispatches to applyPortfolioFilters', () => {
      const result = applyFilters('portfolio', {}, { city: 'Paris' });
      expect(result.professional).toBeDefined();
    });

    it('dispatches to applyProjectFilters', () => {
      const result = applyFilters('projects', {}, { city: 'Paris' });
      expect(result.location).toBeDefined();
    });

    it('dispatches to applyReviewFilters', () => {
      const result = applyFilters('reviews', {}, { minRating: 3 });
      expect(result.rating).toBeDefined();
    });

    it('returns where unchanged for unknown endpoint', () => {
      const where = { active: true };
      const result = applyFilters('unknownEndpoint', where, { city: 'Paris' });
      expect(result).toEqual({ active: true });
    });
  });
});
