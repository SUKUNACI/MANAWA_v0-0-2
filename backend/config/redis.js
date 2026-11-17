const logger = require('../utils/logger');
const { CircuitBreaker } = require('../utils/circuit-breaker');
const { getConfig } = require('./third-party-api-config');

let redisClient = null;
let inMemoryCache = null;
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

// Initialize with InMemoryCache immediately so module-level calls work before initializeRedis()
inMemoryCache = new InMemoryCache();

// Initialize Redis (test connection only, no automatic retries)
async function initializeRedis() {
  if (!process.env.REDIS_URL) {
    logger.info('[Redis] REDIS_URL not configured, using in-memory cache fallback');
    useInMemory = true;
    inMemoryCache = new InMemoryCache();
    return;
  }

  try {
    const redis = require('redis');
    const testClient = redis.createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 500,
        tls: true,
        rejectUnauthorized: false,
      },
    });

    // Try to connect once only
    const connectPromise = testClient.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 800)
    );

    try {
      await Promise.race([connectPromise, timeoutPromise]);
      // Connection successful - create the real client
      redisClient = redis.createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 500,
          tls: true,
          rejectUnauthorized: false,
        },
      });

      redisClient.on('connect', () => {
        logger.info('[Redis] Connected ✅');
        useInMemory = false;
      });

      redisClient.on('error', (err) => {
        logger.warn('[Redis] Connection lost', { error: err.message });
        useInMemory = true;
      });

      await redisClient.connect();
      logger.info('[Redis] Redis initialized successfully');
    } catch (err) {
      logger.info('[Redis] Connection test failed, using in-memory cache');
      useInMemory = true;
      redisClient = null;
      try {
        await testClient.quit();
      } catch { /* ignore */ }
    }
  } catch (err) {
    logger.warn('[Redis] Initialization error, using in-memory cache', { error: err.message });
    useInMemory = true;
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
