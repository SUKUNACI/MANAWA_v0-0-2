const { CircuitBreaker } = require('../../utils/circuit-breaker');
const { AdaptiveRateLimiter } = require('../../utils/rate-limiter-adaptive');
const { getConfig } = require('../../config/third-party-api-config');
const logger = require('../../utils/logger');

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Q57 + Q58 Integration', () => {
  let circuitBreaker;
  let rateLimiter;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreaker = new CircuitBreaker({
      serviceName: 'TestAPI',
      failureThreshold: 3,
      failureTimeWindow: 5000,
      resetTimeout: 100,
    });
    rateLimiter = new AdaptiveRateLimiter({
      serviceName: 'TestAPI',
      minimumRemaining: 10,
    });
  });

  test('should handle successful requests through both layers', async () => {
    const fn = jest.fn().mockResolvedValue({
      data: 'success',
      headers: {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '50',
      },
    });

    const result = await circuitBreaker.execute(() =>
      rateLimiter.execute(fn)
    );

    expect(result.data).toBe('success');
    expect(circuitBreaker.getState()).toBe('CLOSED');
    expect(rateLimiter.rateLimit.remaining).toBe(50);
  });

  test('should throttle when approaching rate limit', async () => {
    const fn = jest.fn().mockResolvedValue({
      data: 'success',
      headers: {
        'x-ratelimit-remaining': '5', // Below threshold of 10
      },
    });

    // First call to set rate limit
    await circuitBreaker.execute(() =>
      rateLimiter.execute(fn)
    );

    // Second call should be throttled
    const start = Date.now();
    await circuitBreaker.execute(() =>
      rateLimiter.execute(fn)
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThan(50); // Some delay added
    expect(rateLimiter.stats.throttledRequests).toBe(1);
  });


  test('should open circuit after threshold failures', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Service error'));

    // Trigger 3 failures
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(() =>
          rateLimiter.execute(fn)
        );
      } catch (err) {
        // Expected
      }
    }

    expect(circuitBreaker.getState()).toBe('OPEN');
    expect(circuitBreaker.stats.failedRequests).toBe(3);

    // Next call should be rejected immediately
    try {
      await circuitBreaker.execute(() =>
        rateLimiter.execute(fn)
      );
      fail('Should have thrown');
    } catch (err) {
      expect(err.code).toBe('CIRCUIT_BREAKER_OPEN');
      expect(circuitBreaker.stats.rejectedRequests).toBe(1);
      expect(fn).toHaveBeenCalledTimes(3); // Not called again
    }
  });

  test('should recover via HALF_OPEN state', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Service error'));

    // Trigger failures to open circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(() =>
          rateLimiter.execute(fn)
        );
      } catch (err) {
        // Expected
      }
    }

    expect(circuitBreaker.getState()).toBe('OPEN');

    // Wait for HALF_OPEN transition
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(circuitBreaker.getState()).toBe('HALF_OPEN');

    // Successful test call
    const successFn = jest.fn().mockResolvedValue({
      data: 'recovered',
      headers: { 'x-ratelimit-remaining': '100' },
    });

    const result = await circuitBreaker.execute(() =>
      rateLimiter.execute(successFn)
    );

    expect(result.data).toBe('recovered');
    expect(circuitBreaker.getState()).toBe('CLOSED');
  });

  test('should queue requests during rate limiting', async () => {
    rateLimiter.rateLimit.isRateLimited = true;

    const fn1 = jest.fn().mockResolvedValue('result1');
    const fn2 = jest.fn().mockResolvedValue('result2');

    const promise1 = circuitBreaker.execute(() =>
      rateLimiter.queueRequest(fn1, [])
    );

    const promise2 = circuitBreaker.execute(() =>
      rateLimiter.queueRequest(fn2, [])
    );

    expect(rateLimiter.requestQueue.length).toBe(2);

    // Resolve rate limit
    rateLimiter.rateLimit.isRateLimited = false;
    await rateLimiter.processQueue();

    await promise1;
    await promise2;

    expect(fn1).toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  test('should get combined statistics', () => {
    const cbStats = circuitBreaker.getStats();
    const rlStats = rateLimiter.getStats();

    expect(cbStats).toHaveProperty('state');
    expect(cbStats).toHaveProperty('totalRequests');
    expect(cbStats).toHaveProperty('failureThreshold');

    expect(rlStats).toHaveProperty('remaining');
    expect(rlStats).toHaveProperty('queueSize');
    expect(rlStats).toHaveProperty('isRateLimited');
  });

  test('should handle configuration from config file', () => {
    const geniusPayConfig = getConfig('geniuspay');
    expect(geniusPayConfig).toBeDefined();
    expect(geniusPayConfig.circuitBreaker).toBeDefined();
    expect(geniusPayConfig.rateLimiter).toBeDefined();

    const mailjetConfig = getConfig('mailjet');
    expect(mailjetConfig.rateLimiter.minimumRemaining).toBe(20);

    const redisConfig = getConfig('redis');
    expect(redisConfig.circuitBreaker.failureThreshold).toBe(10);
  });

});
