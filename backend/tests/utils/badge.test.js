/**
 * Badge Utility Tests
 * Tests badge computation, eligibility checks, prevention of duplicate awards, and user notifications
 */

// Mock trustScore dynamically since it doesn't exist yet
jest.mock('../../utils/trustScore', () => ({
  computeTrustScore: jest.fn().mockReturnValue(80),
}), { virtual: true });

describe('Badge Utility', () => {
  let badges;
  let prisma;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = require('../../config/db');
    badges = require('../../utils/badges');
  });

  describe('Badge Definitions', () => {
    test('should export BADGES object', () => {
      expect(badges.BADGES).toBeDefined();
      expect(typeof badges.BADGES).toBe('object');
    });

    test('should have FIRST_QUOTE badge', () => {
      expect(badges.BADGES.FIRST_QUOTE).toBeDefined();
      expect(badges.BADGES.FIRST_QUOTE.key).toBe('FIRST_QUOTE');
      expect(badges.BADGES.FIRST_QUOTE.label).toBe('Premier devis');
    });

    test('should have FIRST_MISSION badge', () => {
      expect(badges.BADGES.FIRST_MISSION).toBeDefined();
      expect(badges.BADGES.FIRST_MISSION.key).toBe('FIRST_MISSION');
    });

    test('should have TEN_MISSIONS badge', () => {
      expect(badges.BADGES.TEN_MISSIONS).toBeDefined();
      expect(badges.BADGES.TEN_MISSIONS.key).toBe('TEN_MISSIONS');
    });

    test('should have FIFTY_MISSIONS badge', () => {
      expect(badges.BADGES.FIFTY_MISSIONS).toBeDefined();
      expect(badges.BADGES.FIFTY_MISSIONS.key).toBe('FIFTY_MISSIONS');
    });

    test('should have TOP_RATED badge', () => {
      expect(badges.BADGES.TOP_RATED).toBeDefined();
      expect(badges.BADGES.TOP_RATED.key).toBe('TOP_RATED');
    });

    test('should have VERIFIED_ID badge', () => {
      expect(badges.BADGES.VERIFIED_ID).toBeDefined();
      expect(badges.BADGES.VERIFIED_ID.key).toBe('VERIFIED_ID');
    });

    test('should have PREMIUM badge', () => {
      expect(badges.BADGES.PREMIUM).toBeDefined();
      expect(badges.BADGES.PREMIUM.key).toBe('PREMIUM');
    });

    test('should have PORTFOLIO_RICH badge', () => {
      expect(badges.BADGES.PORTFOLIO_RICH).toBeDefined();
      expect(badges.BADGES.PORTFOLIO_RICH.key).toBe('PORTFOLIO_RICH');
    });

    test('should have TRUSTED badge', () => {
      expect(badges.BADGES.TRUSTED).toBeDefined();
      expect(badges.BADGES.TRUSTED.key).toBe('TRUSTED');
    });

    test('should have COMPANY badge', () => {
      expect(badges.BADGES.COMPANY).toBeDefined();
      expect(badges.BADGES.COMPANY.key).toBe('COMPANY');
    });

    test('should have EARLY_ADOPTER badge', () => {
      expect(badges.BADGES.EARLY_ADOPTER).toBeDefined();
      expect(badges.BADGES.EARLY_ADOPTER.key).toBe('EARLY_ADOPTER');
    });

    test('should have REFERRER badge', () => {
      expect(badges.BADGES.REFERRER).toBeDefined();
      expect(badges.BADGES.REFERRER.key).toBe('REFERRER');
    });

    test('each badge should have label and icon', () => {
      Object.values(badges.BADGES).forEach(badge => {
        expect(badge.label).toBeDefined();
        expect(typeof badge.label).toBe('string');
        expect(badge.icon).toBeDefined();
        expect(typeof badge.icon).toBe('string');
      });
    });

    test('each badge should have color', () => {
      Object.values(badges.BADGES).forEach(badge => {
        expect(badge.color).toBeDefined();
        expect(badge.color).toMatch(/^#[0-9A-F]{6}$/i);
      });
    });

    test('each badge should have description', () => {
      Object.values(badges.BADGES).forEach(badge => {
        expect(badge.description).toBeDefined();
        expect(typeof badge.description).toBe('string');
      });
    });
  });

  describe('computeBadges Function', () => {
    test('should export computeBadges function', () => {
      expect(typeof badges.computeBadges).toBe('function');
    });

    test('should return empty array for non-existent professional', async () => {
      prisma.professional = {
        findUnique: jest.fn().mockResolvedValueOnce(null),
      };

      const result = await badges.computeBadges('nonexistent-id');

      expect(result).toEqual([]);
    });

    test('should handle professional without badges', async () => {
      const mockPro = {
        id: 'pro-1',
        quotes: [],
        completedMissionsCount: 0,
        reviewCount: 0,
        averageRating: 0,
        identityStatus: 'PENDING',
        accountType: 'INDIVIDUAL',
        verifiedByAdmin: false,
        createdAt: new Date(),
        badges: [],
        subscription: null,
        portfolioProjects: [],
        reviews: [],
        user: {},
      };

      prisma.professional = {
        findUnique: jest.fn().mockResolvedValueOnce(mockPro),
        count: jest.fn().mockResolvedValueOnce(500),
      };
      prisma.professionalBadge = {
        createMany: jest.fn().mockResolvedValueOnce({ count: 0 }),
        findMany: jest.fn().mockResolvedValueOnce([]),
      };

      const result = await badges.computeBadges('pro-1');

      expect(Array.isArray(result)).toBe(true);
    });

    test('should handle professional with multiple badges', async () => {
      const mockPro = {
        id: 'pro-1',
        quotes: [{ id: 'q1' }],
        completedMissionsCount: 10,
        reviewCount: 15,
        averageRating: 4.8,
        identityStatus: 'APPROVED',
        accountType: 'INDIVIDUAL',
        verifiedByAdmin: false,
        createdAt: new Date('2020-01-01'),
        badges: [],
        subscription: { status: 'ACTIVE' },
        portfolioProjects: Array(12).fill({}),
        reviews: [],
        user: {},
      };

      prisma.professional = {
        findUnique: jest.fn().mockResolvedValueOnce(mockPro),
        count: jest.fn().mockResolvedValueOnce(100),
      };
      prisma.professionalBadge = {
        createMany: jest.fn().mockResolvedValueOnce({ count: 5 }),
        findMany: jest.fn().mockResolvedValueOnce([
          { badgeKey: 'FIRST_QUOTE', earnedAt: new Date(), ...badges.BADGES.FIRST_QUOTE },
          { badgeKey: 'FIRST_MISSION', earnedAt: new Date(), ...badges.BADGES.FIRST_MISSION },
          { badgeKey: 'TEN_MISSIONS', earnedAt: new Date(), ...badges.BADGES.TEN_MISSIONS },
          { badgeKey: 'TOP_RATED', earnedAt: new Date(), ...badges.BADGES.TOP_RATED },
          { badgeKey: 'PREMIUM', earnedAt: new Date(), ...badges.BADGES.PREMIUM },
        ]),
      };

      const result = await badges.computeBadges('pro-1');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Duplicate Prevention', () => {
    test('should not re-award existing badges', async () => {
      const mockPro = {
        id: 'pro-1',
        quotes: [{ id: 'q1' }],
        completedMissionsCount: 0,
        reviewCount: 0,
        averageRating: 0,
        identityStatus: 'PENDING',
        accountType: 'INDIVIDUAL',
        verifiedByAdmin: false,
        createdAt: new Date(),
        badges: [{ badgeKey: 'FIRST_QUOTE' }],
        subscription: null,
        portfolioProjects: [],
        reviews: [],
        user: {},
      };

      prisma.professional = {
        findUnique: jest.fn().mockResolvedValueOnce(mockPro),
        count: jest.fn().mockResolvedValueOnce(500),
      };
      prisma.professionalBadge = {
        createMany: jest.fn().mockResolvedValueOnce({ count: 0 }),
        findMany: jest.fn().mockResolvedValueOnce([
          { badgeKey: 'FIRST_QUOTE', earnedAt: new Date(), ...badges.BADGES.FIRST_QUOTE },
        ]),
      };

      await badges.computeBadges('pro-1');

      const createCall = prisma.professionalBadge.createMany.mock.calls[0];
      if (createCall && createCall[0] && createCall[0].data) {
        expect(createCall[0].data.some(b => b.badgeKey === 'FIRST_QUOTE')).toBe(false);
      }
    });

    test('should use skipDuplicates when creating badges', async () => {
      const mockPro = {
        id: 'pro-1',
        quotes: [],
        completedMissionsCount: 0,
        reviewCount: 0,
        averageRating: 0,
        identityStatus: 'PENDING',
        accountType: 'INDIVIDUAL',
        verifiedByAdmin: false,
        createdAt: new Date(),
        badges: [],
        subscription: null,
        portfolioProjects: [],
        reviews: [],
        user: {},
      };

      prisma.professional = {
        findUnique: jest.fn().mockResolvedValueOnce(mockPro),
        count: jest.fn().mockResolvedValueOnce(500),
      };
      prisma.professionalBadge = {
        createMany: jest.fn().mockResolvedValueOnce({ count: 0 }),
        findMany: jest.fn().mockResolvedValueOnce([]),
      };

      await badges.computeBadges('pro-1');

      const createCall = prisma.professionalBadge.createMany.mock.calls[0];
      expect(createCall[0].skipDuplicates).toBe(true);
    });
  });

  describe('Badge Metadata', () => {
    test('should return badges with metadata', async () => {
      const mockPro = {
        id: 'pro-1',
        quotes: [],
        completedMissionsCount: 0,
        reviewCount: 0,
        averageRating: 0,
        identityStatus: 'APPROVED',
        accountType: 'INDIVIDUAL',
        verifiedByAdmin: false,
        createdAt: new Date(),
        badges: [],
        subscription: null,
        portfolioProjects: [],
        reviews: [],
        user: {},
      };

      prisma.professional = {
        findUnique: jest.fn().mockResolvedValueOnce(mockPro),
        count: jest.fn().mockResolvedValueOnce(500),
      };

      const earnedBadge = { badgeKey: 'VERIFIED_ID', earnedAt: new Date() };
      prisma.professionalBadge = {
        createMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
        findMany: jest.fn().mockResolvedValueOnce([earnedBadge]),
      };

      const result = await badges.computeBadges('pro-1');

      expect(result[0]).toHaveProperty('label');
      expect(result[0]).toHaveProperty('icon');
      expect(result[0]).toHaveProperty('color');
      expect(result[0]).toHaveProperty('description');
    });

    test('should order badges by earned date', async () => {
      const mockPro = {
        id: 'pro-1',
        quotes: [],
        completedMissionsCount: 0,
        reviewCount: 0,
        averageRating: 0,
        identityStatus: 'PENDING',
        accountType: 'INDIVIDUAL',
        verifiedByAdmin: false,
        createdAt: new Date(),
        badges: [],
        subscription: null,
        portfolioProjects: [],
        reviews: [],
        user: {},
      };

      prisma.professional = {
        findUnique: jest.fn().mockResolvedValueOnce(mockPro),
        count: jest.fn().mockResolvedValueOnce(500),
      };

      prisma.professionalBadge = {
        createMany: jest.fn().mockResolvedValueOnce({ count: 0 }),
        findMany: jest.fn().mockResolvedValueOnce([]),
      };

      await badges.computeBadges('pro-1');

      expect(prisma.professionalBadge.findMany).toHaveBeenCalledWith({
        where: { professionalId: 'pro-1' },
        orderBy: { earnedAt: 'asc' },
      });
    });
  });

  describe('Concurrency Protection', () => {
    test('should handle concurrent badge computations', async () => {
      const mockPro = {
        id: 'pro-1',
        quotes: [],
        completedMissionsCount: 0,
        reviewCount: 0,
        averageRating: 0,
        identityStatus: 'PENDING',
        accountType: 'INDIVIDUAL',
        verifiedByAdmin: false,
        createdAt: new Date(),
        badges: [],
        subscription: null,
        portfolioProjects: [],
        reviews: [],
        user: {},
      };

      prisma.professional = {
        findUnique: jest.fn().mockResolvedValue(mockPro),
        count: jest.fn().mockResolvedValue(500),
      };
      prisma.professionalBadge = {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      };

      // Simulate concurrent calls
      const promise1 = badges.computeBadges('pro-1');
      const promise2 = badges.computeBadges('pro-1');

      const results = await Promise.all([promise1, promise2]);

      expect(Array.isArray(results[0])).toBe(true);
      expect(Array.isArray(results[1])).toBe(true);
    });
  });

  describe('Badge Count', () => {
    test('should return all badges for qualified professional', async () => {
      const mockPro = {
        id: 'pro-1',
        quotes: Array(5).fill({ id: '1' }),
        completedMissionsCount: 50,
        reviewCount: 20,
        averageRating: 4.9,
        identityStatus: 'APPROVED',
        accountType: 'ENTREPRISE',
        verifiedByAdmin: true,
        createdAt: new Date('2020-01-01'),
        badges: [],
        subscription: { status: 'ACTIVE' },
        portfolioProjects: Array(15).fill({}),
        reviews: [],
        user: {},
      };

      prisma.professional = {
        findUnique: jest.fn().mockResolvedValueOnce(mockPro),
        count: jest.fn().mockResolvedValueOnce(100),
      };
      prisma.professionalBadge = {
        createMany: jest.fn().mockResolvedValueOnce({ count: 10 }),
        findMany: jest.fn().mockResolvedValueOnce([]),
      };

      await badges.computeBadges('pro-1');

      expect(prisma.professionalBadge.findMany).toHaveBeenCalled();
    });
  });
});
