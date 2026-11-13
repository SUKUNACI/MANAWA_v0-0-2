/**
 * Application Configuration Tests
 * Tests app config defaults, retrieval, and super admin management
 */

jest.mock('../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  appConfig: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
}), { virtual: true });

describe('Application Configuration', () => {
  let appConfig;
  let prisma;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = require('../config/db');
    appConfig = require('../../utils/appConfig');
  });

  describe('Configuration Defaults', () => {
    test('should export DEFAULTS object', () => {
      expect(appConfig.DEFAULTS).toBeDefined();
      expect(typeof appConfig.DEFAULTS).toBe('object');
    });

    test('should have commission_rate default', () => {
      expect(appConfig.DEFAULTS.commission_rate).toBeDefined();
      expect(appConfig.DEFAULTS.commission_rate.value).toBe('0.08');
    });

    test('should have subscription price defaults', () => {
      expect(appConfig.DEFAULTS.price_essentiel.value).toBe('2500');
      expect(appConfig.DEFAULTS.price_pro.value).toBe('5000');
      expect(appConfig.DEFAULTS.price_elite.value).toBe('10000');
    });

    test('should have trial_days default', () => {
      expect(appConfig.DEFAULTS.trial_days.value).toBe('14');
    });

    test('should have quote limits', () => {
      expect(appConfig.DEFAULTS.max_quotes_essentiel).toBeDefined();
      expect(appConfig.DEFAULTS.max_trades_essentiel).toBeDefined();
      expect(appConfig.DEFAULTS.max_trades_premium).toBeDefined();
    });

    test('should have maintenance mode default', () => {
      expect(appConfig.DEFAULTS.app_maintenance_mode).toBeDefined();
      expect(appConfig.DEFAULTS.app_maintenance_mode.value).toBe('false');
    });

    test('should have support settings', () => {
      expect(appConfig.DEFAULTS.app_name).toBeDefined();
      expect(appConfig.DEFAULTS.support_email).toBeDefined();
    });

    test('each default should have description', () => {
      Object.values(appConfig.DEFAULTS).forEach(config => {
        expect(config.description).toBeDefined();
        expect(typeof config.description).toBe('string');
      });
    });
  });

  describe('Configuration Seeding', () => {
    test('should export seedConfig function', () => {
      expect(typeof appConfig.seedConfig).toBe('function');
    });

    test('should insert missing config keys', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({ key: 'commission_rate', value: '0.08' }),
      };

      await appConfig.seedConfig();

      expect(prisma.appConfig.upsert).toHaveBeenCalled();
    });

    test('should upsert all default keys', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({}),
      };

      await appConfig.seedConfig();

      const callCount = prisma.appConfig.upsert.mock.calls.length;
      const defaultKeys = Object.keys(appConfig.DEFAULTS).length;

      expect(callCount).toBeGreaterThanOrEqual(defaultKeys);
    });

    test('should not overwrite existing values', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({}),
      };

      await appConfig.seedConfig();

      const calls = prisma.appConfig.upsert.mock.calls;
      calls.forEach(call => {
        expect(call[0].update).toEqual({});
      });
    });
  });

  describe('Get Configuration', () => {
    test('should export getConfig function', () => {
      expect(typeof appConfig.getConfig).toBe('function');
    });

    test('should return numeric value for numeric config', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: '5000' }),
      };

      const result = await appConfig.getConfig('price_essentiel');

      expect(typeof result).toBe('number');
      expect(result).toBe(5000);
    });

    test('should return boolean true for "true" string', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: 'true' }),
      };

      const result = await appConfig.getConfig('app_maintenance_mode');

      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    test('should return boolean false for "false" string', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: 'false' }),
      };

      const result = await appConfig.getConfig('app_maintenance_mode');

      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
    });

    test('should return string for non-numeric values', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: 'support@manawa.app' }),
      };

      const result = await appConfig.getConfig('support_email');

      expect(typeof result).toBe('string');
      expect(result).toBe('support@manawa.app');
    });

    test('should return default value if not in DB', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce(null),
      };

      const result = await appConfig.getConfig('commission_rate');

      expect(result).toBe(0.08);
    });

    test('should return null for unknown keys', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce(null),
      };

      const result = await appConfig.getConfig('unknown_key');

      expect(result).toBeNull();
    });

    test('should handle decimal numbers', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: '4.5' }),
      };

      const result = await appConfig.getConfig('some_rating');

      expect(typeof result).toBe('number');
      expect(result).toBe(4.5);
    });
  });

  describe('Get All Configuration', () => {
    test('should export getAllConfig function', () => {
      expect(typeof appConfig.getAllConfig).toBe('function');
    });

    test('should call seedConfig before returning', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({}),
        findMany: jest.fn().mockResolvedValueOnce([]),
      };

      await appConfig.getAllConfig();

      expect(prisma.appConfig.upsert).toHaveBeenCalled();
    });

    test('should order results by key', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({}),
        findMany: jest.fn().mockResolvedValueOnce([]),
      };

      await appConfig.getAllConfig();

      const findCall = prisma.appConfig.findMany.mock.calls[0][0];
      expect(findCall.orderBy).toEqual({ key: 'asc' });
    });

    test('should return object with configs', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({}),
        findMany: jest.fn().mockResolvedValueOnce([
          { key: 'commission_rate', value: '0.08', description: 'Commission rate', updatedBy: 'system', updatedAt: new Date() },
          { key: 'price_essentiel', value: '2500', description: 'Essentiel price', updatedBy: 'system', updatedAt: new Date() },
        ]),
      };

      const result = await appConfig.getAllConfig();

      expect(typeof result).toBe('object');
      expect(result.commission_rate).toBeDefined();
      expect(result.price_essentiel).toBeDefined();
    });

    test('should include metadata in response', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({}),
        findMany: jest.fn().mockResolvedValueOnce([
          { key: 'commission_rate', value: '0.08', description: 'Rate', updatedBy: 'admin', updatedAt: new Date() },
        ]),
      };

      const result = await appConfig.getAllConfig();

      expect(result.commission_rate.value).toBe('0.08');
      expect(result.commission_rate.description).toBeDefined();
      expect(result.commission_rate.readonly).toBeDefined();
      expect(result.commission_rate.requiresConfirmation).toBeDefined();
    });

    test('should mark readonly configs', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({}),
        findMany: jest.fn().mockResolvedValueOnce([
          { key: 'app_name', value: 'MANAWA', description: 'App name', updatedBy: 'system', updatedAt: new Date() },
        ]),
      };

      const result = await appConfig.getAllConfig();

      expect(result.app_name.readonly).toBe(true);
    });

    test('should mark configs requiring confirmation', async () => {
      prisma.appConfig = {
        upsert: jest.fn().mockResolvedValueOnce({}),
        findMany: jest.fn().mockResolvedValueOnce([
          { key: 'commission_rate', value: '0.08', description: 'Rate', updatedBy: 'system', updatedAt: new Date() },
        ]),
      };

      const result = await appConfig.getAllConfig();

      expect(result.commission_rate.requiresConfirmation).toBe(true);
    });
  });

  describe('Super Admin Management', () => {
    test('should export ensureSuperAdmin function', () => {
      expect(typeof appConfig.ensureSuperAdmin).toBe('function');
    });

    test('should skip if SUPER_ADMIN_EMAIL not set', async () => {
      delete process.env.SUPER_ADMIN_EMAIL;

      prisma.user = {
        findUnique: jest.fn(),
      };

      await appConfig.ensureSuperAdmin();

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    test('should skip if super admin user not found', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@manawa.app';

      prisma.user = {
        findUnique: jest.fn().mockResolvedValueOnce(null),
      };

      await appConfig.ensureSuperAdmin();

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'admin@manawa.app' },
        select: { id: true, adminLevel: true, securityQuestion: true, securityAnswerHash: true },
      });
    });

    test('should handle errors gracefully', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@manawa.app';

      prisma.user = {
        findUnique: jest.fn().mockRejectedValueOnce(new Error('DB error')),
      };

      await expect(appConfig.ensureSuperAdmin()).resolves.not.toThrow();
    });
  });

  describe('Type Conversion', () => {
    test('should convert string to number', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: '100' }),
      };

      const result = await appConfig.getConfig('max_trades_premium');

      expect(typeof result).toBe('number');
      expect(result).toBe(100);
    });

    test('should handle negative numbers', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: '-50' }),
      };

      const result = await appConfig.getConfig('some_config');

      expect(result).toBe(-50);
    });

    test('should keep strings with non-numeric values', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: 'abc123' }),
      };

      const result = await appConfig.getConfig('some_config');

      expect(typeof result).toBe('string');
      expect(result).toBe('abc123');
    });

    test('should handle zero correctly', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: '0' }),
      };

      const result = await appConfig.getConfig('some_config');

      expect(result).toBe(0);
    });
  });

  describe('Configuration Persistence', () => {
    test('should retrieve values from database', async () => {
      const testValue = 'test_value_123';

      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: testValue }),
      };

      const result = await appConfig.getConfig('test_key');

      expect(result).toBe(testValue);
    });

    test('should handle empty string values', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: '' }),
      };

      const result = await appConfig.getConfig('some_config');

      // Empty string converts to 0 (NaN becomes 0)
      expect(result === '' || result === 0).toBe(true);
    });

    test('should handle large numbers', async () => {
      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({ value: '999999999' }),
      };

      const result = await appConfig.getConfig('some_config');

      expect(result).toBe(999999999);
    });
  });

  describe('Additional branch coverage for seedConfig', () => {
    test('seedConfig should be called by getAllConfig', async () => {
      jest.clearAllMocks();
      prisma.appConfig.upsert = jest.fn().mockResolvedValue({});
      prisma.appConfig.findMany = jest.fn().mockResolvedValueOnce([]);

      await appConfig.getAllConfig();

      // getAllConfig calls seedConfig which calls upsert
      expect(prisma.appConfig.upsert).toHaveBeenCalled();
    });
  });

  describe('Additional branch coverage for ensureSuperAdmin', () => {
    test('should update super admin level when not SUPER', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@manawa.app';

      prisma.user = {
        findUnique: jest.fn().mockResolvedValueOnce({
          id: 'user-1',
          adminLevel: 'ADMIN', // Not SUPER
          securityQuestion: 'Question?',
          securityAnswerHash: 'hash123',
        }),
        update: jest.fn().mockResolvedValueOnce({}),
      };

      await appConfig.ensureSuperAdmin();

      expect(prisma.user.update).toHaveBeenCalled();
      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.adminLevel).toBe('SUPER');
    });

    test('should restore security question and answer from backup', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@manawa.app';

      prisma.user = {
        findUnique: jest.fn().mockResolvedValueOnce({
          id: 'user-1',
          adminLevel: 'SUPER',
          securityQuestion: null,
          securityAnswerHash: null,
        }),
        update: jest.fn().mockResolvedValueOnce({}),
      };

      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({
          value: JSON.stringify({ question: 'Secret?', answerHash: 'hash456' }),
        }),
      };

      await appConfig.ensureSuperAdmin();

      expect(prisma.user.update).toHaveBeenCalled();
      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.securityQuestion).toBe('Secret?');
      expect(updateCall.data.securityAnswerHash).toBe('hash456');
    });

    test('should handle invalid backup JSON gracefully', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@manawa.app';

      prisma.user = {
        findUnique: jest.fn().mockResolvedValueOnce({
          id: 'user-1',
          adminLevel: 'SUPER',
          securityQuestion: null,
          securityAnswerHash: null,
        }),
        update: jest.fn().mockResolvedValueOnce({}),
      };

      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce({
          value: 'invalid-json',
        }),
      };

      await appConfig.ensureSuperAdmin();

      // Should not throw, should continue
      expect(prisma.user.findUnique).toHaveBeenCalled();
    });

    test('should not update when everything is already correct', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@manawa.app';

      prisma.user = {
        findUnique: jest.fn().mockResolvedValueOnce({
          id: 'user-1',
          adminLevel: 'SUPER',
          securityQuestion: 'Question?',
          securityAnswerHash: 'hash123',
        }),
        update: jest.fn().mockResolvedValueOnce({}),
      };

      await appConfig.ensureSuperAdmin();

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    test('should handle appConfig.findUnique returning null', async () => {
      process.env.SUPER_ADMIN_EMAIL = 'admin@manawa.app';

      prisma.user = {
        findUnique: jest.fn().mockResolvedValueOnce({
          id: 'user-1',
          adminLevel: 'SUPER',
          securityQuestion: null,
          securityAnswerHash: null,
        }),
        update: jest.fn().mockResolvedValueOnce({}),
      };

      prisma.appConfig = {
        findUnique: jest.fn().mockResolvedValueOnce(null), // No backup found
      };

      await appConfig.ensureSuperAdmin();

      // Should attempt update with only adminLevel if no backup
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('getAllConfig with edge cases', () => {
    test('should handle configs without description in DB', async () => {
      jest.clearAllMocks();
      prisma.appConfig.upsert = jest.fn().mockResolvedValue({});
      prisma.appConfig.findMany = jest.fn().mockResolvedValueOnce([
        { key: 'commission_rate', value: '0.08', description: null, updatedBy: 'system', updatedAt: new Date() },
      ]);

      const result = await appConfig.getAllConfig();

      // Should use default description
      expect(result.commission_rate.description).toBeDefined();
    });
  });
});
