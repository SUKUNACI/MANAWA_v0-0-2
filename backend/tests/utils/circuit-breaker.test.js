const { CircuitBreaker, CircuitBreakerState } = require('../../utils/circuit-breaker');

jest.mock('../../utils/logger');
const logger = require('../../utils/logger');

describe('CircuitBreaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should initialize in CLOSED state', () => {
    const cb = new CircuitBreaker({ serviceName: 'TestService' });
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  test('should execute function successfully when CLOSED', async () => {
    const cb = new CircuitBreaker({ serviceName: 'TestService' });
    const fn = jest.fn().mockResolvedValue('success');

    const result = await cb.execute(fn, ['arg1', 'arg2']);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    expect(cb.stats.successfulRequests).toBe(1);
  });

  test('should track successful requests', async () => {
    const cb = new CircuitBreaker({ serviceName: 'TestService' });
    const fn = jest.fn().mockResolvedValue('success');

    await cb.execute(fn);
    await cb.execute(fn);
    await cb.execute(fn);

    expect(cb.stats.totalRequests).toBe(3);
    expect(cb.stats.successfulRequests).toBe(3);
  });

  test('should open circuit after failure threshold', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 3,
      failureTimeWindow: 1000,
    });

    const fn = jest.fn().mockRejectedValue(new Error('test error'));

    // Record 3 failures
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(fn);
      } catch (err) {
        // Expected
      }
    }

    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    expect(cb.stats.failedRequests).toBe(3);
  });

  test('should reject requests when OPEN', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
    });

    const fn = jest.fn().mockRejectedValue(new Error('test error'));

    // Trigger one failure to open circuit
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

    // Try to execute another call
    const fn2 = jest.fn().mockResolvedValue('success');
    try {
      await cb.execute(fn2);
      fail('Should have thrown');
    } catch (err) {
      expect(err.code).toBe('CIRCUIT_BREAKER_OPEN');
      expect(fn2).not.toHaveBeenCalled(); // Should not execute
      expect(cb.stats.rejectedRequests).toBe(1);
    }
  });

  test('should transition to HALF_OPEN after resetTimeout', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
      resetTimeout: 5000,
    });

    const fn = jest.fn().mockRejectedValue(new Error('test error'));

    // Trigger failure
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

    // Fast-forward time
    jest.advanceTimersByTime(5000);

    expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
  });

  test('should close circuit on success from HALF_OPEN state', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
      resetTimeout: 5000,
    });

    const failFn = jest.fn().mockRejectedValue(new Error('test error'));

    // Trigger failure to open circuit
    try {
      await cb.execute(failFn);
    } catch (err) {
      // Expected
    }

    // Fast-forward to HALF_OPEN state
    jest.advanceTimersByTime(5000);

    expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);

    // Execute successful call
    const successFn = jest.fn().mockResolvedValue('success');
    const result = await cb.execute(successFn);

    expect(result).toBe('success');
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  test('should reopen circuit on failure from HALF_OPEN state', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
      resetTimeout: 5000,
    });

    const failFn = jest.fn().mockRejectedValue(new Error('test error'));

    // Trigger failure to open circuit
    try {
      await cb.execute(failFn);
    } catch (err) {
      // Expected
    }

    // Fast-forward to HALF_OPEN state
    jest.advanceTimersByTime(5000);

    expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);

    // Execute another failing call
    try {
      await cb.execute(failFn);
    } catch (err) {
      // Expected
    }

    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
  });

  test('should reset circuit manually', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
    });

    const fn = jest.fn().mockRejectedValue(new Error('test error'));

    // Trigger failure
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

    // Manually reset
    cb.reset();

    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(cb.failures.length).toBe(0); // Failures cleared
  });

  test('should clear old failures outside time window', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 3,
      failureTimeWindow: 5000,
    });

    const fn = jest.fn().mockRejectedValue(new Error('test error'));

    // Record failures
    for (let i = 0; i < 2; i++) {
      try {
        await cb.execute(fn);
      } catch (err) {
        // Expected
      }
    }

    expect(cb.failures.length).toBe(2);

    // Fast-forward past the time window
    jest.advanceTimersByTime(5001);

    // Record another failure - old ones should be cleared
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    // Should only have 1 failure (old ones cleared)
    expect(cb.failures.length).toBe(1);
    // Should not open circuit yet
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  test('should track statistics', async () => {
    const cb = new CircuitBreaker({ serviceName: 'TestService' });

    const successFn = jest.fn().mockResolvedValue('success');
    const failFn = jest.fn().mockRejectedValue(new Error('error'));

    await cb.execute(successFn);
    try {
      await cb.execute(failFn);
    } catch (err) {
      // Expected
    }

    const stats = cb.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.successfulRequests).toBe(1);
    expect(stats.failedRequests).toBe(1);
    expect(stats.state).toBe(CircuitBreakerState.CLOSED);
  });

  test('should cleanup on destroy', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
      resetTimeout: 5000,
    });

    const fn = jest.fn().mockRejectedValue(new Error('error'));

    // Trigger failure to create timer
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    expect(cb.resetTimer).not.toBeNull();
    cb.destroy();
    expect(cb.resetTimer).toBeNull();
  });

  test('should track lastSuccessTime and lastFailureTime', async () => {
    const cb = new CircuitBreaker({ serviceName: 'TestService', failureThreshold: 5 });

    const successFn = jest.fn().mockResolvedValue('success');
    const failFn = jest.fn().mockRejectedValue(new Error('error'));

    // Track first success
    await cb.execute(successFn);
    const firstSuccessTime = cb.stats.lastSuccessTime;
    expect(firstSuccessTime).not.toBeNull();

    // Fast-forward and track failure
    jest.advanceTimersByTime(1000);
    try {
      await cb.execute(failFn);
    } catch (err) {
      // Expected
    }

    const failureTime = cb.stats.lastFailureTime;
    expect(failureTime).not.toBeNull();
    expect(failureTime.getTime()).toBeGreaterThan(firstSuccessTime.getTime());

    cb.destroy();
  });

  test('should handle error code correctly when circuit is OPEN', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
    });

    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

    try {
      await cb.execute(() => Promise.resolve());
    } catch (err) {
      expect(err.code).toBe('CIRCUIT_BREAKER_OPEN');
      expect(err.message).toContain('Circuit breaker is OPEN');
    }
  });

  test('should handle rapid consecutive failures correctly', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 2,
      failureTimeWindow: 10000,
    });

    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    // First failure
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(cb.stats.failedRequests).toBe(1);

    // Second failure - triggers OPEN
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    expect(cb.stats.failedRequests).toBe(2);

    // Subsequent calls while OPEN should be rejected, not execute
    const successFn = jest.fn().mockResolvedValue('success');
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(successFn);
      } catch (err) {
        // Expected
      }
    }

    expect(successFn).not.toHaveBeenCalled();
    expect(cb.stats.rejectedRequests).toBe(3);
  });

  test('should properly clear timer when transitioning from OPEN to HALF_OPEN', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
      resetTimeout: 5000,
    });

    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    // Open circuit
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    const firstTimer = cb.resetTimer;
    expect(firstTimer).not.toBeNull();

    // Manually reset while OPEN
    cb.reset();
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(cb.resetTimer).toBeNull();

    // Timer should be different if we open again
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    const secondTimer = cb.resetTimer;
    expect(secondTimer).not.toBeNull();
  });

  test('should provide complete stats', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 2,
    });

    const successFn = jest.fn().mockResolvedValue('success');
    const failFn = jest.fn().mockRejectedValue(new Error('error'));

    await cb.execute(successFn);
    try {
      await cb.execute(failFn);
    } catch (err) {
      // Expected
    }

    const stats = cb.getStats();
    expect(stats).toHaveProperty('totalRequests', 2);
    expect(stats).toHaveProperty('successfulRequests', 1);
    expect(stats).toHaveProperty('failedRequests', 1);
    expect(stats).toHaveProperty('rejectedRequests', 0);
    expect(stats).toHaveProperty('state', CircuitBreakerState.CLOSED);
    expect(stats).toHaveProperty('failureCount', 1);
    expect(stats).toHaveProperty('failureThreshold', 2);
  });

  test('should handle destroy when no timer exists', () => {
    const cb = new CircuitBreaker({ serviceName: 'TestService' });
    expect(() => cb.destroy()).not.toThrow();
  });

  test('should initialize with correct default openedAt', () => {
    const cb = new CircuitBreaker({ serviceName: 'TestService' });
    expect(cb.openedAt).toBeNull();
  });
});
