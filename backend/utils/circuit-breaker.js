const logger = require('./logger');

/**
 * States for the Circuit Breaker pattern
 */
const CircuitBreakerState = {
  CLOSED: 'CLOSED',       // Normal operation, calls pass through
  OPEN: 'OPEN',           // Too many failures, calls are blocked
  HALF_OPEN: 'HALF_OPEN', // Recovery phase, testing a single call
};

/**
 * Circuit Breaker implementation
 * Prevents cascading failures by stopping calls to failing services
 *
 * States:
 * - CLOSED: Normal operation
 * - OPEN: Service is down, reject calls immediately
 * - HALF_OPEN: Testing if service recovered, allow one test call
 */
class CircuitBreaker {
  constructor(options = {}) {
    // Service name for logging
    this.serviceName = options.serviceName || 'Unknown Service';

    // Failure threshold - failures before opening circuit
    this.failureThreshold = options.failureThreshold || 5;

    // Time window for counting failures (in ms)
    this.failureTimeWindow = options.failureTimeWindow || 5 * 60 * 1000; // 5 minutes

    // Time to wait before attempting recovery (in ms)
    this.resetTimeout = options.resetTimeout || 5 * 60 * 1000; // 5 minutes

    // State of the circuit breaker
    this.state = CircuitBreakerState.CLOSED;

    // List of recent failures with timestamps
    this.failures = [];

    // Timestamp when circuit was opened
    this.openedAt = null;

    // Timeout for transitioning from OPEN to HALF_OPEN
    this.resetTimer = null;

    // Stats for monitoring
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0, // Rejected because circuit is OPEN
      lastFailureTime: null,
      lastSuccessTime: null,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - The function to execute
   * @param {Array} args - Arguments to pass to the function
   * @returns {Promise<any>} - Result of the function
   * @throws {Error} - If circuit is OPEN or function throws
   */
  async execute(fn, args = []) {
    this.stats.totalRequests++;

    // If circuit is OPEN, reject immediately
    if (this.state === CircuitBreakerState.OPEN) {
      this.stats.rejectedRequests++;
      const error = new Error(
        `[${this.serviceName}] Circuit breaker is OPEN. Service unavailable.`
      );
      error.code = 'CIRCUIT_BREAKER_OPEN';
      logger.warn(`[CircuitBreaker] ${this.serviceName} - Request rejected (OPEN)`, {
        state: this.state,
        openedAt: this.openedAt,
        rejectedCount: this.stats.rejectedRequests,
      });
      throw error;
    }

    try {
      const result = await fn(...args);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful call
   */
  onSuccess() {
    this.stats.successfulRequests++;
    this.stats.lastSuccessTime = new Date();

    // If in HALF_OPEN state, close the circuit
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      logger.info(
        `[CircuitBreaker] ${this.serviceName} - Circuit CLOSED (recovered)`,
        { state: CircuitBreakerState.CLOSED }
      );
      this.close();
    }

    // Clear failures on success
    this.clearOldFailures();
  }

  /**
   * Handle failed call
   */
  onFailure() {
    this.stats.failedRequests++;
    this.stats.lastFailureTime = new Date();

    // Record failure with timestamp
    this.failures.push(Date.now());

    // Clean up old failures outside the time window
    this.clearOldFailures();

    // If too many failures in the time window, open the circuit
    if (this.failures.length >= this.failureThreshold) {
      logger.error(
        `[CircuitBreaker] ${this.serviceName} - Circuit OPEN (${this.failures.length} failures in ${this.failureTimeWindow}ms)`,
        {
          state: CircuitBreakerState.OPEN,
          failureCount: this.failures.length,
          threshold: this.failureThreshold,
        }
      );
      this.open();
    }
  }

  /**
   * Clear failures that are outside the time window
   */
  clearOldFailures() {
    const cutoffTime = Date.now() - this.failureTimeWindow;
    this.failures = this.failures.filter(timestamp => timestamp > cutoffTime);
  }

  /**
   * Open the circuit (block calls)
   */
  open() {
    this.state = CircuitBreakerState.OPEN;
    this.openedAt = new Date();

    // Schedule transition to HALF_OPEN after resetTimeout
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      this.halfOpen();
    }, this.resetTimeout);

    logger.warn(`[CircuitBreaker] ${this.serviceName} - Circuit OPEN`, {
      state: this.state,
      resetIn: `${this.resetTimeout}ms`,
    });
  }

  /**
   * Transition to HALF_OPEN state (allow test call)
   */
  halfOpen() {
    this.state = CircuitBreakerState.HALF_OPEN;
    logger.info(`[CircuitBreaker] ${this.serviceName} - Circuit HALF_OPEN (testing recovery)`, {
      state: this.state,
    });
  }

  /**
   * Close the circuit (normal operation)
   */
  close() {
    this.state = CircuitBreakerState.CLOSED;
    this.openedAt = null;
    this.failures = [];

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    logger.info(`[CircuitBreaker] ${this.serviceName} - Circuit CLOSED`, {
      state: this.state,
    });
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      state: this.state,
      failureCount: this.failures.length,
      failureThreshold: this.failureThreshold,
    };
  }

  /**
   * Reset the circuit breaker to CLOSED state
   * Useful for manual recovery or testing
   */
  reset() {
    logger.info(`[CircuitBreaker] ${this.serviceName} - Manual reset`, {
      previousState: this.state,
      newState: CircuitBreakerState.CLOSED,
    });
    this.close();
  }

  /**
   * Destroy the circuit breaker (cleanup)
   */
  destroy() {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
  }
}

module.exports = { CircuitBreaker, CircuitBreakerState };
