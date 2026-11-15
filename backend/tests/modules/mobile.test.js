const MobileModule = require('../../modules/mobile');

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../config/mobile-images', () => ({
  optimizeImagesForMobile: jest.fn((obj) => obj),
}));

describe('MobileModule', () => {
  let prisma;
  let mobileModule;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      project: {
        findMany: jest.fn(),
      },
      message: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    mobileModule = new MobileModule(prisma, {});
  });

  // ─── getDashboard ───

  describe('getDashboard', () => {
    const userId = 'user-1';

    test('fetches dashboard with all batch queries', async () => {
      const mockUser = {
        id: userId,
        firstName: 'Alice',
        lastName: 'Dupont',
        avatarUrl: null,
        role: 'CLIENT',
        emailVerified: true,
        city: 'Antananarivo',
        professional: { id: 'pro-1', verified: true, rating: 4.5, reviewCount: 10 },
      };

      const mockNotifications = [
        {
          id: 'n-1',
          type: 'NEW_BOOKING',
          title: 'Nouvelle réservation',
          body: 'Corps',
          createdAt: new Date().toISOString(),
        },
      ];

      const mockProjects = [
        {
          id: 'p-1',
          title: 'Rénovation cuisine',
          status: 'IN_PROGRESS',
          city: 'Antananarivo',
          updatedAt: new Date().toISOString(),
          budgetMin: 500,
          budgetMax: 2000,
        },
      ];

      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.notification.findMany.mockResolvedValue(mockNotifications);
      prisma.project.findMany.mockResolvedValue(mockProjects);
      prisma.message.count.mockResolvedValue(3);

      const result = await mobileModule.getDashboard(userId, false);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('unreadNotifications', 1);
      expect(result).toHaveProperty('recentNotifications');
      expect(result).toHaveProperty('activeProjects');
      expect(result).toHaveProperty('unreadMessages', 3);
      expect(result).toHaveProperty('fetchedAt');

      // Verify all queries were called in parallel
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userId },
        })
      );
      expect(prisma.notification.findMany).toHaveBeenCalled();
      expect(prisma.project.findMany).toHaveBeenCalled();
      expect(prisma.message.count).toHaveBeenCalled();
    });

    test('uses slim mode with reduced fields', async () => {
      const mockUser = {
        id: userId,
        firstName: 'Alice',
        lastName: 'Dupont',
        avatarUrl: null,
        role: 'CLIENT',
        emailVerified: true,
        city: 'Antananarivo',
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.project.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      const result = await mobileModule.getDashboard(userId, true);

      expect(result).toBeDefined();
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 3, // slim mode takes 3 projects instead of 5
        })
      );
    });

    test('handles database errors gracefully', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      await expect(mobileModule.getDashboard(userId, false)).rejects.toThrow(
        'DB error'
      );
    });
  });

  // ─── getNotifications ───

  describe('getNotifications', () => {
    const userId = 'user-1';

    test('fetches paginated notifications', async () => {
      const mockNotifications = [
        {
          id: 'n-1',
          type: 'NEW_BOOKING',
          title: 'Nouvelle réservation',
          body: 'Corps',
          read: false,
          createdAt: new Date().toISOString(),
          data: {},
        },
      ];

      prisma.notification.findMany.mockResolvedValue(mockNotifications);
      prisma.notification.count.mockResolvedValue(5);

      const result = await mobileModule.getNotifications(userId, 20, 1, false);

      expect(result.notifications).toEqual(mockNotifications);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          skip: 0,
          take: 20,
        })
      );
    });

    test('filters unread notifications only', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(2);

      await mobileModule.getNotifications(userId, 20, 1, true);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, read: false },
        })
      );
      expect(prisma.notification.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, read: false },
        })
      );
    });

    test('enforces max limit of 50', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await mobileModule.getNotifications(userId, 100, 1, false); // Request 100

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50, // Capped at 50
        })
      );
    });

    test('handles pagination correctly', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(100);

      await mobileModule.getNotifications(userId, 20, 3, false);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 40, // (3-1) * 20 = 40
          take: 20,
        })
      );
    });
  });

  // ─── getETag ───

  describe('getETag', () => {
    test('generates ETag with userId and timestamp', () => {
      const userId = 'user-1';
      const data = { fetchedAt: '2026-11-15T12:00:00Z' };

      const etag = mobileModule.getETag(userId, data);

      expect(etag).toMatch(/^"mobile-user-1-/);
      expect(etag).toMatch(/"$/);
    });

    test('generates consistent ETag for same data', () => {
      const userId = 'user-1';
      const data = { fetchedAt: '2026-11-15T12:00:00Z' };

      const etag1 = mobileModule.getETag(userId, data);
      const etag2 = mobileModule.getETag(userId, data);

      expect(etag1).toBe(etag2);
    });

    test('generates different ETag for different timestamps', () => {
      const userId = 'user-1';
      const data1 = { fetchedAt: '2026-11-15T12:00:00Z' };
      const data2 = { fetchedAt: '2026-11-15T12:01:00Z' };

      const etag1 = mobileModule.getETag(userId, data1);
      const etag2 = mobileModule.getETag(userId, data2);

      expect(etag1).not.toBe(etag2);
    });
  });

  // ─── applyCacheHeaders ───

  describe('applyCacheHeaders', () => {
    test('sets ETag, Cache-Control, and Last-Modified headers', () => {
      const res = {
        setHeader: jest.fn(),
      };

      const userId = 'user-1';
      const data = { fetchedAt: '2026-11-15T12:00:00Z' };

      mobileModule.applyCacheHeaders(res, userId, data, 60);

      expect(res.setHeader).toHaveBeenCalledWith(
        'ETag',
        expect.stringMatching(/^"mobile-user-1-/)
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=60, stale-while-revalidate=300'
      );
      expect(res.setHeader).toHaveBeenCalledWith('Last-Modified', expect.any(String));
    });

    test('respects custom maxAge', () => {
      const res = {
        setHeader: jest.fn(),
      };

      mobileModule.applyCacheHeaders(res, 'user-1', {}, 120);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=120, stale-while-revalidate=600'
      );
    });
  });

  // ─── isCacheFresh ───

  describe('isCacheFresh', () => {
    test('returns true when ETags match', () => {
      const etag = '"abc123"';

      const result = mobileModule.isCacheFresh(etag, etag);

      expect(result).toBe(true);
    });

    test('returns false when ETags do not match', () => {
      const result = mobileModule.isCacheFresh('"abc123"', '"def456"');

      expect(result).toBe(false);
    });
  });

  // ─── getProfileSummary ───

  describe('getProfileSummary', () => {
    const userId = 'user-1';

    test('fetches profile with professional details', async () => {
      const mockUser = {
        id: userId,
        firstName: 'Alice',
        lastName: 'Dupont',
        email: 'alice@example.com',
        phone: '+261 34 1234 5678',
        avatarUrl: null,
        role: 'PROFESSIONAL',
        city: 'Antananarivo',
        emailVerified: true,
        phoneVerified: false,
        twoFAEnabled: false,
        locale: 'fr-MG',
        createdAt: new Date().toISOString(),
        professional: {
          id: 'pro-1',
          bio: 'Expérimenté',
          verified: true,
          rating: 4.8,
          reviewCount: 25,
          trades: ['Plomberie', 'Électricité'],
          city: 'Antananarivo',
          photoUrl: 'https://example.com/photo.jpg',
        },
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await mobileModule.getProfileSummary(userId, false);

      expect(result).toHaveProperty('id', userId);
      expect(result).toHaveProperty('firstName');
      expect(result).toHaveProperty('professional');
    });

    test('uses slim mode excluding bio and trades', async () => {
      const mockUser = {
        id: userId,
        firstName: 'Alice',
        lastName: 'Dupont',
        email: 'alice@example.com',
        phone: '+261 34 1234 5678',
        avatarUrl: null,
        role: 'PROFESSIONAL',
        city: 'Antananarivo',
        emailVerified: true,
        phoneVerified: false,
        twoFAEnabled: false,
        locale: 'fr-MG',
        createdAt: new Date().toISOString(),
        professional: {
          id: 'pro-1',
          verified: true,
          rating: 4.8,
          reviewCount: 25,
          city: 'Antananarivo',
          photoUrl: 'https://example.com/photo.jpg',
        },
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await mobileModule.getProfileSummary(userId, true);

      expect(result).toBeDefined();
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            professional: expect.objectContaining({
              select: expect.not.objectContaining({
                bio: true,
                trades: true,
              }),
            }),
          }),
        })
      );
    });

    test('throws 404 when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(mobileModule.getProfileSummary(userId, false)).rejects.toThrow(
        'Utilisateur introuvable'
      );
    });
  });

  // ─── getDeltaSync ───

  describe('getDeltaSync', () => {
    const userId = 'user-1';
    const sinceTimestamp = '2026-11-15T00:00:00.000Z';

    test('returns delta with all modified entities', async () => {
      const now = new Date();
      const mockNotifications = [
        {
          id: 'n-1',
          type: 'NEW_BOOKING',
          title: 'Nouvelle réservation',
          body: 'Corps',
          read: false,
          createdAt: now.toISOString(),
        },
      ];

      const mockProjects = [
        {
          id: 'p-1',
          title: 'Rénovation cuisine',
          status: 'IN_PROGRESS',
          city: 'Antananarivo',
          updatedAt: now.toISOString(),
          budgetMin: 500,
          budgetMax: 2000,
          description: 'Description',
        },
      ];

      const mockMessages = [
        {
          id: 'm-1',
          senderId: 'sender-1',
          content: 'Contenu du message',
          read: false,
          createdAt: now.toISOString(),
        },
      ];

      const mockProfile = {
        id: userId,
        firstName: 'Alice',
        lastName: 'Dupont',
        avatarUrl: null,
        updatedAt: now.toISOString(),
      };

      prisma.notification.findMany.mockResolvedValue(mockNotifications);
      prisma.project.findMany.mockResolvedValue(mockProjects);
      prisma.message.findMany.mockResolvedValue(mockMessages);
      prisma.user.findFirst.mockResolvedValue(mockProfile);

      const result = await mobileModule.getDeltaSync(userId, sinceTimestamp, false);

      expect(result).toHaveProperty('notifications');
      expect(result).toHaveProperty('projects');
      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('profile');
      expect(result).toHaveProperty('syncedAt');
      expect(result).toHaveProperty('sinceUsed', sinceTimestamp);
      expect(result).toHaveProperty('conflictPolicy');
      expect(result).toHaveProperty('counts');

      expect(result.conflictPolicy.profile).toBe('last-write-wins');
      expect(result.conflictPolicy.projects).toBe('server-wins');
    });

    test('uses slim mode with reduced take limits', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.project.findMany.mockResolvedValue([]);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.user.findFirst.mockResolvedValue(null);

      await mobileModule.getDeltaSync(userId, sinceTimestamp, true);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 })
      );
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });

    test('throws 400 for invalid timestamp', async () => {
      await expect(
        mobileModule.getDeltaSync(userId, 'invalid-date', false)
      ).rejects.toThrow('Invalid "since" parameter');
    });

    test('throws 400 when since parameter is missing', async () => {
      await expect(
        mobileModule.getDeltaSync(userId, null, false)
      ).rejects.toThrow('Invalid "since" parameter');
    });

    test('returns null profile when no updates', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.project.findMany.mockResolvedValue([]);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await mobileModule.getDeltaSync(userId, sinceTimestamp, false);

      expect(result.profile).toBeNull();
      expect(result.counts.profileUpdated).toBe(false);
    });
  });

  // ─── Constructor injection ───

  describe('constructor', () => {
    test('injects Prisma dependency', () => {
      const testPrisma = { test: true };
      const module = new MobileModule(testPrisma);

      expect(module.prisma).toBe(testPrisma);
    });

    test('accepts optional mobile images config', () => {
      const config = { width: 500, quality: 80 };
      const module = new MobileModule(prisma, config);

      expect(module.mobileImagesConfig).toEqual(config);
    });
  });
});
