/**
 * Feature Flags Configuration
 * Centralized config for all feature flags
 * Uses Redis cache (5min TTL) for performance
 */

const redis = require('./redis');
const logger = require('../utils/logger');

// Cache keys
const FEATURE_FLAG_CACHE_KEY = 'feature-flags:all';
const FEATURE_FLAG_TTL = 300; // 5 minutes

/**
 * Pre-defined feature flags with metadata
 */
const DEFAULT_FLAGS = {
  // Q71: Feature Flags System
  'new-dashboard-ui': {
    name: 'new-dashboard-ui',
    description: 'New dashboard UI with enhanced analytics',
    enabled: false,
    rolloutPercentage: 0,
  },
  'advanced-search': {
    name: 'advanced-search',
    description: 'Advanced search with filters and facets',
    enabled: true,
    rolloutPercentage: 100,
  },
  'video-calls-beta': {
    name: 'video-calls-beta',
    description: 'Beta video calling feature',
    enabled: true,
    rolloutPercentage: 50,
  },
  'ai-quote-suggestions': {
    name: 'ai-quote-suggestions',
    description: 'AI-powered quote suggestions for professionals',
    enabled: false,
    rolloutPercentage: 0,
  },
  'two-factor-auth-enforce': {
    name: 'two-factor-auth-enforce',
    description: 'Enforce 2FA for admin users',
    enabled: true,
    rolloutPercentage: 100,
  },
  'payment-retry-automation': {
    name: 'payment-retry-automation',
    description: 'Automated payment retry system',
    enabled: true,
    rolloutPercentage: 80,
  },
};

/**
 * Initialize default flags in database (if not already present)
 * Called on application startup
 */
async function initializeDefaultFlags(prisma) {
  try {
    for (const flagName of Object.keys(DEFAULT_FLAGS)) {
      const existing = await prisma.featureFlag.findUnique({
        where: { name: flagName },
      });

      if (!existing) {
        const flagConfig = DEFAULT_FLAGS[flagName];
        await prisma.featureFlag.create({
          data: {
            name: flagName,
            description: flagConfig.description,
            enabled: flagConfig.enabled,
            rolloutPercentage: flagConfig.rolloutPercentage,
          },
        });
        logger.info(`[FeatureFlags] Initialized default flag: ${flagName}`);
      }
    }
  } catch (err) {
    logger.error('[FeatureFlags] Failed to initialize default flags', { error: err.message });
  }
}

/**
 * Clear feature flags cache
 */
async function invalidateCache() {
  try {
    await redis.deleteKey(FEATURE_FLAG_CACHE_KEY);
    logger.debug('[FeatureFlags] Cache invalidated');
  } catch (err) {
    logger.warn('[FeatureFlags] Failed to invalidate cache', { error: err.message });
  }
}

/**
 * Get cache TTL configuration
 */
function getCacheTTL() {
  return FEATURE_FLAG_TTL;
}

// Q76: Redis PubSub channel for hot reload
const CONFIG_RELOAD_CHANNEL = 'config:reload:feature-flags';

/**
 * Subscribe to hot reload channel
 * When admin updates a flag, server publishes to this channel
 * All instances receive the message and invalidate their cache
 */
async function subscribeToHotReload(redisSubscriber) {
  try {
    await redisSubscriber.subscribe(CONFIG_RELOAD_CHANNEL, (message) => {
      logger.info('[FeatureFlags] Hot reload triggered via PubSub', { message });
      // Async invalidation - fire and forget
      redis.deleteKey(FEATURE_FLAG_CACHE_KEY).catch(err => {
        logger.warn('[FeatureFlags] Hot reload cache clear failed', { error: err.message });
      });
    });
    logger.info('[FeatureFlags] Hot reload subscription active', { channel: CONFIG_RELOAD_CHANNEL });
  } catch (err) {
    logger.error('[FeatureFlags] Failed to subscribe to hot reload', { error: err.message });
  }
}

/**
 * Publish hot reload event (called after flag update)
 * All server instances will clear their cache on receipt
 */
async function publishHotReload(flagName) {
  try {
    await redis.publish(CONFIG_RELOAD_CHANNEL, JSON.stringify({ flag: flagName, ts: Date.now() }));
    logger.debug('[FeatureFlags] Hot reload published', { flagName });
  } catch (err) {
    logger.warn('[FeatureFlags] Failed to publish hot reload', { error: err.message });
  }
}

module.exports = {
  DEFAULT_FLAGS,
  FEATURE_FLAG_CACHE_KEY,
  FEATURE_FLAG_TTL,
  CONFIG_RELOAD_CHANNEL,
  initializeDefaultFlags,
  invalidateCache,
  getCacheTTL,
  subscribeToHotReload,
  publishHotReload,
};
