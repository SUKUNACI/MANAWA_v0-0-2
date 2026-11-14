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
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    searchModule = new SearchModule(prisma);
  });

  describe('searchProfessionals', () => {
    test('returns professionals with results and total', async () => {
      const mockPros = [
        { id: 'pro-1', user: { firstName: 'John' }, _count: { followers: 5 } },
      ];

      prisma.professional.findMany.mockResolvedValue(mockPros);
      prisma.professional.count.mockResolvedValue(1);

      const result = await searchModule.searchProfessionals('plumber', { skip: 0, take: 20 });

      expect(result.results).toEqual(mockPros);
      expect(result.total).toBe(1);
      expect(prisma.professional.findMany).toHaveBeenCalled();
      expect(prisma.professional.count).toHaveBeenCalled();
    });

    test('applies city filter', async () => {
      prisma.professional.findMany.mockResolvedValue([]);
      prisma.professional.count.mockResolvedValue(0);

      await searchModule.searchProfessionals('plumber', { filters: { city: 'Paris' } });

      const callArgs = prisma.professional.findMany.mock.calls[0][0];
      expect(callArgs.where.user.city).toBe('Paris');
    });

    test('applies trade filter', async () => {
      prisma.professional.findMany.mockResolvedValue([]);
      prisma.professional.count.mockResolvedValue(0);

      await searchModule.searchProfessionals('', { filters: { trade: 'Plomberie' } });

      const callArgs = prisma.professional.findMany.mock.calls[0][0];
      expect(callArgs.where.trades).toEqual({ has: 'Plomberie' });
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
    test('returns projects with results and total', async () => {
      const mockProjects = [
        { id: 'proj-1', title: 'Fix leak', _count: { quotes: 2 } },
      ];

      prisma.project.findMany.mockResolvedValue(mockProjects);
      prisma.project.count.mockResolvedValue(1);

      const result = await searchModule.searchProjects('leak', { skip: 0, take: 20 });

      expect(result.results).toEqual(mockProjects);
      expect(result.total).toBe(1);
    });

    test('applies status filter', async () => {
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);

      await searchModule.searchProjects('', { filters: { status: 'OPEN' } });

      const callArgs = prisma.project.findMany.mock.calls[0][0];
      expect(callArgs.where.status).toBe('OPEN');
    });
  });

  describe('searchClients', () => {
    test('returns clients matching query', async () => {
      const mockClients = [
        { id: 'user-1', firstName: 'Alice', email: 'alice@test.com' },
      ];

      prisma.user.findMany.mockResolvedValue(mockClients);
      prisma.user.count.mockResolvedValue(1);

      const result = await searchModule.searchClients('alice', { skip: 0, take: 20 });

      expect(result.results).toEqual(mockClients);
      expect(result.total).toBe(1);
    });

    test('filters by role CLIENT', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await searchModule.searchClients('test');

      const callArgs = prisma.user.findMany.mock.calls[0][0];
      expect(callArgs.where.role).toBe('CLIENT');
    });
  });

  describe('getFacets', () => {
    test('returns trades and cities facets', async () => {
      const mockTradeStats = [{ trades: ['Plomberie'], _count: { id: 10 } }];
      const mockCityStats = [{ user: 'Paris', _count: { id: 5 } }];

      prisma.professional.groupBy
        .mockResolvedValueOnce(mockTradeStats)
        .mockResolvedValueOnce(mockCityStats);

      const result = await searchModule.getFacets();

      expect(result.trades).toEqual(mockTradeStats);
      expect(result.cities).toEqual(mockCityStats);
    });

    test('handles error gracefully', async () => {
      prisma.professional.groupBy.mockRejectedValue(new Error('DB error'));

      const result = await searchModule.getFacets();

      expect(result.trades).toEqual([]);
      expect(result.cities).toEqual([]);
    });
  });
});
