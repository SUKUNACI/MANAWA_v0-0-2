/**
 * Third-party API Timeout Configuration (Q59)
 * Centralized timeout settings for all external API calls
 */

module.exports = {
  // Third-party API timeouts (milliseconds)
  GENIUSPAY_TIMEOUT: 5000,      // GeniusPay payment gateway: 5 seconds
  MAILJET_TIMEOUT: 5000,         // Mailjet email service: 5 seconds
  TWILIO_TIMEOUT: 5000,          // Twilio SMS service: 5 seconds

  // Express middleware timeouts (milliseconds)
  EXPRESS_PAYMENT_TIMEOUT: 30000,      // /api/v1/payments/* routes: 30 seconds
  EXPRESS_SUBSCRIPTION_TIMEOUT: 30000, // /api/v1/subscriptions/* routes: 30 seconds

  // Retry configuration
  RETRY_MAX_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000, // 1 second base delay (exponential backoff)

  // Fallback notification timeouts
  FALLBACK_EMAIL_TIMEOUT: 10000,  // 10 seconds for fallback email
  FALLBACK_SMS_TIMEOUT: 10000,    // 10 seconds for fallback SMS

  // Error codes for different timeout types
  ERROR_CODES: {
    TIMEOUT_ECONNABORTED: 'TIMEOUT_ECONNABORTED',  // Connection aborted
    TIMEOUT_ETIMEDOUT: 'TIMEOUT_ETIMEDOUT',        // Socket timeout
    TIMEOUT_GENERIC: 'TIMEOUT_GENERIC',            // Generic timeout
    TIMEOUT_ERR: 'TIMEOUT_ERR',                    // Custom timeout error code (Q59)
  },

  // Service-specific error classification
  SERVICE_ERRORS: {
    TIMEOUT: 'timeout',
    RATE_LIMIT: 'rate_limit',
    AUTH_INVALID: 'auth_invalid',
    SERVER_ERROR: 'server_error',
    NETWORK_ERROR: 'network_error',
  },
};
