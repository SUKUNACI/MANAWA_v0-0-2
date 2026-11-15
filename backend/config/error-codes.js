/**
 * Error Codes Registry (Batch 9 - Error Handling)
 * Centralized error codes for all API endpoints
 * Format: CODE_KEY = { code, status, retryable, i18nKey }
 *
 * Usage: createError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, locale)
 */

const ERROR_CODES = {
  // ──────────────────────────────────────────────────────────────
  // AUTH ERRORS (AUTH_*)
  // ──────────────────────────────────────────────────────────────
  AUTH_INVALID_CREDENTIALS: {
    code: 'AUTH_001',
    status: 401,
    retryable: false,
    i18nKey: 'auth.invalid_credentials',
  },
  AUTH_TOKEN_EXPIRED: {
    code: 'AUTH_002',
    status: 401,
    retryable: false,
    i18nKey: 'auth.token_expired',
  },
  AUTH_TOKEN_INVALID: {
    code: 'AUTH_003',
    status: 401,
    retryable: false,
    i18nKey: 'auth.token_invalid',
  },
  AUTH_INSUFFICIENT_PERMISSIONS: {
    code: 'AUTH_004',
    status: 403,
    retryable: false,
    i18nKey: 'auth.forbidden',
  },
  AUTH_ACCOUNT_SUSPENDED: {
    code: 'AUTH_005',
    status: 403,
    retryable: false,
    i18nKey: 'auth.account_suspended',
  },
  AUTH_2FA_REQUIRED: {
    code: 'AUTH_006',
    status: 401,
    retryable: false,
    i18nKey: 'auth.2fa_required',
  },
  AUTH_2FA_INVALID: {
    code: 'AUTH_007',
    status: 401,
    retryable: false,
    i18nKey: 'auth.2fa_invalid',
  },
  AUTH_TOO_MANY_ATTEMPTS: {
    code: 'AUTH_008',
    status: 429,
    retryable: true,
    i18nKey: 'auth.too_many_attempts',
  },
  AUTH_UNAUTHORIZED: {
    code: 'AUTH_009',
    status: 401,
    retryable: false,
    i18nKey: 'auth.unauthorized',
  },

  // ──────────────────────────────────────────────────────────────
  // VALIDATION ERRORS (VAL_*)
  // ──────────────────────────────────────────────────────────────
  VAL_MISSING_FIELDS: {
    code: 'VAL_001',
    status: 400,
    retryable: false,
    i18nKey: 'validation.required',
  },
  VAL_INVALID_EMAIL: {
    code: 'VAL_002',
    status: 400,
    retryable: false,
    i18nKey: 'validation.invalid_email',
  },
  VAL_INVALID_PHONE: {
    code: 'VAL_003',
    status: 400,
    retryable: false,
    i18nKey: 'validation.invalid_phone',
  },
  VAL_PASSWORD_WEAK: {
    code: 'VAL_004',
    status: 400,
    retryable: false,
    i18nKey: 'validation.password_weak',
  },
  VAL_INVALID_AMOUNT: {
    code: 'VAL_005',
    status: 400,
    retryable: false,
    i18nKey: 'validation.invalid_amount',
  },
  VAL_MIN_LENGTH: {
    code: 'VAL_006',
    status: 400,
    retryable: false,
    i18nKey: 'validation.min_length',
  },
  VAL_MAX_LENGTH: {
    code: 'VAL_007',
    status: 400,
    retryable: false,
    i18nKey: 'validation.max_length',
  },
  VAL_INVALID_FORMAT: {
    code: 'VAL_008',
    status: 400,
    retryable: false,
    i18nKey: 'validation.invalid_format',
  },
  VAL_DUPLICATE_ENTRY: {
    code: 'VAL_009',
    status: 409,
    retryable: false,
    i18nKey: 'validation.duplicate_entry',
  },

  // ──────────────────────────────────────────────────────────────
  // PAYMENT ERRORS (PAY_*)
  // ──────────────────────────────────────────────────────────────
  PAY_INSUFFICIENT_FUNDS: {
    code: 'PAY_001',
    status: 402,
    retryable: false,
    i18nKey: 'payment.insufficient',
  },
  PAY_TIMEOUT: {
    code: 'PAY_002',
    status: 504,
    retryable: true,
    i18nKey: 'payment.timeout',
  },
  PAY_DECLINED: {
    code: 'PAY_003',
    status: 402,
    retryable: false,
    i18nKey: 'payment.failed',
  },
  PAY_INVALID_METHOD: {
    code: 'PAY_004',
    status: 400,
    retryable: false,
    i18nKey: 'payment.invalid_method',
  },
  PAY_ALREADY_PROCESSED: {
    code: 'PAY_005',
    status: 409,
    retryable: false,
    i18nKey: 'payment.already_processed',
  },
  PAY_GATEWAY_ERROR: {
    code: 'PAY_006',
    status: 502,
    retryable: true,
    i18nKey: 'payment.gateway_error',
  },

  // ──────────────────────────────────────────────────────────────
  // RESOURCE ERRORS (RES_*)
  // ──────────────────────────────────────────────────────────────
  RES_NOT_FOUND: {
    code: 'RES_001',
    status: 404,
    retryable: false,
    i18nKey: 'resource.not_found',
  },
  RES_FORBIDDEN: {
    code: 'RES_002',
    status: 403,
    retryable: false,
    i18nKey: 'resource.access_denied',
  },
  RES_CONFLICT: {
    code: 'RES_003',
    status: 409,
    retryable: false,
    i18nKey: 'resource.already_exists',
  },
  RES_GONE: {
    code: 'RES_004',
    status: 410,
    retryable: false,
    i18nKey: 'resource.gone',
  },
  RES_DELETED: {
    code: 'RES_005',
    status: 404,
    retryable: false,
    i18nKey: 'resource.deleted_error',
  },

  // ──────────────────────────────────────────────────────────────
  // SERVICE ERRORS (SVC_*)
  // ──────────────────────────────────────────────────────────────
  SVC_UNAVAILABLE: {
    code: 'SVC_001',
    status: 503,
    retryable: true,
    i18nKey: 'service.unavailable',
  },
  SVC_TIMEOUT: {
    code: 'SVC_002',
    status: 504,
    retryable: true,
    i18nKey: 'service.timeout',
  },
  SVC_RATE_LIMITED: {
    code: 'SVC_003',
    status: 429,
    retryable: true,
    i18nKey: 'rate_limit.exceeded',
  },
  SVC_INTERNAL_ERROR: {
    code: 'SVC_004',
    status: 500,
    retryable: false,
    i18nKey: 'server.error',
  },
  SVC_DATABASE_ERROR: {
    code: 'SVC_005',
    status: 500,
    retryable: true,
    i18nKey: 'server.error',
  },
  SVC_EMAIL_FAILED: {
    code: 'SVC_006',
    status: 500,
    retryable: true,
    i18nKey: 'service.email_failed',
  },
  SVC_SMS_FAILED: {
    code: 'SVC_007',
    status: 500,
    retryable: true,
    i18nKey: 'service.sms_failed',
  },
  SVC_FILE_UPLOAD_FAILED: {
    code: 'SVC_008',
    status: 500,
    retryable: true,
    i18nKey: 'upload.failed',
  },

  // ──────────────────────────────────────────────────────────────
  // BUSINESS LOGIC ERRORS (BUS_*)
  // ──────────────────────────────────────────────────────────────
  BUS_QUOTE_EXPIRED: {
    code: 'BUS_001',
    status: 410,
    retryable: false,
    i18nKey: 'quote.expired',
  },
  BUS_PROJECT_NOT_AVAILABLE: {
    code: 'BUS_002',
    status: 409,
    retryable: false,
    i18nKey: 'business.project_unavailable',
  },
  BUS_BOOKING_CONFLICT: {
    code: 'BUS_003',
    status: 409,
    retryable: false,
    i18nKey: 'booking.conflict',
  },
  BUS_INSUFFICIENT_BALANCE: {
    code: 'BUS_004',
    status: 402,
    retryable: false,
    i18nKey: 'payment.insufficient',
  },
  BUS_OPERATION_NOT_ALLOWED: {
    code: 'BUS_005',
    status: 403,
    retryable: false,
    i18nKey: 'business.operation_not_allowed',
  },
};

