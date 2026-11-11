/**
 * Load Balancing & Horizontal Scaling Configuration
 * Enables PM2 cluster mode and graceful shutdown for multi-worker deployment
 */

const os = require('os');
const logger = require('../utils/logger');

// Number of worker processes (default: CPU cores, can override with env var)
const numWorkers = parseInt(process.env.WORKERS || os.cpus().length, 10);

/**
 * PM2 Cluster Mode Configuration
 * Use: pm2 start ecosystem.config.js
 */
function getEcosystemConfig() {
  return {
    apps: [
      {
        name: 'manawa-api',
        script: './index.js',
        instances: numWorkers,
        exec_mode: 'cluster',
        env: {
          NODE_ENV: 'production',
          PORT: 4000,
        },
        // Graceful shutdown
        listen_timeout: 10000,
        kill_timeout: 5000,

        // Restart policy
        max_restarts: 5,
        min_uptime: '30s',
        max_memory_restart: '500M',

        // Logging
        output: 'logs/out.log',
        error: 'logs/error.log',
        merge_logs: true,

        // Auto restart
        autorestart: true,
        watch: false,

        // Clustering
        exec_mode: 'cluster',
        instances: numWorkers,
        increment_var: 'PORT',
        port_increment: 100,
      }
    ]
  };
}

/**
 * Health check endpoint configuration
 * Returns current worker status for load balancer verification
 */
const healthCheckConfig = {
  // Health check endpoint responds to load balancer
  endpoint: '/api/health',
  timeout: 5000,
  interval: 30000, // Check every 30 seconds
  unhealthyThreshold: 3, // Mark unhealthy after 3 failed checks
  healthyThreshold: 2, // Mark healthy after 2 successful checks
};

/**
 * Graceful shutdown handler
 * Ensures in-flight requests complete before worker exits
 */
class GracefulShutdown {
  constructor(server, options = {}) {
    this.server = server;
    this.isShuttingDown = false;
    this.activeConnections = new Set();
    this.options = {
      timeout: options.timeout || 30000, // 30 seconds default
      logger: options.logger || logger,
    };
  }

  /**
   * Initialize graceful shutdown handlers
   */
  initialize() {
    // Track active requests
    this.server.on('request', (req, res) => {
      const connection = { req, res, startTime: Date.now() };
      this.activeConnections.add(connection);

      res.on('finish', () => {
        this.activeConnections.delete(connection);
      });

      res.on('close', () => {
        this.activeConnections.delete(connection);
      });
    });

    // Handle SIGTERM (graceful shutdown signal)
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
  }

  /**
   * Execute graceful shutdown
   */
  async shutdown(signal) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.options.logger.info(`[GracefulShutdown] Received ${signal}, starting graceful shutdown`);

    // Stop accepting new connections
    this.server.close(() => {
      this.options.logger.info('[GracefulShutdown] Server closed, no new connections');
    });

    // Wait for active connections to complete or timeout
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = this.activeConnections.size;

      if (remaining === 0) {
        clearInterval(checkInterval);
        this.options.logger.info('[GracefulShutdown] All connections closed gracefully');
        process.exit(0);
      }

      if (elapsed > this.options.timeout) {
        clearInterval(checkInterval);
        this.options.logger.warn(`[GracefulShutdown] Timeout (${this.options.timeout}ms) exceeded, forcing shutdown`, {
          activeConnections: remaining,
        });

        // Force close remaining connections
        this.activeConnections.forEach(conn => {
          conn.res.destroy();
        });

        process.exit(1);
      }

      if (remaining > 0 && elapsed % 5000 === 0) {
        this.options.logger.info(`[GracefulShutdown] Waiting for connections to close`, {
          activeConnections: remaining,
          elapsedMs: elapsed,
        });
      }
    }, 1000);
  }

  /**
   * Get current connection stats
   */
  getStats() {
    return {
      activeConnections: this.activeConnections.size,
      isShuttingDown: this.isShuttingDown,
    };
  }
}

/**
 * Worker process management utilities
 */
class WorkerManager {
  constructor(options = {}) {
    this.numWorkers = options.numWorkers || numWorkers;
    this.logger = options.logger || logger;
  }

  /**
   * Get worker process info
   */
  getWorkerInfo() {
    return {
      workerId: process.env.NODE_APP_INSTANCE || 0,
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpus: os.cpus().length,
    };
  }

  /**
   * Monitor worker memory usage
   */
  monitorMemory(options = {}) {
    const maxMemoryMb = options.maxMemoryMb || 500;
    const checkInterval = options.checkInterval || 60000; // 1 minute

    setInterval(() => {
      const memUsageMb = process.memoryUsage().heapUsed / 1024 / 1024;

      if (memUsageMb > maxMemoryMb) {
        this.logger.warn('[WorkerManager] High memory usage detected', {
          memoryUsed: `${memUsageMb.toFixed(2)}MB`,
          maxAllowed: `${maxMemoryMb}MB`,
          workerId: process.env.NODE_APP_INSTANCE,
        });
      }
    }, checkInterval);
  }

  /**
   * Get configuration summary
   */
  getConfig() {
    return {
      numWorkers: this.numWorkers,
      environment: process.env.NODE_ENV,
      port: process.env.PORT,
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
    };
  }
}

/**
 * Load balancer session affinity (sticky sessions)
 * For WebSocket and stateful connections
 */
const sessionAffinityConfig = {
  // Use JWT token from cookies for session affinity
  cookieName: 'SERVERID',
  ttl: 86400, // 24 hours

  // Hash-based routing (consistent hashing for user session affinity)
  hashAlgorithm: 'md5',

  // Redis-backed session storage (optional, for cross-instance affinity)
  redisKey: 'session:affinity:',
};

module.exports = {
  getEcosystemConfig,
  healthCheckConfig,
  GracefulShutdown,
  WorkerManager,
  sessionAffinityConfig,
  numWorkers,
};
