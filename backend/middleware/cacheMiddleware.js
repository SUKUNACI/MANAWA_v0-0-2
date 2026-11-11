const redis = require('../config/redis');
const logger = require('../utils/logger');

// Cache configuration by pattern with TTLs
const CACHE_CONFIG = {
  // User profiles and sessions
  'user:*': { ttl: 3600, description: 'User profile cache (1h)' },
  'user:*:settings': { ttl: 3600, description: 'User settings cache (1h)' },
  'session:*': { ttl: 86400, description: 'Session cache (24h)' },

  // Professional profiles and portfolios
  'professional:*': { ttl: 3600, description: 'Professional profile cache (1h)' },
  'professional:*:portfolio': { ttl: 3600, description: 'Professional portfolio cache (1h)' },
  'professional:*:reviews': { ttl: 1800, description: 'Professional reviews cache (30min)' },

  // Projects and search
  'projects:search:*': { ttl: 1800, description: 'Project search results cache (30min)' },
  'projects:city:*': { ttl: 1800, description: 'Projects by city cache (30min)' },
  'projects:*': { ttl: 1800, description: 'Project details cache (30min)' },

  // Admin analytics and KPIs
  'analytics:*': { ttl: 300, description: 'Analytics cache (5min)' },
  'kpis:*': { ttl: 300, description: 'KPIs cache (5min)' },
  'admin:dashboard:*': { ttl: 300, description: 'Admin dashboard cache (5min)' },
  'admin:stats:*': { ttl: 300, description: 'Admin stats cache (5min)' },

  // Quotes and finances
  'quotes:*': { ttl: 1800, description: 'Quotes cache (30min)' },
  'finances:*': { ttl: 600, description: 'Finances cache (10min)' },

  // Packages and availability
  'packages:*': { ttl: 3600, description: 'Packages cache (1h)' },
  'availability:*': { ttl: 3600, description: 'Availability cache (1h)' },

  // Badges and referrals
  'badges:*': { ttl: 3600, description: 'Badges cache (1h)' },
  'referrals:*': { ttl: 1800, description: 'Referrals cache (30min)' },
};

// Generate cache key from request
function generateCacheKey(req) {
  const user = req.user ? `:${req.user.id}` : '';
  const query = Object.keys(req.query).length > 0 ? `:${JSON.stringify(req.query)}` : '';

  // Extract resource ID from path (e.g., /api/professionals/123 -> 123)
  const pathSegments = req.path.split('/').filter(Boolean);
  const resourceId = pathSegments[pathSegments.length - 1];

  return `${req.baseUrl}:${req.path}${user}${query}`;
}