/**
 * Factory function to create standardized error responses
 * @param {Object} errorCode - Error code config from ERROR_CODES
 * @param {string} locale - Language locale (fr, en)
 * @param {Function} i18nFunc - i18n translation function t(key, locale, vars)
 * @param {Object} vars - Variables for i18n interpolation
 * @returns {Object} Standardized error object
 */
function createError(errorCode, locale, i18nFunc, vars = {}) {
  if (!errorCode) {
    throw new Error('createError: errorCode is required');
  }
  if (typeof i18nFunc !== 'function') {
    throw new Error('createError: i18nFunc must be a function');
  }

  return {
    error: i18nFunc(errorCode.i18nKey, locale, vars),
    code: errorCode.code,
    status: errorCode.status,
    retryable: errorCode.retryable,
  };
}

/**
 * Get error code by string key
 * @param {string} key - Error code key (e.g., 'AUTH_INVALID_CREDENTIALS')
 * @returns {Object|null} Error code config or null
 */
function getErrorCode(key) {
  return ERROR_CODES[key] || null;
}

/**
 * Check if error is retryable
 * @param {string} key - Error code key
 * @returns {boolean}
 */
function isRetryable(key) {
  const code = ERROR_CODES[key];
  return code ? code.retryable : false;
}

Object.keys(ERROR_CODES).forEach(key => Object.freeze(ERROR_CODES[key]));
Object.freeze(ERROR_CODES);

module.exports = {
  ERROR_CODES,
  createError,
  getErrorCode,
  isRetryable,
};
