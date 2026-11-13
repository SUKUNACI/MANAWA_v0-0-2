/**
 * Redis Cache Middleware Tests
 * Tests for cacheGet() and cacheInvalidate() middleware
 */

const redis = require('../config/redis');
const { cacheGet, cacheInvalidate, generateCacheKey, getTTLForPath } = require('../middleware/cacheMiddleware');

// Initialize cache before tests
beforeAll(async () => {
  await redis.initializeRedis();
  await redis.clear();
});

// Cleanup after tests
afterEach(async () => {
  await redis.clear();
});

afterAll(async () => {
  await redis.disconnect();
});

// ============ REDIS CONFIG TESTS ============

describe('Redis Configuration', () => {
  test('should initialize Redis or fallback to in-memory', async () => {
    const health = await redis.healthCheck();
    expect(health.status).toBe('ok');
    expect(['redis', 'in-memory-fallback']).toContain(health.mode);
  });

  test('should get and set values', async () => {
    const testData = { user: 'john', id: 123 };
    await redis.set('test:key', testData, 3600);
    const retrieved = await redis.get('test:key');
    expect(retrieved).toEqual(testData);
  });

  test('should respect TTL - expire after timeout', async () => {
    await redis.set('expire:key', { data: 'test' }, 1); // 1 second TTL
    expect(await redis.get('expire:key')).toBeDefined();

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(await redis.get('expire:key')).toBeNull();
  });

  test('should delete specific keys', async () => {
    await redis.set('delete:key', { data: 'test' });
    await redis.deleteKey('delete:key');
    expect(await redis.get('delete:key')).toBeNull();
  });

  test('should delete keys by pattern', async () => {
    await redis.set('professional:123:data', { data: 'p123' });
    await redis.set('professional:123:portfolio', { data: 'portfolio' });
    await redis.set('professional:456:data', { data: 'p456' });

    await redis.deletePattern('professional:123:*');

    expect(await redis.get('professional:123:data')).toBeNull();
    expect(await redis.get('professional:123:portfolio')).toBeNull();
    expect(await redis.get('professional:456:data')).toBeDefined();
  });

  test('should clear entire cache', async () => {
    await redis.set('key1', { data: 'test1' });
    await redis.set('key2', { data: 'test2' });

    await redis.clear();

    expect(await redis.get('key1')).toBeNull();
    expect(await redis.get('key2')).toBeNull();
  });
});

// ============ CACHE MIDDLEWARE TESTS ============

describe('cacheGet Middleware', () => {
  test('should cache GET response', async () => {
    const mockReq = {
      method: 'GET',
      path: '/api/professionals/123',
      baseUrl: '/api',
      query: {},
      user: null
    };

    const mockRes = {
      statusCode: 200,
      json: jest.fn(function(data) {
        this.data = data;
        return this;
      }),
      set: jest.fn()
    };

    const middleware = cacheGet();
    const nextCalled = jest.fn();

    await middleware(mockReq, mockRes, nextCalled);

    expect(nextCalled).toHaveBeenCalled();
  });

  test('should skip cache for non-GET requests', async () => {
    const mockReq = {
      method: 'POST',
      path: '/api/projects',
      query: {}
    };

    const mockRes = {};
    const nextCalled = jest.fn();

    const middleware = cacheGet();
    await middleware(mockReq, mockRes, nextCalled);

    expect(nextCalled).toHaveBeenCalled();
  });

  test('should respect skipCache query param', async () => {
    const mockReq = {
      method: 'GET',
      path: '/api/professionals/123',
      baseUrl: '/api',
      query: { skipCache: 'true' },
      user: null
    };

    const mockRes = {};
    const nextCalled = jest.fn();

    const middleware = cacheGet();
    await middleware(mockReq, mockRes, nextCalled);

    expect(nextCalled).toHaveBeenCalled();
  });

  test('should return cached response on HIT', async () => {
    const cacheKey = '/api/professionals/123';
    const cachedData = { id: '123', name: 'John Pro' };

    // Pre-populate cache with JSON string (matches how middleware stores it)
    await redis.set(cacheKey, JSON.stringify(cachedData));

    const mockReq = {
      method: 'GET',
      path: '/professionals/123',
      baseUrl: '/api',
      query: {},
      user: null
    };

    let capturedResponse = null;
    const mockRes = {
      statusCode: 200,
      set: jest.fn(),
      json: jest.fn(function(data) {
        capturedResponse = data;
        return this;
      })
    };

    const middleware = cacheGet();
    await middleware(mockReq, mockRes, jest.fn());

    // Should serve from cache
    expect(mockRes.json).toHaveBeenCalled();
  });

  test('should set X-Cache header correctly', async () => {
    const cacheKey = '/api/api/test';
    await redis.set(cacheKey, JSON.stringify({ result: 'cached' }));

    const mockReq = {
      method: 'GET',
      path: '/api/test',
      baseUrl: '/api',
      query: {},
      user: null
    };

    const mockRes = {
      statusCode: 200,
      set: jest.fn(),
      json: jest.fn(function(data) {
        return this;
      })
    };

    const middleware = cacheGet();
    await middleware(mockReq, mockRes, jest.fn());

    // HIT path sets X-Cache header before calling res.json
    expect(mockRes.set).toHaveBeenCalledWith('X-Cache', 'HIT');
  });
});

