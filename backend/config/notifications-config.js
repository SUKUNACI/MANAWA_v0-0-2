/**
 * Notifications Configuration
 * Central configuration for all notification features
 */

const logger = require('../utils/logger');

const config = {
  // Feature flags
  features: {
    deduplication: true,
    batching: true,
    fallback: true,
    preferences: true,
    templates: true,
    multiLanguage: true,
    archival: true,
  },

  // Deduplication
  deduplication: {
    enabled: true,
    windowMs: parseInt(process.env.NOTIFICATION_DEDUP_WINDOW_MS || 5000),
    ttlSeconds: parseInt(process.env.NOTIFICATION_DEDUP_TTL_SECONDS || 6),
  },

  // Batching
  batching: {
    enabled: true,
    batchSize: parseInt(process.env.NOTIFICATION_BATCH_SIZE || 100),
    maxConcurrentBatches: parseInt(process.env.NOTIFICATION_MAX_CONCURRENT_BATCHES || 5),
    enabled: true,
  },

  // Fallback chain
  fallback: {
    enabled: true,
    retryConfig: {
      fcm: {
        enabled: true,
        attempts: parseInt(process.env.NOTIFICATION_FCM_RETRY_ATTEMPTS || 2),
        delayMs: parseInt(process.env.NOTIFICATION_FCM_RETRY_DELAY_MS || 1000),
      },
      expo: {
        enabled: true,
        attempts: parseInt(process.env.NOTIFICATION_EXPO_RETRY_ATTEMPTS || 2),
        delayMs: parseInt(process.env.NOTIFICATION_EXPO_RETRY_DELAY_MS || 1000),
      },
      email: {
        enabled: true,
        attempts: parseInt(process.env.NOTIFICATION_EMAIL_RETRY_ATTEMPTS || 1),
      },
    },
  },

  // User preferences
  preferences: {
    enabled: true,
    defaultAllEnabled: process.env.NOTIFICATION_PREFS_DEFAULT_ALL_ENABLED !== 'false',
    notificationTypes: [
      'ORDER_CONFIRMED',
      'ORDER_SHIPPED',
      'ORDER_DELIVERED',
      'ORDER_CANCELLED',
      'PAYMENT_RECEIVED',
      'PAYMENT_FAILED',
      'MESSAGE_RECEIVED',
      'REVIEW_RECEIVED',
      'BOOKING_CONFIRMED',
      'BOOKING_CANCELLED',
      'DISPUTE_CREATED',
      'DISPUTE_RESOLVED',
      'PROMOTIONAL',
      'SYSTEM_ALERT',
    ],
    channels: ['email', 'push', 'sms'],
  },

  // Multi-language
  multiLanguage: {
    enabled: true,
    languages: ['fr', 'en', 'es', 'de'],
    defaultLanguage: process.env.NOTIFICATION_DEFAULT_LANGUAGE || 'fr',
  },

  // Templates
  templates: {
    enabled: true,
    cacheEnabled: process.env.NOTIFICATION_TEMPLATE_CACHE_ENABLED !== 'false',
    cacheTtlSeconds: parseInt(process.env.NOTIFICATION_TEMPLATE_CACHE_TTL_SECONDS || 3600),
  },

  // Archival
  archival: {
    enabled: true,
    softDelete: true,
  },

  // Logging
  logging: {
    verbose: process.env.NOTIFICATION_VERBOSE_LOGGING === 'true',
  },
};

// Validation
function validateConfig() {
  const errors = [];

  if (config.batching.batchSize < 10) {
    errors.push('NOTIFICATION_BATCH_SIZE must be >= 10');
  }

  if (config.batching.maxConcurrentBatches < 1) {
    errors.push('NOTIFICATION_MAX_CONCURRENT_BATCHES must be >= 1');
  }

  if (config.deduplication.windowMs < 1000) {
    errors.push('NOTIFICATION_DEDUP_WINDOW_MS must be >= 1000');
  }

  if (!config.multiLanguage.languages.includes(config.multiLanguage.defaultLanguage)) {
    errors.push(`NOTIFICATION_DEFAULT_LANGUAGE must be one of: ${config.multiLanguage.languages.join(', ')}`);
  }

  if (errors.length > 0) {
    logger.error('[Notifications Config] Validation errors:', errors);
    throw new Error('Invalid notification configuration');
  }

  logger.info('[Notifications Config] ✅ Configuration valid');
  return config;
}

// Log configuration on startup
function logConfig() {
  if (!config.logging.verbose) return;

  logger.info('[Notifications Config]', {
    deduplication: { ...config.deduplication },
    batching: { ...config.batching },
    fallback: { ...config.fallback },
    preferences: config.preferences.notificationTypes.length + ' notification types',
    languages: config.multiLanguage.languages.join(', '),
  });
}

module.exports = {
  config,
  validateConfig,
  logConfig,
};