// Determine TTL based on request path
function getTTLForPath(path) {
  const pathLower = path.toLowerCase();

  // Find matching cache config
  for (const [pattern, config] of Object.entries(CACHE_CONFIG)) {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`, 'i');
    if (regex.test(pathLower)) {
      return config.ttl;
    }
  }

  // Default TTLs based on route prefix
  if (pathLower.includes('/analytics/') || pathLower.includes('/kpis/')) {
    return 300; // 5 minutes for admin analytics
  }
  if (pathLower.includes('/professionals/')) {
    return 3600; // 1 hour for professional data
  }
  if (pathLower.includes('/projects/')) {
    return 1800; // 30 minutes for projects
  }

  return 1800; // Default 30 minutes
}

// Middleware: Cache GET responses
function cacheGet(options = {}) {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip cache for specific query params
    if (req.query.skipCache === 'true' || req.query.noCache === 'true') {
      return next();
    }

    // Skip cache if admin explicitly disabled it
    if (options.skipCache === true) {
      return next();
    }

    const cacheKey = generateCacheKey(req);
    const ttl = getTTLForPath(req.path);

    try {
      // Check cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug('[Cache] Cache HIT', { path: req.path, key: cacheKey });
        res.set('X-Cache', 'HIT');
        return res.json(cached);
      }

      logger.debug('[Cache] Cache MISS', { path: req.path, key: cacheKey, ttl });

      // Intercept response
      const originalJson = res.json.bind(res);
      res.json = function (data) {
        // Cache successful responses only (2xx status)
        if (res.statusCode >= 200 && res.statusCode < 300 && data && typeof data === 'object') {
          redis.set(cacheKey, data, ttl).catch(err => {
            logger.warn('[Cache] Failed to set cache', { key: cacheKey, error: err.message });
          });
          res.set('X-Cache', 'MISS');
        }

        return originalJson(data);
      };

      next();
    } catch (err) {
      logger.warn('[Cache] Cache middleware error', { error: err.message, path: req.path });
      next(); // Continue without caching on error
    }
  };
}

// Middleware: Invalidate cache on mutations (POST, PATCH, DELETE)
function cacheInvalidate(patterns = []) {
  return async (req, res, next) => {
    // Only invalidate on mutation methods
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      return next();
    }

    // Store original json to intercept response
    const originalJson = res.json.bind(res);

    res.json = async function (data) {
      // Invalidate on successful response
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          // Invalidate specific patterns for this resource
          const resourcePatterns = generateInvalidationPatterns(req.path, patterns);

          for (const pattern of resourcePatterns) {
            const count = await redis.deletePattern(pattern);
            if (count > 0) {
              logger.debug('[Cache] Invalidated pattern', { method: req.method, pattern, count });
            }
          }
        } catch (err) {
          logger.warn('[Cache] Error during invalidation', { error: err.message });
        }
      }

      return originalJson(data);
    };

    next();
  };
}

// Generate cache invalidation patterns based on request path and method
function generateInvalidationPatterns(path, customPatterns = []) {
  const patterns = [...customPatterns];
  const pathSegments = path.split('/').filter(Boolean);

  // Extract IDs from path
  const userId = pathSegments.find((_, i) => pathSegments[i - 1] === 'users');
  const professionalId = pathSegments.find((_, i) => pathSegments[i - 1] === 'professionals');
  const projectId = pathSegments.find((_, i) => pathSegments[i - 1] === 'projects');
  const quoteId = pathSegments.find((_, i) => pathSegments[i - 1] === 'quotes');

  // Add specific invalidation patterns
  if (userId) {
    patterns.push(
      `user:${userId}:*`,
      'user:*:settings',
      'projects:search:*',
      'projects:city:*'
    );
  }

  if (professionalId) {
    patterns.push(
      `professional:${professionalId}:*`,
      `professional:${professionalId}:portfolio`,
      `professional:${professionalId}:reviews`,
      'projects:search:*',
      'projects:city:*'
    );
  }

  if (projectId) {
    patterns.push(
      `projects:*`,
      `projects:search:*`,
      `projects:city:*`,
      `quotes:*`
    );
  }

  if (quoteId) {
    patterns.push(`quotes:${quoteId}:*`, `quotes:*`);
  }

  // Always invalidate analytics and admin stats on mutations
  patterns.push('analytics:*', 'kpis:*', 'admin:dashboard:*', 'admin:stats:*');

  // Remove duplicates
  return [...new Set(patterns)];
}

// Utility: Clear cache for specific resource
async function clearCacheForResource(resourceType, resourceId) {
  const patterns = [
    `${resourceType}:${resourceId}:*`,
    `${resourceType}:*:${resourceId}`,
    `${resourceType}:*`,
  ];

  let totalCleared = 0;
  for (const pattern of patterns) {
    const count = await redis.deletePattern(pattern);
    totalCleared += count;
  }

  logger.info('[Cache] Cleared resource cache', { resourceType, resourceId, totalCleared });
  return totalCleared;
}

// Utility: Warm up cache (preload common queries)
async function warmupCache(endpoints = []) {
  logger.info('[Cache] Starting cache warmup', { endpoints: endpoints.length });
  // This would be called after server startup to preload common endpoints
  // Implementation depends on application-specific logic
}

module.exports = {
  cacheGet,
  cacheInvalidate,
  clearCacheForResource,
  warmupCache,
  generateCacheKey,
  getTTLForPath,
};
