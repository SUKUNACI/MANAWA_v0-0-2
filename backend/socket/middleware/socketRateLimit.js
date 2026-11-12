/**
 * Socket.IO Rate Limiting Middleware
 * Prevents abuse by limiting events per socket/user
 */

const { RATE_LIMITS } = require('../../utils/socket-events');
const logger = require('../../utils/logger');
const redis = require('../../config/redis');

// In-memory fallback rate limit store
const rateLimitStore = new Map();

/**
 * Create rate limiter for specific event
 * Returns middleware that checks if user has exceeded rate limit
 */
function createRateLimitMiddleware(eventName) {
  const limits = RATE_LIMITS[eventName];

  if (!limits) {
    // No rate limit defined for this event
    return (socket, next) => next();
  }

  return (socket, next) => {
    checkRateLimit(socket.userId, eventName, limits)
      .then((allowed) => {
        if (allowed) {
          next();
        } else {
          next(new Error(`Rate limit exceeded for event: ${eventName}`));
        }
      })
      .catch((err) => {
        logger.error('Rate limit check error', { error: err.message, eventName });
        // On error, allow the request to proceed
        next();
      });
  };
}

/**
 * Check if user has exceeded rate limit for an event
 * @returns {Promise<boolean>} true if request is allowed, false if rate limited
 */
async function checkRateLimit(userId, eventName, limits) {
  try {
    const key = `ratelimit:${eventName}:${userId}`;
    const { max, windowMs } = limits;

    // Try to use Redis first
    const redisClient = redis.getClient();
    if (redisClient) {
      return await checkRateLimitRedis(redisClient, key, max, windowMs);
    }

    // Fallback to in-memory store
    return checkRateLimitInMemory(key, max, windowMs);
  } catch (err) {
    logger.warn('Rate limit check failed', { error: err.message, eventName, userId });
    // On error, allow the request
    return true;
  }
}

/**
 * Check rate limit using Redis
 */
async function checkRateLimitRedis(redisClient, key, max, windowMs) {
  try {
    const current = await redisClient.incr(key);

    if (current === 1) {
      // First request in window - set expiration
      await redisClient.pexpire(key, windowMs);
    }

    return current <= max;
  } catch (err) {
    logger.warn('Redis rate limit check error', { error: err.message });
    return true;
  }
}

/**
 * Check rate limit using in-memory store
 */
function checkRateLimitInMemory(key, max, windowMs) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    // New window or expired
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return true;
  }

  entry.count++;
  rateLimitStore.set(key, entry);
  return entry.count <= max;
}

/**
 * Socket event wrapper to add rate limiting
 * Usage: rateLimitedEvent(socket, 'message.new', handler)
 */
function rateLimitedEvent(socket, eventName, handler) {
  const limits = RATE_LIMITS[eventName];

  if (!limits) {
    // No rate limit - register normally
    socket.on(eventName, handler);
    return;
  }

  socket.on(eventName, async (data, callback) => {
    try {
      const allowed = await checkRateLimit(socket.userId, eventName, limits);

      if (!allowed) {
        logger.warn('Rate limit exceeded', {
          userId: socket.userId,
          eventName,
        });
        socket.emit('error', { message: 'Too many requests, please slow down' });
        if (callback) callback({ error: 'rate_limited' });
        return;
      }

      // Call the actual handler
      await handler(data, callback);
    } catch (err) {
      logger.error('Rate limited event error', { error: err.message, eventName });
      socket.emit('error', { message: 'Error processing request' });
    }
  });
}

/**
 * Cleanup old rate limit entries (call periodically)
 * Helps prevent memory growth in in-memory store
 */
function cleanupRateLimitStore() {
  try {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of rateLimitStore.entries()) {
      if (now > entry.resetAt) {
        rateLimitStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Rate limit store cleanup', { cleaned });
    }
  } catch (err) {
    logger.error('Rate limit cleanup error', { error: err.message });
  }
}

// Cleanup periodically (every 5 minutes)
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);

module.exports = {
  createRateLimitMiddleware,
  checkRateLimit,
  rateLimitedEvent,
  cleanupRateLimitStore,
};
