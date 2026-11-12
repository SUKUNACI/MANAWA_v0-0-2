/**
 * Connection Pool Configuration for MANAWA Database
 * Manages Prisma connection pooling settings for optimal performance
 *
 * Strategy:
 * - Min pool size: 5 (minimum concurrent connections)
 * - Max pool size: 20 (maximum concurrent connections)
 * - Adjusts based on environment and load
 */

class ConnectionPoolConfig {
  constructor() {
    this.environment = process.env.NODE_ENV || 'development';
    this.isProduction = this.environment === 'production';
  }

  /**
   * Get connection pool configuration for Prisma
   * Returns URL with connection pool parameters
   */
  getPoolConfig() {
    const baseUrl = process.env.DATABASE_URL;

    if (!baseUrl) {
      throw new Error('DATABASE_URL not configured');
    }

    // Parse existing URL
    const url = new URL(baseUrl);

    // Set connection pool parameters based on environment
    const poolConfig = this.isProduction
      ? {
          min: 10,           // Production: keep 10 connections ready
          max: 30,           // Production: max 30 concurrent connections
          idleTimeoutMillis: 30000,   // Close idle connections after 30s
          connectionTimeoutMillis: 5000, // Max 5s to acquire connection
          maxLifetimeSeconds: 3600,   // Recycle connections after 1 hour
        }
      : {
          min: 2,            // Dev: minimal overhead
          max: 5,            // Dev: low concurrency
          idleTimeoutMillis: 60000,   // Dev: close idle after 60s
          connectionTimeoutMillis: 5000,
          maxLifetimeSeconds: 7200,   // Dev: recycle after 2 hours
        };

    // Prisma connection string format: ?schema=public&connection_limit=20
    const params = new URLSearchParams();
    params.append('connection_limit', poolConfig.max);

    // Recreate URL with params
    const poolUrl = `${url.protocol}//${url.host}${url.pathname}?${params.toString()}`;

    return {
      url: poolUrl,
      pool: poolConfig,
    };
  }

  /**
   * Get read replica pool config (typically more aggressive pooling)
   */
  getReadReplicaPoolConfig() {
    const baseUrl = process.env.DATABASE_REPLICA_URLS?.split(',')[0];

    if (!baseUrl) {
      return null;
    }

    // Read replicas can have more connections since they're not handling writes
    const poolConfig = this.isProduction
      ? {
          min: 15,
          max: 50,           // Read replicas can handle more connections
          idleTimeoutMillis: 20000,
          connectionTimeoutMillis: 3000,
          maxLifetimeSeconds: 3600,
        }
      : {
          min: 2,
          max: 10,
          idleTimeoutMillis: 60000,
          connectionTimeoutMillis: 5000,
          maxLifetimeSeconds: 7200,
        };

    const url = new URL(baseUrl.trim());
    const params = new URLSearchParams();
    params.append('connection_limit', poolConfig.max);

    const poolUrl = `${url.protocol}//${url.host}${url.pathname}?${params.toString()}`;

    return {
      url: poolUrl,
      pool: poolConfig,
    };
  }

  /**
   * Get environment-specific pool recommendations
   */
  getPoolRecommendations() {
    return {
      production: {
        minPoolSize: 10,
        maxPoolSize: 30,
        recommendation: 'Scale based on concurrent request volume (1 connection per 2-3 requests)',
        monitoring: 'Track pool utilization hourly; trigger alert if >80% utilized',
      },
      development: {
        minPoolSize: 2,
        maxPoolSize: 5,
        recommendation: 'Low overhead for local development',
        monitoring: 'Not critical in development',
      },
      testing: {
        minPoolSize: 1,
        maxPoolSize: 3,
        recommendation: 'Minimize resource usage during tests',
        monitoring: 'Verify cleanup in test teardown',
      },
    };
  }

  /**
   * Calculate optimal pool size based on expected QPS
   * Formula: pool_size = (QPS * average_query_time_seconds) + buffer
   */
  calculateOptimalPoolSize(queriesPerSecond, avgQueryTimeMs = 50, bufferPercent = 0.2) {
    const queryTimeSeconds = avgQueryTimeMs / 1000;
    const baseSize = queriesPerSecond * queryTimeSeconds;
    const buffer = baseSize * bufferPercent;
    const optimal = Math.ceil(baseSize + buffer);

    // Clamp between min and max
    const clamped = Math.max(2, Math.min(optimal, 50));

    return {
      queriesPerSecond,
      avgQueryTimeMs,
      calculatedSize: clamped,
      formula: `${queriesPerSecond} QPS × ${queryTimeSeconds}s + ${Math.round(buffer)} buffer = ${clamped}`,
    };
  }

  /**
   * Get health check query to verify pool connectivity
   */
  getHealthCheckQuery() {
    return `
      SELECT
        count(*) as active_connections,
        max(state_change) as last_change
      FROM pg_stat_activity
      WHERE state = 'active'
    `;
  }

  /**
   * Monitor connection pool usage
   */
  async monitorPoolUsage(prisma) {
    try {
      const result = await prisma.$queryRaw`
        SELECT
          datname as database,
          count(*) as total_connections,
          sum(case when state = 'active' then 1 else 0 end) as active_connections,
          sum(case when state = 'idle' then 1 else 0 end) as idle_connections,
          max(extract(epoch from (now() - query_start))) as longest_query_duration_seconds
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY datname
      `;

      return result[0] || {};
    } catch (err) {
      console.error('[Connection Pool] Monitor error:', err.message);
      return null;
    }
  }
}

module.exports = new ConnectionPoolConfig();
