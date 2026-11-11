/**
 * MANAWA Admin Panel - Configuration Constants
 * Centralized hardcoded values for timeouts, limits, and configuration
 * Version 1.0
 */

// ============================================================================
// API & Network Configuration
// ============================================================================

const API_CONFIG = {
  // Request timeout in milliseconds
  REQUEST_TIMEOUT_MS: 30000,

  // Number of retry attempts for failed requests
  MAX_RETRIES: 1,

  // Retry delay in milliseconds
  RETRY_DELAY_MS: 1000,

  // Debounce delay for input events (ms)
  DEBOUNCE_DELAY_MS: 300,

  // Toast notification duration (ms)
  TOAST_DURATION_MS: 3000,
};

// ============================================================================
// Pagination & Data Limits
// ============================================================================

const PAGINATION_CONFIG = {
  // Default items per page
  ITEMS_PER_PAGE: 50,

  // Maximum items allowed per page
  MAX_ITEMS_PER_PAGE: 1000,

  // Minimum items per page
  MIN_ITEMS_PER_PAGE: 10,

  // Default sort order
  DEFAULT_SORT_ORDER: 'desc',
};

// ============================================================================
// Moderation & Alerts
// ============================================================================

const MODERATION_CONFIG = {
  // Threshold for alert when complaint count >= this
  ALERT_COMPLAINT_THRESHOLD: 3,

  // Warning threshold (medium severity)
  WARNING_COMPLAINT_THRESHOLD: 2,

  // Low severity threshold
  INFO_COMPLAINT_THRESHOLD: 1,
};

// ============================================================================
// Authentication & Sessions
// ============================================================================

const AUTH_CONFIG = {
  // Token time-to-live in milliseconds (15 minutes)
  TOKEN_TTL_MS: 15 * 60 * 1000,

  // Token renewal interval (10 minutes, 5 min before TTL)
  TOKEN_RENEWAL_INTERVAL_MS: 10 * 60 * 1000,

  // Session check interval
  SESSION_CHECK_INTERVAL_MS: 60 * 1000,
};

// ============================================================================
// Search & Filter Configuration
// ============================================================================

const SEARCH_CONFIG = {
  // Maximum search string length
  MAX_SEARCH_LENGTH: 500,

  // Minimum characters to trigger search
  MIN_SEARCH_LENGTH: 1,

  // Debounce delay for search input (ms)
  SEARCH_DEBOUNCE_MS: 300,
};

// ============================================================================
// Form Validation Limits
// ============================================================================

const VALIDATION_CONFIG = {
  // API Key name constraints
  API_KEY_NAME_MIN_LENGTH: 3,
  API_KEY_NAME_MAX_LENGTH: 100,
  API_KEY_DESC_MAX_LENGTH: 500,

  // User password constraints
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,

  // Email constraints
  EMAIL_MAX_LENGTH: 254,

  // Badge constraints
  BADGE_NAME_MIN_LENGTH: 2,
  BADGE_NAME_MAX_LENGTH: 50,
  BADGE_ICON_MAX_LENGTH: 100,
  BADGE_DESC_MAX_LENGTH: 300,
  BADGE_CATEGORY_MAX_LENGTH: 50,

  // General text field limits
  DESCRIPTION_MAX_LENGTH: 300,
  TITLE_MAX_LENGTH: 255,
  COMMENT_MAX_LENGTH: 1000,
};

// ============================================================================
// Status & State Constants
// ============================================================================

const STATUS_CONSTANTS = {
  // User roles
  USER_ROLES: ['ADMIN', 'MODERATOR', 'SUPPORT', 'ANALYST'],

  // Professional statuses
  PROFESSIONAL_STATUSES: ['ACTIVE', 'PENDING', 'SUSPENDED', 'BANNED'],

  // Project statuses
  PROJECT_STATUSES: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],

  // Payment statuses
  PAYMENT_STATUSES: ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'],

  // Support ticket statuses
  TICKET_STATUSES: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],

  // Support ticket categories
  TICKET_CATEGORIES: ['PAYMENT', 'ACCOUNT', 'TECHNICAL', 'OTHER'],

  // Ticket priorities
  TICKET_PRIORITIES: ['low', 'medium', 'high'],

  // Badge categories
  BADGE_CATEGORIES: ['ACHIEVEMENT', 'CERTIFICATION', 'MILESTONE', 'SPECIAL'],

  // Refund statuses
  REFUND_STATUSES: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED'],

  // Review statuses
  REVIEW_STATUSES: ['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED'],

  // Dispute statuses
  DISPUTE_STATUSES: ['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED'],

  // General active/inactive
  ACTIVE_STATUS: 'ACTIVE',
  INACTIVE_STATUS: 'INACTIVE',
  PENDING_STATUS: 'PENDING',
  SUSPENDED_STATUS: 'SUSPENDED',
};

// ============================================================================
// Color Configuration (UI)
// ============================================================================

const COLOR_CONFIG = {
  // Status colors
  SUCCESS_COLOR: '#22C55E',
  ERROR_COLOR: '#EF4444',
  WARNING_COLOR: '#F59E0B',
  INFO_COLOR: '#3B82F6',
  SECONDARY_COLOR: '#8B5CF6',

  // Role colors
  SUPERADMIN_COLOR: '#8B5CF6',
  ADMIN_COLOR: '#3B82F6',
  MODERATOR_COLOR: '#10B981',
  ANALYST_COLOR: '#06B6D4',

  // Priority colors
  HIGH_PRIORITY_COLOR: '#EF4444',
  MEDIUM_PRIORITY_COLOR: '#F59E0B',
  LOW_PRIORITY_COLOR: '#3B82F6',

  // Severity colors
  CRITICAL_SEVERITY_COLOR: '#EF4444',
  HIGH_SEVERITY_COLOR: '#F59E0B',
  MEDIUM_SEVERITY_COLOR: '#F59E0B',
  LOW_SEVERITY_COLOR: '#3B82F6',
};

// ============================================================================
// Feature Flags & Configuration
// ============================================================================

const FEATURE_CONFIG = {
  // Enable/disable features
  ENABLE_TWO_FACTOR_AUTH: true,
  ENABLE_API_KEYS: true,
  ENABLE_FRAUD_DETECTION: true,
  ENABLE_AUDIT_LOGS: true,
  ENABLE_BULK_OPERATIONS: true,

  // Export settings
  MAX_EXPORT_ROWS: 10000,
  EXPORT_BATCH_SIZE: 1000,
};

// ============================================================================
// Utility function to get config value
// ============================================================================

/**
 * Safely get a config value by path
 * @param {string} path - Dot-notation path (e.g., 'API_CONFIG.REQUEST_TIMEOUT_MS')
 * @param {*} defaultValue - Value to return if path not found
 * @returns {*} Config value or defaultValue
 */
function getConfigValue(path, defaultValue = null) {
  const parts = path.split('.');
  let value = { API_CONFIG, PAGINATION_CONFIG, MODERATION_CONFIG, AUTH_CONFIG, SEARCH_CONFIG, VALIDATION_CONFIG, STATUS_CONSTANTS, COLOR_CONFIG, FEATURE_CONFIG };

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return defaultValue;
    }
  }

  return value;
}

// Export all constants
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    API_CONFIG,
    PAGINATION_CONFIG,
    MODERATION_CONFIG,
    AUTH_CONFIG,
    SEARCH_CONFIG,
    VALIDATION_CONFIG,
    STATUS_CONSTANTS,
    COLOR_CONFIG,
    FEATURE_CONFIG,
    getConfigValue,
  };
}
