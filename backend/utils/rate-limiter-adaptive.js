const logger = require('./logger');

/**
 * Adaptive Rate Limiter for third-party APIs
 * Listens to X-RateLimit-* headers and throttles automatically
 *
 * Features:
 * - Parses X-RateLimit-* headers from API responses
 * - Queues requests when rate limited
 * - Calculates adaptive delays based on X-RateLimit-Reset
 * - Logs rate limit events
 */
class AdaptiveRateLimiter {
  constructor(options = {}) {
    // Service name for logging
    this.serviceName = options.serviceName || 'Unknown Service';

    // Threshold (in percentage) to start throttling
    // Default: throttle when remaining < 10 requests
    this.remainingThreshold = options.remainingThreshold || 10;

    // Minimum requests remaining before throttling
    this.minimumRemaining = options.minimumRemaining || 10;

    // Queue for pending requests
    this.requestQueue = [];

    // Is currently processing queue
    this.isProcessing = false;

    // Current rate limit state
    this.rateLimit = {
      limit: null,           // Total requests allowed
      remaining: null,       // Requests remaining
      reset: null,           // Unix timestamp when limit resets
      retryAfter: null,      // Seconds to wait (if rate limited)
      isRateLimited: false,  // Currently rate limited
      lastUpdated: null,     // When we last parsed headers
    };

    // Stats for monitoring
    this.stats = {
      totalRequests: 0,
      throttledRequests: 0,
      queuedRequests: 0,
      rateLimitedResponses: 0,
      lastRateLimitTime: null,
      totalDelayMs: 0,
    };
  }

  /**
   * Execute a request with adaptive rate limiting
   * @param {Function} fn - The function to execute
   * @param {Array} args - Arguments to pass to the function
   * @returns {Promise<any>} - Result of the function
   */
  async execute(fn, args = []) {
    this.stats.totalRequests++;

    // If rate limited, queue the request
    if (this.rateLimit.isRateLimited) {
      return this.queueRequest(fn, args);
    }

    // Check if we should throttle
    if (this.shouldThrottle()) {
      this.stats.throttledRequests++;
      const delay = this.calculateDelay();
      logger.warn(
        `[RateLimiter] ${this.serviceName} - Throttling request (remaining: ${this.rateLimit.remaining})`,
        { delay, remaining: this.rateLimit.remaining, limit: this.rateLimit.limit }
      );
      await this.sleep(delay);
    }

    try {
      const result = await fn(...args);

      // Parse rate limit headers from response
      if (result && typeof result === 'object') {
        this.parseRateLimitHeaders(result.headers || result);
      }

      return result;
    } catch (error) {
      // Handle rate limit errors (429, 503)
      this.handleRateLimitError(error);
      throw error;
    }
  }

  /**
   * Parse rate limit headers from API response
   * Supports:
   * - X-RateLimit-Limit: Total requests allowed
   * - X-RateLimit-Remaining: Requests remaining
   * - X-RateLimit-Reset: Unix timestamp when limit resets
   * - Retry-After: Seconds to wait if rate limited
   */
  parseRateLimitHeaders(response) {
    const headers = response.headers || response;

    // Parse headers (case-insensitive)
    const limit = this.getHeaderValue(headers, 'x-ratelimit-limit');
    const remaining = this.getHeaderValue(headers, 'x-ratelimit-remaining');
    const reset = this.getHeaderValue(headers, 'x-ratelimit-reset');
    const retryAfter = this.getHeaderValue(headers, 'retry-after');

    if (limit) this.rateLimit.limit = parseInt(limit, 10);
    if (remaining) this.rateLimit.remaining = parseInt(remaining, 10);
    if (reset) this.rateLimit.reset = parseInt(reset, 10);
    if (retryAfter) this.rateLimit.retryAfter = parseInt(retryAfter, 10);

    this.rateLimit.lastUpdated = Date.now();
    this.rateLimit.isRateLimited = false;

    // Log when we're getting close to the limit
    if (
      this.rateLimit.remaining !== null &&
      this.rateLimit.remaining < this.minimumRemaining
    ) {
      logger.info(
        `[RateLimiter] ${this.serviceName} - Approaching rate limit`,
        {
          remaining: this.rateLimit.remaining,
          limit: this.rateLimit.limit,
          resetAt: new Date(this.rateLimit.reset * 1000).toISOString(),
        }
      );
    }
  }

  /**
   * Handle rate limit errors (429, 503)
   */
  handleRateLimitError(error) {
    const status = error.response?.status;

    if (status === 429 || status === 503) {
      this.stats.rateLimitedResponses++;
      this.stats.lastRateLimitTime = new Date();
      this.rateLimit.isRateLimited = true;

      // Parse Retry-After header
      const retryAfter = error.response?.headers?.['retry-after'];
      if (retryAfter) {
        this.rateLimit.retryAfter = parseInt(retryAfter, 10);
      }

      logger.error(
        `[RateLimiter] ${this.serviceName} - Rate limited (${status})`,
        {
          retryAfter: this.rateLimit.retryAfter,
          queueSize: this.requestQueue.length,
          status,
        }
      );

      // Start processing queue after retry delay
      this.processQueueAfterDelay();
    }
  }

