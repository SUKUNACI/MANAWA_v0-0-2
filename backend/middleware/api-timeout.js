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
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;

      logger.warn(`[TIMEOUT] ${serviceType} endpoint timeout`, {
        path: req.path,
        method: req.method,
        timeoutMs,
        code: timeoutConfig.ERROR_CODES.TIMEOUT_ERR,
        timestamp: new Date().toISOString(),
      });

      if (!res.headersSent) {
        res.status(504).json({
          error: `Délai d'attente dépassé. ${serviceType} a pris trop de temps.`,
          code: timeoutConfig.ERROR_CODES.TIMEOUT_ERR,
          retryable: true,
        });
      } else if (!res.finished) {
        res.end();
      }
    }, timeoutMs);

    // Guard all post-timeout response writes
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    res.json = function(...args) {
      if (timedOut && res.headersSent) return res;
      return originalJson(...args);
    };
    res.send = function(...args) {
      if (timedOut && res.headersSent) return res;
      return originalSend(...args);
    };
    res.write = function(...args) {
      if (timedOut && res.headersSent) return false;
      return originalWrite(...args);
    };
    res.end = function(...args) {
      if (timedOut && res.headersSent) return res;
      return originalEnd(...args);
    };

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
