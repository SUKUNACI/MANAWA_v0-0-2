/**
 * Feature Flag Manager
 * Functions to check feature flags with rollout percentage support
 * Uses deterministic hashing for user-consistent rollout
 */

const crypto = require('crypto');
const redis = require('../config/redis');
const logger = require('./logger');
const {
  FEATURE_FLAG_CACHE_KEY,
  FEATURE_FLAG_TTL,
} = require('../config/feature-flags');

/**
 * Hash function for deterministic user rollout
 * Same userId + flagName = same result (consistent across requests)
 */
function hashUserFlag(userId, flagName) {
  const hash = crypto
    .createHash('sha256')
    .update(`${flagName}:${userId}`)
    .digest('hex');

  // Convert first 8 chars to number and normalize to 0-100
  const hashValue = parseInt(hash.substring(0, 8), 16);
  return hashValue % 100;
}

/**
 * Check if feature is enabled for a user
 * @param {string} flagName - Feature flag name
 * @param {string} userId - Optional user ID for rollout percentage check
 * @param {PrismaClient} prisma - Prisma instance
 * @returns {boolean} - True if feature is enabled
 */
async function isFeatureEnabled(flagName, userId = null, prisma) {
  try {
    // Get all flags from cache
    let flags = await redis.get(FEATURE_FLAG_CACHE_KEY);

    if (!flags) {
      // Cache miss: fetch from database
      if (!prisma) {
        logger.warn('[FeatureFlags] Prisma client not provided, cannot fetch flags');
        return false;
      }

      const dbFlags = await prisma.featureFlag.findMany({
        select: {
          name: true,
          enabled: true,
          rolloutPercentage: true,
        },
      });

      flags = {};
      dbFlags.forEach(flag => {
        flags[flag.name] = flag;
      });

      // Cache flags
      await redis.set(FEATURE_FLAG_CACHE_KEY, flags, FEATURE_FLAG_TTL);
    }

    const flag = flags[flagName];
    if (!flag) {
      logger.warn(`[FeatureFlags] Flag not found: ${flagName}`);
      return false;
    }

    // If not enabled at all, return false
    if (!flag.enabled) {
      return false;
    }

    // If rollout is 100%, always enabled
    if (flag.rolloutPercentage >= 100) {
      return true;
    }

    // If no userId provided and rollout < 100%, return false
    if (!userId) {
      return false;
    }

    // Use deterministic hash for user rollout
    const userHash = hashUserFlag(userId, flagName);
    const isInRollout = userHash < flag.rolloutPercentage;

    logger.debug('[FeatureFlags] User rollout check', {
      flagName,
      userId,
      rolloutPercentage: flag.rolloutPercentage,
      userHash,
      isInRollout,
    });

    return isInRollout;
  } catch (err) {
    logger.error('[FeatureFlags] Error checking feature flag', {
      flagName,
      userId,
      error: err.message,
    });
    return false; // Fail-safe: disable feature on error
  }
}

/**
 * Check multiple flags at once
 * @param {string[]} flagNames - Array of flag names
 * @param {string} userId - Optional user ID
 * @param {PrismaClient} prisma - Prisma instance
 * @returns {object} - Map of flagName -> enabled
 */
async function checkMultipleFlags(flagNames, userId = null, prisma) {
  try {
    const results = {};

    for (const flagName of flagNames) {
      results[flagName] = await isFeatureEnabled(flagName, userId, prisma);
    }

    return results;
  } catch (err) {
    logger.error('[FeatureFlags] Error checking multiple flags', {
      flagCount: flagNames.length,
      error: err.message,
    });

    const results = {};
    flagNames.forEach(name => {
      results[name] = false;
    });
    return results;
  }
}

/**
 * Get all active feature flags (cache-aware)
 * @param {PrismaClient} prisma - Prisma instance
 * @returns {object} - All flags with their status
 */
async function getAllFlags(prisma) {
  try {
    let flags = await redis.get(FEATURE_FLAG_CACHE_KEY);

    if (!flags) {
      if (!prisma) {
        logger.warn('[FeatureFlags] Prisma client not provided, cannot fetch flags');
        return {};
      }

      const dbFlags = await prisma.featureFlag.findMany({
        select: {
          name: true,
          enabled: true,
          rolloutPercentage: true,
          description: true,
        },
      });

      flags = {};
      dbFlags.forEach(flag => {
        flags[flag.name] = flag;
      });

      // Cache flags
      await redis.set(FEATURE_FLAG_CACHE_KEY, flags, FEATURE_FLAG_TTL);
    }

    return flags;
  } catch (err) {
    logger.error('[FeatureFlags] Error getting all flags', { error: err.message });
    return {};
  }
}

/**
 * Clear feature flags cache (called when flags are updated)
 */
async function invalidateCache() {
  try {
    await redis.deleteKey(FEATURE_FLAG_CACHE_KEY);
    logger.info('[FeatureFlags] Cache invalidated');
  } catch (err) {
    logger.warn('[FeatureFlags] Failed to invalidate cache', { error: err.message });
  }
}

module.exports = {
  isFeatureEnabled,
  checkMultipleFlags,
  getAllFlags,
  invalidateCache,
  hashUserFlag,
};
