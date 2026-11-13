'use strict';
/**
 * Tests for config/feature-flags.js
 */

jest.mock('../../config/redis', () => ({
  deleteKey: jest.fn().mockResolvedValue(undefined),
  publish: jest.fn().mockResolvedValue(undefined),
}));

describe('feature-flags config', () => {
  let featureFlags;
  let redisMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../config/redis', () => ({
      deleteKey: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(undefined),
    }));
    featureFlags = require('../../config/feature-flags');
    redisMock = require('../../config/redis');
  });

  describe('exports', () => {
    it('exporte DEFAULT_FLAGS', () => {
      expect(featureFlags.DEFAULT_FLAGS).toBeDefined();
      expect(typeof featureFlags.DEFAULT_FLAGS).toBe('object');
    });

    it('exporte FEATURE_FLAG_CACHE_KEY', () => {
      expect(typeof featureFlags.FEATURE_FLAG_CACHE_KEY).toBe('string');
    });

    it('exporte FEATURE_FLAG_TTL', () => {
      expect(typeof featureFlags.FEATURE_FLAG_TTL).toBe('number');
      expect(featureFlags.FEATURE_FLAG_TTL).toBe(300);
    });

    it('exporte CONFIG_RELOAD_CHANNEL', () => {
      expect(typeof featureFlags.CONFIG_RELOAD_CHANNEL).toBe('string');
    });

    it('exporte les fonctions nécessaires', () => {
      expect(typeof featureFlags.initializeDefaultFlags).toBe('function');
      expect(typeof featureFlags.invalidateCache).toBe('function');
      expect(typeof featureFlags.getCacheTTL).toBe('function');
      expect(typeof featureFlags.subscribeToHotReload).toBe('function');
      expect(typeof featureFlags.publishHotReload).toBe('function');
    });
  });

  describe('DEFAULT_FLAGS', () => {
    it('contient les flags par défaut', () => {
      const { DEFAULT_FLAGS } = featureFlags;
      expect(DEFAULT_FLAGS).toHaveProperty('new-dashboard-ui');
      expect(DEFAULT_FLAGS).toHaveProperty('advanced-search');
      expect(DEFAULT_FLAGS).toHaveProperty('video-calls-beta');
      expect(DEFAULT_FLAGS).toHaveProperty('two-factor-auth-enforce');
      expect(DEFAULT_FLAGS).toHaveProperty('payment-retry-automation');
    });

    it('chaque flag a les propriétés requises', () => {
      const { DEFAULT_FLAGS } = featureFlags;
      for (const flagName of Object.keys(DEFAULT_FLAGS)) {
        const flag = DEFAULT_FLAGS[flagName];
        expect(flag).toHaveProperty('name', flagName);
        expect(flag).toHaveProperty('description');
        expect(flag).toHaveProperty('enabled');
        expect(flag).toHaveProperty('rolloutPercentage');
        expect(typeof flag.enabled).toBe('boolean');
        expect(typeof flag.rolloutPercentage).toBe('number');
        expect(flag.rolloutPercentage).toBeGreaterThanOrEqual(0);
        expect(flag.rolloutPercentage).toBeLessThanOrEqual(100);
      }
    });

    it('advanced-search est activé à 100%', () => {
      const flag = featureFlags.DEFAULT_FLAGS['advanced-search'];
      expect(flag.enabled).toBe(true);
      expect(flag.rolloutPercentage).toBe(100);
    });

    it('new-dashboard-ui est désactivé', () => {
      const flag = featureFlags.DEFAULT_FLAGS['new-dashboard-ui'];
      expect(flag.enabled).toBe(false);
    });
  });

  describe('getCacheTTL', () => {
    it('retourne le TTL en secondes', () => {
      const ttl = featureFlags.getCacheTTL();
      expect(ttl).toBe(300);
    });
  });

  describe('invalidateCache', () => {
    it('appelle redis.deleteKey avec la bonne clé', async () => {
      await featureFlags.invalidateCache();
      expect(redisMock.deleteKey).toHaveBeenCalledWith(featureFlags.FEATURE_FLAG_CACHE_KEY);
    });

    it('gère les erreurs Redis sans lancer', async () => {
      redisMock.deleteKey.mockRejectedValueOnce(new Error('Redis down'));
      await expect(featureFlags.invalidateCache()).resolves.not.toThrow();
    });
  });

  describe('publishHotReload', () => {
    it('publie un message sur le canal de hot reload', async () => {
      await featureFlags.publishHotReload('advanced-search');
      expect(redisMock.publish).toHaveBeenCalledWith(
        featureFlags.CONFIG_RELOAD_CHANNEL,
        expect.stringContaining('advanced-search')
      );
    });

    it('gère les erreurs de publication sans lancer', async () => {
      redisMock.publish.mockRejectedValueOnce(new Error('Publish failed'));
      await expect(featureFlags.publishHotReload('some-flag')).resolves.not.toThrow();
    });
  });

  describe('initializeDefaultFlags', () => {
    it('appelle prisma.featureFlag.findUnique pour chaque flag', async () => {
      const mockPrisma = {
        featureFlag: {
          findUnique: jest.fn().mockResolvedValue({ name: 'existing' }),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      await featureFlags.initializeDefaultFlags(mockPrisma);
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledTimes(
        Object.keys(featureFlags.DEFAULT_FLAGS).length
      );
    });

    it('crée les flags manquants', async () => {
      const mockPrisma = {
        featureFlag: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      await featureFlags.initializeDefaultFlags(mockPrisma);
      expect(mockPrisma.featureFlag.create).toHaveBeenCalledTimes(
        Object.keys(featureFlags.DEFAULT_FLAGS).length
      );
    });

    it('ne crée pas les flags qui existent déjà', async () => {
      const mockPrisma = {
        featureFlag: {
          findUnique: jest.fn().mockResolvedValue({ name: 'existing' }),
          create: jest.fn(),
        },
      };
      await featureFlags.initializeDefaultFlags(mockPrisma);
      expect(mockPrisma.featureFlag.create).not.toHaveBeenCalled();
    });

    it('gère les erreurs Prisma sans lancer', async () => {
      const mockPrisma = {
        featureFlag: {
          findUnique: jest.fn().mockRejectedValue(new Error('DB error')),
          create: jest.fn(),
        },
      };
      await expect(featureFlags.initializeDefaultFlags(mockPrisma)).resolves.not.toThrow();
    });
  });

  describe('subscribeToHotReload', () => {
    it('appelle subscribe sur le canal', async () => {
      const mockSubscriber = {
        subscribe: jest.fn().mockResolvedValue(undefined),
      };
      await featureFlags.subscribeToHotReload(mockSubscriber);
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
        featureFlags.CONFIG_RELOAD_CHANNEL,
        expect.any(Function)
      );
    });

    it('gère les erreurs de subscribe sans lancer', async () => {
      const mockSubscriber = {
        subscribe: jest.fn().mockRejectedValue(new Error('Subscribe failed')),
      };
      await expect(featureFlags.subscribeToHotReload(mockSubscriber)).resolves.not.toThrow();
    });
  });
});
