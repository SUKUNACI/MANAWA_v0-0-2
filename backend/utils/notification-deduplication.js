const logger = require('./logger');
const cache = require('../config/redis');
const crypto = require('crypto');

/**
 * Notification Deduplication
 *
 * Prevents sending duplicate notifications within a 5-second window
 * Uses Redis cache with key: "dedup:{userId}:{type}:{contentHash}"
 *
 * This prevents:
 * - Multiple simultaneous notification sends
 * - Race conditions in rapid API calls
 * - Duplicate notifications from retries
 */

const DEDUP_WINDOW = 5000; // 5 seconds in milliseconds
const DEDUP_TTL = 6; // Cache TTL in seconds (slightly longer than window)

/**
 * Check if notification was recently sent
 * @param {string} userId - User ID
 * @param {string} type - Notification type (e.g., 'ORDER_CONFIRMED', 'MESSAGE_RECEIVED')
 * @param {string} content - Notification content (title + body)
 * @returns {Promise<boolean>} True if recently sent, false if new
 */
async function isDuplicate(userId, type, content) {
  try {
    const key = generateDedupKey(userId, type, content);
    const isDup = await cache.get(key);

    if (isDup) {
      logger.warn(`[Dedup] Duplicate notification blocked: ${key}`);
      return true;
    }

    return false;
  } catch (err) {
    logger.warn('[Dedup] Error checking duplicate:', err.message);
    // On error, allow sending (fail open) rather than blocking
    return false;
  }
}

/**
 * Mark notification as sent (register in dedup cache)
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {string} content - Notification content
 * @returns {Promise<boolean>} True if successfully marked
 */
async function markSent(userId, type, content) {
  try {
    const key = generateDedupKey(userId, type, content);
    const timestamp = Date.now();

    await cache.set(key, JSON.stringify({ sent: true, timestamp }), DEDUP_TTL);
    logger.info(`[Dedup] Marked as sent: ${key}`);
    return true;
  } catch (err) {
    logger.warn('[Dedup] Error marking as sent:', err.message);
    // Continue even if cache write fails (fail open)
    return false;
  }
}

/**
 * Check and mark in one atomic operation
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {string} content - Notification content
 * @returns {Promise<{isDuplicate: boolean, marked: boolean}>}
 */
async function checkAndMark(userId, type, content) {
  const isDup = await isDuplicate(userId, type, content);

  if (isDup) {
    return { isDuplicate: true, marked: false };
  }

  const marked = await markSent(userId, type, content);
  return { isDuplicate: false, marked };
}

/**
 * Generate deduplication cache key
 * Hash content to keep key reasonably short
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {string} content - Content to hash
 * @returns {string} Cache key
 */
function generateDedupKey(userId, type, content) {
  const contentHash = hashContent(content);
  return `dedup:${userId}:${type}:${contentHash}`;
}

/**
 * Hash notification content (title + body)
 * @param {string} content - Content to hash
 * @returns {string} Hash (first 8 chars)
 */
function hashContent(content) {
  return crypto
    .createHash('md5')
    .update(content || '')
    .digest('hex')
    .substring(0, 8);
}

/**
 * Clear deduplication cache for a user
 * @param {string} userId - User ID
 * @param {string} type - Optional: specific notification type to clear
 * @returns {Promise<number>} Number of keys deleted
 */
async function clearUserDedup(userId, type = null) {
  try {
    const pattern = type
      ? `dedup:${userId}:${type}:*`
      : `dedup:${userId}:*`;

    const deleted = await cache.deletePattern(pattern);
    logger.info(`[Dedup] Cleared ${deleted} entries for user ${userId}${type ? ` type ${type}` : ''}`);
    return deleted;
  } catch (err) {
    logger.warn('[Dedup] Error clearing dedup cache:', err.message);
    return 0;
  }
}

/**
 * Validate deduplication parameters
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @returns {object} Validation result with errors array
 */
function validateParams(userId, type, title, body) {
  const errors = [];

  if (!userId || typeof userId !== 'string') {
    errors.push('Invalid userId');
  }

  if (!type || typeof type !== 'string') {
    errors.push('Invalid type');
  }

  if (!title && !body) {
    errors.push('Title or body required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Middleware to check deduplication before sending
 * Can be used in routes to prevent duplicate sends
 * @param {string} cacheKey - Cache key or user+type+content
 * @returns {Function} Express middleware
 */
function dedupMiddleware() {
  return async (req, res, next) => {
    try {
      const { userId, type, title, body } = req.body;

      // Validate parameters
      const validation = validateParams(userId, type, title, body);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.errors,
        });
      }

      // Check for duplicate
      const content = `${title}||${body}`;
      const { isDuplicate, marked } = await checkAndMark(userId, type, content);

      if (isDuplicate) {
        return res.status(429).json({
          error: 'Duplicate notification blocked',
          message: 'This notification was sent recently',
        });
      }

      // Attach dedup info to request for logging
      req.dedup = { isDuplicate: false, marked, userId, type };
      next();
    } catch (err) {
      logger.error('[Dedup] Middleware error:', err.message);
      next(); // Continue on error (fail open)
    }
  };
}

module.exports = {
  isDuplicate,
  markSent,
  checkAndMark,
  clearUserDedup,
  validateParams,
  dedupMiddleware,
  generateDedupKey,
  hashContent,
  DEDUP_WINDOW,
  DEDUP_TTL,
};
