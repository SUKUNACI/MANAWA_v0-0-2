/**
 * HealthModule
 * Health check logic for database and cache
 */

const logger = require('../utils/logger');

class HealthModule {
  constructor(healthCheck, redis) {
    this.healthCheck = healthCheck;
    this.redis = redis;
  }

  // Check system health
  async checkSystemHealth() {
    try {
      const [db, cache] = await Promise.all([
        this.healthCheck.checkDatabaseHealth(),
        this.redis.healthCheck(),
      ]);

      const isHealthy = db.status === 'healthy' && cache.status === 'ok';
      return {
        status: isHealthy ? 'healthy' : 'degraded',
        services: {
          database: { status: db.status },
          cache: { status: cache.status },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      throw new Error('Health check failed');
    }
  }

  // Check response status code
  getStatusCode(health) {
    return health.status === 'healthy' ? 200 : 503;
  }
}

module.exports = HealthModule;
