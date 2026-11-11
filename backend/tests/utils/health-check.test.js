/**
 * Health Check Utility Tests
 * Tests database connection monitoring and health status reporting
 */

jest.mock('../../config/db');
jest.mock('../../utils/logger');

describe('Health Check Utility', () => {
  let healthCheck;
  let prisma;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = require('../../config/db');
    logger = require('../../utils/logger');

    healthCheck = require('../../utils/health-check');
  });

  describe('Exports', () => {
    test('should export checkDatabaseHealth function', () => {
      expect(typeof healthCheck.checkDatabaseHealth).toBe('function');
    });
  });

  describe('Successful Database Health Check', () => {
    test('should return healthy status on successful database connection', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('healthy');
    });

    test('should include timestamp in response', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
    });

    test('should use ISO format for timestamp', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      const result = await healthCheck.checkDatabaseHealth();

      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('should execute SELECT 1 query', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      await healthCheck.checkDatabaseHealth();

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    test('should have recent timestamp', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      const beforeTime = new Date();
      const result = await healthCheck.checkDatabaseHealth();
      const afterTime = new Date();

      const resultTime = new Date(result.timestamp);

      expect(resultTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);
      expect(resultTime.getTime()).toBeLessThanOrEqual(afterTime.getTime() + 1000);
    });
  });

  describe('Database Connection Failures', () => {
    test('should return unhealthy status on connection error', async () => {
      const connectionError = new Error('Connection refused');
      connectionError.code = 'ECONNREFUSED';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(connectionError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
    });

    test('should include error message on failure', async () => {
      const connectionError = new Error('Connection timeout');
      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(connectionError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.error).toBe('Connection timeout');
    });

    test('should include error code when available', async () => {
      const connectionError = new Error('Database error');
      connectionError.code = 'P2002';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(connectionError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.code).toBe('P2002');
    });

    test('should handle Prisma connection errors', async () => {
      const prismaError = new Error('PrismaClientInitializationError');
      prismaError.code = 'P1000';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(prismaError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('PrismaClientInitializationError');
      expect(result.code).toBe('P1000');
    });

    test('should handle timeout errors', async () => {
      const timeoutError = new Error('Query timeout');
      timeoutError.code = 'ETIMEDOUT';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(timeoutError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Query timeout');
    });

    test('should log errors to logger', async () => {
      const connectionError = new Error('Database connection failed');
      connectionError.code = 'ECONNREFUSED';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(connectionError);

      await healthCheck.checkDatabaseHealth();

      expect(logger.error).toHaveBeenCalled();
      const errorCall = logger.error.mock.calls[0];
      expect(errorCall[0]).toContain('health check');
    });

    test('should include error details in logging', async () => {
      const connectionError = new Error('Connection pool exhausted');
      connectionError.code = 'POOL_ERROR';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(connectionError);

      await healthCheck.checkDatabaseHealth();

      expect(logger.error).toHaveBeenCalled();
      const errorCall = logger.error.mock.calls[0];
      expect(errorCall[1]).toBeDefined();
    });
  });

  describe('Response Format', () => {
    test('should always return object with status field', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      const result = await healthCheck.checkDatabaseHealth();

      expect(typeof result).toBe('object');
      expect(result.status).toBeDefined();
    });

    test('should have only status and timestamp on success', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      const result = await healthCheck.checkDatabaseHealth();

      expect(Object.keys(result)).toContain('status');
      expect(Object.keys(result)).toContain('timestamp');
    });

    test('should have status, error, code, and timestamp on failure', async () => {
      const connectionError = new Error('Failed');
      connectionError.code = 'ERROR_CODE';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(connectionError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(Object.keys(result)).toContain('status');
      expect(Object.keys(result)).toContain('error');
      expect(Object.keys(result)).toContain('code');
      expect(Object.keys(result)).toContain('timestamp');
    });

    test('should have status=healthy or status=unhealthy', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([]);

      const result1 = await healthCheck.checkDatabaseHealth();
      expect(['healthy', 'unhealthy']).toContain(result1.status);

      const error = new Error('Connection failed');
      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(error);

      const result2 = await healthCheck.checkDatabaseHealth();
      expect(['healthy', 'unhealthy']).toContain(result2.status);
    });
  });

  describe('Different Error Types', () => {
    test('should handle syntax errors', async () => {
      const syntaxError = new Error('syntax error');
      syntaxError.code = 'SYNTAX_ERROR';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(syntaxError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toContain('syntax error');
    });

    test('should handle authentication errors', async () => {
      const authError = new Error('invalid password');
      authError.code = 'P1000';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(authError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
    });

    test('should handle database not found errors', async () => {
      const notFoundError = new Error('database does not exist');
      notFoundError.code = 'ENOTFOUND';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(notFoundError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
    });

    test('should handle permission denied errors', async () => {
      const permError = new Error('permission denied');
      permError.code = 'EACCES';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(permError);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
    });
  });

  describe('Concurrent Checks', () => {
    test('should handle multiple simultaneous health checks', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

      const results = await Promise.all([
        healthCheck.checkDatabaseHealth(),
        healthCheck.checkDatabaseHealth(),
        healthCheck.checkDatabaseHealth(),
      ]);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.status).toBe('healthy');
      });
    });

    test('should handle rapid successive checks', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      const result1 = await healthCheck.checkDatabaseHealth();
      const result2 = await healthCheck.checkDatabaseHealth();
      const result3 = await healthCheck.checkDatabaseHealth();

      expect(result1.status).toBe('healthy');
      expect(result2.status).toBe('healthy');
      expect(result3.status).toBe('healthy');
    });
  });

  describe('Edge Cases', () => {
    test('should handle query returning empty result', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([]);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('healthy');
    });

    test('should handle query returning multiple rows', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([
        { '?column?': 1 },
        { '?column?': 2 },
      ]);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('healthy');
    });

    test('should handle error with no code', async () => {
      const error = new Error('Unknown database error');
      delete error.code;

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(error);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBeDefined();
      expect(result.code).toBeUndefined();
    });

    test('should handle error with null message', async () => {
      const error = new Error();
      error.message = '';
      error.code = 'UNKNOWN';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(error);

      const result = await healthCheck.checkDatabaseHealth();

      expect(result.status).toBe('unhealthy');
    });
  });

  describe('Logging Behavior', () => {
    test('should not log on successful connection', async () => {
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);

      await healthCheck.checkDatabaseHealth();

      expect(logger.error).not.toHaveBeenCalled();
    });

    test('should log on connection failure with error message', async () => {
      const error = new Error('Connection failed');
      error.code = 'ECONNREFUSED';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(error);

      await healthCheck.checkDatabaseHealth();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('health check'),
        expect.objectContaining({
          error: 'Connection failed',
          code: 'ECONNREFUSED',
        })
      );
    });

    test('should include error details in log context', async () => {
      const error = new Error('Database error');
      error.code = 'DB_ERROR';

      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(error);

      await healthCheck.checkDatabaseHealth();

      const logCall = logger.error.mock.calls[0];
      expect(logCall[1].error).toBe('Database error');
      expect(logCall[1].code).toBe('DB_ERROR');
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle recovery after temporary failure', async () => {
      const error = new Error('Temporary connection issue');
      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(error);

      const result1 = await healthCheck.checkDatabaseHealth();
      expect(result1.status).toBe('unhealthy');

      // Recovery
      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);
      const result2 = await healthCheck.checkDatabaseHealth();
      expect(result2.status).toBe('healthy');
    });

    test('should maintain consistent error tracking across multiple failures', async () => {
      const errors = [
        new Error('Connection refused'),
        new Error('Connection timeout'),
        new Error('Connection reset'),
      ];

      for (const error of errors) {
        prisma.$queryRaw = jest.fn().mockRejectedValueOnce(error);
        const result = await healthCheck.checkDatabaseHealth();
        expect(result.status).toBe('unhealthy');
      }

      expect(logger.error).toHaveBeenCalledTimes(3);
    });

    test('should reset error state on successful health check', async () => {
      const error = new Error('Connection failed');
      prisma.$queryRaw = jest.fn().mockRejectedValueOnce(error);

      await healthCheck.checkDatabaseHealth();
      expect(logger.error).toHaveBeenCalledTimes(1);

      prisma.$queryRaw = jest.fn().mockResolvedValueOnce([{ '?column?': 1 }]);
      await healthCheck.checkDatabaseHealth();

      expect(logger.error).toHaveBeenCalledTimes(1); // Still only 1
    });
  });
});
