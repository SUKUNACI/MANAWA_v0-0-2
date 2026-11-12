/**
 * Jest Setup File for E2E Tests
 * Global configuration and utilities for all E2E test suites
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Extend Jest timeout globally
jest.setTimeout(30000);

/**
 * Global test utilities available in all suites
 */
global.testUtils = {
  /**
   * Sleep for specified milliseconds
   */
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Retry async function with exponential backoff
   */
  retry: async (fn, maxRetries = 3, initialDelayMs = 100) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          const delay = initialDelayMs * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  },

  /**
   * Wait for condition with timeout
   */
  waitFor: async (condition, timeoutMs = 5000, intervalMs = 100) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        if (await condition()) {
          return true;
        }
      } catch (err) {
        // Continue waiting
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
  },

  /**
   * Generate unique identifier
   */
  uuid: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },

  /**
   * Generate timestamp for test data
   */
  timestamp: () => new Date().toISOString(),
};

/**
 * Global error handler
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

/**
 * Suppress console logs during tests (optional)
 */
if (process.env.SUPPRESS_LOGS === 'true') {
  global.console.log = jest.fn();
  global.console.info = jest.fn();
  global.console.warn = jest.fn();
}

/**
 * Test data cleanup
 */
afterEach(() => {
  jest.clearAllMocks();
});
