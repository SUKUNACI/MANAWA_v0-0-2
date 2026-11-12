/**
 * Third-party Error Handler (Q60)
 * Differentiates between error types: timeout ≠ rate-limit ≠ auth-invalid ≠ server-error
 * Provides clear client messages and fallback mechanisms
 */

const timeoutConfig = require('../config/timeout-config');
const logger = require('./logger');
const Sentry = require('@sentry/node');

/**
 * Classify error from third-party API
 * @param {Error|Object} error - The error object
 * @param {string} service - Service name (geniuspay, mailjet, twilio)
 * @returns {Object} Classified error with type, message, retryable flag
 */
function classifyError(error, service) {
  // Timeout errors (Q59)
  if (error.code === timeoutConfig.ERROR_CODES.TIMEOUT_ERR ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      error.message?.includes('timeout')) {
    return {
      type: timeoutConfig.SERVICE_ERRORS.TIMEOUT,
      code: timeoutConfig.ERROR_CODES.TIMEOUT_ERR,
      message: `${service} a dépassé le délai d'attente. Veuillez réessayer.`,
      retryable: true,
      statusCode: 504,
    };
  }

  const statusCode = error.response?.status || error.statusCode;
  const data = error.response?.data || error.data;
  const message = error.message || 'Erreur inconnue';

  // Rate limit errors (429)
  if (statusCode === 429) {
    logger.warn(`[RateLimit] ${service} rate limit exceeded`, {
      service,
      statusCode,
      message,
    });
    return {
      type: timeoutConfig.SERVICE_ERRORS.RATE_LIMIT,
      code: 'RATE_LIMIT_ERR',
      message: `${service} est temporairement indisponible. Trop de requêtes. Réessayez dans quelques minutes.`,
      retryable: true,
      statusCode: 429,
    };
  }

  // Authentication/Authorization errors (401, 403)
  if (statusCode === 401 || statusCode === 403) {
    logger.error(`[AuthError] ${service} authentication failed`, {
      service,
      statusCode,
      data,
    });
    return {
      type: timeoutConfig.SERVICE_ERRORS.AUTH_INVALID,
      code: 'AUTH_INVALID_ERR',
      message: `Configuration ${service} invalide. Vérifiez les clés API.`,
      retryable: false,
      statusCode: 503, // Return 503 to client to indicate service issue
    };
  }

  // Server errors (5xx)
  if (statusCode >= 500) {
    logger.error(`[ServerError] ${service} server error`, {
      service,
      statusCode,
      message,
      data,
    });
    return {
      type: timeoutConfig.SERVICE_ERRORS.SERVER_ERROR,
      code: 'SERVER_ERROR_ERR',
      message: `${service} rencontre une erreur serveur. Réessayez dans quelques instants.`,
      retryable: true,
      statusCode: 503,
    };
  }

  // Client errors (4xx, except 401/403/429)
  if (statusCode >= 400 && statusCode < 500) {
    logger.warn(`[ClientError] ${service} client error`, {
      service,
      statusCode,
      message,
    });
    return {
      type: timeoutConfig.SERVICE_ERRORS.NETWORK_ERROR,
      code: 'CLIENT_ERROR_ERR',
      message: `Erreur dans la requête vers ${service}: ${message}`,
      retryable: false,
      statusCode: 400,
    };
  }

  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || !statusCode) {
    logger.error(`[NetworkError] ${service} network error`, {
      service,
      code: error.code,
      message,
    });
    return {
      type: timeoutConfig.SERVICE_ERRORS.NETWORK_ERROR,
      code: 'NETWORK_ERROR_ERR',
      message: `Impossible de contacter ${service}. Vérifiez votre connexion réseau.`,
      retryable: true,
      statusCode: 503,
    };
  }

  // Unknown error
  logger.error(`[UnknownError] ${service} unknown error`, {
    service,
    statusCode,
    message,
  });
  return {
    type: 'unknown',
    code: 'UNKNOWN_ERROR_ERR',
    message: `Erreur inconnue avec ${service}. Réessayez plus tard.`,
    retryable: true,
    statusCode: 500,
  };
}

/**
 * Handle error with logging and Sentry integration
 * @param {Error|Object} error - The error object
 * @param {string} service - Service name (geniuspay, mailjet, twilio)
 * @param {Object} context - Additional context for logging
 * @returns {Object} Classified error info
 */
function handleThirdPartyError(error, service, context = {}) {
  const classified = classifyError(error, service);

  // Log all errors with Sentry for monitoring
  if (Sentry && classified.type !== timeoutConfig.SERVICE_ERRORS.RATE_LIMIT) {
    Sentry.captureException(error, {
      tags: {
        service,
        errorType: classified.type,
        code: classified.code,
      },
      contexts: {
        thirdParty: {
          service,
          statusCode: classified.statusCode,
          ...context,
        },
      },
    });
  }

  return classified;
}

/**
 * Q60: Get fallback strategy for service failure
 * Returns which fallback to use: email fallback, SMS fallback, etc.
 */
function getFallbackStrategy(failedService, originalNotificationType) {
  const strategies = {
    // If Twilio SMS fails, fallback to email OTP (Q60)
    twilio: {
      fallbackService: 'mailjet',
      fallbackType: 'email_otp',
      message: 'SMS indisponible, code OTP envoyé par email',
    },
    // If Mailjet email fails, fallback to SMS notification (Q60)
    mailjet: {
      fallbackService: 'twilio',
      fallbackType: 'sms_notification',
      message: 'Email indisponible, notification envoyée par SMS',
    },
    // If GeniusPay fails
    geniuspay: {
      fallbackService: null,
      fallbackType: 'error_message',
      message: 'Paiement échoué. Veuillez réessayer ou utiliser une autre méthode.',
    },
  };

  return strategies[failedService] || {
    fallbackService: null,
    fallbackType: null,
    message: 'Service indisponible',
  };
}

/**
 * Format error response for client (Q60)
 * Clear messages, not generic "Internal Error"
 */
function formatErrorResponse(error, service, statusCode) {
  const classified = classifyError(error, service);

  return {
    success: false,
    error: classified.message,
    code: classified.code,
    type: classified.type,
    retryable: classified.retryable,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Log timeout separately (Q59)
 */
function logTimeout(service, context = {}) {
  logger.warn(`[TIMEOUT_ERR] ${service} timeout`, {
    code: timeoutConfig.ERROR_CODES.TIMEOUT_ERR,
    service,
    timestamp: new Date().toISOString(),
    ...context,
  });

  // Also report to Sentry
  if (Sentry) {
    Sentry.captureMessage(`${service} timeout`, 'warning', {
      tags: {
        service,
        errorType: 'timeout',
        code: timeoutConfig.ERROR_CODES.TIMEOUT_ERR,
      },
    });
  }
}

/**
 * Log all third-party errors to Sentry (Q60)
 */
function logThirdPartyErrorToSentry(error, service, context = {}) {
  if (!Sentry) return;

  const classified = classifyError(error, service);

  Sentry.captureException(error, {
    tags: {
      service,
      errorType: classified.type,
      code: classified.code,
    },
    contexts: {
      thirdPartyError: {
        service,
        statusCode: error.response?.status,
        errorMessage: error.message,
        ...context,
      },
    },
  });
}

module.exports = {
  classifyError,
  handleThirdPartyError,
  getFallbackStrategy,
  formatErrorResponse,
  logTimeout,
  logThirdPartyErrorToSentry,
  SERVICE_ERRORS: timeoutConfig.SERVICE_ERRORS,
  ERROR_CODES: timeoutConfig.ERROR_CODES,
};
