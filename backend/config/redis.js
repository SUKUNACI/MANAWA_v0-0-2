const logger = require('../utils/logger');
const { CircuitBreaker } = require('../utils/circuit-breaker');
const { getConfig } = require('./third-party-api-config');

let redisClient = null;
let inMemoryCache = new Map();
let useInMemory = false;

// Get configuration
const config = getConfig('redis');
const cbConfig = config?.circuitBreaker || {};

// Initialize Circuit Breaker for Redis
const circuitBreaker = new CircuitBreaker({
  serviceName: 'Redis',
  ...cbConfig,
});

// In-memory fallback cache with TTL support
class InMemoryCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  async get(key) {
    return this.cache.get(key) ?? null;
  }

  async set(key, value, ttl = 3600) {
    this.cache.set(key, value);

    // Clear existing timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    // Set new expiration timer
    const timer = setTimeout(() => {
      this.cache.delete(key);
      this.timers.delete(key);
    }, ttl * 1000);

    this.timers.set(key, timer);
  }

  async delete(key) {
    this.cache.delete(key);
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }

  async deletePattern(pattern) {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    const keysToDelete = Array.from(this.cache.keys()).filter(key => regex.test(key));

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
      }
    });

    return keysToDelete.length;
  }

  async clear() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.cache.clear();
    this.timers.clear();
  }
}

// Initialize Redis (attempt to use Redis, fallback to in-memory)
async function initializeRedis() {
  if (!process.env.REDIS_URL) {
    logger.info('[Redis] REDIS_URL not configured, using in-memory cache fallback');
    useInMemory = true;
    inMemoryCache = new InMemoryCache();
    return;
  }

  try {
    const redis = require('redis');
    redisClient = redis.createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('[Redis] Connection failed after 10 retries, switching to in-memory cache');
            useInMemory = true;
            inMemoryCache = new InMemoryCache();
            return new Error('Redis max retries exceeded');
          }
          return retries * 100;
        },
      },
    });

    redisClient.on('error', (err) => {
      logger.error('[Redis] Connection error, falling back to in-memory cache', { error: err.message });
      useInMemory = true;
      if (!inMemoryCache) inMemoryCache = new InMemoryCache();
    });

    redisClient.on('connect', () => {
      logger.info('[Redis] Connected successfully ✅');
      useInMemory = false;
    });

    await redisClient.connect();
  } catch (err) {
    logger.warn('[Redis] Failed to initialize, using in-memory cache', { error: err.message });
    useInMemory = true;
    inMemoryCache = new InMemoryCache();
  }
}

// Get value from cache (Redis or in-memory)
async function get(key) {
  if (useInMemory || !redisClient) {
    return inMemoryCache.get(key);
  }

  return circuitBreaker.execute(async () => {
    try {
      const value = await redisClient.get(key);
      if (!value) return null;

      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (err) {
      logger.warn('[Redis] Get error, using in-memory', { key, error: err.message });
      useInMemory = true;
      return inMemoryCache.get(key);
    }
  }).catch(err => {
    // If circuit breaker is open, fallback to in-memory
    if (err.code === 'CIRCUIT_BREAKER_OPEN') {
      logger.warn('[Redis] Circuit breaker open, using in-memory cache', { key });
      useInMemory = true;
      return inMemoryCache.get(key);
    }
    throw err;
  });
}

// Set value in cache (Redis or in-memory)
async function set(key, value, ttl = 3600) {
  if (useInMemory || !redisClient) {
    return inMemoryCache.set(key, value, ttl);
  }

  return circuitBreaker.execute(async () => {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await redisClient.setEx(key, ttl, serialized);
    } catch (err) {
      logger.warn('[Redis] Set error, using in-memory', { key, error: err.message });
      useInMemory = true;
      inMemoryCache.set(key, value, ttl);
    }
  }).catch(err => {
    // If circuit breaker is open, fallback to in-memory
    if (err.code === 'CIRCUIT_BREAKER_OPEN') {
      logger.warn('[Redis] Circuit breaker open, using in-memory cache', { key });
      useInMemory = true;
      inMemoryCache.set(key, value, ttl);
      return;
    }
    throw err;
  });
}

// Delete key from cache
async function deleteKey(key) {
  if (useInMemory || !redisClient) {
    return inMemoryCache.delete(key);
  }

  return circuitBreaker.execute(async () => {
    try {
      await redisClient.del(key);
    } catch (err) {
      logger.warn('[Redis] Delete error, using in-memory', { key, error: err.message });
      useInMemory = true;
      inMemoryCache.delete(key);
    }
  }).catch(err => {
    // If circuit breaker is open, fallback to in-memory
    if (err.code === 'CIRCUIT_BREAKER_OPEN') {
      logger.warn('[Redis] Circuit breaker open, using in-memory cache', { key });
      useInMemory = true;
      inMemoryCache.delete(key);
      return;
    }
    throw err;
  });
}

// Delete keys matching pattern (e.g., user:123:* or projects:*:comments)
async function deletePattern(pattern) {
  if (useInMemory || !redisClient) {
    return inMemoryCache.deletePattern(pattern);
  }

  return circuitBreaker.execute(async () => {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return keys.length;
    } catch (err) {
      logger.warn('[Redis] Pattern delete error, using in-memory', { pattern, error: err.message });
      useInMemory = true;
      return inMemoryCache.deletePattern(pattern);
    }
  }).catch(err => {
    // If circuit breaker is open, fallback to in-memory
    if (err.code === 'CIRCUIT_BREAKER_OPEN') {
      logger.warn('[Redis] Circuit breaker open, using in-memory cache', { pattern });
      useInMemory = true;
      return inMemoryCache.deletePattern(pattern);
    }
    throw err;
  });
}

// Clear entire cache
async function clear() {
  if (useInMemory || !redisClient) {
    return inMemoryCache.clear();
  }

  return circuitBreaker.execute(async () => {
    try {
      await redisClient.flushDb();
    } catch (err) {
      logger.warn('[Redis] Clear error, using in-memory', { error: err.message });
      useInMemory = true;
      inMemoryCache.clear();
    }
  }).catch(err => {
    // If circuit breaker is open, fallback to in-memory
    if (err.code === 'CIRCUIT_BREAKER_OPEN') {
      logger.warn('[Redis] Circuit breaker open, using in-memory cache');
      useInMemory = true;
      inMemoryCache.clear();
      return;
    }
    throw err;
  });
}

// Graceful shutdown
async function disconnect() {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('[Redis] Disconnected');
    } catch (err) {
      logger.error('[Redis] Disconnect error', { error: err.message });
    }
  }
  if (inMemoryCache) {
    inMemoryCache.clear();
  }
}

// Health check
async function healthCheck() {
  if (useInMemory) {
    return { status: 'ok', mode: 'in-memory-fallback', message: 'In-memory cache fallback active' };
  }

  try {
    if (redisClient) {
      await redisClient.ping();
      return { status: 'ok', mode: 'redis', message: 'Redis cache active' };
    }
  } catch (err) {
    return { status: 'degraded', mode: 'in-memory-fallback', message: `Redis unavailable: ${err.message}` };
  }

  return { status: 'degraded', mode: 'in-memory-fallback', message: 'Redis not initialized' };
}

module.exports = {
  initializeRedis,
  get,
  set,
  deleteKey,
  deletePattern,
  clear,
  disconnect,
  healthCheck,
  // Expose circuit breaker for monitoring/testing
  circuitBreaker,
};
