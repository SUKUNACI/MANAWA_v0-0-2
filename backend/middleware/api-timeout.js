/**
 * Express API Timeout Middleware (Q59)
 * Configures timeout for specific routes: /payments, /subscriptions
 * Handles ECONNABORTED and ETIMEDOUT as specific timeout errors
 */

const timeoutConfig = require('../config/timeout-config');
const logger = require('../utils/logger');

/**
 * Create timeout middleware for specific routes
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} serviceType - Service type (e.g., 'payments', 'subscriptions')
 * @returns {Function} Express middleware
 */
function createTimeoutMiddleware(timeoutMs, serviceType) {
  return (req, res, next) => {
    // Set timeout on the request socket
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(`${serviceType} request timeout after ${timeoutMs}ms`);
      timeoutError.code = timeoutConfig.ERROR_CODES.TIMEOUT_ERR;
      timeoutError.timeout = true;
      timeoutError.service = serviceType;
      timeoutError.timeoutMs = timeoutMs;

      // Log timeout separately (Q59)
      logger.warn(`[TIMEOUT] ${serviceType} endpoint timeout`, {
        path: req.path,
        method: req.method,
        timeoutMs,
        code: timeoutConfig.ERROR_CODES.TIMEOUT_ERR,
        timestamp: new Date().toISOString(),
      });

      // If response not already sent, send timeout error
      if (!res.headersSent) {
        return res.status(504).json({
          error: `Délai d'attente dépassé. ${serviceType} a pris trop de temps.`,
          code: timeoutConfig.ERROR_CODES.TIMEOUT_ERR,
          retryable: true,
        });
      }

      // If response started, just end it
      if (!res.finished) {
        res.end();
      }
    }, timeoutMs);

    // Clean up timeout if response finishes before timeout
    res.on('finish', () => {
      clearTimeout(timeoutHandle);
    });

    res.on('close', () => {
      clearTimeout(timeoutHandle);
    });

    // Handle socket errors (ECONNABORTED, ETIMEDOUT)
    const originalOnError = req.socket.on;
    req.socket.on = function(...args) {
      if (args[0] === 'error') {
        const originalErrorHandler = args[1];
        args[1] = function(err) {
          if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
            // Log socket timeout/abort separately (Q59)
            logger.warn(`[TIMEOUT] ${serviceType} socket error: ${err.code}`, {
              path: req.path,
              method: req.method,
              code: err.code,
              service: serviceType,
              timestamp: new Date().toISOString(),
            });

            // Send appropriate error if not already sent
            if (!res.headersSent) {
              return res.status(504).json({
                error: `Erreur de connexion: ${err.code}. ${serviceType} a perdu la connexion.`,
                code: `TIMEOUT_${err.code}`,
                retryable: true,
              });
            }
          }

          // Call original error handler
          if (typeof originalErrorHandler === 'function') {
            originalErrorHandler.call(this, err);
          }
        };
      }

      return originalOnError.apply(this, args);
    };

    next();
  };
}

/**
 * Timeout middleware for payment routes
 */
const paymentTimeoutMiddleware = createTimeoutMiddleware(
  timeoutConfig.EXPRESS_PAYMENT_TIMEOUT,
  'payments'
);

/**
 * Timeout middleware for subscription routes
 */
const subscriptionTimeoutMiddleware = createTimeoutMiddleware(
  timeoutConfig.EXPRESS_SUBSCRIPTION_TIMEOUT,
  'subscriptions'
);

module.exports = {
  createTimeoutMiddleware,
  paymentTimeoutMiddleware,
  subscriptionTimeoutMiddleware,
};
