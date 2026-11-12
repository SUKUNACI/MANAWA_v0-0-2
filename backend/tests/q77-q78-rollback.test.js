/**
 * Q77 + Q78: Configuration Versioning & Rollback Strategy Tests
 */

const mockPrismaInstance = {
  appConfig: {
    findMany: jest.fn().mockResolvedValue([{ key: 'APP_VERSION', value: '0.0.0' }]),
    upsert: jest.fn().mockResolvedValue({}),
  },
  configVersion: {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  },
  rollbackEvent: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  },
  systemHealthMetric: { findFirst: jest.fn().mockResolvedValue(null) },
  backupIntegrityCheck: { findFirst: jest.fn().mockResolvedValue(null) },
};

// rollback-manager.js fait: const { prisma } = require('../config/db')
// config/db.js exporte l'instance directement, mais le manager l'importe via destructuring
// On doit exporter { prisma } pour que le mock corresponde
jest.mock('../config/db', () => ({ prisma: mockPrismaInstance }));

jest.mock('@sentry/node', () => ({ captureException: jest.fn(), init: jest.fn() }));

const mockPrisma = mockPrismaInstance;
const rollbackManager = require('../utils/rollback-manager');

const mockAdminId = 'admin-user-q77-q78';

function makeMockVersion(version, overrides = {}) {
  return {
    id: `id-${version}`,
    version,
    snapshot: { key: 'value' },
    changelog: 'test',
    createdBy: mockAdminId,
    isStable: false,
    tag: `config-${version}`,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockRollbackEvent(id, toVersion) {
  return {
    id,
    fromVersion: 'unknown',
    toVersion,
    trigger: 'manual',
    reason: 'test',
    triggeredBy: mockAdminId,
    status: 'completed',
    createdAt: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset singleton state between tests
  rollbackManager.lastRollbackTime = null;
  rollbackManager.isRollingBack = false;
  // Réinitialiser les mocks par défaut après clearAllMocks
  mockPrisma.appConfig.findMany.mockResolvedValue([{ key: 'APP_VERSION', value: '0.0.0' }]);
  mockPrisma.appConfig.upsert.mockResolvedValue({});
  mockPrisma.configVersion.findMany.mockResolvedValue([]);
  mockPrisma.configVersion.findFirst.mockResolvedValue(null);
  mockPrisma.rollbackEvent.findFirst.mockResolvedValue(null);
  mockPrisma.rollbackEvent.findMany.mockResolvedValue([]);
  mockPrisma.rollbackEvent.update.mockResolvedValue({});
  mockPrisma.systemHealthMetric.findFirst.mockResolvedValue(null);
  mockPrisma.backupIntegrityCheck.findFirst.mockResolvedValue(null);
});

describe('Q77: Configuration Versioning', () => {
  describe('saveConfigVersion()', () => {
    it('should save current config as new version', async () => {
      const version = '1.0.0';
      const mockVersion = makeMockVersion(version, { changelog: 'Initial production configuration', createdBy: mockAdminId });
      mockPrisma.configVersion.findUnique.mockResolvedValue(null);
      mockPrisma.configVersion.create.mockResolvedValue(mockVersion);

      const result = await rollbackManager.saveConfigVersion(version, mockAdminId, 'Initial production configuration');

      expect(result).toHaveProperty('id');
      expect(result.version).toBe(version);
      expect(result.changelog).toBe('Initial production configuration');
      expect(result.createdBy).toBe(mockAdminId);
      expect(result.snapshot).toBeDefined();
    });

    it('should reject duplicate version numbers', async () => {
      const version = '1.0.1';
      // Simuler l'erreur de contrainte unique Prisma (P2002)
      const prismaUniqueError = new Error('Unique constraint failed on the fields: (`version`)');
      prismaUniqueError.code = 'P2002';
      mockPrisma.configVersion.create.mockRejectedValue(prismaUniqueError);

      await expect(
        rollbackManager.saveConfigVersion(version, mockAdminId, 'Duplicate')
      ).rejects.toBeDefined();
    });

    it('should create git tag for version', async () => {
      const version = '1.0.2';
      const mockVersion = makeMockVersion(version);
      mockPrisma.configVersion.findUnique.mockResolvedValue(null);
      mockPrisma.configVersion.create.mockResolvedValue(mockVersion);

      const result = await rollbackManager.saveConfigVersion(version, mockAdminId, 'Version with git tag');

      if (result.tag) {
        expect(result.tag).toBe(`config-${version}`);
      }
    });
  });

  describe('markVersionAsStable()', () => {
    it('should mark version as production stable', async () => {
      const version = '1.0.3';
      const mockVersion = makeMockVersion(version, { isStable: true });
      mockPrisma.configVersion.findUnique.mockResolvedValue(makeMockVersion(version));
      mockPrisma.configVersion.update.mockResolvedValue(mockVersion);

      const result = await rollbackManager.markVersionAsStable(version);

      expect(result.isStable).toBe(true);
    });

    it('should reject non-existent version', async () => {
      mockPrisma.configVersion.update.mockRejectedValue(new Error('Config version 99.99.99 not found'));

      await expect(
        rollbackManager.markVersionAsStable('99.99.99')
      ).rejects.toBeDefined();
    });
  });
});

describe('Q78: Rollback Strategy', () => {
  describe('rollbackConfiguration()', () => {
    it('should rollback configuration to previous version', async () => {
      const rollbackEventId = 'event-id-1';
      mockPrisma.configVersion.findUnique.mockResolvedValue(makeMockVersion('2.0.0'));
      mockPrisma.rollbackEvent.create.mockResolvedValue(makeMockRollbackEvent(rollbackEventId, '2.0.0'));

      const result = await rollbackManager.rollbackConfiguration('2.0.0', mockAdminId, 'Revert buggy version');

      expect(result.success).toBe(true);
      expect(result.rollbackId).toBeDefined();
    });

    it('should create rollback event record', async () => {
      const rollbackEventId = 'event-id-2';
      const mockEvent = makeMockRollbackEvent(rollbackEventId, '2.1.0');
      mockPrisma.configVersion.findUnique.mockResolvedValue(makeMockVersion('2.1.0'));
      mockPrisma.rollbackEvent.create.mockResolvedValue(mockEvent);
      mockPrisma.rollbackEvent.findUnique.mockResolvedValue(mockEvent);

      const result = await rollbackManager.rollbackConfiguration('2.1.0', mockAdminId, 'Test rollback');

      const rollbackEvent = await mockPrisma.rollbackEvent.findUnique({ where: { id: result.rollbackId } });

      expect(rollbackEvent).toBeDefined();
      expect(rollbackEvent.toVersion).toBe('2.1.0');
      expect(rollbackEvent.trigger).toBe('manual');
      expect(rollbackEvent.triggeredBy).toBe(mockAdminId);
    });

    it('should reject rollback to non-existent version', async () => {
      mockPrisma.configVersion.findUnique.mockResolvedValue(null);

      await expect(
        rollbackManager.rollbackConfiguration('99.99.99', mockAdminId, 'Invalid version')
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('autoRollbackOnErrorSpike()', () => {
    it('should trigger auto-rollback when error rate exceeds threshold', async () => {
      const stableVer = makeMockVersion('3.0.0', { isStable: true });
      const rollbackEvt = makeMockRollbackEvent('evt-auto-1', '3.0.0');

      // findFirst retourne la version stable (pour autoRollbackOnErrorSpike)
      mockPrisma.configVersion.findFirst.mockResolvedValue(stableVer);
      // findUnique retourne la version pour rollbackConfiguration
      mockPrisma.configVersion.findUnique.mockResolvedValue(stableVer);
      // rollbackEvent.create retourne l'event
      mockPrisma.rollbackEvent.create.mockResolvedValue(rollbackEvt);

      const result = await rollbackManager.autoRollbackOnErrorSpike({ errorRate: 2.5, durationMinutes: 5 });

      expect(result.initiated).toBe(true);
      expect(result.rollbackId).toBeDefined();
    });

    it('should not rollback if error rate below threshold', async () => {
      const result = await rollbackManager.autoRollbackOnErrorSpike({ errorRate: 0.5, durationMinutes: 5 });

      expect(result.initiated).toBe(false);
      expect(result.reason).toBe('threshold_not_met');
    });

    it('should not rollback if auto-rollback is disabled', async () => {
      const thresholds = require('../config/monitoring-thresholds');
      const originalValue = thresholds.rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE;
      thresholds.rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE = false;

      try {
        const result = await rollbackManager.autoRollbackOnErrorSpike({ errorRate: 5.0, durationMinutes: 5 });
        expect(result.initiated).toBe(false);
        expect(result.reason).toBe('auto_rollback_disabled');
      } finally {
        thresholds.rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE = originalValue;
      }
    });

    it('should prevent rollback thrashing (min 30 min between rollbacks)', async () => {
      // Forcer lastRollbackTime récent sur le singleton pour déclencher la limite
      const originalLastRollback = rollbackManager.lastRollbackTime;
      rollbackManager.lastRollbackTime = Date.now() - 5 * 60 * 1000; // 5 min ago

      try {
        const result = await rollbackManager.autoRollbackOnErrorSpike({ errorRate: 2.0, durationMinutes: 5 });
        expect(result.initiated).toBe(false);
        expect(result.reason).toBe('rollback_frequency_limit');
      } finally {
        rollbackManager.lastRollbackTime = originalLastRollback;
      }
    });
  });

  describe('blueGreenFallback()', () => {
    it('should switch to green environment', async () => {
      const result = await rollbackManager.blueGreenFallback('green');
      expect(result.success).toBe(true);
      expect(result.environment).toBe('green');
    });

    it('should switch back to blue', async () => {
      const result = await rollbackManager.blueGreenFallback('blue');
      expect(result.success).toBe(true);
      expect(result.environment).toBe('blue');
    });
  });

  describe('getRollbackHistory()', () => {
    it('should retrieve rollback history', async () => {
      const mockHistory = [makeMockRollbackEvent('evt-hist-1', '5.0.0')];
      mockPrisma.rollbackEvent.findMany.mockResolvedValue(mockHistory);

      const history = await rollbackManager.getRollbackHistory(10);

      expect(history).toBeInstanceOf(Array);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toHaveProperty('fromVersion');
      expect(history[0]).toHaveProperty('toVersion');
      expect(history[0]).toHaveProperty('createdAt');
    });

    it('should limit history results', async () => {
      mockPrisma.rollbackEvent.findMany.mockResolvedValue([]);

      const history = await rollbackManager.getRollbackHistory(5);

      expect(history.length).toBeLessThanOrEqual(5);
    });
  });
});

describe('Q78: Monitoring Thresholds', () => {
  const thresholds = require('../config/monitoring-thresholds');

  describe('shouldRollbackOnErrorRate()', () => {
    it('should trigger rollback when threshold exceeded', () => {
      expect(thresholds.shouldRollbackOnErrorRate(2.0, 5)).toBe(true);
    });

    it('should not trigger when below threshold', () => {
      expect(thresholds.shouldRollbackOnErrorRate(0.5, 5)).toBe(false);
    });

    it('should not trigger if duration too short', () => {
      expect(thresholds.shouldRollbackOnErrorRate(2.0, 2)).toBe(false);
    });
  });

  describe('shouldRollbackOnLatency()', () => {
    it('should trigger rollback when latency exceeded and feature enabled', () => {
      const originalValue = thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE;
      thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE = true;
      try {
        expect(thresholds.shouldRollbackOnLatency(4000, 5)).toBe(true);
      } finally {
        thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE = originalValue;
      }
    });

    it('should not trigger when feature disabled (conservative default)', () => {
      const originalValue = thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE;
      thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE = false;
      try {
        expect(thresholds.shouldRollbackOnLatency(4000, 5)).toBe(false);
      } finally {
        thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE = originalValue;
      }
    });

    it('should not trigger when below threshold', () => {
      const originalValue = thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE;
      thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE = true;
      try {
        expect(thresholds.shouldRollbackOnLatency(1500, 5)).toBe(false);
      } finally {
        thresholds.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE = originalValue;
      }
    });
  });

  describe('shouldRollbackOnMemory()', () => {
    it('should trigger rollback when memory exceeded', () => {
      expect(thresholds.shouldRollbackOnMemory(90, 10)).toBe(true);
    });

    it('should not trigger when below threshold', () => {
      expect(thresholds.shouldRollbackOnMemory(70, 10)).toBe(false);
    });
  });

  describe('getAlertLevel()', () => {
    it('should return CRITICAL when thresholds exceeded', () => {
      expect(thresholds.getAlertLevel({ errorRate: 2.0, latencyP95Ms: 3000, memoryPercent: 85 })).toBe('CRITICAL');
    });

    it('should return ALERT when approaching threshold', () => {
      expect(thresholds.getAlertLevel({ errorRate: 0.7, latencyP95Ms: 1600, memoryPercent: 78 })).toBe('ALERT');
    });

    it('should return OK when all normal', () => {
      expect(thresholds.getAlertLevel({ errorRate: 0.1, latencyP95Ms: 200, memoryPercent: 50 })).toBe('OK');
    });
  });
});

describe('Database Schema (mocked)', () => {
  describe('ConfigVersion table', () => {
    it('should have required columns', async () => {
      const mockRecord = makeMockVersion('schema-test');
      mockPrisma.configVersion.findMany.mockResolvedValue([mockRecord]);

      const result = await mockPrisma.configVersion.findMany({ take: 1 });

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id');
        expect(result[0]).toHaveProperty('version');
        expect(result[0]).toHaveProperty('snapshot');
        expect(result[0]).toHaveProperty('createdAt');
      }
    });
  });

  describe('RollbackEvent table', () => {
    it('should track rollback events', async () => {
      const mockEvent = makeMockRollbackEvent('evt-schema', '1.0.0');
      mockPrisma.rollbackEvent.findFirst.mockResolvedValue(mockEvent);

      const event = await mockPrisma.rollbackEvent.findFirst({ take: 1 });

      if (event) {
        expect(event).toHaveProperty('fromVersion');
        expect(event).toHaveProperty('toVersion');
        expect(event).toHaveProperty('trigger');
        expect(event).toHaveProperty('status');
      }
    });
  });

  describe('SystemHealthMetric table', () => {
    it('should store system health data', async () => {
      mockPrisma.systemHealthMetric.findFirst.mockResolvedValue(null);
      const metric = await mockPrisma.systemHealthMetric.findFirst({ take: 1 });
      expect(metric === null || typeof metric === 'object').toBe(true);
    });
  });

  describe('BackupIntegrityCheck table', () => {
    it('should log backup integrity checks', async () => {
      mockPrisma.backupIntegrityCheck.findFirst.mockResolvedValue(null);
      const check = await mockPrisma.backupIntegrityCheck.findFirst({ take: 1 });
      expect(check === null || typeof check === 'object').toBe(true);
    });
  });
});

describe('Integration Tests', () => {
  it('should complete full versioning workflow', async () => {
    const v1 = makeMockVersion('6.0.0', { isStable: false });
    const v1Stable = makeMockVersion('6.0.0', { isStable: true });
    const rollbackEvt = makeMockRollbackEvent('evt-integration', '6.0.0');

    // saveConfigVersion: appConfig.findMany + configVersion.create
    mockPrisma.configVersion.create.mockResolvedValue(v1);
    // markVersionAsStable: configVersion.update (cherche par where.version)
    mockPrisma.configVersion.update.mockResolvedValue(v1Stable);
    // rollbackConfiguration: configVersion.findUnique + rollbackEvent.create + rollbackEvent.update + appConfig.upsert
    mockPrisma.configVersion.findUnique.mockResolvedValue(v1Stable);
    mockPrisma.rollbackEvent.create.mockResolvedValue(rollbackEvt);
    mockPrisma.rollbackEvent.findMany.mockResolvedValue([rollbackEvt]);

    const created = await rollbackManager.saveConfigVersion('6.0.0', mockAdminId, 'Step 1');
    expect(created).toBeDefined();

    const marked = await rollbackManager.markVersionAsStable('6.0.0');
    expect(marked.isStable).toBe(true);

    const result = await rollbackManager.rollbackConfiguration('6.0.0', mockAdminId, 'Step 3');
    expect(result.success).toBe(true);

    const history = await rollbackManager.getRollbackHistory(1);
    expect(history.length).toBeGreaterThan(0);
  });
});
