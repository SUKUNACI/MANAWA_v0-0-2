/**
 * API Versioning Middleware
 *
 * Adds versioning headers and deprecation warnings to all API responses
 */

const { CURRENT_VERSION, getDeprecationInfo } = require('../config/versioning');

/**
 * Middleware to add versioning headers to all API responses
 * Adds:
 * - X-API-Version: Current API version
 * - Deprecation: false (or true if version is deprecated)
 * - Sunset: HTTP date when endpoint will be removed (if deprecated)
 * - Deprecation-Info: Deprecation message (if deprecated)
 */
function versioningHeadersMiddleware(req, res, next) {
  // Store original json method
  const originalJson = res.json;

  // Override json method to add versioning headers
  res.json = function (data) {
    // Add API version header
    res.setHeader('X-API-Version', CURRENT_VERSION);

    // Check for deprecation on non-v1 paths
    if (req.baseUrl && !req.baseUrl.includes('/api/v1')) {
      const deprecationInfo = getDeprecationInfo('v0');
      if (deprecationInfo && deprecationInfo.deprecated) {
        res.setHeader('Deprecation', 'true');
        if (deprecationInfo.sunsetDate) {
          const sunsetDate = new Date(deprecationInfo.sunsetDate);
          res.setHeader('Sunset', sunsetDate.toUTCString());
        }
        if (deprecationInfo.message) {
          res.setHeader('Deprecation-Info', deprecationInfo.message);
        }
      }
    } else {
      // No deprecation for v1
      res.setHeader('Deprecation', 'false');
    }

    // Call original json method
    return originalJson.call(this, data);
  };

  next();
}

/**
 * Middleware to redirect /api/... requests to /api/v1/...
 * Provides backwards compatibility with HTTP 301 Permanent Redirect
 */
function apiRedirectMiddleware(req, res, next) {
  // Match /api/* but not /api/v1/* or /api/v0/*
  if (req.path.match(/^\/api\/(?!v[0-9])/) && req.baseUrl === '/api') {
    const targetPath = `/api/v1${req.url}`;
    return res.redirect(301, targetPath);
  }
  next();
}

/**
 * Middleware to validate requested API version
 * Can be used to enforce specific versions or log version usage
 */
function versionValidationMiddleware(req, res, next) {
  const acceptHeader = req.headers['accept-version'] || req.headers['x-api-version'];

  if (acceptHeader) {
    // If client specifies a version, validate it
    if (acceptHeader !== CURRENT_VERSION) {
      const deprecationInfo = getDeprecationInfo(acceptHeader);
      if (deprecationInfo && deprecationInfo.deprecated) {
        // Log deprecated version usage
        console.warn(`[API] Deprecated version ${acceptHeader} requested from ${req.ip}`);

        if (deprecationInfo.sunsetDate && new Date() > new Date(deprecationInfo.sunsetDate)) {
          // Version is sunset, reject
          return res.status(410).json({
            error: 'API version no longer supported',
            message: `API ${acceptHeader} is no longer supported. Please migrate to ${CURRENT_VERSION}.`,
            migrateUrl: deprecationInfo.redirectUrl,
          });
        }
      }
    }
  }

  next();
}

module.exports = {
  versioningHeadersMiddleware,
  apiRedirectMiddleware,
  versionValidationMiddleware,
};
