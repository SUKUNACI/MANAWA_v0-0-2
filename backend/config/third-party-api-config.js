/**
 * Third-party API Configuration
 * Centralized configuration for Circuit Breaker and Rate Limiter thresholds
 */

const thirdPartyApiConfig = {
  /**
   * GeniusPay Configuration
   * Payment processing API
   */
  geniuspay: {
    serviceName: 'GeniusPay',
    enabled: !!process.env.GENIUSPAY_API_KEY,

    // Circuit Breaker settings
    circuitBreaker: {
      failureThreshold: parseInt(process.env.GENIUSPAY_CB_FAILURE_THRESHOLD || '5', 10),
      failureTimeWindow: parseInt(process.env.GENIUSPAY_CB_TIME_WINDOW || '300000', 10), // 5 minutes
      resetTimeout: parseInt(process.env.GENIUSPAY_CB_RESET_TIMEOUT || '300000', 10),    // 5 minutes
    },

    // Rate Limiter settings
    rateLimiter: {
      minimumRemaining: parseInt(process.env.GENIUSPAY_RL_MIN_REMAINING || '10', 10),
      remainingThreshold: parseInt(process.env.GENIUSPAY_RL_THRESHOLD || '10', 10),
    },

    // Timeout for API calls (in ms)
    timeout: parseInt(process.env.GENIUSPAY_TIMEOUT || '15000', 10),
  },

  /**
   * Mailjet Configuration
   * Email sending API
   */
  mailjet: {
    serviceName: 'Mailjet',
    enabled: !!process.env.MAILJET_API_KEY,

    // Circuit Breaker settings
    circuitBreaker: {
      failureThreshold: parseInt(process.env.MAILJET_CB_FAILURE_THRESHOLD || '5', 10),
      failureTimeWindow: parseInt(process.env.MAILJET_CB_TIME_WINDOW || '300000', 10), // 5 minutes
      resetTimeout: parseInt(process.env.MAILJET_CB_RESET_TIMEOUT || '300000', 10),    // 5 minutes
    },

    // Rate Limiter settings
    rateLimiter: {
      minimumRemaining: parseInt(process.env.MAILJET_RL_MIN_REMAINING || '20', 10),
      remainingThreshold: parseInt(process.env.MAILJET_RL_THRESHOLD || '20', 10),
    },

    // Timeout for API calls (in ms)
    timeout: parseInt(process.env.MAILJET_TIMEOUT || '10000', 10),
  },

  /**
   * Twilio Configuration
   * SMS sending API
   */
  twilio: {
    serviceName: 'Twilio',
    enabled: !!process.env.TWILIO_ACCOUNT_SID,

    // Circuit Breaker settings
    circuitBreaker: {
      failureThreshold: parseInt(process.env.TWILIO_CB_FAILURE_THRESHOLD || '5', 10),
      failureTimeWindow: parseInt(process.env.TWILIO_CB_TIME_WINDOW || '300000', 10), // 5 minutes
      resetTimeout: parseInt(process.env.TWILIO_CB_RESET_TIMEOUT || '300000', 10),    // 5 minutes
    },

    // Rate Limiter settings
    rateLimiter: {
      minimumRemaining: parseInt(process.env.TWILIO_RL_MIN_REMAINING || '20', 10),
      remainingThreshold: parseInt(process.env.TWILIO_RL_THRESHOLD || '20', 10),
    },

    // Timeout for API calls (in ms)
    timeout: parseInt(process.env.TWILIO_TIMEOUT || '10000', 10),
  },

  /**
   * Redis Configuration
   * Caching and session storage
   */
  redis: {
    serviceName: 'Redis',
    enabled: !!process.env.REDIS_URL,

    // Circuit Breaker settings
    circuitBreaker: {
      failureThreshold: parseInt(process.env.REDIS_CB_FAILURE_THRESHOLD || '10', 10),
      failureTimeWindow: parseInt(process.env.REDIS_CB_TIME_WINDOW || '300000', 10), // 5 minutes
      resetTimeout: parseInt(process.env.REDIS_CB_RESET_TIMEOUT || '600000', 10),    // 10 minutes
    },

    // Redis doesn't have rate limiting in the traditional sense
    // But we track connection failures
    rateLimiter: {
      minimumRemaining: 1,
      remainingThreshold: 1,
    },

    // Timeout for Redis operations (in ms)
    timeout: parseInt(process.env.REDIS_TIMEOUT || '5000', 10),
  },
};

/**
 * Get configuration for a specific service
 */
function getConfig(serviceName) {
  return thirdPartyApiConfig[serviceName] || null;
}

/**
 * Get all enabled services
 */
function getEnabledServices() {
  return Object.entries(thirdPartyApiConfig)
    .filter(([_, config]) => config.enabled)
    .map(([name, config]) => ({
      name,
      ...config,
    }));
}

/**
 * Validate configuration
 */
function validateConfig() {
  const issues = [];

  for (const [serviceName, config] of Object.entries(thirdPartyApiConfig)) {
    // Validate circuit breaker settings
    if (config.circuitBreaker.failureThreshold < 1) {
      issues.push(
        `${serviceName}: failureThreshold must be >= 1, got ${config.circuitBreaker.failureThreshold}`
      );
    }

    if (config.circuitBreaker.failureTimeWindow < 1000) {
      issues.push(
        `${serviceName}: failureTimeWindow must be >= 1000ms, got ${config.circuitBreaker.failureTimeWindow}ms`
      );
    }

    if (config.circuitBreaker.resetTimeout < 1000) {
      issues.push(
        `${serviceName}: resetTimeout must be >= 1000ms, got ${config.circuitBreaker.resetTimeout}ms`
      );
    }

    // Validate rate limiter settings
    if (config.rateLimiter.minimumRemaining < 1) {
      issues.push(
        `${serviceName}: minimumRemaining must be >= 1, got ${config.rateLimiter.minimumRemaining}`
      );
    }
  }

  return issues;
}

module.exports = {
  thirdPartyApiConfig,
  getConfig,
  getEnabledServices,
  validateConfig,
};
