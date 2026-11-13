/**
 * Tests for feature-flag-manager.js
 * Tests isFeatureEnabled, checkMultipleFlags, getAllFlags, invalidateCache, hashUserFlag
 */

jest.mock('../../config/redis', () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  deleteKey: jest.fn().mockResolvedValue(1),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../config/feature-flags', () => ({
  FEATURE_FLAG_CACHE_KEY: 'feature-flags:all',
  FEATURE_FLAG_TTL: 300,
}));

describe('FeatureFlagManager', () => {
  let manager;
  let redis;
  let mockPrisma;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    redis = require('../../config/redis');
    manager = require('../../utils/feature-flag-manager');

    // Default prisma mock
    mockPrisma = {
      featureFlag: {
        findMany: jest.fn(),
      },
    };
  });

  // ─────────────────────────────────────────────
  // Exports
  // ─────────────────────────────────────────────
  describe('Exports', () => {
    const expectedExports = [
      'isFeatureEnabled',
      'checkMultipleFlags',
      'getAllFlags',
      'invalidateCache',
      'hashUserFlag',
    ];

    expectedExports.forEach(fn => {
      it(`should export ${fn}`, () => {
        expect(typeof manager[fn]).toBe('function');
      });
    });
  });

  // ─────────────────────────────────────────────
  // hashUserFlag
  // ─────────────────────────────────────────────
  describe('hashUserFlag', () => {
    it('should return a number between 0 and 99 (inclusive)', () => {
      // Act
      const hash = manager.hashUserFlag('user-123', 'new-feature');

      // Assert
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(100);
    });

    it('should be deterministic — same inputs produce same output', () => {
      // Act
      const hash1 = manager.hashUserFlag('user-abc', 'feature-x');
      const hash2 = manager.hashUserFlag('user-abc', 'feature-x');

      // Assert
      expect(hash1).toBe(hash2);
    });

    it('should produce different values for different users', () => {
      // Act
      const hash1 = manager.hashUserFlag('user-1', 'feature-x');
      const hash2 = manager.hashUserFlag('user-2', 'feature-x');

      // Assert — statistically very unlikely to be equal
      // This test has a 1/100 chance of false failure (acceptable)
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different values for different flags', () => {
      // Act
      const hash1 = manager.hashUserFlag('user-1', 'feature-a');
      const hash2 = manager.hashUserFlag('user-1', 'feature-b');

      // Assert
      expect(hash1).not.toBe(hash2);
    });
  });

  // ─────────────────────────────────────────────
  // isFeatureEnabled
  // ─────────────────────────────────────────────
  describe('isFeatureEnabled', () => {
    it('should return false when flag is not found in cache or DB', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      // Act
      const result = await manager.isFeatureEnabled('nonexistent-flag', null, mockPrisma);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when flag is disabled', async () => {
      // Arrange
      redis.get.mockResolvedValue({
        'disabled-flag': { enabled: false, rolloutPercentage: 100 },
      });

      // Act
      const result = await manager.isFeatureEnabled('disabled-flag', 'user-1', mockPrisma);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when flag is enabled at 100%', async () => {
      // Arrange
      redis.get.mockResolvedValue({
        'full-flag': { enabled: true, rolloutPercentage: 100 },
      });

      // Act
      const result = await manager.isFeatureEnabled('full-flag', 'user-1', mockPrisma);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when no userId and rollout < 100%', async () => {
      // Arrange
      redis.get.mockResolvedValue({
        'partial-flag': { enabled: true, rolloutPercentage: 50 },
      });

      // Act
      const result = await manager.isFeatureEnabled('partial-flag', null, mockPrisma);

      // Assert
      expect(result).toBe(false);
    });

    it('should use deterministic hash to decide rollout (100% always true)', async () => {
      // Arrange
      redis.get.mockResolvedValue({
        'rollout-flag': { enabled: true, rolloutPercentage: 100 },
      });

      // Act
      const r1 = await manager.isFeatureEnabled('rollout-flag', 'user-1', mockPrisma);
      const r2 = await manager.isFeatureEnabled('rollout-flag', 'user-1', mockPrisma);

      // Assert — consistent across calls
      expect(r1).toBe(r2);
    });

    it('should return false for rollout 0% even with userId', async () => {
      // Arrange
      redis.get.mockResolvedValue({
        'off-flag': { enabled: true, rolloutPercentage: 0 },
      });

      // Act
      const result = await manager.isFeatureEnabled('off-flag', 'user-1', mockPrisma);

      // Assert
      expect(result).toBe(false);
    });

    it('should fetch flags from DB on cache miss and cache them', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { name: 'db-flag', enabled: true, rolloutPercentage: 100 },
      ]);

      // Act
      const result = await manager.isFeatureEnabled('db-flag', null, mockPrisma);

      // Assert
      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        'feature-flags:all',
        expect.any(Object),
        300
      );
    });

    it('should return false without throwing when prisma is not provided on cache miss', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);

      // Act
      const result = await manager.isFeatureEnabled('some-flag', 'user-1', undefined);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false (fail-safe) when an exception is thrown', async () => {
      // Arrange
      redis.get.mockRejectedValue(new Error('Redis connection lost'));

      // Act
      const result = await manager.isFeatureEnabled('flag', 'user-1', mockPrisma);

      // Assert
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // checkMultipleFlags
  // ─────────────────────────────────────────────
  describe('checkMultipleFlags', () => {
    it('should return a map of flagName -> boolean', async () => {
      // Arrange
      redis.get.mockResolvedValue({
        'flag-a': { enabled: true, rolloutPercentage: 100 },
        'flag-b': { enabled: false, rolloutPercentage: 0 },
      });

      // Act
      const result = await manager.checkMultipleFlags(
        ['flag-a', 'flag-b'],
        null,
        mockPrisma
      );

      // Assert
      expect(result['flag-a']).toBe(true);
      expect(result['flag-b']).toBe(false);
    });

    it('should return all false for empty flag names array', async () => {
      // Act
      const result = await manager.checkMultipleFlags([], null, mockPrisma);

      // Assert
      expect(result).toEqual({});
    });

    it('should return all false on error', async () => {
      // Arrange
      redis.get.mockRejectedValue(new Error('Redis down'));

      // Act
      const result = await manager.checkMultipleFlags(
        ['flag-x', 'flag-y'],
        'user-1',
        mockPrisma
      );

      // Assert
      expect(result['flag-x']).toBe(false);
      expect(result['flag-y']).toBe(false);
    });

    it('should check each flag independently', async () => {
      // Arrange
      redis.get.mockResolvedValue({
        'flag-1': { enabled: true, rolloutPercentage: 100 },
        'flag-2': { enabled: true, rolloutPercentage: 100 },
        'flag-3': { enabled: false, rolloutPercentage: 100 },
      });

      // Act
      const result = await manager.checkMultipleFlags(
        ['flag-1', 'flag-2', 'flag-3'],
        'user-99',
        mockPrisma
      );

      // Assert
      expect(result['flag-1']).toBe(true);
      expect(result['flag-2']).toBe(true);
      expect(result['flag-3']).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // getAllFlags
  // ─────────────────────────────────────────────
  describe('getAllFlags', () => {
    it('should return cached flags when available', async () => {
      // Arrange
      const cachedFlags = {
        'feature-x': { name: 'feature-x', enabled: true, rolloutPercentage: 50 },
      };
      redis.get.mockResolvedValue(cachedFlags);

      // Act
      const result = await manager.getAllFlags(mockPrisma);

      // Assert
      expect(result).toEqual(cachedFlags);
      expect(mockPrisma.featureFlag.findMany).not.toHaveBeenCalled();
    });

    it('should fetch from DB on cache miss and return flags', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        {
          name: 'new-ui',
          enabled: true,
          rolloutPercentage: 25,
          description: 'New UI test',
        },
      ]);

      // Act
      const result = await manager.getAllFlags(mockPrisma);

      // Assert
      expect(result['new-ui']).toBeDefined();
      expect(result['new-ui'].enabled).toBe(true);
    });

    it('should return empty object when prisma is not provided on cache miss', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);

      // Act
      const result = await manager.getAllFlags(undefined);

      // Assert
      expect(result).toEqual({});
    });

    it('should return empty object on error', async () => {
      // Arrange
      redis.get.mockRejectedValue(new Error('Redis down'));

      // Act
      const result = await manager.getAllFlags(mockPrisma);

      // Assert
      expect(result).toEqual({});
    });

    it('should cache DB flags after fetching', async () => {
      // Arrange
      redis.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        { name: 'fl', enabled: true, rolloutPercentage: 100, description: 'D' },
      ]);

      // Act
      await manager.getAllFlags(mockPrisma);

      // Assert
      expect(redis.set).toHaveBeenCalledWith(
        'feature-flags:all',
        expect.any(Object),
        300
      );
    });
  });

  // ─────────────────────────────────────────────
  // invalidateCache
  // ─────────────────────────────────────────────
  describe('invalidateCache', () => {
    it('should call redis.deleteKey with the cache key', async () => {
      // Act
      await manager.invalidateCache();

      // Assert
      expect(redis.deleteKey).toHaveBeenCalledWith('feature-flags:all');
    });

    it('should not throw when redis.deleteKey fails', async () => {
      // Arrange
      redis.deleteKey.mockRejectedValueOnce(new Error('Redis error'));

      // Act & Assert — should not throw
      await expect(manager.invalidateCache()).resolves.toBeUndefined();
    });
  });
});