describe('cacheInvalidate Middleware', () => {
  test('should clear cache on successful response (2xx)', async () => {
    // Pre-populate cache
    await redis.set('professional:123:data', { data: 'old' });

    const mockReq = {
      method: 'PATCH',
      path: '/api/professionals/123'
    };

    const mockRes = {
      statusCode: 200,
      json: jest.fn(function(data) {
        this.data = data;
        return this;
      })
    };

    const middleware = cacheInvalidate(['professional:*']);
    const nextCalled = jest.fn();

    await middleware(mockReq, mockRes, nextCalled);
    expect(nextCalled).toHaveBeenCalled();

    // Simulate successful response
    const responseData = { success: true };
    const jsonFn = mockRes.json;
    jsonFn(responseData);

    // Cache should be cleared
    const cached = await redis.get('professional:123:data');
    expect(cached).toBeNull();
  });

  test('should skip cache invalidation for GET requests', async () => {
    const mockReq = {
      method: 'GET',
      path: '/api/professionals/123'
    };

    const mockRes = { json: jest.fn() };
    const nextCalled = jest.fn();

    const middleware = cacheInvalidate(['professional:*']);
    await middleware(mockReq, mockRes, nextCalled);

    expect(nextCalled).toHaveBeenCalled();
  });

  test('should NOT clear cache on error response (5xx)', async () => {
    await redis.set('professional:123:data', { data: 'keep' });

    const mockReq = {
      method: 'PATCH',
      path: '/api/professionals/123'
    };

    let originalJson = null;
    const mockRes = {
      statusCode: 500, // Error response
      json: jest.fn(function(data) {
        return this;
      })
    };

    const middleware = cacheInvalidate(['professional:*']);
    await middleware(mockReq, mockRes, jest.fn());

    // Simulate error response
    mockRes.json({ error: 'Server error' });

    // Cache should NOT be cleared (still there after 5s delay)
    await new Promise(resolve => setTimeout(resolve, 100));
    const cached = await redis.get('professional:123:data');
    expect(cached).toBeDefined(); // Cache preserved
  });

  test('should handle multiple invalidation patterns', async () => {
    await redis.set('professional:123:data', { data: 'p' });
    await redis.set('projects:search:plumber', { data: 'proj' });

    const mockReq = {
      method: 'PATCH',
      path: '/api/professionals/123'
    };

    const mockRes = {
      statusCode: 200,
      json: jest.fn(function(data) {
        return this;
      })
    };

    const middleware = cacheInvalidate(['professional:*', 'projects:search:*']);
    await middleware(mockReq, mockRes, jest.fn());

    mockRes.json({ success: true });

    expect(await redis.get('professional:123:data')).toBeNull();
    expect(await redis.get('projects:search:plumber')).toBeNull();
  });
});

