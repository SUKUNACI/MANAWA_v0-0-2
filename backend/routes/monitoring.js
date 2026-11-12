/**
 * Monitoring & Metrics Routes
 * Endpoints for health checks, metrics, and monitoring dashboards
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { checkDatabaseHealth } = require('../utils/health-check');
const monitoring = require('../utils/monitoring');
const prisma = require('../config/db');
const jwt = require('jsonwebtoken');

// Middleware to verify admin token
const verifyAdmin = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.adminToken;
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Rate limiters
const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many health check requests' },
});

const metricsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many metrics requests' },
});

const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many dashboard requests' },
});

/**
 * GET /health
 * Simple health check endpoint
 * Returns basic system health status
 */
router.get('/health', healthLimiter, async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();

    const systemHealth = {
      status: dbHealth.status === 'healthy' ? 'healthy' : 'degraded',
      services: {
        api: 'healthy',
        database: dbHealth.status,
      },
      uptime: (process.uptime() / 3600).toFixed(2) + ' hours',
      memory: {
        heapUsed: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB',
      },
      timestamp: new Date().toISOString(),
    };

    const statusCode = systemHealth.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(systemHealth);
  } catch (error) {
    logger.error('Health check error', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /metrics
 * Prometheus-compatible metrics endpoint
 * Can be scraped by Prometheus, Grafana, or other monitoring tools
 */
router.get('/metrics', metricsLimiter, (req, res) => {
  try {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(monitoring.getPrometheusMetrics());
  } catch (error) {
    logger.error('Metrics endpoint error', { error: error.message });
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

/**
 * GET /admin/monitoring
 * Dashboard data endpoint (admin only)
 * Returns comprehensive metrics for the admin dashboard
 */
router.get('/admin/monitoring', verifyAdmin, dashboardLimiter, async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const metrics = monitoring.getMetrics();

    // Get recent errors from logs
    const fs = require('fs');
    const path = require('path');
    const errorLogPath = path.join(__dirname, '../logs/error.log');

    let recentErrors = [];
    if (fs.existsSync(errorLogPath)) {
      try {
        const errorLog = fs.readFileSync(errorLogPath, 'utf8');
        const lines = errorLog.split('\n').filter(l => l.trim()).slice(-50); // Last 50 errors
        recentErrors = lines.map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return { message: line, timestamp: new Date().toISOString() };
          }
        });
      } catch (err) {
        logger.warn('Failed to read error log', { error: err.message });
      }
    }

    const dashboardData = {
      summary: {
        status: dbHealth.status === 'healthy' ? 'healthy' : 'degraded',
        uptime: metrics.system.uptime,
        timestamp: new Date().toISOString(),
      },
      health: {
        database: dbHealth.status,
        api: 'healthy',
      },
      performance: {
        requests: {
          total: metrics.requests.total,
          avgResponseTime: metrics.requests.avgResponseTime,
          perSecond: (metrics.requests.total / Math.max(process.uptime(), 1)).toFixed(2),
        },
        errors: {
          total: metrics.errors.total,
          rate: metrics.errors.rate,
          topTypes: Object.entries(metrics.errors.byType)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .reduce((acc, [type, count]) => {
              acc[type] = count;
              return acc;
            }, {}),
        },
      },
      resources: {
        memory: {
          heapUsed: metrics.system.memory.heapUsed,
          heapTotal: metrics.system.memory.heapTotal,
          systemPercent: metrics.system.memory.systemMemoryPercent,
        },
        cpu: {
          user: metrics.system.cpu.user,
          system: metrics.system.cpu.system,
        },
      },
      business: {
        payments: {
          processed: metrics.business.payments.processed,
          failed: metrics.business.payments.failed,
          totalAmount: metrics.business.payments.totalAmount,
          failureRate: metrics.business.payments.failureRate,
        },
        bookings: metrics.business.bookings,
        activeUsers: metrics.business.activeUsers,
        quotes: metrics.business.quotes,
        conversions: metrics.business.conversions,
      },
      topRoutes: Object.entries(metrics.requests.routeMetrics)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 10)
        .reduce((acc, [route, data]) => {
          acc[route] = data;
          return acc;
        }, {}),
      recentErrors: recentErrors.slice(-20), // Last 20 errors
      alerts: metrics.alerts,
    };

    res.json(dashboardData);
  } catch (error) {
    logger.error('Monitoring dashboard error', { error: error.message });
    res.status(500).json({ error: 'Failed to generate dashboard data' });
  }
});

/**
 * GET /admin/alerts
 * Get current active alerts (admin only)
 */
