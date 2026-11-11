/**
 * Monitoring Middleware
 * Tracks all HTTP requests and responses for metrics collection
 */

const monitoring = require('../utils/monitoring');
const logger = require('../utils/logger');

/**
 * Express middleware to record request/response metrics
 * Should be placed early in the middleware stack
 */
function monitoringMiddleware(req, res, next) {
  const startTime = Date.now();

  // Capture the original res.json and res.send methods
  const originalJson = res.json;
  const originalSend = res.send;

  // Override res.json
  res.json = function(data) {
    const responseTime = Date.now() - startTime;
    monitoring.recordRequest(req, res, responseTime);
    return originalJson.call(this, data);
  };

  // Override res.send
  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    monitoring.recordRequest(req, res, responseTime);
    return originalSend.call(this, data);
  };

  // Fallback: if neither json nor send is called, record after some delay
  const timeoutId = setTimeout(() => {
    const responseTime = Date.now() - startTime;
    if (res.statusCode && !res.headersSent) {
      monitoring.recordRequest(req, res, responseTime);
    }
  }, 30000);

  // Clear timeout on response
  res.on('finish', () => {
    clearTimeout(timeoutId);
  });

  next();
}

/**
 * Track database operations
 */
function recordDatabaseMetrics(success, responseTime, query) {
  monitoring.recordDatabaseOperation(success, responseTime, query);
}

/**
 * Track payment operations
 */
function recordPaymentMetrics(amount, status) {
  monitoring.recordPayment(amount, status);
}

/**
 * Track booking operations
 */
function recordBookingMetrics() {
  monitoring.recordBooking();
}

/**
 * Track active user
 */
function recordActiveUserMetrics(userId) {
  monitoring.recordActiveUser(userId);
}

/**
 * Track quote operations
 */
function recordQuoteMetrics() {
  monitoring.recordQuote();
}

/**
 * Track conversion operations
 */
function recordConversionMetrics() {
  monitoring.recordConversion();
}

module.exports = {
  monitoringMiddleware,
  recordDatabaseMetrics,
  recordPaymentMetrics,
  recordBookingMetrics,
  recordActiveUserMetrics,
  recordQuoteMetrics,
  recordConversionMetrics,
};
