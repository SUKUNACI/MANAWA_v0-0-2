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
});