  /**
   * Check if we should throttle the request
   */
  shouldThrottle() {
    // No rate limit info yet, don't throttle
    if (this.rateLimit.remaining === null) {
      return false;
    }

    // Throttle if remaining is below threshold
    return this.rateLimit.remaining < this.minimumRemaining;
  }

  /**
   * Calculate adaptive delay based on rate limit state
   * Formula: delay = (max_requests / remaining_requests) * base_delay
   */
  calculateDelay() {
    const baseDelay = 100; // ms

    if (this.rateLimit.remaining === null || this.rateLimit.limit === null) {
      return baseDelay;
    }

    // If we have reset time, calculate delay to spread requests evenly
    if (this.rateLimit.reset) {
      const now = Math.floor(Date.now() / 1000);
      const secondsUntilReset = Math.max(0, this.rateLimit.reset - now);

      if (this.rateLimit.remaining > 0 && secondsUntilReset > 0) {
        // Spread remaining requests over the time window
        const delay = (secondsUntilReset * 1000) / this.rateLimit.remaining;
        return Math.max(baseDelay, Math.ceil(delay));
      }
    }

    // Fallback: increase delay as remaining decreases
    const percentageRemaining =
      this.rateLimit.remaining / this.rateLimit.limit;
    const delay = baseDelay / Math.max(0.1, percentageRemaining);

    return Math.ceil(delay);
  }

  /**
   * Queue a request for later execution
   */
  async queueRequest(fn, args) {
    this.stats.queuedRequests++;

    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        fn,
        args,
        resolve,
        reject,
        queuedAt: Date.now(),
      });

      logger.debug(
        `[RateLimiter] ${this.serviceName} - Request queued`,
        { queueSize: this.requestQueue.length }
      );

      // Start processing queue if not already doing so
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process queued requests
   */
  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      if (this.rateLimit.isRateLimited) {
        // Still rate limited, wait
        const delay = this.calculateRetryDelay();
        logger.info(
          `[RateLimiter] ${this.serviceName} - Waiting before retry`,
          { delay, queueSize: this.requestQueue.length }
        );
        await this.sleep(delay);
        continue;
      }

      const request = this.requestQueue.shift();
      const waitTime = Date.now() - request.queuedAt;
      this.stats.totalDelayMs += waitTime;

      try {
        const result = await request.fn(...request.args);

        // Parse rate limit headers
        if (result && typeof result === 'object') {
          this.parseRateLimitHeaders(result.headers || result);
        }

        request.resolve(result);

        // Add delay between queued requests
        if (this.requestQueue.length > 0) {
          const delay = this.calculateDelay();
          await this.sleep(delay);
        }
      } catch (error) {
        this.handleRateLimitError(error);
        request.reject(error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Process queue after retry delay
   */
  processQueueAfterDelay() {
    const delay = this.calculateRetryDelay();
    setTimeout(() => {
      this.processQueue();
    }, delay);
  }

  /**
   * Calculate retry delay based on Retry-After header
   */
  calculateRetryDelay() {
    if (this.rateLimit.retryAfter) {
      // Retry-After is in seconds, convert to ms
      return this.rateLimit.retryAfter * 1000;
    }

    // If we have reset time, use it
    if (this.rateLimit.reset) {
      const now = Math.floor(Date.now() / 1000);
      const delay = (this.rateLimit.reset - now + 1) * 1000;
      return Math.max(1000, delay); // At least 1 second
    }

    // Fallback: exponential backoff
    return 5000; // 5 seconds
  }

  /**
   * Get header value (case-insensitive)
   */
  getHeaderValue(headers, key) {
    if (!headers) return null;

    // Try exact key first
    if (headers[key]) return headers[key];

    // Try case-insensitive search
    const lowerKey = key.toLowerCase();
    for (const [headerKey, value] of Object.entries(headers)) {
      if (headerKey.toLowerCase() === lowerKey) {
        return value;
      }
    }

    return null;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current rate limit state
   */
  getState() {
    return {
      ...this.rateLimit,
      isThrottling: this.shouldThrottle(),
      queueSize: this.requestQueue.length,
    };
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.requestQueue.length,
      isRateLimited: this.rateLimit.isRateLimited,
      remaining: this.rateLimit.remaining,
      limit: this.rateLimit.limit,
    };
  }

  /**
   * Reset rate limiter
   */
  reset() {
    logger.info(`[RateLimiter] ${this.serviceName} - Reset`, {
      previousState: this.rateLimit,
    });

    this.rateLimit = {
      limit: null,
      remaining: null,
      reset: null,
      retryAfter: null,
      isRateLimited: false,
      lastUpdated: null,
    };

    this.requestQueue = [];
    this.isProcessing = false;
  }
}

module.exports = { AdaptiveRateLimiter };
