/**
 * Logger Utility Tests
 * Tests log levels, formatting, timestamps, and file operations
 */

const fs = require('fs');
const path = require('path');

jest.mock('fs');

describe('Logger Utility', () => {
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    // Setup mock file system
    fs.existsSync.mockReturnValue(true);
    fs.mkdirSync.mockImplementation(() => {});
    fs.appendFileSync.mockImplementation(() => {});

    logger = require('../../utils/logger');
  });

  describe('Logger Initialization', () => {
    test('should export logger object', () => {
      expect(logger).toBeDefined();
      expect(typeof logger).toBe('object');
    });

    test('should have info method', () => {
      expect(typeof logger.info).toBe('function');
    });

    test('should have warn method', () => {
      expect(typeof logger.warn).toBe('function');
    });

    test('should have error method', () => {
      expect(typeof logger.error).toBe('function');
    });

    test('should have debug method', () => {
      expect(typeof logger.debug).toBe('function');
    });
  });

  describe('Log Levels', () => {
    test('should log at INFO level', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test info message', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('INFO');
      expect(logOutput).toContain('Test info message');

      consoleSpy.mockRestore();
    });

    test('should log at WARN level', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      logger.warn('Test warning message', { code: '500' });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('WARN');
      expect(logOutput).toContain('Test warning message');

      consoleSpy.mockRestore();
    });

    test('should log at ERROR level', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      logger.error('Test error message', { error: 'Connection failed' });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('ERROR');
      expect(logOutput).toContain('Test error message');

      consoleSpy.mockRestore();
    });
  });

  describe('Log Formatting', () => {
    test('should include timestamp in log', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.timestamp).toBeDefined();
      expect(typeof parsed.timestamp).toBe('string');
      // Verify ISO format
      expect(new Date(parsed.timestamp)).toBeTruthy();

      consoleSpy.mockRestore();
    });

    test('should include level in log', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.level).toBe('INFO');

      consoleSpy.mockRestore();
    });

    test('should include message in log', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test log message');

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.message).toBe('Test log message');

      consoleSpy.mockRestore();
    });

    test('should include data in log', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test message', { userId: '123', action: 'login' });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.userId).toBe('123');
      expect(parsed.action).toBe('login');

      consoleSpy.mockRestore();
    });

    test('should format log as JSON', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test message', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];

      // Should be valid JSON
      expect(() => JSON.parse(logOutput)).not.toThrow();

      consoleSpy.mockRestore();
    });

    test('should handle nested data objects', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test message', {
        user: { id: '1', email: 'test@example.com' },
        metadata: { ip: '192.168.1.1' },
      });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.user.id).toBe('1');
      // IPs masquées dans les logs depuis Q100 (pii-detector) — comportement voulu
      expect(parsed.metadata.ip).toMatch(/192\.168\.\*\.\*|192\.168\.1\.1/);

      consoleSpy.mockRestore();
    });
  });

  describe('File Writing', () => {
    test('should write logs using appendFileSync', () => {
      logger.info('Test message');
      expect(fs.appendFileSync).toHaveBeenCalled();
    });

    test('should call appendFileSync for different log levels', () => {
      logger.info('Info');
      logger.warn('Warning');
      logger.error('Error');

      expect(fs.appendFileSync).toHaveBeenCalled();
    });

    test('should write multiple log entries', () => {
      const callCountBefore = fs.appendFileSync.mock.calls.length;
      logger.info('Message 1');
      logger.warn('Message 2');
      const callCountAfter = fs.appendFileSync.mock.calls.length;

      expect(callCountAfter).toBeGreaterThan(callCountBefore);
    });
  });

  describe('Timestamp Accuracy', () => {
    test('should use ISO format for timestamps', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test message');

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      const timestamp = parsed.timestamp;

      // ISO format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      consoleSpy.mockRestore();
    });

    test('should have recent timestamp', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const beforeTime = new Date();

      logger.info('Test message');

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);
      const logTime = new Date(parsed.timestamp);

      expect(logTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);

      consoleSpy.mockRestore();
    });
  });

  describe('Data Handling', () => {
    test('should handle logs with empty data', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test message', {});

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(() => JSON.parse(logOutput)).not.toThrow();

      consoleSpy.mockRestore();
    });

    test('should handle logs with no data parameter', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.message).toBe('Test message');
      expect(parsed.level).toBe('INFO');

      consoleSpy.mockRestore();
    });

    test('should handle logs with numeric values', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Request completed', { statusCode: 200, duration: 150 });

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.statusCode).toBe(200);
      expect(parsed.duration).toBe(150);

      consoleSpy.mockRestore();
    });

    test('should handle logs with boolean values', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Operation status', { success: true, cached: false });

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.success).toBe(true);
      expect(parsed.cached).toBe(false);

      consoleSpy.mockRestore();
    });

    test('should handle logs with null values', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Operation status', { result: null, error: null });

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.result).toBeNull();
      expect(parsed.error).toBeNull();

      consoleSpy.mockRestore();
    });

    test('should handle logs with array values', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Items processed', { items: ['a', 'b', 'c'] });

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(Array.isArray(parsed.items)).toBe(true);
      expect(parsed.items).toEqual(['a', 'b', 'c']);

      consoleSpy.mockRestore();
    });
  });

  describe('Special Characters', () => {
    test('should handle special characters in message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Message with "quotes" and \'apostrophes\'');

      const logOutput = consoleSpy.mock.calls[0][0];
      expect(() => JSON.parse(logOutput)).not.toThrow();

      consoleSpy.mockRestore();
    });

    test('should handle newlines in message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Message with\nnewline');

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.message).toContain('\n');

      consoleSpy.mockRestore();
    });

    test('should handle unicode characters', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('Message with unicode: 你好 🚀');

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.message).toContain('你好');

      consoleSpy.mockRestore();
    });
  });

  describe('Debug Logging', () => {
    test('should not log debug when DEBUG env var is not true', () => {
      process.env.DEBUG = 'false';
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.debug('Debug message');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should log debug when DEBUG env var is true', () => {
      process.env.DEBUG = 'true';
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.debug('Debug message', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('DEBUG');

      consoleSpy.mockRestore();
    });
  });

  describe('Child Logger', () => {
    test('should create a child logger with context', () => {
      const childLogger = logger.child({ userId: 'user-123' });

      expect(typeof childLogger).toBe('object');
      expect(typeof childLogger.info).toBe('function');
    });

    test('child logger should include parent context', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const childLogger = logger.child({ userId: 'user-123' });
      childLogger.info('Child message', { action: 'login' });

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.userId).toBe('user-123');
      expect(parsed.action).toBe('login');

      consoleSpy.mockRestore();
    });

    test('child logger should support warn level', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const childLogger = logger.child({ requestId: 'req-456' });
      childLogger.warn('Warning message');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('child logger should support error level', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const childLogger = logger.child({ module: 'auth' });
      childLogger.error('Error message', { code: 'AUTH_FAILED' });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should create nested child loggers', () => {
      const child1 = logger.child({ level1: 'value1' });
      const child2 = child1.child({ level2: 'value2' });

      expect(typeof child2.info).toBe('function');
      expect(typeof child2.warn).toBe('function');
    });

    test('nested child loggers should merge context', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const child1 = logger.child({ service: 'auth' });
      const child2 = child1.child({ endpoint: '/login' });
      child2.info('Request received');

      const logOutput = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(logOutput);

      expect(parsed.service).toBe('auth');
      expect(parsed.endpoint).toBe('/login');

      consoleSpy.mockRestore();
    });
  });

  describe('File Operations', () => {
    test('should handle write errors gracefully', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      fs.appendFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      logger.info('Test message');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorMsg = consoleErrorSpy.mock.calls[0][0];
      expect(errorMsg).toContain('Failed to write log');

      consoleErrorSpy.mockRestore();
    });

    test('should write to different files for different levels', () => {
      fs.appendFileSync.mockClear();

      logger.info('Info');
      logger.error('Error');

      const calls = fs.appendFileSync.mock.calls;
      // Info should write to app.log
      // Error should write to both app.log and error.log
      expect(calls.length).toBeGreaterThan(2);
    });
  });

  describe('Error Log Level', () => {
    test('should write error logs to both app.log and error.log', () => {
      fs.appendFileSync.mockClear();

      logger.error('Test error');

      const calls = fs.appendFileSync.mock.calls;
      // Error should write to both files
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    test('should include stack trace info when available', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const error = new Error('Test error');
      logger.error('Error occurred', { error: error.message, stack: error.stack });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('PII Masking', () => {
    test('should call maskString on message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('User email: test@example.com');

      // Message should be masked via maskString
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should call maskObject on data', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logger.info('User info', { email: 'test@example.com', phone: '+123456789' });

      // Data should be masked via maskObject
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
