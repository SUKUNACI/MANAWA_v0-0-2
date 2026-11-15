/**
 * Sentry Breadcrumbs Helper
 * Centralized breadcrumb management for better debugging
 */

const Sentry = require('@sentry/node');

/**
 * Add authentication action breadcrumb
 */
function addAuthBreadcrumb(action, data = {}) {
  const { email, ...rest } = data;
  Sentry.addBreadcrumb({
    category: 'auth',
    message: action,
    level: 'info',
    data: {
      email: email ? maskEmail(email) : undefined,
      ...rest,
    },
  });
}

/**
 * Add payment action breadcrumb
 */
function addPaymentBreadcrumb(action, data = {}) {
  Sentry.addBreadcrumb({
    category: 'payment',
    message: action,
    level: 'warning',
    data: {
      paymentId: data.paymentId,
      amount: data.amount,
      currency: data.currency,
      method: data.method,
      userId: data.userId,
      status: data.status,
      ...data,
    },
  });
}

/**
 * Add search action breadcrumb
 */
function addSearchBreadcrumb(action, data = {}) {
  Sentry.addBreadcrumb({
    category: 'search',
    message: action,
    level: 'info',
    data: {
      query: data.query,
      filters: data.filters,
      resultCount: data.resultCount,
      duration: data.duration,
      userId: data.userId,
      ...data,
    },
  });
}

/**
 * Add database action breadcrumb
 */
function addDatabaseBreadcrumb(action, data = {}) {
  Sentry.addBreadcrumb({
    category: 'database',
    message: action,
    level: 'info',
    data: {
      operation: data.operation,
      table: data.table,
      recordCount: data.recordCount,
      duration: data.duration,
      ...data,
    },
  });
}

/**
 * Add API call breadcrumb
 */
function addAPIBreadcrumb(action, data = {}) {
  Sentry.addBreadcrumb({
    category: 'api',
    message: action,
    level: 'info',
    data: {
      service: data.service,
      endpoint: data.endpoint,
      method: data.method,
      status: data.status,
      duration: data.duration,
      ...data,
    },
  });
}

/**
 * Add file operation breadcrumb
 */
function addFileBreadcrumb(action, data = {}) {
  Sentry.addBreadcrumb({
    category: 'file',
    message: action,
    level: 'info',
    data: {
      filename: data.filename,
      operation: data.operation,
      size: data.size,
      type: data.type,
      duration: data.duration,
      ...data,
    },
  });
}

/**
 * Add error/exception breadcrumb
 */
function addErrorBreadcrumb(action, error, data = {}) {
  Sentry.addBreadcrumb({
    category: 'error',
    message: action,
    level: 'error',
    data: {
      errorCode: error.code,
      errorMessage: error.message,
      errorType: error.constructor.name,
      ...data,
    },
  });
}

/**
 * Add retry attempt breadcrumb
 */
function addRetryBreadcrumb(action, attempt, maxAttempts, data = {}) {
  Sentry.addBreadcrumb({
    category: 'retry',
    message: `${action} (attempt ${attempt}/${maxAttempts})`,
    level: attempt === maxAttempts ? 'error' : 'warning',
    data: {
      attempt,
      maxAttempts,
      ...data,
    },
  });
}

/**
 * Add circuit breaker breadcrumb
 */
function addCircuitBreakerBreadcrumb(service, status, data = {}) {
  Sentry.addBreadcrumb({
    category: 'circuit-breaker',
    message: `Circuit breaker ${service}: ${status}`,
    level: status === 'OPEN' ? 'error' : 'warning',
    data: {
      service,
      status,
      failureCount: data.failureCount,
      threshold: data.threshold,
      resetTime: data.resetTime,
      ...data,
    },
  });
}

/**
 * Mask email for privacy
 */
function maskEmail(email) {
  if (!email) return undefined;
  const parts = email.split('@');
  if (parts.length !== 2) return email;

  const [localPart, domain] = parts;
  if (localPart.length <= 2) return `${localPart}@••••••••`;
  return `${localPart.substring(0, 2)}****@${domain}`;
}

module.exports = {
  addAuthBreadcrumb,
  addPaymentBreadcrumb,
  addSearchBreadcrumb,
  addDatabaseBreadcrumb,
  addAPIBreadcrumb,
  addFileBreadcrumb,
  addErrorBreadcrumb,
  addRetryBreadcrumb,
  addCircuitBreakerBreadcrumb,
};