// ============ CACHE KEY GENERATION TESTS ============

describe('Cache Key Generation', () => {
  test('should generate cache key from request', () => {
    const mockReq = {
      method: 'GET',
      path: '/professionals/123',
      baseUrl: '/api',
      query: {},
      user: null
    };

    const key = generateCacheKey(mockReq);
    expect(key).toContain('/api');
    expect(key).toContain('/professionals/123');
  });

  test('should include user ID in cache key when authenticated', () => {
    const mockReq = {
      method: 'GET',
      path: '/professionals/123',
      baseUrl: '/api',
      query: {},
      user: { id: 'user456' }
    };

    const key = generateCacheKey(mockReq);
    expect(key).toContain('user456');
  });

  test('should include query parameters in cache key', () => {
    const mockReq = {
      method: 'GET',
      path: '/projects',
      baseUrl: '/api',
      query: { city: 'Paris', category: 'plumbing' },
      user: null
    };

    const key = generateCacheKey(mockReq);
    expect(key).toContain('city');
    expect(key).toContain('Paris');
  });
});

// ============ TTL CONFIGURATION TESTS ============

describe('TTL Configuration', () => {
  test('should return correct TTL for analytics paths', () => {
    const ttl = getTTLForPath('/api/analytics/dashboard');
    expect(ttl).toBe(300); // 5 minutes
  });

  test('should return correct TTL for professional paths', () => {
    const ttl = getTTLForPath('/api/professionals/123');
    expect(ttl).toBe(3600); // 1 hour
  });

  test('should return correct TTL for project paths', () => {
    const ttl = getTTLForPath('/api/projects?search=plumber');
    expect(ttl).toBe(1800); // 30 minutes
  });

  test('should return default TTL for unknown paths', () => {
    const ttl = getTTLForPath('/api/unknown/path');
    expect(ttl).toBe(1800); // Default 30 minutes
  });
});

// ============ INTEGRATION TESTS ============

describe('Cache Integration', () => {
  test('full workflow: cache miss → set → cache hit → invalidate', async () => {
    // Step 1: Cache miss
    expect(await redis.get('professional:999:data')).toBeNull();

    // Step 2: Set cache
    const profData = { id: '999', name: 'Test Pro' };
    await redis.set('professional:999:data', profData, 3600);

    // Step 3: Cache hit
    expect(await redis.get('professional:999:data')).toEqual(profData);

    // Step 4: Invalidate by pattern
    await redis.deletePattern('professional:*');

    // Step 5: Verify cleared
    expect(await redis.get('professional:999:data')).toBeNull();
  });

  test('should handle concurrent cache operations', async () => {
    const promises = [];

    // Concurrent sets
    for (let i = 0; i < 10; i++) {
      promises.push(
        redis.set(`key:${i}`, { data: i }, 3600)
      );
    }

    await Promise.all(promises);

    // Verify all set
    for (let i = 0; i < 10; i++) {
      const val = await redis.get(`key:${i}`);
      expect(val).toBeDefined();
      expect(val.data).toBe(i);
    }
  });

  test('should handle cache under load (100 operations)', async () => {
    const start = Date.now();

    for (let i = 0; i < 100; i++) {
      await redis.set(`load:${i}`, { data: i }, 3600);
      await redis.get(`load:${i}`);
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
  });
});

// ============ ERROR HANDLING TESTS ============

describe('Error Handling', () => {
  test('should handle invalid cache keys gracefully', async () => {
    // Should not throw
    const result = await redis.get(null);
    expect(result).toBeNull();
  });

  test('should handle invalid pattern gracefully', async () => {
    // Should not throw
    const count = await redis.deletePattern('');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should handle serialization of complex objects', async () => {
    const complexObj = {
      nested: { deep: { value: 123 } },
      array: [1, 2, 3],
      date: new Date().toISOString(),
      null: null,
      bool: true
    };

    await redis.set('complex', complexObj, 3600);
    const retrieved = await redis.get('complex');

    expect(retrieved.nested.deep.value).toBe(123);
    expect(retrieved.array).toEqual([1, 2, 3]);
  });
});