router.get('/admin/alerts', verifyAdmin, (req, res) => {
  try {
    const metrics = monitoring.getMetrics();
    res.json({
      active: metrics.alerts.active,
      thresholds: metrics.alerts.thresholds,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Alerts endpoint error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * POST /admin/alerts/config
 * Configure alert thresholds (admin only)
 * Request body: { errorRate: 5, apiResponseTime: 2000, ... }
 */
router.post('/admin/alerts/config', verifyAdmin, express.json(), async (req, res) => {
  try {
    const { errorRate, apiResponseTime, dbConnectionPoolUsage, paymentFailureRate, queueDepth, memoryUsage, cpuUsage } = req.body;

    const newThresholds = {};
    if (typeof errorRate === 'number') newThresholds.errorRate = errorRate;
    if (typeof apiResponseTime === 'number') newThresholds.apiResponseTime = apiResponseTime;
    if (typeof dbConnectionPoolUsage === 'number') newThresholds.dbConnectionPoolUsage = dbConnectionPoolUsage;
    if (typeof paymentFailureRate === 'number') newThresholds.paymentFailureRate = paymentFailureRate;
    if (typeof queueDepth === 'number') newThresholds.queueDepth = queueDepth;
    if (typeof memoryUsage === 'number') newThresholds.memoryUsage = memoryUsage;
    if (typeof cpuUsage === 'number') newThresholds.cpuUsage = cpuUsage;

    if (Object.keys(newThresholds).length === 0) {
      return res.status(400).json({ error: 'No valid thresholds provided' });
    }

    monitoring.updateAlertThresholds(newThresholds);

    // Save to database for persistence
    try {
      await prisma.appConfig.upsert({
        where: { key: 'alert_thresholds' },
        update: { value: JSON.stringify(newThresholds) },
        create: { key: 'alert_thresholds', value: JSON.stringify(newThresholds) },
      });
    } catch (err) {
      logger.warn('Failed to persist alert thresholds', { error: err.message });
    }

    logger.info('Alert thresholds updated', { updatedThresholds: newThresholds, userId: req.user?.id });

    res.json({
      message: 'Alert thresholds updated successfully',
      thresholds: monitoring.getAlertThresholds(),
    });
  } catch (error) {
    logger.error('Failed to update alert thresholds', { error: error.message });
    res.status(500).json({ error: 'Failed to update alert thresholds' });
  }
});

/**
 * GET /admin/alerts/config
 * Get current alert configuration (admin only)
 */
router.get('/admin/alerts/config', verifyAdmin, (req, res) => {
  try {
    res.json({
      thresholds: monitoring.getAlertThresholds(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Alert config endpoint error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch alert configuration' });
  }
});

/**
 * GET /admin/performance/top-routes
 * Get top performing and worst performing routes (admin only)
 */
router.get('/admin/performance/top-routes', verifyAdmin, (req, res) => {
  try {
    const metrics = monitoring.getMetrics();

    const routes = Object.entries(metrics.requests.routeMetrics).map(([route, data]) => ({
      route,
      ...data,
    }));

    const topByLatency = routes.sort((a, b) => parseFloat(b.avgTime) - parseFloat(a.avgTime)).slice(0, 10);
    const topByErrorRate = Object.entries(metrics.errors.byRoute)
      .map(([route, errors]) => ({
        route,
        errors,
        requests: metrics.requests.byRoute[route] || 0,
      }))
      .sort((a, b) => b.errors - a.errors)
      .slice(0, 10);

    res.json({
      slowestRoutes: topByLatency,
      mostErrorProneRoutes: topByErrorRate,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Performance routes endpoint error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch performance data' });
  }
});

/**
 * GET /admin/performance/database
 * Get database performance metrics (admin only)
 */
router.get('/admin/performance/database', verifyAdmin, async (req, res) => {
  try {
    const metrics = monitoring.getMetrics();

    res.json({
      queries: {
        total: metrics.database.queryCount,
        errors: metrics.database.errorCount,
        errorRate: metrics.database.errorRate,
      },
      health: await checkDatabaseHealth(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Database performance endpoint error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch database metrics' });
  }
});

/**
 * GET /admin/business/metrics
 * Get business metrics (admin only)
 */
router.get('/admin/business/metrics', verifyAdmin, (req, res) => {
  try {
    const metrics = monitoring.getMetrics();

    res.json({
      payments: metrics.business.payments,
      bookings: metrics.business.bookings,
      activeUsers: metrics.business.activeUsers,
      quotes: metrics.business.quotes,
      conversions: metrics.business.conversions,
      conversionRate: metrics.business.bookings > 0
        ? ((metrics.business.conversions / metrics.business.bookings) * 100).toFixed(2) + '%'
        : '0%',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Business metrics endpoint error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch business metrics' });
  }
});

/**
 * POST /admin/monitoring/reset
 * Reset daily metrics (admin only)
 */
router.post('/admin/monitoring/reset', verifyAdmin, express.json(), (req, res) => {
  try {
    monitoring.resetDailyMetrics();
    logger.info('Daily metrics reset by admin', { userId: req.user?.id });

    res.json({
      message: 'Daily metrics reset successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to reset metrics', { error: error.message });
    res.status(500).json({ error: 'Failed to reset metrics' });
  }
});

module.exports = router;
