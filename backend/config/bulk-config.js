/**
 * Bulk Operations Configuration (Q70)
 * Defines limits and settings for bulk create/update/delete operations
 */

module.exports = {
  // Maximum number of items per bulk operation
  MAX_ITEMS_PER_BULK_OP: 50,

  // Rate limiting for bulk operations
  RATE_LIMIT: {
    // 5 bulk calls per hour per user
    calls_per_hour: 5,
    window_ms: 60 * 60 * 1000, // 1 hour
  },

  // Redis key prefixes for rate limiting
  REDIS_KEYS: {
    bulk_rate_limit: 'bulk_ops:rate_limit:',
    bulk_operation_log: 'bulk_ops:log:',
  },

  // HTTP status codes
  STATUS_CODES: {
    BAD_REQUEST: 400,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    UNPROCESSABLE_ENTITY: 422,
  },

  // Error messages
  ERRORS: {
    TOO_MANY_ITEMS: 'Trop d\'éléments - maximum {max} par opération',
    RATE_LIMIT_EXCEEDED: 'Limite de taux d\'opérations en masse dépassée - maximum {limit} appels par heure',
    INVALID_OPERATION: 'Type d\'opération invalide',
    EMPTY_BATCH: 'Le lot ne peut pas être vide',
    DUPLICATE_IDS: 'Les IDs doivent être uniques',
    INVALID_DATA: 'Données invalides pour l\'élément à l\'index {index}',
    MISSING_FIELD: 'Champ obligatoire manquant: {field}',
  },

  // Bulk operation types
  OPERATIONS: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
  },

  // Field validation rules for projects
  PROJECT_FIELDS: {
    CREATE: ['title', 'budget', 'city'],
    UPDATE_REQUIRED: ['id'],
    UPDATE: ['id', 'title', 'description', 'budget', 'status', 'city', 'category'],
    DELETE: ['id'],
  },

  // Validation options
  VALIDATION: {
    // Validate each item individually before processing batch
    validate_individual: true,

    // Continue processing batch even if some items fail
    partial_success: true,

    // Return detailed error info for each failed item
    detailed_errors: true,
  },

  // Logging options
  LOGGING: {
    // Log all bulk operations
    enabled: true,

    // Log level (info, warn, error)
    level: 'info',

    // Include full payload in logs
    include_payload: false,

    // Include response details
    include_response: true,
  },

  // Performance options
  PERFORMANCE: {
    // Process items in parallel (up to this many)
    parallel_workers: 10,

    // Timeout per item in milliseconds (5 seconds)
    item_timeout_ms: 5000,

    // Timeout for entire bulk operation in milliseconds (30 seconds)
    total_timeout_ms: 30000,
  },

  // Audit options
  AUDIT: {
    // Track all bulk operations for audit
    enabled: true,

    // Fields to track in audit log
    track_fields: ['operation', 'count', 'duration_ms', 'status', 'userId'],
  },
};
