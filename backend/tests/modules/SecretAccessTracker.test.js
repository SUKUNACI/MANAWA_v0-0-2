const SecretAccessTracker = require('../../modules/SecretAccessTracker');
const crypto = require('crypto');

// Mock logger
jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

// Mock Prisma
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    secretAccessLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  return {
    PrismaClient: jest.fn(() => mockPrisma),
  };
});

const { PrismaClient } = require('@prisma/client');

describe('SecretAccessTracker', () => {
  let mockPrisma;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = new PrismaClient();
  });

  // ==================== hashSecret TESTS ====================
  describe('hashSecret', () => {
    test('should return SHA256 hash of exactly 64 hex characters', () => {
      const secret = 'test_secret';
      const hash = SecretAccessTracker.hashSecret(secret);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash.length).toBe(64);
    });

    test('should produce consistent hash for same input (deterministic)', () => {
      const secret = 'consistent_secret';
      const hash1 = SecretAccessTracker.hashSecret(secret);
      const hash2 = SecretAccessTracker.hashSecret(secret);

      expect(hash1).toBe(hash2);
    });

    test('should produce different hashes for different inputs', () => {
      const hash1 = SecretAccessTracker.hashSecret('secret1');
      const hash2 = SecretAccessTracker.hashSecret('secret2');

      expect(hash1).not.toBe(hash2);
    });

    test('should match crypto.createHash SHA256 implementation', () => {
      const secret = 'verify_implementation';
      const expected = crypto.createHash('sha256').update(secret).digest('hex');
      const actual = SecretAccessTracker.hashSecret(secret);

      expect(actual).toBe(expected);
    });

    test('should handle empty string', () => {
      const hash = SecretAccessTracker.hashSecret('');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle long strings', () => {
      const longSecret = 'a'.repeat(10000);
      const hash = SecretAccessTracker.hashSecret(longSecret);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ==================== logAccess TESTS ====================
  describe('logAccess', () => {
    test('should create log with hashed secretId when all required fields present', async () => {
      const mockLog = {
        id: 'log_123',
        secretId: 'hashed_id',
        secretType: 'JWT_SECRET',
        action: 'ACCESS',
        userId: 'user_123',
      };
      mockPrisma.secretAccessLog.create.mockResolvedValue(mockLog);

      const result = await SecretAccessTracker.logAccess({
        secretId: 'JWT_SECRET_RAW',
        secretType: 'JWT_SECRET',
        action: 'ACCESS',
        userId: 'user_123',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        reason: 'login',
      });

      expect(result).toEqual(mockLog);
      expect(mockPrisma.secretAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          secretType: 'JWT_SECRET',
          action: 'ACCESS',
          userId: 'user_123',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          reason: 'login',
        }),
      });
    });

    test('should use default reason "unspecified" if not provided', async () => {
      mockPrisma.secretAccessLog.create.mockResolvedValue({ id: 'log_123' });

      await SecretAccessTracker.logAccess({
        secretId: 'SECRET',
        secretType: 'JWT_SECRET',
        action: 'ACCESS',
        userId: 'user_123',
        ipAddress: '127.0.0.1',
        userAgent: 'Test',
      });

      expect(mockPrisma.secretAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reason: 'unspecified',
        }),
      });
    });

    test('should return null and log warning if secretId missing', async () => {
      const result = await SecretAccessTracker.logAccess({
        secretType: 'JWT_SECRET',
        action: 'ACCESS',
        userId: 'user_123',
        ipAddress: '127.0.0.1',
      });

      expect(result).toBeNull();
      expect(mockPrisma.secretAccessLog.create).not.toHaveBeenCalled();
    });

    test('should return null and log warning if secretType missing', async () => {
      const result = await SecretAccessTracker.logAccess({
        secretId: 'JWT_SECRET',
        action: 'ACCESS',
        userId: 'user_123',
        ipAddress: '127.0.0.1',
      });

      expect(result).toBeNull();
      expect(mockPrisma.secretAccessLog.create).not.toHaveBeenCalled();
    });

    test('should return null and log warning if action missing', async () => {
      const result = await SecretAccessTracker.logAccess({
        secretId: 'JWT_SECRET',
        secretType: 'JWT_SECRET',
        userId: 'user_123',
        ipAddress: '127.0.0.1',
      });

      expect(result).toBeNull();
      expect(mockPrisma.secretAccessLog.create).not.toHaveBeenCalled();
    });

    test('should return null and log warning if userId missing', async () => {
      const result = await SecretAccessTracker.logAccess({
        secretId: 'JWT_SECRET',
        secretType: 'JWT_SECRET',
        action: 'ACCESS',
        ipAddress: '127.0.0.1',
      });

      expect(result).toBeNull();
      expect(mockPrisma.secretAccessLog.create).not.toHaveBeenCalled();
    });

    test('should return null on database error', async () => {
      mockPrisma.secretAccessLog.create.mockRejectedValue(new Error('DB error'));

      const result = await SecretAccessTracker.logAccess({
        secretId: 'SECRET',
        secretType: 'JWT_SECRET',
        action: 'ACCESS',
        userId: 'user_123',
        ipAddress: '127.0.0.1',
        userAgent: 'Test',
      });

      expect(result).toBeNull();
    });

    test('should hash secretId before storing', async () => {
      mockPrisma.secretAccessLog.create.mockResolvedValue({ id: 'log_123' });

      await SecretAccessTracker.logAccess({
        secretId: 'RAW_SECRET_VALUE',
        secretType: 'JWT_SECRET',
        action: 'ACCESS',
        userId: 'user_123',
        ipAddress: '127.0.0.1',
        userAgent: 'Test',
      });

      const expectedHash = SecretAccessTracker.hashSecret('RAW_SECRET_VALUE');
      expect(mockPrisma.secretAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          secretId: expectedHash,
        }),
      });
    });
  });

  // ==================== getAccessHistory TESTS ====================
  describe('getAccessHistory', () => {
    test('should retrieve logs for secretType with default limit', async () => {
      const mockLogs = [
        { id: 'log_1', secretType: 'JWT_SECRET', action: 'ACCESS', timestamp: new Date() },
        { id: 'log_2', secretType: 'JWT_SECRET', action: 'ROTATE', timestamp: new Date() },
      ];
      mockPrisma.secretAccessLog.findMany.mockResolvedValue(mockLogs);

      const result = await SecretAccessTracker.getAccessHistory('JWT_SECRET');

      expect(result).toEqual(mockLogs);
      expect(mockPrisma.secretAccessLog.findMany).toHaveBeenCalledWith({
        where: { secretType: 'JWT_SECRET' },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
    });

    test('should filter by userId when provided', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([]);

      await SecretAccessTracker.getAccessHistory('JWT_SECRET', 50, 'user_123');

      expect(mockPrisma.secretAccessLog.findMany).toHaveBeenCalledWith({
        where: {
          secretType: 'JWT_SECRET',
          userId: 'user_123',
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });
    });

    test('should respect custom limit parameter', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([]);

      await SecretAccessTracker.getAccessHistory('JWT_SECRET', 25);

      expect(mockPrisma.secretAccessLog.findMany).toHaveBeenCalledWith({
        where: { secretType: 'JWT_SECRET' },
        orderBy: { timestamp: 'desc' },
        take: 25,
      });
    });

    test('should return empty array on error', async () => {
      mockPrisma.secretAccessLog.findMany.mockRejectedValue(new Error('DB error'));

      const result = await SecretAccessTracker.getAccessHistory('JWT_SECRET');

      expect(result).toEqual([]);
    });

    test('should not include userId in where clause if userId is null', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([]);

      await SecretAccessTracker.getAccessHistory('JWT_SECRET', 100, null);

      expect(mockPrisma.secretAccessLog.findMany).toHaveBeenCalledWith({
        where: { secretType: 'JWT_SECRET' },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
    });
  });

  // ==================== getUserAccessHistory TESTS ====================
  describe('getUserAccessHistory', () => {
    test('should retrieve all logs for userId with default limit', async () => {
      const mockLogs = [
        { id: 'log_1', userId: 'user_123', secretType: 'JWT_SECRET', action: 'ACCESS' },
        { id: 'log_2', userId: 'user_123', secretType: 'AWS_CREDENTIALS', action: 'ROTATE' },
      ];
      mockPrisma.secretAccessLog.findMany.mockResolvedValue(mockLogs);

      const result = await SecretAccessTracker.getUserAccessHistory('user_123');

      expect(result).toEqual(mockLogs);
      expect(mockPrisma.secretAccessLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_123' },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
    });

    test('should respect custom limit', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([]);

      await SecretAccessTracker.getUserAccessHistory('user_123', 50);

      expect(mockPrisma.secretAccessLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_123' },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });
    });

    test('should return empty array on error', async () => {
      mockPrisma.secretAccessLog.findMany.mockRejectedValue(new Error('DB error'));

      const result = await SecretAccessTracker.getUserAccessHistory('user_123');

      expect(result).toEqual([]);
    });
  });

  // ==================== detectAnomalies TESTS ====================
  describe('detectAnomalies', () => {
    test('should detect anomaly when > 5 accesses in time window', async () => {
      const mockLogs = Array.from({ length: 6 }, (_, i) => ({
        id: `log_${i}`,
        action: 'ACCESS',
        timestamp: new Date(),
      }));
      mockPrisma.secretAccessLog.findMany.mockResolvedValue(mockLogs);

      const result = await SecretAccessTracker.detectAnomalies('JWT_SECRET', 60);

      expect(result.isAnomaly).toBe(true);
      expect(result.accessCount).toBe(6);
      expect(result.logs).toEqual(mockLogs);
    });

    test('should not flag <= 5 accesses as anomaly', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([
        { id: 'log_1', action: 'ACCESS' },
        { id: 'log_2', action: 'ACCESS' },
      ]);

      const result = await SecretAccessTracker.detectAnomalies('JWT_SECRET', 60);

      expect(result.isAnomaly).toBe(false);
      expect(result.accessCount).toBe(2);
      expect(result.logs).toBeUndefined();
    });

    test('should calculate correct time window cutoff', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([]);

      await SecretAccessTracker.detectAnomalies('JWT_SECRET', 30);

      const call = mockPrisma.secretAccessLog.findMany.mock.calls[0][0];
      const cutoffTime = call.where.timestamp.gte;
      const now = Date.now();
      const expectedCutoff = now - 30 * 60 * 1000;

      expect(Math.abs(cutoffTime.getTime() - expectedCutoff)).toBeLessThan(1000);
    });

    test('should return object with error property on database error', async () => {
      mockPrisma.secretAccessLog.findMany.mockRejectedValue(new Error('DB error'));

      const result = await SecretAccessTracker.detectAnomalies('JWT_SECRET');

      expect(result.isAnomaly).toBe(false);
      expect(result.error).toBe('DB error');
    });
  });

  // ==================== exportAccessLogs TESTS ====================
  describe('exportAccessLogs', () => {
    test('should export all logs when no filters provided', async () => {
      const mockLogs = [
        { id: 'log_1', secretType: 'JWT_SECRET' },
        { id: 'log_2', secretType: 'AWS_CREDENTIALS' },
      ];
      mockPrisma.secretAccessLog.findMany.mockResolvedValue(mockLogs);

      const result = await SecretAccessTracker.exportAccessLogs();

      expect(result).toEqual(mockLogs);
      expect(mockPrisma.secretAccessLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { timestamp: 'desc' },
      });
    });

    test('should filter by secretType', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([]);

      await SecretAccessTracker.exportAccessLogs('JWT_SECRET');

      expect(mockPrisma.secretAccessLog.findMany).toHaveBeenCalledWith({
        where: { secretType: 'JWT_SECRET' },
        orderBy: { timestamp: 'desc' },
      });
    });

    test('should filter by date range', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([]);

      await SecretAccessTracker.exportAccessLogs(null, '2026-01-01', '2026-12-31');

      const call = mockPrisma.secretAccessLog.findMany.mock.calls[0][0];
      expect(call.where.timestamp.gte).toEqual(new Date('2026-01-01'));
      expect(call.where.timestamp.lte).toEqual(new Date('2026-12-31'));
    });

    test('should filter by both secretType and date range', async () => {
      mockPrisma.secretAccessLog.findMany.mockResolvedValue([]);

      await SecretAccessTracker.exportAccessLogs('JWT_SECRET', '2026-01-01', '2026-12-31');

      const call = mockPrisma.secretAccessLog.findMany.mock.calls[0][0];
      expect(call.where.secretType).toBe('JWT_SECRET');
      expect(call.where.timestamp).toBeDefined();
    });

    test('should return empty array on error', async () => {
      mockPrisma.secretAccessLog.findMany.mockRejectedValue(new Error('DB error'));

      const result = await SecretAccessTracker.exportAccessLogs();

      expect(result).toEqual([]);
    });
  });

  // ==================== cleanOldLogs TESTS ====================
  describe('cleanOldLogs', () => {
    test('should delete logs older than retention days', async () => {
      const mockResult = { count: 42 };
      mockPrisma.secretAccessLog.deleteMany.mockResolvedValue(mockResult);

      const result = await SecretAccessTracker.cleanOldLogs(90);

      expect(result).toEqual(mockResult);
      expect(result.count).toBe(42);
    });

    test('should calculate correct cutoff date', async () => {
      mockPrisma.secretAccessLog.deleteMany.mockResolvedValue({ count: 0 });

      const before = Date.now();
      await SecretAccessTracker.cleanOldLogs(30);
      const after = Date.now();

      const call = mockPrisma.secretAccessLog.deleteMany.mock.calls[0][0];
      const cutoffDate = call.where.timestamp.lt;
      const expectedMin = before - 30 * 24 * 60 * 60 * 1000;
      const expectedMax = after - 30 * 24 * 60 * 60 * 1000;

      expect(cutoffDate.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(cutoffDate.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    test('should return null on error', async () => {
      mockPrisma.secretAccessLog.deleteMany.mockRejectedValue(new Error('DB error'));

      const result = await SecretAccessTracker.cleanOldLogs(90);

      expect(result).toBeNull();
    });

    test('should use default retention of 90 days', async () => {
      mockPrisma.secretAccessLog.deleteMany.mockResolvedValue({ count: 0 });

      await SecretAccessTracker.cleanOldLogs();

      const call = mockPrisma.secretAccessLog.deleteMany.mock.calls[0][0];
      // Verify cutoff is approximately 90 days ago
      const cutoffDate = call.where.timestamp.lt;
      const expectedApprox = Date.now() - 90 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoffDate.getTime() - expectedApprox)).toBeLessThan(1000);
    });
  });

  // ==================== getSummaryStats TESTS ====================
  describe('getSummaryStats', () => {
    test('should return stats grouped by secretType and action', async () => {
      const mockStats = [
        { secretType: 'JWT_SECRET', action: 'ACCESS', _count: { id: 42 } },
        { secretType: 'AWS_CREDENTIALS', action: 'ROTATE', _count: { id: 5 } },
        { secretType: 'JWT_SECRET', action: 'ROTATE', _count: { id: 3 } },
      ];
      mockPrisma.secretAccessLog.groupBy.mockResolvedValue(mockStats);

      const result = await SecretAccessTracker.getSummaryStats();

      expect(result).toEqual(mockStats);
      expect(mockPrisma.secretAccessLog.groupBy).toHaveBeenCalledWith({
        by: ['secretType', 'action'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });
    });

    test('should return empty array on error', async () => {
      mockPrisma.secretAccessLog.groupBy.mockRejectedValue(new Error('DB error'));

      const result = await SecretAccessTracker.getSummaryStats();

      expect(result).toEqual([]);
    });

    test('should handle empty result set', async () => {
      mockPrisma.secretAccessLog.groupBy.mockResolvedValue([]);

      const result = await SecretAccessTracker.getSummaryStats();

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
