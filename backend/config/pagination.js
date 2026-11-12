/**
 * Pagination Configuration
 *
 * Centralized pagination settings for the MANAWA API.
 * Uses offset-based pagination strategy globally.
 *
 * Strategy: offset-based pagination (recommended for stateless REST APIs)
 * - Client specifies: offset (where to start) and limit (how many items)
 * - Pros: Simple, stateless, works with filtering/sorting, good for filtering
 * - Cons: Item deletions can cause "gaps" in cursors (acceptable for MANAWA's use case)
 *
 * Note: Cursor-based pagination can be implemented per-endpoint if needed (high-frequency data)
 */

module.exports = {
  // Global default page size
  // Used when client doesn't specify limit
  DEFAULT_LIMIT: 20,

  // Absolute maximum allowed limit to prevent abuse
  // Enforced across all endpoints
  MAX_LIMIT: 100,

  // Minimum allowed limit
  MIN_LIMIT: 1,

  // Default offset (starting position)
  DEFAULT_OFFSET: 0,

  // Endpoint-specific overrides
  // Keys match route names or specific endpoints
  // Each can override DEFAULT_LIMIT for special cases with justification
  ENDPOINT_LIMITS: {
    // Admin endpoints: can handle more items
    'admin-backups': 50,
    'admin-recovery': 50,
    'admin-analytics': 50,
    'admin-kpis': 50,
    'admin-webhooks': 50,
    'queues-admin': 50,
    'referrals-admin': 50,

    // Search endpoints: typically return smaller datasets
    'search': 20,

    // User dashboard: moderate amounts
    'projects': 20,
    'quotes': 20,
    'bookings': 50,
    'messages': 20,
    'notifications': 30,

    // User lists: smaller by default (privacy/performance)
    'users': 20,
    'companies': 50,

    // Review/ratings: typically small
    'reviews': 20,

    // Finance/payments: smaller for security
    'finances': 50,
    'payments': 20,

    // Portfolio: moderate
    'portfolio-projects': 20,

    // Notifications: moderate
    'notification-templates': 50,
    'notification-preferences': 20,

    // Support/disputes: smaller
    'support': 20,
    'disputes': 20,

    // Subscriptions: typically small
    'subscriptions': 20,

    // Role permissions: moderate
    'role-permissions': 50,
  },

  /**
   * Get limit for a specific endpoint
   * @param {string} endpoint - The endpoint/route name
   * @returns {number} - The limit for this endpoint
   */
  getLimitForEndpoint(endpoint) {
    return this.ENDPOINT_LIMITS[endpoint] || this.DEFAULT_LIMIT;
  },

  /**
   * Validate and normalize pagination parameters
   * @param {object} params - { limit, offset } from query parameters
   * @param {string} endpoint - The endpoint name for limit lookup
   * @returns {object} - { limit, offset } validated and normalized
   */
  validatePaginationParams(params = {}, endpoint) {
    const limit = parseInt(params.limit) || this.DEFAULT_LIMIT;
    const offset = parseInt(params.offset) || this.DEFAULT_OFFSET;

    // Enforce limits
    const endpointMaxLimit = Math.min(this.getLimitForEndpoint(endpoint), this.MAX_LIMIT);
    const validatedLimit = Math.max(this.MIN_LIMIT, Math.min(limit, endpointMaxLimit));
    const validatedOffset = Math.max(0, offset);

    return {
      limit: validatedLimit,
      offset: validatedOffset,
    };
  },

  /**
   * Calculate pagination metadata for response
   * @param {number} limit - Items per page
   * @param {number} offset - Starting position
   * @param {number} total - Total items available
   * @returns {object} - Pagination metadata
   */
  getPaginationMetadata(limit, offset, total) {
    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);
    const hasMore = offset + limit < total;

    return {
      limit,
      offset,
      total,
      page,
      totalPages,
      hasMore,
    };
  },

  /**
   * Build pagination response envelope
   * Standardizes pagination responses across all endpoints
   * @param {array} data - The paginated items
   * @param {number} limit - Items per page
   * @param {number} offset - Starting position
   * @param {number} total - Total items available
   * @returns {object} - Response with pagination metadata
   */
  buildPaginatedResponse(data = [], limit, offset, total) {
    return {
      data,
      pagination: this.getPaginationMetadata(limit, offset, total),
    };
  },

  /**
   * Convert page-based pagination to offset-based
   * For backward compatibility with old API clients
   * @param {number} page - Page number (1-indexed)
   * @param {number} limit - Items per page
   * @returns {number} - Offset value
   */
  pageToOffset(page, limit) {
    return Math.max(0, (page - 1) * limit);
  },

  /**
   * Convert offset-based pagination to page-based
   * For backward compatibility with old API clients
   * @param {number} offset - Starting position
   * @param {number} limit - Items per page
   * @returns {number} - Page number (1-indexed)
   */
  offsetToPage(offset, limit) {
    return Math.floor(offset / limit) + 1;
  },
};
