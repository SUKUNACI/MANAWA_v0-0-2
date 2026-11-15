/**
 * Standardized Error Response Helper
 * Wraps error-codes.js for use in routes
 * Usage: sendError(res, ERROR_CODES.AUTH_INVALID_CREDENTIALS, req.locale, 'Custom message')
 */

const { ERROR_CODES, createError } = require('../config/error-codes');
const { t } = require('../config/i18n');
const Sentry = require('@sentry/node');

/**
 * Send standardized error response
 * @param {Object} res - Express response object
 * @param {Object} errorCode - Error code from ERROR_CODES
 * @param {string} locale - Locale for i18n (fr, en)
 * @param {Object} vars - Variables for i18n interpolation (optional)
 * @returns {Object} Response sent to client
 */
function sendError(res, errorCode, locale = 'fr', vars = {}) {
  if (!errorCode) {
    console.error('sendError: Missing errorCode');
    return res.status(500).json({
      error: t('server.error', locale),
      code: 'SVC_004',
      status: 500,
      retryable: false,
    });
  }

  const error = createError(errorCode, locale, t, vars);

  if (errorCode.status >= 500) {
    Sentry.captureMessage(`${errorCode.code}: ${error.error}`, 'error');
  }

  return res.status(error.status).json(error);
}

/**
 * Send success response with optional data
 * @param {Object} res - Express response object
 * @param {Object} data - Response data
 * @param {number} status - HTTP status (default 200)
 * @returns {Object} Response sent to client
 */
function sendSuccess(res, data = null, status = 200) {
  return res.status(status).json({
    success: true,
    data,
  });
}

/**
 * Send paginated response
 * @param {Object} res - Express response object
 * @param {Array} data - Data items
 * @param {number} total - Total count
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} Response sent to client
 */
function sendPaginated(res, data, total, page, limit) {
  return res.status(200).json({
    success: true,
    data,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
}

/**
 * Wrap route handler to catch errors and apply error codes
 * @param {Function} handler - Express route handler
 * @returns {Function} Wrapped handler with error handling
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(error => {
      if (error.message.includes('not found')) {
        return sendError(res, ERROR_CODES.RES_NOT_FOUND, req.locale || 'fr');
      }
      if (error.message.includes('unauthorized')) {
        return sendError(res, ERROR_CODES.AUTH_UNAUTHORIZED, req.locale || 'fr');
      }
      if (error.message.includes('forbidden')) {
        return sendError(res, ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS, req.locale || 'fr');
      }
      if (error.message.includes('validation')) {
        return sendError(res, ERROR_CODES.VAL_MISSING_FIELDS, req.locale || 'fr');
      }
      if (error.message.includes('timeout')) {
        return sendError(res, ERROR_CODES.SVC_TIMEOUT, req.locale || 'fr');
      }

      Sentry.captureException(error);
      return sendError(res, ERROR_CODES.SVC_INTERNAL_ERROR, req.locale || 'fr');
    });
  };
}

/**
 * Validate request data
 * @param {Object} data - Data to validate
 * @param {Array} rules - Validation rules
 * @param {Object} res - Response object (optional, for sending error)
 * @param {string} locale - Locale (optional)
 * @returns {null|Object} null if valid, error code if invalid
 */
function validateRequest(data, rules, res = null, locale = 'fr') {
  for (const rule of rules) {
    const value = data[rule.field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      if (res) return sendError(res, ERROR_CODES.VAL_MISSING_FIELDS, locale);
      return ERROR_CODES.VAL_MISSING_FIELDS;
    }

    if (!rule.required && (value === undefined || value === null || value === '')) {
      continue;
    }

    if (rule.type && typeof value !== rule.type) {
      if (res) return sendError(res, ERROR_CODES.VAL_INVALID_FORMAT, locale);
      return ERROR_CODES.VAL_INVALID_FORMAT;
    }

    if (rule.min && value.length < rule.min) {
      if (res) return sendError(res, ERROR_CODES.VAL_MIN_LENGTH, locale, { min: rule.min });
      return ERROR_CODES.VAL_MIN_LENGTH;
    }

    if (rule.max && value.length > rule.max) {
      if (res) return sendError(res, ERROR_CODES.VAL_MAX_LENGTH, locale, { max: rule.max });
      return ERROR_CODES.VAL_MAX_LENGTH;
    }
  }

  return null;
}

module.exports = {
  sendError,
  sendSuccess,
  sendPaginated,
  asyncHandler,
  validateRequest,
  ERROR_CODES,
};
