const { AdaptiveRateLimiter } = require('../../utils/rate-limiter-adaptive');
const logger = require('../../utils/logger');

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('AdaptiveRateLimiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should initialize with default settings', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });
    expect(rl.serviceName).toBe('TestService');
    expect(rl.minimumRemaining).toBe(10);
    expect(rl.requestQueue.length).toBe(0);
  });

  test('should execute function when not throttled', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });
    const fn = jest.fn().mockResolvedValue('success');

    const result = await rl.execute(fn, ['arg1']);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledWith('arg1');
    expect(rl.stats.totalRequests).toBe(1);
  });

  test('should parse X-RateLimit headers', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    const response = {
      headers: {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '50',
        'x-ratelimit-reset': '1700000000',
        'retry-after': '60',
      },
    };

    rl.parseRateLimitHeaders(response.headers);

    expect(rl.rateLimit.limit).toBe(100);
    expect(rl.rateLimit.remaining).toBe(50);
    expect(rl.rateLimit.reset).toBe(1700000000);
    expect(rl.rateLimit.retryAfter).toBe(60);
    expect(rl.rateLimit.isRateLimited).toBe(false);
  });

  test('should handle case-insensitive headers', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    const response = {
      'X-RateLimit-Limit': '100',
      'X-RATELIMIT-REMAINING': '50',
    };

    rl.parseRateLimitHeaders(response);

    expect(rl.rateLimit.limit).toBe(100);
    expect(rl.rateLimit.remaining).toBe(50);
  });

  test('should detect when approaching rate limit', () => {
    const rl = new AdaptiveRateLimiter({
      serviceName: 'TestService',
      minimumRemaining: 10,
    });

    expect(rl.shouldThrottle()).toBe(false); // No rate limit info yet

    rl.rateLimit.remaining = 5;
    expect(rl.shouldThrottle()).toBe(true);

    rl.rateLimit.remaining = 15;
    expect(rl.shouldThrottle()).toBe(false);
  });

  test('should queue request when rate limited', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });
    rl.rateLimit.isRateLimited = true;

    const fn = jest.fn().mockResolvedValue('success');

    const promise = rl.queueRequest(fn, ['arg1']);

    expect(rl.requestQueue.length).toBe(1);
    expect(rl.stats.queuedRequests).toBe(1);

    // Resolve the queue
    rl.rateLimit.isRateLimited = false;
    await rl.processQueue();
    await promise;

    expect(fn).toHaveBeenCalledWith('arg1');
  });

  test('should handle rate limit errors (429)', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    const error = new Error('Too Many Requests');
    error.response = {
      status: 429,
      headers: { 'retry-after': '30' },
    };

    rl.handleRateLimitError(error);

    expect(rl.rateLimit.isRateLimited).toBe(true);
    expect(rl.rateLimit.retryAfter).toBe(30);
    expect(rl.stats.rateLimitedResponses).toBe(1);
  });

  test('should handle rate limit errors (503)', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    const error = new Error('Service Unavailable');
    error.response = {
      status: 503,
      headers: { 'retry-after': '60' },
    };

    rl.handleRateLimitError(error);

    expect(rl.rateLimit.isRateLimited).toBe(true);
  });

  test('should calculate adaptive delay', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    // Test 1: No rate limit info
    let delay = rl.calculateDelay();
    expect(delay).toBe(100); // Base delay

    // Test 2: With rate limit info
    rl.rateLimit.limit = 100;
    rl.rateLimit.remaining = 10;
    delay = rl.calculateDelay();
    expect(delay).toBeGreaterThan(100);

    // Test 3: With reset time
    rl.rateLimit.reset = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now
    rl.rateLimit.remaining = 20;
    delay = rl.calculateDelay();
    expect(delay).toBeGreaterThan(0);
  });

  test('should process queued requests', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    const fn1 = jest.fn().mockResolvedValue('result1');
    const fn2 = jest.fn().mockResolvedValue('result2');

    rl.requestQueue.push({
      fn: fn1,
      args: [],
      resolve: jest.fn(),
      reject: jest.fn(),
      queuedAt: Date.now(),
    });

    rl.requestQueue.push({
      fn: fn2,
      args: [],
      resolve: jest.fn(),
      reject: jest.fn(),
      queuedAt: Date.now(),
    });

    await rl.processQueue();

    expect(fn1).toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  test('should calculate retry delay', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    // Test 1: With retryAfter
    rl.rateLimit.retryAfter = 30;
    expect(rl.calculateRetryDelay()).toBe(30000);

    // Test 2: With reset time
    rl.rateLimit.retryAfter = null;
    rl.rateLimit.reset = Math.floor(Date.now() / 1000) + 10;
    const delay = rl.calculateRetryDelay();
    expect(delay).toBeGreaterThan(1000);
    expect(delay).toBeLessThanOrEqual(11000);

    // Test 3: Fallback
    rl.rateLimit.reset = null;
    expect(rl.calculateRetryDelay()).toBe(5000);
  });

  test('should get rate limiter state', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });
    rl.rateLimit.remaining = 50;
    rl.rateLimit.limit = 100;
    rl.rateLimit.isRateLimited = false;

    const state = rl.getState();

    expect(state.remaining).toBe(50);
    expect(state.limit).toBe(100);
    expect(state.isRateLimited).toBe(false);
    expect(state.isThrottling).toBe(false);
  });

  test('should track statistics', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    const fn = jest.fn().mockResolvedValue('success');

    await rl.execute(fn);
    await rl.execute(fn);

    const stats = rl.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.queueSize).toBe(0);
  });

  test('should reset rate limiter', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    rl.rateLimit.remaining = 50;
    rl.rateLimit.isRateLimited = true;
    rl.requestQueue.push({
      fn: jest.fn(),
      args: [],
      resolve: jest.fn(),
      reject: jest.fn(),
      queuedAt: Date.now(),
    });

    rl.reset();

    expect(rl.rateLimit.remaining).toBeNull();
    expect(rl.rateLimit.isRateLimited).toBe(false);
    expect(rl.requestQueue.length).toBe(0);
    expect(rl.isProcessing).toBe(false);
  });

  test('should sleep for specified duration', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    const start = Date.now();
    await rl.sleep(50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(500); // CI-safe tolerance
  });

  test('should handle errors in queued requests', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'TestService' });

    const error = new Error('Test error');
    const fn = jest.fn().mockRejectedValue(error);

    let resolvedValue = null;
    let rejectedError = null;

    rl.requestQueue.push({
      fn,
      args: [],
      resolve: (value) => {
        resolvedValue = value;
      },
      reject: (err) => {
        rejectedError = err;
      },
      queuedAt: Date.now(),
    });

    await rl.processQueue();

    expect(rejectedError).toBe(error);
    expect(resolvedValue).toBeNull();
  });
});
