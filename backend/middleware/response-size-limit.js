/**
 * Response Size Limit Middleware (Q69)
 * Validates response size before sending to client
 * Implements X-Response-Limit headers and logging for large responses
 */

const logger = require('../utils/logger');

// Configuration
const CONFIG = {
  // Maximum response size in bytes (5MB)
  MAX_RESPONSE_SIZE: 5 * 1024 * 1024,

  // Warning threshold for response size in bytes (1MB)
  WARNING_THRESHOLD: 1 * 1024 * 1024,

  // Headers for response limits
  HEADERS: {
    RESPONSE_LIMIT: 'X-Response-Limit',
    REQUEST_BODY_LIMIT: 'X-Request-Body-Limit',
    MAX_PAGE_SIZE: 'X-Max-Page-Size',
    ACTUAL_SIZE: 'X-Response-Size',
  },

  // Default pagination limits
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 500,
};

/**
 * Middleware to validate response size before sending
 * Wraps res.json() and res.send() to measure response size
 */
function responseSizeLimitMiddleware(req, res, next) {
  // Store original send methods
  const originalSend = res.send;
  const originalJson = res.json;

  // Override res.send to check size
  res.send = function(data) {
    const responseSize = Buffer.byteLength(data, 'utf8');

    // Set response size header
    res.setHeader(CONFIG.HEADERS.ACTUAL_SIZE, responseSize);

    // Log warning if response exceeds warning threshold
    if (responseSize > CONFIG.WARNING_THRESHOLD) {
      logger.warn('[Response Size] Large response detected', {
        path: req.path,
        method: req.method,
        sizeBytes: responseSize,
        sizeMB: (responseSize / (1024 * 1024)).toFixed(2),
        threshold: CONFIG.WARNING_THRESHOLD,
        status: res.statusCode,
      });
    }

    // Block response if it exceeds maximum
    if (responseSize > CONFIG.MAX_RESPONSE_SIZE) {
      logger.error('[Response Size] Response exceeds maximum limit', {
        path: req.path,
        method: req.method,
        sizeBytes: responseSize,
        maxBytes: CONFIG.MAX_RESPONSE_SIZE,
        status: res.statusCode,
      });

      // If headers not yet sent, send error
      if (!res.headersSent) {
        return res.status(413).json({
          error: 'Réponse trop volumineux - limite dépassée',
          code: 'PAYLOAD_TOO_LARGE',
          sizeBytes: responseSize,
          limitBytes: CONFIG.MAX_RESPONSE_SIZE,
        });
      }

      // If response already started, truncate
      res.end();
      return;
    }

    // Call original send
    return originalSend.call(this, data);
  };

  // Override res.json to check size
  res.json = function(data) {
    const jsonString = JSON.stringify(data);
    const responseSize = Buffer.byteLength(jsonString, 'utf8');

    // Set response size header
    res.setHeader(CONFIG.HEADERS.ACTUAL_SIZE, responseSize);

    // Log warning if response exceeds warning threshold
    if (responseSize > CONFIG.WARNING_THRESHOLD) {
      logger.warn('[Response Size] Large JSON response detected', {
        path: req.path,
        method: req.method,
        sizeBytes: responseSize,
        sizeMB: (responseSize / (1024 * 1024)).toFixed(2),
        threshold: CONFIG.WARNING_THRESHOLD,
        status: res.statusCode,
      });
    }

    // Block response if it exceeds maximum
    if (responseSize > CONFIG.MAX_RESPONSE_SIZE) {
      logger.error('[Response Size] JSON response exceeds maximum limit', {
        path: req.path,
        method: req.method,
        sizeBytes: responseSize,
        maxBytes: CONFIG.MAX_RESPONSE_SIZE,
        status: res.statusCode,
      });

      // If headers not yet sent, send error
      if (!res.headersSent) {
        return res.status(413).json({
          error: 'Réponse JSON trop volumineux - limite dépassée',
          code: 'PAYLOAD_TOO_LARGE',
          sizeBytes: responseSize,
          limitBytes: CONFIG.MAX_RESPONSE_SIZE,
        });
      }

      // If response already started, truncate
      res.end();
      return;
    }

    // Call original json
    return originalJson.call(this, data);
  };

  next();
}

/**
 * Middleware to set request/response limit headers
 */
function setResponseLimitHeaders(req, res, next) {
  // Set standard response limit headers
  res.setHeader(CONFIG.HEADERS.RESPONSE_LIMIT, CONFIG.MAX_RESPONSE_SIZE);
  res.setHeader(CONFIG.HEADERS.REQUEST_BODY_LIMIT, '1mb');
  res.setHeader(CONFIG.HEADERS.MAX_PAGE_SIZE, CONFIG.MAX_PAGE_SIZE);

  next();
}

/**
 * Middleware to validate pagination parameters
 * Ensures clients don't request pages that would exceed size limits
 */
function validatePaginationMiddleware(req, res, next) {
  const { page = 1, limit = CONFIG.DEFAULT_PAGE_SIZE } = req.query;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);

  // Validate page number
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({
      error: 'Paramètre page invalide - doit être un entier >= 1',
      code: 'INVALID_PAGE',
    });
  }

  // Validate limit
  if (isNaN(limitNum) || limitNum < 1) {
    return res.status(400).json({
      error: 'Paramètre limit invalide - doit être un entier >= 1',
      code: 'INVALID_LIMIT',
    });
  }

  // Enforce maximum page size
  if (limitNum > CONFIG.MAX_PAGE_SIZE) {
    logger.warn('[Pagination] Client requested page size exceeding maximum', {
      path: req.path,
      method: req.method,
      requested: limitNum,
      maximum: CONFIG.MAX_PAGE_SIZE,
      userId: req.user?.id,
    });

    return res.status(400).json({
      error: `Limite de page trop élevée - maximum ${CONFIG.MAX_PAGE_SIZE}`,
      code: 'PAGE_SIZE_EXCEEDED',
      requested: limitNum,
      maximum: CONFIG.MAX_PAGE_SIZE,
    });
  }

  // Attach validated values to request
  req.pagination = {
    page: pageNum,
    limit: limitNum,
    skip: (pageNum - 1) * limitNum,
  };

  next();
}

module.exports = {
  responseSizeLimitMiddleware,
  setResponseLimitHeaders,
  validatePaginationMiddleware,
  CONFIG,
};
