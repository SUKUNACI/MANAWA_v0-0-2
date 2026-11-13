/**
 * Tests unitaires pour utils/aggregation-helper.js
 * Toutes les fonctions font des requêtes DB (Prisma) → mock via config/__mocks__/db.js
 */

jest.mock('../../config/db');

const prisma = require('../../config/db');
const {
  getFacetedCounts,
  getDistributionStats,
  getPriceDistributionStats,
  getReviewDistributionStats,
  getQuoteBookingStats,
} = require('../../utils/aggregation-helper');

// Helpers de construction de pros fictifs
function makePro(overrides = {}) {
  return {
    id: 'pro-1',
    trade: 'Plomberie',
    trades: [],
    hourlyRate: 80,
    averageRating: 4.5,
    user: { city: 'Paris' },
    ...overrides,
  };
}

describe('AggregationHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  describe('getFacetedCounts', () => {
    it('returns facets structure for empty professional list', async () => {
      prisma.professional.findMany.mockResolvedValue([]);

      const result = await getFacetedCounts();

      expect(result).toHaveProperty('locations');
      expect(result).toHaveProperty('trades');
      expect(result).toHaveProperty('ratings');
      expect(result).toHaveProperty('priceRanges');
      expect(result).toHaveProperty('total');
      expect(result.total).toBe(0);
    });

    it('counts total professionals correctly', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ id: 'pro-1' }),
        makePro({ id: 'pro-2' }),
      ]);

      const result = await getFacetedCounts();
      expect(result.total).toBe(2);
    });

    it('accumulates location facets', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ user: { city: 'Paris' } }),
        makePro({ user: { city: 'Paris' } }),
        makePro({ user: { city: 'Lyon' } }),
      ]);

      const result = await getFacetedCounts();
      expect(result.locations['Paris']).toBe(2);
      expect(result.locations['Lyon']).toBe(1);
    });

    it('skips location when city is null', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ user: { city: null } }),
      ]);

      const result = await getFacetedCounts();
      expect(Object.keys(result.locations)).toHaveLength(0);
    });

    it('skips location when user is null', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ user: null }),
      ]);

      const result = await getFacetedCounts();
      expect(Object.keys(result.locations)).toHaveLength(0);
    });

    it('accumulates trade facets from primary trade', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ trade: 'Plomberie', trades: [] }),
        makePro({ trade: 'Plomberie', trades: [] }),
        makePro({ trade: 'Électricité', trades: [] }),
      ]);

      const result = await getFacetedCounts();
      expect(result.trades['Plomberie']).toBe(2);
      expect(result.trades['Électricité']).toBe(1);
    });

    it('accumulates trade facets from secondary trades array', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ trade: 'Plomberie', trades: ['Carrelage', 'Peinture'] }),
      ]);

      const result = await getFacetedCounts();
      expect(result.trades['Carrelage']).toBe(1);
      expect(result.trades['Peinture']).toBe(1);
    });

    it('handles pro with no trade (null)', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ trade: null, trades: [] }),
      ]);

      const result = await getFacetedCounts();
      // null trade should not appear in facets
      expect(result.trades[null]).toBeUndefined();
    });

    it('accumulates rating facets correctly (rounded)', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ averageRating: 4.6 }),  // rounds to 5
        makePro({ averageRating: 3.3 }),  // rounds to 3
        makePro({ averageRating: 0 }),     // 0
      ]);

      const result = await getFacetedCounts();
      expect(result.ratings['5']).toBe(1);
      expect(result.ratings['3']).toBe(1);
      expect(result.ratings['0']).toBe(1);
    });

    it('handles undefined averageRating (defaults to 0)', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ averageRating: undefined }),
      ]);

      const result = await getFacetedCounts();
      expect(result.ratings['0']).toBe(1);
    });

    it('accumulates priceRanges: under-50', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ hourlyRate: 30 }),
        makePro({ hourlyRate: 0 }),
      ]);

      const result = await getFacetedCounts();
      expect(result.priceRanges['under-50']).toBe(2);
    });

    it('accumulates priceRanges: 50-100', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ hourlyRate: 75 }),
      ]);
      const result = await getFacetedCounts();
      expect(result.priceRanges['50-100']).toBe(1);
    });

    it('accumulates priceRanges: 100-200', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ hourlyRate: 150 }),
      ]);
      const result = await getFacetedCounts();
      expect(result.priceRanges['100-200']).toBe(1);
    });

    it('accumulates priceRanges: 200-500', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ hourlyRate: 350 }),
      ]);
      const result = await getFacetedCounts();
      expect(result.priceRanges['200-500']).toBe(1);
    });

    it('accumulates priceRanges: over-500', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ hourlyRate: 600 }),
      ]);
      const result = await getFacetedCounts();
      expect(result.priceRanges['over-500']).toBe(1);
    });

    it('handles null hourlyRate (defaults to 0, under-50)', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ hourlyRate: null }),
      ]);
      const result = await getFacetedCounts();
      expect(result.priceRanges['under-50']).toBe(1);
    });

    it('sorts locations by count descending', async () => {
      prisma.professional.findMany.mockResolvedValue([
        makePro({ user: { city: 'Lyon' } }),
        makePro({ user: { city: 'Paris' } }),
        makePro({ user: { city: 'Paris' } }),
        makePro({ user: { city: 'Paris' } }),
      ]);

      const result = await getFacetedCounts();
      const cities = Object.keys(result.locations);
      expect(cities[0]).toBe('Paris');
      expect(cities[1]).toBe('Lyon');
    });

    it('passes search query in where when q is provided', async () => {
      prisma.professional.findMany.mockResolvedValue([]);
      await getFacetedCounts({ q: 'plombier' });
      const callArg = prisma.professional.findMany.mock.calls[0][0];
      expect(callArg.where.OR).toBeDefined();
    });

    it('throws and propagates errors from prisma', async () => {
      prisma.professional.findMany.mockRejectedValue(new Error('DB error'));
      await expect(getFacetedCounts()).rejects.toThrow('DB error');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getDistributionStats', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([]);
    });

    it('returns object with byTrade, byLocation, byVerification, bySubscription', async () => {
      const result = await getDistributionStats();
      expect(result).toHaveProperty('byTrade');
      expect(result).toHaveProperty('byLocation');
      expect(result).toHaveProperty('byVerification');
      expect(result).toHaveProperty('bySubscription');
    });

    it('queries prisma.$queryRaw multiple times', async () => {
      await getDistributionStats();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    });

    it('returns empty arrays when db returns nothing', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await getDistributionStats();
      expect(result.byTrade).toEqual([]);
      expect(result.byLocation).toEqual([]);
    });

    it('throws and propagates errors from prisma', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('Raw query failed'));
      await expect(getDistributionStats()).rejects.toThrow('Raw query failed');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getPriceDistributionStats', () => {
    beforeEach(() => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total_professionals: 100, mean_price: 85.5 }])
        .mockResolvedValueOnce([{ price_range: '50-100', count: 30, avg_in_range: 75 }]);
    });

    it('returns summary and distribution fields', async () => {
      const result = await getPriceDistributionStats();
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('distribution');
    });

    it('summary is first element of first query result', async () => {
      const result = await getPriceDistributionStats();
      expect(result.summary.total_professionals).toBe(100);
    });

    it('distribution contains price buckets from second query', async () => {
      const result = await getPriceDistributionStats();
      expect(result.distribution[0].price_range).toBe('50-100');
    });

    it('queries prisma.$queryRaw exactly twice', async () => {
      await getPriceDistributionStats();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('throws and propagates errors', async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockRejectedValue(new Error('stats error'));
      await expect(getPriceDistributionStats()).rejects.toThrow('stats error');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getReviewDistributionStats', () => {
    beforeEach(() => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ rating: 5, count: 20, percentage: 40 }])
        .mockResolvedValueOnce([{ trade: 'Plomberie', avg_rating: 4.2, total_reviews: 10 }])
        .mockResolvedValueOnce([{ id: 'pro-1', rating: 4.9, reviewCount: 50 }]);
    });

    it('returns ratingDistribution, ratingByTrade, topRated', async () => {
      const result = await getReviewDistributionStats();
      expect(result).toHaveProperty('ratingDistribution');
      expect(result).toHaveProperty('ratingByTrade');
      expect(result).toHaveProperty('topRated');
    });

    it('ratingDistribution contains rating rows', async () => {
      const result = await getReviewDistributionStats();
      expect(result.ratingDistribution[0].rating).toBe(5);
    });

    it('ratingByTrade contains trade rows', async () => {
      const result = await getReviewDistributionStats();
      expect(result.ratingByTrade[0].trade).toBe('Plomberie');
    });

    it('queries prisma.$queryRaw exactly three times', async () => {
      await getReviewDistributionStats();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it('throws and propagates errors', async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockRejectedValue(new Error('review stats error'));
      await expect(getReviewDistributionStats()).rejects.toThrow('review stats error');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getQuoteBookingStats', () => {
    beforeEach(() => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ status: 'ACCEPTED', count: 10, avg_amount: 500 }])
        .mockResolvedValueOnce([{ status: 'CONFIRMED', count: 8 }])
        .mockResolvedValueOnce([{ total_quotes: 100, total_bookings: 20, conversion_rate: 20.0 }]);
    });

    it('returns quotes, bookings, conversion fields', async () => {
      const result = await getQuoteBookingStats();
      expect(result).toHaveProperty('quotes');
      expect(result).toHaveProperty('bookings');
      expect(result).toHaveProperty('conversion');
    });

    it('quotes contains quote status rows', async () => {
      const result = await getQuoteBookingStats();
      expect(result.quotes[0].status).toBe('ACCEPTED');
    });

    it('bookings contains booking status rows', async () => {
      const result = await getQuoteBookingStats();
      expect(result.bookings[0].status).toBe('CONFIRMED');
    });

    it('conversion is first element of conversion query', async () => {
      const result = await getQuoteBookingStats();
      expect(result.conversion.total_quotes).toBe(100);
      expect(result.conversion.conversion_rate).toBe(20.0);
    });

    it('queries prisma.$queryRaw exactly three times', async () => {
      await getQuoteBookingStats();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it('throws and propagates errors', async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockRejectedValue(new Error('quote stats error'));
      await expect(getQuoteBookingStats()).rejects.toThrow('quote stats error');
    });
  });
});
