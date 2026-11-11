const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { checkDatabaseHealth } = require('../utils/health-check');
const redis = require('../config/redis');
const logger = require('../utils/logger');

// Rate limiters
const healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute (health checks are frequent)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de santé, réessayez dans une minute' },
});

// GET /api/health — Health check endpoint (includes Redis cache)
router.get('/health', healthLimiter, async (req, res) => {
  try {
    const [db, cache] = await Promise.all([
      checkDatabaseHealth(),
      redis.healthCheck()
    ]);

    const isHealthy = db.status === 'healthy' && cache.status === 'ok';
    const status = isHealthy ? 200 : 503;
    const response = {
      status: isHealthy ? 'healthy' : 'degraded',
      services: {
        database: db,
        cache: cache,
      },
      timestamp: new Date().toISOString(),
    };

    res.status(status).json(response);
  } catch (error) {
    logger.error('Health check error', {
      error: error.message,
    });
    res.status(503).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
