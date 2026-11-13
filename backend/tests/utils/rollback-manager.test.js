/**
 * Tests for RollbackManager (Q77/Q78)
 * Tests configuration rollback, database rollback, auto-rollback, and helpers
 */

jest.mock('../../config/db', () => ({
  prisma: {
    appConfig: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    configVersion: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    rollbackEvent: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('child_process', () => {
  const util = jest.requireActual('util');
  const execFn = jest.fn();
  // util.promisify uses this custom symbol to return { stdout, stderr } like the real exec
  execFn[util.promisify.custom] = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
  return { exec: execFn };
});

jest.mock('../../config/monitoring-thresholds', () => ({
  rollback: {
    MIN_INTERVAL_BETWEEN_ROLLBACKS_MINUTES: 30,
    AUTO_ROLLBACK_ON_ERROR_SPIKE: true,
    SENTRY_ENABLED: false,
    SLACK_WEBHOOK_URL: null,
    NOTIFICATION_EMAILS: [],
  },
  errorRate: {
    CRITICAL_THRESHOLD: 1.0,
    MONITOR_WINDOW_MINUTES: 5,
  },
  shouldRollbackOnErrorRate: jest.fn(),
}));

jest.mock('../../config/redis', () => ({
  del: jest.fn().mockResolvedValue(1),
  get: jest.fn(),
  set: jest.fn(),
}));

jest.mock('../../utils/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}), { virtual: true });

describe('RollbackManager', () => {
  let manager;
  let prismaDb;
  let thresholds;
  let execAsyncMock;
  const util = require('util');

  beforeEach(() => {
    jest.clearAllMocks();

    const { prisma } = require('../../config/db');
    prismaDb = prisma;
    thresholds = require('../../config/monitoring-thresholds');
    const { exec } = require('child_process');
    // util.promisify(exec) will use exec[util.promisify.custom]
    execAsyncMock = exec[util.promisify.custom];

    manager = require('../../utils/rollback-manager');
    // Reset singleton state between tests
    manager.lastRollbackTime = null;
    manager.isRollingBack = false;
  });

  // ─────────────────────────────────────────────
  // rollbackConfiguration
  // ─────────────────────────────────────────────
  describe('rollbackConfiguration', () => {
    it('should rollback configuration to target version successfully', async () => {
      // Arrange
      prismaDb.appConfig.findMany.mockResolvedValue([
        { key: 'APP_VERSION', value: '1.0.0' },
      ]);
      prismaDb.configVersion.findUnique.mockResolvedValue({
        version: '0.9.0',
        snapshot: { APP_VERSION: '0.9.0', FEATURE_X: 'false' },
      });
      prismaDb.rollbackEvent.create.mockResolvedValue({ id: 'evt-1' });
      prismaDb.appConfig.upsert.mockResolvedValue({});
      prismaDb.rollbackEvent.update.mockResolvedValue({});

      // Act
      const result = await manager.rollbackConfiguration('0.9.0', 'admin-1', 'rollback test');

      // Assert
      expect(result.success).toBe(true);
      expect(result.rollbackId).toBe('evt-1');
      expect(prismaDb.configVersion.findUnique).toHaveBeenCalledWith({
        where: { version: '0.9.0' },
      });
      expect(prismaDb.rollbackEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            toVersion: '0.9.0',
            status: 'IN_PROGRESS',
          }),
        })
      );
    });

    it('should throw when target version is not found', async () => {
      // Arrange
      prismaDb.appConfig.findMany.mockResolvedValue([]);
      prismaDb.configVersion.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        manager.rollbackConfiguration('9.9.9', 'admin-1', 'test')
      ).rejects.toThrow('Config version 9.9.9 not found');
    });

    it('should use "unknown" as fromVersion when APP_VERSION config key is missing', async () => {
      // Arrange
      prismaDb.appConfig.findMany.mockResolvedValue([]);
      prismaDb.configVersion.findUnique.mockResolvedValue({
        version: '1.0.0',
        snapshot: { KEY: 'value' },
      });
      prismaDb.rollbackEvent.create.mockResolvedValue({ id: 'evt-2' });
      prismaDb.appConfig.upsert.mockResolvedValue({});
      prismaDb.rollbackEvent.update.mockResolvedValue({});

      // Act
      const result = await manager.rollbackConfiguration('1.0.0', 'system', 'reason');

      // Assert
      expect(result.success).toBe(true);
      expect(prismaDb.rollbackEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fromVersion: 'unknown' }),
        })
      );
    });

    it('should mark rollback event as COMPLETED on success', async () => {
      // Arrange
      prismaDb.appConfig.findMany.mockResolvedValue([]);
      prismaDb.configVersion.findUnique.mockResolvedValue({
        version: '1.0.0',
        snapshot: {},
      });
      prismaDb.rollbackEvent.create.mockResolvedValue({ id: 'evt-3' });
      prismaDb.rollbackEvent.update.mockResolvedValue({});

      // Act
      await manager.rollbackConfiguration('1.0.0', 'system', 'test');

      // Assert
      expect(prismaDb.rollbackEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        })
      );
    });
  });

  // ─────────────────────────────────────────────
  // rollbackDatabase
  // ─────────────────────────────────────────────
  describe('rollbackDatabase', () => {
    beforeEach(() => {
      execAsyncMock.mockResolvedValue({ stdout: 'restore completed', stderr: '' });
    });

    it('should rollback database successfully', async () => {
      // Arrange
      prismaDb.rollbackEvent.create.mockResolvedValue({ id: 'db-evt-1' });
      prismaDb.rollbackEvent.update.mockResolvedValue({});

      // Act
      const result = await manager.rollbackDatabase('backup-123', 'admin-1');

      // Assert
      expect(result.success).toBe(true);
      expect(result.rollbackId).toBe('db-evt-1');
    });

    it('should throw when rollback is too frequent', async () => {
      // Arrange - set lastRollbackTime to 5 minutes ago (less than 30 min threshold)
      manager.lastRollbackTime = Date.now() - 5 * 60 * 1000;

      // Act & Assert
      await expect(
        manager.rollbackDatabase('backup-123')
      ).rejects.toThrow(/too frequent/i);
    });

    it('should mark rollback event as FAILED when exec fails', async () => {
      // Arrange
      prismaDb.rollbackEvent.create.mockResolvedValue({ id: 'db-evt-fail' });
      prismaDb.rollbackEvent.update.mockResolvedValue({});
      execAsyncMock.mockRejectedValueOnce(new Error('pg_restore failed'));

      // Act & Assert
      await expect(
        manager.rollbackDatabase('backup-fail', 'system')
      ).rejects.toThrow(/failed/i);

      expect(prismaDb.rollbackEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        })
      );
    });
  });

  // ─────────────────────────────────────────────
  // autoRollbackOnErrorSpike
  // ─────────────────────────────────────────────
  describe('autoRollbackOnErrorSpike', () => {
    it('should return not initiated when auto-rollback is disabled', async () => {
      // Arrange
      thresholds.rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE = false;

      // Act
      const result = await manager.autoRollbackOnErrorSpike({
        errorRate: 50,
        durationMinutes: 10,
      });

      // Assert
      expect(result.initiated).toBe(false);
      expect(result.reason).toBe('auto_rollback_disabled');

      // Restore
      thresholds.rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE = true;
    });

    it('should return not initiated when too soon for rollback', async () => {
      // Arrange
      thresholds.rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE = true;
      manager.lastRollbackTime = Date.now() - 5 * 60 * 1000; // 5 min ago

      // Act
      const result = await manager.autoRollbackOnErrorSpike({
        errorRate: 50,
        durationMinutes: 10,
      });

      // Assert
      expect(result.initiated).toBe(false);
      expect(result.reason).toBe('rollback_frequency_limit');
    });

    it('should return not initiated when threshold is not met', async () => {
      // Arrange
      thresholds.shouldRollbackOnErrorRate.mockReturnValue(false);

      // Act
      const result = await manager.autoRollbackOnErrorSpike({
        errorRate: 0.1,
        durationMinutes: 1,
      });

      // Assert
      expect(result.initiated).toBe(false);
      expect(result.reason).toBe('threshold_not_met');
    });

    it('should initiate rollback when threshold is met and stable version exists', async () => {
      // Arrange
      thresholds.shouldRollbackOnErrorRate.mockReturnValue(true);
      prismaDb.configVersion.findFirst.mockResolvedValue({
        version: '1.0.0',
        isStable: true,
      });
      prismaDb.appConfig.findMany.mockResolvedValue([]);
      prismaDb.configVersion.findUnique.mockResolvedValue({
        version: '1.0.0',
        snapshot: {},
      });
      prismaDb.rollbackEvent.create.mockResolvedValue({ id: 'auto-evt-1' });
      prismaDb.rollbackEvent.update.mockResolvedValue({});

      // Act
      const result = await manager.autoRollbackOnErrorSpike({
        errorRate: 5,
        durationMinutes: 10,
      });

      // Assert
      expect(result.initiated).toBe(true);
      expect(result.rollbackId).toBe('auto-evt-1');
    });

    it('should return error when no stable version is found', async () => {
      // Arrange
      thresholds.shouldRollbackOnErrorRate.mockReturnValue(true);
      prismaDb.configVersion.findFirst.mockResolvedValue(null);

      // Act
      const result = await manager.autoRollbackOnErrorSpike({
        errorRate: 5,
        durationMinutes: 10,
      });

      // Assert
      expect(result.initiated).toBe(false);
      expect(result.error).toMatch(/no stable version/i);
    });
  });

  // ─────────────────────────────────────────────
  // rollbackCode
  // ─────────────────────────────────────────────
  describe('rollbackCode', () => {
    it('should perform git revert successfully', async () => {
      // Arrange
      execAsyncMock.mockResolvedValueOnce({ stdout: 'Revert "bad commit"', stderr: '' });

      // Act
      const result = await manager.rollbackCode('abc1234', 'admin-1');

      // Assert
      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('abc1234');
    });

    it('should throw when git revert fails', async () => {
      // Arrange
      execAsyncMock.mockRejectedValueOnce(new Error('git revert failed'));

      // Act & Assert
      await expect(manager.rollbackCode('badcommit')).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────
  // blueGreenFallback
  // ─────────────────────────────────────────────
  describe('blueGreenFallback', () => {
    it('should switch to blue environment successfully', async () => {
      // Act
      const result = await manager.blueGreenFallback('blue');

      // Assert
      expect(result.success).toBe(true);
      expect(result.environment).toBe('blue');
    });

    it('should switch to green environment successfully', async () => {
      // Act
      const result = await manager.blueGreenFallback('green');

      // Assert
      expect(result.success).toBe(true);
      expect(result.environment).toBe('green');
    });
  });

  // ─────────────────────────────────────────────
  // saveConfigVersion
  // ─────────────────────────────────────────────
  describe('saveConfigVersion', () => {
    it('should save a new config version successfully', async () => {
      // Arrange
      prismaDb.appConfig.findMany.mockResolvedValue([
        { key: 'APP_VERSION', value: '1.1.0' },
        { key: 'FEATURE_X', value: 'true' },
      ]);
      prismaDb.configVersion.create.mockResolvedValue({
        id: 'cv-1',
        version: '1.1.0',
        snapshot: { APP_VERSION: '1.1.0', FEATURE_X: 'true' },
      });
      execAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

      // Act
      const result = await manager.saveConfigVersion('1.1.0', 'admin-1', 'New features');

      // Assert
      expect(result.version).toBe('1.1.0');
      expect(prismaDb.configVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: '1.1.0',
            createdBy: 'admin-1',
            changelog: 'New features',
          }),
        })
      );
    });

    it('should save config version even when git tag creation fails', async () => {
      // Arrange
      prismaDb.appConfig.findMany.mockResolvedValue([]);
      prismaDb.configVersion.create.mockResolvedValue({
        id: 'cv-2',
        version: '1.2.0',
      });
      execAsyncMock.mockRejectedValueOnce(new Error('not a git repo'));

      // Act
      const result = await manager.saveConfigVersion('1.2.0', 'admin-1', 'Test');

      // Assert
      expect(result).toBeDefined();
      expect(prismaDb.configVersion.create).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // markVersionAsStable
  // ─────────────────────────────────────────────
  describe('markVersionAsStable', () => {
    it('should mark a version as stable', async () => {
      // Arrange
      prismaDb.configVersion.update.mockResolvedValue({
        version: '1.0.0',
        isStable: true,
      });

      // Act
      const result = await manager.markVersionAsStable('1.0.0');

      // Assert
      expect(result.isStable).toBe(true);
      expect(prismaDb.configVersion.update).toHaveBeenCalledWith({
        where: { version: '1.0.0' },
        data: { isStable: true },
      });
    });

    it('should throw when version does not exist', async () => {
      // Arrange
      prismaDb.configVersion.update.mockRejectedValue(
        new Error('Record not found')
      );

      // Act & Assert
      await expect(manager.markVersionAsStable('99.0.0')).rejects.toThrow(
        'Record not found'
      );
    });
  });

  // ─────────────────────────────────────────────
  // getRollbackHistory
  // ─────────────────────────────────────────────
  describe('getRollbackHistory', () => {
    it('should return rollback history with default limit 50', async () => {
      // Arrange
      const events = [{ id: '1' }, { id: '2' }];
      prismaDb.rollbackEvent.findMany.mockResolvedValue(events);

      // Act
      const result = await manager.getRollbackHistory();

      // Assert
      expect(result).toEqual(events);
      expect(prismaDb.rollbackEvent.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('should respect custom limit', async () => {
      // Arrange
      prismaDb.rollbackEvent.findMany.mockResolvedValue([]);

      // Act
      await manager.getRollbackHistory(10);

      // Assert
      expect(prismaDb.rollbackEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });

    it('should throw when database query fails', async () => {
      // Arrange
      prismaDb.rollbackEvent.findMany.mockRejectedValue(new Error('DB error'));

      // Act & Assert
      await expect(manager.getRollbackHistory()).rejects.toThrow('DB error');
    });
  });

  // ─────────────────────────────────────────────
  // _isTooSoonForRollback (private, tested via behavior)
  // ─────────────────────────────────────────────
  describe('_isTooSoonForRollback (internal)', () => {
    it('should return false when no previous rollback occurred', () => {
      manager.lastRollbackTime = null;
      expect(manager._isTooSoonForRollback()).toBe(false);
    });

    it('should return true when last rollback was recent', () => {
      // 5 minutes ago, threshold is 30 minutes
      manager.lastRollbackTime = Date.now() - 5 * 60 * 1000;
      expect(manager._isTooSoonForRollback()).toBe(true);
    });

    it('should return false when enough time has passed', () => {
      // 35 minutes ago, threshold is 30 minutes
      manager.lastRollbackTime = Date.now() - 35 * 60 * 1000;
      expect(manager._isTooSoonForRollback()).toBe(false);
    });
  });
});
