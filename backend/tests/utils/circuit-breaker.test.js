const { CircuitBreaker, CircuitBreakerState } = require('../../utils/circuit-breaker');
const logger = require('../../utils/logger');

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('CircuitBreaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      resetTimeout: 100, // 100ms for testing
    });

    const fn = jest.fn().mockRejectedValue(new Error('test error'));

    // Trigger failure
    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

    // Wait for reset timeout
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(cb.getState()).toBe(CircuitBreakerState.HALF_OPEN);
  });

  test('should close circuit on success from HALF_OPEN state', async () => {
    const cb = new CircuitBreaker({
      serviceName: 'TestService',
      failureThreshold: 1,
      resetTimeout: 50,
    });

    const failFn = jest.fn().mockRejectedValue(new Error('test error'));

    // Trigger failure to open circuit
    try {
      await cb.execute(failFn);
    } catch (err) {
      // Expected
    }

    // Wait for HALF_OPEN state
    await new Promise(resolve => setTimeout(resolve, 100));

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
      resetTimeout: 50,
    });

    const failFn = jest.fn().mockRejectedValue(new Error('test error'));

    // Trigger failure to open circuit
    try {
      await cb.execute(failFn);
    } catch (err) {
      // Expected
    }

    // Wait for HALF_OPEN state
    await new Promise(resolve => setTimeout(resolve, 100));

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
      failureTimeWindow: 100, // 100ms
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

    // Wait for failures to age
    await new Promise(resolve => setTimeout(resolve, 150));

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
      resetTimeout: 100,
    });

    const fn = jest.fn().mockRejectedValue(new Error('error'));

    try {
      await cb.execute(fn);
    } catch (err) {
      // Expected
    }

    cb.destroy();
    expect(cb.resetTimer).toBeNull();
  });
});
