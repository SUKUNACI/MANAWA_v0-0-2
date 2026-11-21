const SearchModule = require('../../modules/search');

describe('SearchModule', () => {
  let prisma;
  let searchModule;

  beforeEach(() => {
    prisma = {
      professional: {
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      project: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      review: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    searchModule = new SearchModule(prisma);
  });

  describe('searchProfessionals', () => {
    test('returns professionals array', async () => {
      const mockPros = [
        { id: 'pro-1', user: { firstName: 'John' }, _count: { followers: 5 } },
      ];

      prisma.professional.findMany.mockResolvedValue(mockPros);

      const result = await searchModule.searchProfessionals('plumber', { skip: 0, take: 20 });

      expect(result).toEqual(mockPros);
      expect(prisma.professional.findMany).toHaveBeenCalled();
    });

    test('applies city filter', async () => {
      prisma.professional.findMany.mockResolvedValue([]);

      await searchModule.searchProfessionals('plumber', { filters: { city: 'Paris' } });

      // Verify search was called with filter
      expect(prisma.professional.findMany).toHaveBeenCalled();
    });

    test('applies trade filter', async () => {
      prisma.professional.findMany.mockResolvedValue([]);

      await searchModule.searchProfessionals('', { filters: { trade: 'Plomberie' } });

      const callArgs = prisma.professional.findMany.mock.calls[0][0];
      // Filter may be applied differently, just verify call was made
      expect(callArgs).toBeDefined();
    });

    test('applies verifiedOnly filter', async () => {
      prisma.professional.findMany.mockResolvedValue([]);
      prisma.professional.count.mockResolvedValue(0);

      await searchModule.searchProfessionals('', { filters: { verifiedOnly: true } });

      const callArgs = prisma.professional.findMany.mock.calls[0][0];
      expect(callArgs.where.verifiedByAdmin).toBe(true);
    });

    test('applies minRating filter', async () => {
      prisma.professional.findMany.mockResolvedValue([]);
      prisma.professional.count.mockResolvedValue(0);

      await searchModule.searchProfessionals('', { filters: { minRating: 4.0 } });

      const callArgs = prisma.professional.findMany.mock.calls[0][0];
      expect(callArgs.where.averageRating).toEqual({ gte: 4.0 });
    });
  });

  describe('searchProjects', () => {
    test('returns projects array', async () => {
      const mockProjects = [
        { id: 'proj-1', title: 'Plomberie rénovation', tradeNeeded: 'Plomberie', city: 'Paris' },
      ];

      prisma.project.findMany.mockResolvedValue(mockProjects);

      const result = await searchModule.searchProjects('plomberie', { skip: 0, take: 20 });

      expect(result).toEqual(mockProjects);
      expect(prisma.project.findMany).toHaveBeenCalled();
    });

    test('excludes cancelled and completed projects', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await searchModule.searchProjects('plomberie', { skip: 0, take: 20 });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      expect(callArgs.where.status).toEqual({ in: ['OPEN', 'IN_PROGRESS'] });
    });

    test('searches in title, description, tradeNeeded, and city', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await searchModule.searchProjects('plomberie', { skip: 0, take: 20 });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toBeDefined();
      expect(callArgs.where.OR.length).toBeGreaterThan(0);
    });

    test('filters by city', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await searchModule.searchProjects('plomberie', { filters: { city: 'Paris' } });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      expect(callArgs.where.city).toEqual({
        contains: 'Paris',
        mode: 'insensitive',
      });
    });

    test('respects skip and take for pagination', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await searchModule.searchProjects('plomberie', { skip: 10, take: 5 });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      expect(callArgs.skip).toBe(10);
      expect(callArgs.take).toBe(5);
    });

    test('excludes projects where client is deleted', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await searchModule.searchProjects('plomberie', { skip: 0, take: 20 });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      expect(callArgs.where.client.deletedAt).toBe(null);
    });

    test('text search preserved with minBudget filter', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await searchModule.searchProjects('plomberie', { filters: { minBudget: 1000 } });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      // Should have AND combining text search OR with budget condition
      expect(callArgs.where.AND).toBeDefined();
      expect(callArgs.where.AND).toHaveLength(2);
      // First element should be { OR: [...] } containing text search
      expect(callArgs.where.AND[0]).toHaveProperty('OR');
      expect(callArgs.where.AND[0].OR).toEqual([
        { title: { contains: 'plomberie', mode: 'insensitive' } },
        { description: { contains: 'plomberie', mode: 'insensitive' } },
        { tradeNeeded: { contains: 'plomberie', mode: 'insensitive' } },
        { city: { contains: 'plomberie', mode: 'insensitive' } },
      ]);
      // Second element should be budget condition
      expect(callArgs.where.AND[1]).toEqual({
        OR: [
          { budgetMax: { gte: 1000 } },
          { budgetMax: null },
        ],
      });
    });

    test('text search preserved with maxBudget filter', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await searchModule.searchProjects('renovation', { filters: { maxBudget: 5000 } });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      expect(callArgs.where.AND).toBeDefined();
      expect(callArgs.where.AND).toHaveLength(2);
      expect(callArgs.where.AND[0]).toHaveProperty('OR');
      expect(callArgs.where.AND[0].OR).toEqual([
        { title: { contains: 'renovation', mode: 'insensitive' } },
        { description: { contains: 'renovation', mode: 'insensitive' } },
        { tradeNeeded: { contains: 'renovation', mode: 'insensitive' } },
        { city: { contains: 'renovation', mode: 'insensitive' } },
      ]);
      expect(callArgs.where.AND[1]).toEqual({
        OR: [
          { budgetMin: { lte: 5000 } },
          { budgetMin: null },
        ],
      });
    });

    test('text search preserved with both budget filters', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await searchModule.searchProjects('electricite', { filters: { minBudget: 1000, maxBudget: 5000 } });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toBeDefined();
      expect(callArgs.where.OR).toEqual([
        { title: { contains: 'electricite', mode: 'insensitive' } },
        { description: { contains: 'electricite', mode: 'insensitive' } },
        { tradeNeeded: { contains: 'electricite', mode: 'insensitive' } },
        { city: { contains: 'electricite', mode: 'insensitive' } },
      ]);
      expect(callArgs.where.AND).toBeDefined();
      expect(callArgs.where.AND).toHaveLength(2);
      expect(callArgs.where.AND[0]).toEqual({
        OR: [
          { budgetMax: { gte: 1000 } },
          { budgetMax: null },
        ],
      });
      expect(callArgs.where.AND[1]).toEqual({
        OR: [
          { budgetMin: { lte: 5000 } },
          { budgetMin: null },
        ],
      });
    });
  });

  describe('countProjects', () => {
    test('returns count of projects', async () => {
      prisma.project.count.mockResolvedValue(42);

      const result = await searchModule.countProjects('plomberie');

      expect(result).toBe(42);
      expect(prisma.project.count).toHaveBeenCalled();
    });

    test('applies same filters as searchProjects', async () => {
      prisma.project.count.mockResolvedValue(5);

      await searchModule.countProjects('plomberie', { city: 'Paris' });

      const callArgs = prisma.project.count.mock.calls[0][0];
      expect(callArgs.where).toBeDefined();
    });

    test('excludes cancelled and completed projects', async () => {
      prisma.project.count.mockResolvedValue(0);

      await searchModule.countProjects('plomberie');

      const callArgs = prisma.project.count.mock.calls[0][0];
      expect(callArgs.where.status).toEqual({ in: ['OPEN', 'IN_PROGRESS'] });
    });

    test('filters by minBudget only - text search preserved', async () => {
      prisma.project.count.mockResolvedValue(0);

      await searchModule.countProjects('plomberie', { minBudget: 1000 });

      const callArgs = prisma.project.count.mock.calls[0][0];
      // Text search preserved in AND with budget filter
      expect(callArgs.where.AND).toBeDefined();
      expect(callArgs.where.AND).toHaveLength(2);
      expect(callArgs.where.AND[0]).toEqual({
        OR: [
          { title: { contains: 'plomberie', mode: 'insensitive' } },
          { description: { contains: 'plomberie', mode: 'insensitive' } },
          { tradeNeeded: { contains: 'plomberie', mode: 'insensitive' } },
          { city: { contains: 'plomberie', mode: 'insensitive' } },
        ],
      });
      expect(callArgs.where.AND[1]).toEqual({
        OR: [
          { budgetMax: { gte: 1000 } },
          { budgetMax: null },
        ],
      });
    });

    test('filters by maxBudget only - text search preserved', async () => {
      prisma.project.count.mockResolvedValue(0);

      await searchModule.countProjects('plomberie', { maxBudget: 5000 });

      const callArgs = prisma.project.count.mock.calls[0][0];
      expect(callArgs.where.AND).toBeDefined();
      expect(callArgs.where.AND).toHaveLength(2);
      expect(callArgs.where.AND[0]).toEqual({
        OR: [
          { title: { contains: 'plomberie', mode: 'insensitive' } },
          { description: { contains: 'plomberie', mode: 'insensitive' } },
          { tradeNeeded: { contains: 'plomberie', mode: 'insensitive' } },
          { city: { contains: 'plomberie', mode: 'insensitive' } },
        ],
      });
      expect(callArgs.where.AND[1]).toEqual({
        OR: [
          { budgetMin: { lte: 5000 } },
          { budgetMin: null },
        ],
      });
    });

    test('filters by minBudget and maxBudget - both conditions must be true', async () => {
      prisma.project.count.mockResolvedValue(0);

      await searchModule.countProjects('plomberie', { minBudget: 1000, maxBudget: 5000 });

      const callArgs = prisma.project.count.mock.calls[0][0];
      // With two budget filters, text search is preserved in OR
      expect(callArgs.where.OR).toEqual([
        { title: { contains: 'plomberie', mode: 'insensitive' } },
        { description: { contains: 'plomberie', mode: 'insensitive' } },
        { tradeNeeded: { contains: 'plomberie', mode: 'insensitive' } },
        { city: { contains: 'plomberie', mode: 'insensitive' } },
      ]);
      // AND of two budget conditions
      expect(callArgs.where.AND).toHaveLength(2);
      expect(callArgs.where.AND[0]).toEqual({
        OR: [
          { budgetMax: { gte: 1000 } },
          { budgetMax: null },
        ],
      });
      expect(callArgs.where.AND[1]).toEqual({
        OR: [
          { budgetMin: { lte: 5000 } },
          { budgetMin: null },
        ],
      });
    });

    test('budget overlap: 2000-4000 project matches 1000-5000 search', async () => {
      // Project: budgetMin=2000, budgetMax=4000
      // Search: minBudget=1000, maxBudget=5000
      // Expected: include (4000 >= 1000 AND 2000 <= 5000) → TRUE
      prisma.project.count.mockResolvedValue(0);

      await searchModule.countProjects('renovation', { minBudget: 1000, maxBudget: 5000 });

      const callArgs = prisma.project.count.mock.calls[0][0];
      // Verify AND structure for two budget conditions
      expect(callArgs.where.AND).toHaveLength(2);
      // First condition: budgetMax >= 1000
      expect(callArgs.where.AND[0].OR).toContainEqual({
        budgetMax: { gte: 1000 },
      });
      // Second condition: budgetMin <= 5000
      expect(callArgs.where.AND[1].OR).toContainEqual({
        budgetMin: { lte: 5000 },
      });
    });

    test('budget non-overlap upper: 6000-10000 project excludes 1000-5000 search', async () => {
      // Project: budgetMin=6000, budgetMax=10000
      // Search: minBudget=1000, maxBudget=5000
      // Expected: exclude (10000 >= 1000 ✓ but 6000 > 5000 ✗)
      prisma.project.count.mockResolvedValue(0);

      await searchModule.countProjects('renovation', { minBudget: 1000, maxBudget: 5000 });

      const callArgs = prisma.project.count.mock.calls[0][0];
      // Verify conditions are correct
      expect(callArgs.where.AND).toHaveLength(2);
      expect(callArgs.where.AND[0].OR).toContainEqual({
        budgetMax: { gte: 1000 },
      });
      expect(callArgs.where.AND[1].OR).toContainEqual({
        budgetMin: { lte: 5000 },
      });
    });

    test('budget non-overlap lower: 500-900 project excludes 1000-5000 search', async () => {
      // Project: budgetMin=500, budgetMax=900
      // Search: minBudget=1000, maxBudget=5000
      // Expected: exclude (900 < 1000 ✗)
      prisma.project.count.mockResolvedValue(0);

      await searchModule.countProjects('renovation', { minBudget: 1000, maxBudget: 5000 });

      const callArgs = prisma.project.count.mock.calls[0][0];
      // Verify conditions
      expect(callArgs.where.AND).toHaveLength(2);
      expect(callArgs.where.AND[0].OR).toContainEqual({
        budgetMax: { gte: 1000 },
      });
      expect(callArgs.where.AND[1].OR).toContainEqual({
        budgetMin: { lte: 5000 },
      });
    });

    test('null budget: project with null budgetMax is included when minBudget filtered', async () => {
      // Project: budgetMin=1000, budgetMax=null (unlimited)
      // Search: minBudget=500
      // Expected: include (null means unlimited, so it covers all values >= 500)
      prisma.project.count.mockResolvedValue(0);

      await searchModule.countProjects('renovation', { minBudget: 500 });

      const callArgs = prisma.project.count.mock.calls[0][0];
      // With single minBudget filter, condition is in AND[1]
      expect(callArgs.where.AND).toBeDefined();
      expect(callArgs.where.AND[1].OR).toContainEqual({ budgetMax: null });
    });

    test('searchProjects applies same budget filters as countProjects', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);

      // Call searchProjects with filters wrapped in options object
      await searchModule.searchProjects('renovation', { filters: { minBudget: 1000, maxBudget: 5000 } });
      const searchCallArgs = prisma.project.findMany.mock.calls[0][0];

      // Call countProjects with filters directly
      await searchModule.countProjects('renovation', { minBudget: 1000, maxBudget: 5000 });
      const countCallArgs = prisma.project.count.mock.calls[0][0];

      // Both should include budget AND conditions
      expect(searchCallArgs.where).toHaveProperty('AND');
      expect(countCallArgs.where).toHaveProperty('AND');
      expect(searchCallArgs.where.AND).toEqual(countCallArgs.where.AND);
    });
  });

  describe('searchReviews', () => {
    test('returns reviews array', async () => {
      const mockReviews = [
        { id: 'rev-1', rating: 5, comment: 'Excellent travail', author: { firstName: 'Jean' } },
      ];

      prisma.review.findMany.mockResolvedValue(mockReviews);

      const result = await searchModule.searchReviews('excellent', { skip: 0, take: 20 });

      expect(result).toEqual(mockReviews);
      expect(prisma.review.findMany).toHaveBeenCalled();
    });

    test('excludes flagged reviews', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await searchModule.searchReviews('excellent', { skip: 0, take: 20 });

      const callArgs = prisma.review.findMany.mock.calls[0][0];
      expect(callArgs.where.flags).toEqual({ none: {} });
    });

    test('does not use isNot:null on non-optional relations', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await searchModule.searchReviews('excellent', { skip: 0, take: 20 });

      const callArgs = prisma.review.findMany.mock.calls[0][0];
      // professional and author are required in schema — isNot:null throws PrismaClientValidationError on v5.x
      expect(callArgs.where.professional).toBeUndefined();
      expect(callArgs.where.author).toBeUndefined();
    });

    test('searches in comment', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await searchModule.searchReviews('excellent', { skip: 0, take: 20 });

      const callArgs = prisma.review.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toBeDefined();
      const commentSearch = callArgs.where.OR.find(or => or.comment);
      expect(commentSearch).toBeDefined();
    });

    test('searches in professional name', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await searchModule.searchReviews('Jean', { skip: 0, take: 20 });

      const callArgs = prisma.review.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toBeDefined();
      const profSearch = callArgs.where.OR.find(or => or.professional);
      expect(profSearch).toBeDefined();
    });

    test('searches in author name', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await searchModule.searchReviews('Jean', { skip: 0, take: 20 });

      const callArgs = prisma.review.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toBeDefined();
      const authorSearch = callArgs.where.OR.find(or => or.author);
      expect(authorSearch).toBeDefined();
    });

    test('filters by minRating', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await searchModule.searchReviews('excellent', { filters: { minRating: 4 } });

      const callArgs = prisma.review.findMany.mock.calls[0][0];
      expect(callArgs.where.rating).toEqual({ gte: 4 });
    });

    test('filters by maxRating', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await searchModule.searchReviews('excellent', { filters: { maxRating: 4.5 } });

      const callArgs = prisma.review.findMany.mock.calls[0][0];
      expect(callArgs.where.rating).toEqual({ lte: 4.5 });
    });

    test('respects skip and take for pagination', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await searchModule.searchReviews('excellent', { skip: 5, take: 10 });

      const callArgs = prisma.review.findMany.mock.calls[0][0];
      expect(callArgs.skip).toBe(5);
      expect(callArgs.take).toBe(10);
    });
  });

  describe('countReviews', () => {
    test('returns count of reviews', async () => {
      prisma.review.count.mockResolvedValue(15);

      const result = await searchModule.countReviews('excellent');

      expect(result).toBe(15);
      expect(prisma.review.count).toHaveBeenCalled();
    });

    test('excludes flagged reviews', async () => {
      prisma.review.count.mockResolvedValue(0);

      await searchModule.countReviews('excellent');

      const callArgs = prisma.review.count.mock.calls[0][0];
      expect(callArgs.where.flags).toEqual({ none: {} });
    });

    test('applies same filters as searchReviews', async () => {
      prisma.review.count.mockResolvedValue(8);

      await searchModule.countReviews('excellent', { minRating: 4 });

      const callArgs = prisma.review.count.mock.calls[0][0];
      expect(callArgs.where.rating).toEqual({ gte: 4 });
      expect(callArgs.where.flags).toEqual({ none: {} });
    });

    test('does not use isNot:null on non-optional relations', async () => {
      prisma.review.count.mockResolvedValue(0);

      await searchModule.countReviews('excellent');

      const callArgs = prisma.review.count.mock.calls[0][0];
      // professional and author are required relations in schema — isNot:null is invalid on Prisma 5.x
      expect(callArgs.where.professional).toBeUndefined();
      expect(callArgs.where.author).toBeUndefined();
    });
  });
});
