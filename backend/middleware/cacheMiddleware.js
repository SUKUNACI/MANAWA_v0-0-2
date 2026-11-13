const redis = require('../config/redis');
const logger = require('../utils/logger');
const { CACHE_TTL } = require('../config/performance-optimization');

// Cache configuration by pattern with TTLs
const CACHE_CONFIG = {
  // User profiles and sessions
  'user:*': { ttl: CACHE_TTL.USER_PROFILE, description: 'User profile cache' },
  'user:*:settings': { ttl: CACHE_TTL.USER_PROFILE, description: 'User settings cache' },
  'session:*': { ttl: 86400, description: 'Session cache (24h)' },

  // Professional profiles and portfolios
  'professional:*': { ttl: CACHE_TTL.PROFESSIONAL_DETAIL, description: 'Professional profile cache' },
  'professional:*:portfolio': { ttl: CACHE_TTL.PORTFOLIO_PROJECTS, description: 'Professional portfolio cache' },
  'professional:*:reviews': { ttl: CACHE_TTL.PROFESSIONAL_DETAIL, description: 'Professional reviews cache' },

  // Projects and search
  'projects:search:*': { ttl: CACHE_TTL.SEARCH_RESULTS, description: 'Project search results cache' },
  'projects:city:*': { ttl: CACHE_TTL.PROJECTS_LIST, description: 'Projects by city cache' },
  'projects:*': { ttl: CACHE_TTL.PROJECT_DETAIL, description: 'Project details cache' },

  // Admin analytics and KPIs
  'analytics:*': { ttl: CACHE_TTL.ANALYTICS, description: 'Analytics cache' },
  'kpis:*': { ttl: CACHE_TTL.DASHBOARD_KPI, description: 'KPIs cache' },
  'admin:dashboard:*': { ttl: CACHE_TTL.DASHBOARD_KPI, description: 'Admin dashboard cache' },
  'admin:stats:*': { ttl: CACHE_TTL.ADMIN_STATS, description: 'Admin stats cache' },

  // Quotes and finances
  'quotes:*': { ttl: CACHE_TTL.PROFESSIONAL_DETAIL, description: 'Quotes cache' },
  'finances:*': { ttl: CACHE_TTL.ANALYTICS, description: 'Finances cache' },

  // Packages and availability
  'packages:*': { ttl: CACHE_TTL.PACKAGES, description: 'Packages cache' },
  'availability:*': { ttl: CACHE_TTL.AVAILABILITY, description: 'Availability cache' },

  // Badges and referrals
  'badges:*': { ttl: CACHE_TTL.USER_PROFILE, description: 'Badges cache' },
  'referrals:*': { ttl: CACHE_TTL.PROFESSIONAL_DETAIL, description: 'Referrals cache' },
};

// Generate cache key from request
function generateCacheKey(req) {
  const user = req.user ? `:${req.user.id}` : '';
  const query = Object.keys(req.query).length > 0 ? `:${JSON.stringify(req.query)}` : '';

  // Extract resource ID from path (e.g., /api/professionals/123 -> 123)
  const pathSegments = req.path.split('/').filter(Boolean);
  const resourceId = pathSegments[pathSegments.length - 1];

  const base = req.baseUrl || '';
  const path = req.path || '';
  return `${base}${path}${user}${query}`;
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

// Middleware: Cache GET responses (Actively enabled)
function cacheGet(options = {}) {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip cache for specific query params
    if (req.query.skipCache === 'true' || req.query.noCache === 'true') {
      logger.debug('[Cache] Skipping cache per query param', { path: req.path });
      return next();
    }

    // Skip cache if admin explicitly disabled it
    if (options.skipCache === true) {
      logger.debug('[Cache] Skipping cache per middleware option', { path: req.path });
      return next();
    }

    // Don't cache authenticated user-specific endpoints by default
    // (can be overridden with options.cachePerUser = true)
    if (req.user && !options.cachePerUser) {
      return next();
    }

    const cacheKey = generateCacheKey(req);
    const ttl = getTTLForPath(req.path);

    try {
      // Check cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info('[Cache] HIT', { path: req.path, ttl });
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Key', cacheKey);
        return res.json(JSON.parse(cached));
      }

      // Intercept response to cache it
      const originalJson = res.json.bind(res);
      res.json = function (data) {
        // Cache successful responses only (2xx status)
        if (res.statusCode >= 200 && res.statusCode < 300 && data && typeof data === 'object') {
          redis.set(cacheKey, JSON.stringify(data), 'EX', ttl).catch(err => {
            logger.warn('[Cache] Failed to set cache', { key: cacheKey, error: err.message });
          });
          res.set('X-Cache', 'MISS');
          res.set('X-Cache-Key', cacheKey);
          logger.info('[Cache] SET', { path: req.path, ttl });
        }

        return originalJson(data);
      };

      next();
    } catch (err) {
      logger.warn('[Cache] Middleware error', { error: err.message, path: req.path });
      next(); // Continue without caching on error
    }
  };
}

// Middleware: Invalidate cache on mutations (POST, PATCH, DELETE) - ACTIVELY ENABLED
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

          let totalInvalidated = 0;
          for (const pattern of resourcePatterns) {
            const count = await redis.deletePattern(pattern);
            if (count > 0) {
              totalInvalidated += count;
              logger.info('[Cache] Invalidated', { method: req.method, pattern, count });
            }
          }

          if (totalInvalidated > 0) {
            logger.info('[Cache] Total invalidations', { method: req.method, total: totalInvalidated });
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
