/**
 * Sorting Helper - Validates and applies sorting parameters
 * Supports single and multi-column sorting: ?sort=name,createdAt&order=asc,desc
 * Q64 Implementation
 */

const paginationConfig = require('../config/pagination');

/**
 * Validate and parse sort parameters
 * @param {string} sortParam - Comma-separated column names (e.g., "name,createdAt")
 * @param {string} orderParam - Comma-separated sort directions (e.g., "asc,desc")
 * @param {array} allowedFields - Whitelist of sortable fields for this route
 * @returns {object|null} Prisma orderBy object or null if invalid
 */
function validateSortParams(sortParam, orderParam, allowedFields = []) {
  if (!sortParam) {
    return null;
  }

  // Parse sort fields
  const sortFields = sortParam.split(',').map(s => s.trim()).filter(s => s);
  if (sortFields.length === 0) {
    return null;
  }

  // Parse order directions
  const orderDirections = orderParam ? orderParam.split(',').map(o => o.trim().toLowerCase()) : Array(sortFields.length).fill('asc');

  // Validate all fields are allowed
  for (const field of sortFields) {
    if (!isValidSortField(field, allowedFields)) {
      return null;
    }
  }

  // Validate order directions
  for (const order of orderDirections) {
    if (!['asc', 'desc'].includes(order)) {
      return null;
    }
  }

  // Build orderBy object
  if (sortFields.length === 1) {
    return {
      [sortFields[0]]: orderDirections[0] || 'asc',
    };
  }

  // Multi-column sorting
  const orderBy = {};
  for (let i = 0; i < sortFields.length; i++) {
    orderBy[sortFields[i]] = orderDirections[i] || 'asc';
  }
  return orderBy;
}

/**
 * Check if a field is valid for sorting
 * @param {string} field - Field name to validate
 * @param {array} allowedFields - Whitelist of sortable fields
 * @returns {boolean} True if field is allowed
 */
function isValidSortField(field, allowedFields = []) {
  // Prevent injection attacks - only allow alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
    return false;
  }

  // If whitelist provided, check against it
  if (allowedFields.length > 0) {
    return allowedFields.includes(field);
  }

  // Default allowed fields (common across routes)
  const defaultAllowed = [
    'id',
    'createdAt',
    'updatedAt',
    'name',
    'title',
    'status',
    'email',
    'city',
    'rating',
    'score',
    'budget',
    'price',
    'amount',
    'version',
    'sortOrder',
    '_count',
  ];

  return defaultAllowed.includes(field);
}

/**
 * Validate page size - enforces max limits from centralized config
 * @param {number} limit - Requested page size
 * @param {boolean} isAdmin - Whether user has admin role
 * @param {string} endpoint - Endpoint name for limit lookup (optional)
 * @returns {number} Validated limit
 */
const ADMIN_MAX_LIMIT = 500;

function validatePageSize(limit, isAdmin = false, endpoint = null) {
  const parsed = parseInt(limit);
  const effective = Number.isNaN(parsed) ? paginationConfig.DEFAULT_LIMIT : parsed;

  // Get endpoint-specific max or use global max
  const baseMax = isAdmin ? ADMIN_MAX_LIMIT : paginationConfig.MAX_LIMIT;
  const maxLimit = endpoint
    ? Math.min(paginationConfig.getLimitForEndpoint(endpoint), baseMax)
    : baseMax;

  // Enforce min/max bounds
  return Math.min(Math.max(paginationConfig.MIN_LIMIT, effective), maxLimit);
}

/**
 * Build complete pagination + sorting object for Prisma
 * @param {object} options - Configuration object
 * @returns {object} Object with { take, skip, orderBy }
 */
function buildPaginationQuery(options = {}) {
  const {
    page = 1,
    limit = paginationConfig.DEFAULT_LIMIT,
    isAdmin = false,
    sortParam = null,
    orderParam = null,
    allowedFields = [],
    defaultOrder = null,
    endpoint = null,  // Optional endpoint name for limit lookup
  } = options;

  const validatedPage = Math.max(1, parseInt(page) || 1);
  const validatedLimit = validatePageSize(limit, isAdmin, endpoint);

  const result = {
    take: validatedLimit,
    skip: (validatedPage - 1) * validatedLimit,
  };

  // Apply sorting
  const parsedSort = validateSortParams(sortParam, orderParam, allowedFields);
  if (parsedSort) {
    result.orderBy = parsedSort;
  } else if (defaultOrder) {
    result.orderBy = defaultOrder;
  }

  return result;
}

module.exports = {
  validateSortParams,
  isValidSortField,
  validatePageSize,
  buildPaginationQuery,
};
