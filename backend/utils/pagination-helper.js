/**
 * Pagination Helper Utility
 *
 * Provides reusable functions for applying pagination to database queries.
 * Integrates with the centralized pagination config.
 *
 * Usage in routes:
 *   const { applyPagination } = require('../utils/pagination-helper');
 *   const { limit, offset } = applyPagination(req.query, 'projects');
 *   const data = await prisma.project.findMany({ skip: offset, take: limit });
 */

const paginationConfig = require('../config/pagination');
const logger = require('./logger');

/**
 * Apply pagination to a Prisma query
 *
 * Extracts limit/offset from query parameters, validates them,
 * and returns Prisma-compatible skip/take values.
 *
 * @param {object} queryParams - Express req.query object
 * @param {string} endpoint - Endpoint name for limit lookup
 * @param {object} options - Additional options
 * @returns {object} - { limit, offset, skip, take } for use in Prisma
 */
function applyPagination(queryParams, endpoint, options = {}) {
  const { limit, offset } = paginationConfig.validatePaginationParams(queryParams, endpoint);

  // Log pagination for monitoring
  if (options.logPagination !== false) {
    logger.debug(`[Pagination] ${endpoint}: limit=${limit}, offset=${offset}`);
  }

  return {
    limit,
    offset,
    // Prisma uses skip (offset) and take (limit)
    skip: offset,
    take: limit,
  };
}

/**
 * Validate pagination middleware for Express
 *
 * Use in route validation chain:
 *   router.get('/list', validatePaginationQuery(), ...)
 *
 * @returns {array} - express-validator rules
 */
function validatePaginationQuery() {
  const { query } = require('express-validator');

  return [
    query('limit')
      .optional()
      .isInt({ min: paginationConfig.MIN_LIMIT, max: paginationConfig.MAX_LIMIT })
      .withMessage(`limit must be between ${paginationConfig.MIN_LIMIT} and ${paginationConfig.MAX_LIMIT}`)
      .toInt(),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('offset must be >= 0')
      .toInt(),
  ];
}

/**
 * Validate pagination middleware (legacy page-based)
 *
 * For backward compatibility with old API clients using page/limit.
 * Automatically converts page to offset.
 *
 * Use in route validation chain:
 *   router.get('/list', validatePageBasedPaginationQuery(), ...)
 *
 * @returns {array} - express-validator rules
 */
function validatePageBasedPaginationQuery() {
  const { query } = require('express-validator');

  return [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('page must be >= 1')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: paginationConfig.MIN_LIMIT, max: paginationConfig.MAX_LIMIT })
      .withMessage(`limit must be between ${paginationConfig.MIN_LIMIT} and ${paginationConfig.MAX_LIMIT}`)
      .toInt(),
  ];
}

/**
 * Apply page-based pagination (for backward compatibility)
 *
 * Converts page/limit to offset/limit and validates.
 * Useful for APIs that previously used page-based pagination.
 *
 * @param {object} queryParams - Express req.query object
 * @param {string} endpoint - Endpoint name for limit lookup
 * @returns {object} - { limit, offset, skip, take, page }
 */
function applyPageBasedPagination(queryParams, endpoint) {
  const limit = parseInt(queryParams.limit) || paginationConfig.DEFAULT_LIMIT;
  const page = Math.max(1, parseInt(queryParams.page) || 1);

  // Enforce limits
  const endpointMaxLimit = Math.min(paginationConfig.getLimitForEndpoint(endpoint), paginationConfig.MAX_LIMIT);
  const validatedLimit = Math.max(paginationConfig.MIN_LIMIT, Math.min(limit, endpointMaxLimit));

  // Convert page to offset
  const offset = paginationConfig.pageToOffset(page, validatedLimit);

  return {
    limit: validatedLimit,
    offset,
    skip: offset,
    take: validatedLimit,
    page,
  };
}

/**
 * Build a paginated response envelope
 *
 * Standardizes response format across all endpoints.
 *
 * Usage:
 *   const items = await prisma.project.findMany({ skip, take });
 *   const total = await prisma.project.count();
 *   return res.json(buildPaginatedResponse(items, limit, offset, total));
 *
 * @param {array} data - The items in this page
 * @param {number} limit - Items per page
 * @param {number} offset - Starting position
 * @param {number} total - Total items available
 * @returns {object} - Response with data and pagination metadata
 */
function buildPaginatedResponse(data, limit, offset, total) {
  return paginationConfig.buildPaginatedResponse(data, limit, offset, total);
}

/**
 * Cursor-based pagination helper (for future use with high-frequency data)
 *
 * NOTE: Currently not used globally, but available for endpoints with
 * high-frequency updates where offset-based pagination causes issues.
 *
 * @param {object} queryParams - Express req.query with cursor
 * @param {string} endpoint - Endpoint name
 * @returns {object} - { cursor, limit }
 */
function applyCursorPagination(queryParams, endpoint) {
  const limit = Math.min(
    parseInt(queryParams.limit) || paginationConfig.DEFAULT_LIMIT,
    paginationConfig.MAX_LIMIT
  );
  const cursor = queryParams.cursor || null;

  return { cursor, limit };
}

/**
 * Check if pagination is valid and return error if not
 *
 * Useful for custom validation logic.
 *
 * @param {number} limit - The limit value to validate
 * @param {number} offset - The offset value to validate
 * @returns {string|null} - Error message or null if valid
 */
function validatePaginationValues(limit, offset) {
  if (limit < paginationConfig.MIN_LIMIT || limit > paginationConfig.MAX_LIMIT) {
    return `limit must be between ${paginationConfig.MIN_LIMIT} and ${paginationConfig.MAX_LIMIT}`;
  }
  if (offset < 0) {
    return 'offset must be >= 0';
  }
  return null;
}

/**
 * Get pagination defaults
 *
 * Useful for documentation and client-side implementations.
 *
 * @returns {object} - Default pagination settings
 */
function getPaginationDefaults() {
  return {
    defaultLimit: paginationConfig.DEFAULT_LIMIT,
    maxLimit: paginationConfig.MAX_LIMIT,
    minLimit: paginationConfig.MIN_LIMIT,
    defaultOffset: paginationConfig.DEFAULT_OFFSET,
  };
}

module.exports = {
  // Main functions
  applyPagination,
  applyPageBasedPagination,
  buildPaginatedResponse,
  applyCursorPagination,

  // Validation
  validatePaginationQuery,
  validatePageBasedPaginationQuery,
  validatePaginationValues,

  // Utilities
  getPaginationDefaults,
};
