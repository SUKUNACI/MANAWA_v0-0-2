/**
 * MonitoringModule
 * Business logic for monitoring and metrics
 */

const logger = require('../utils/logger');

class MonitoringModule {
  constructor(healthCheck, monitoring, prisma) {
    this.healthCheck = healthCheck;
    this.monitoring = monitoring;
    this.prisma = prisma;
  }

  // Get monitoring dashboard
  async getDashboard() {
    const [dbHealth, metrics] = await Promise.all([
      this.healthCheck.checkDatabaseHealth(),
      Promise.resolve(this.monitoring.getMetrics()),
    ]);

    return {
      summary: {
        status: dbHealth.status === 'healthy' ? 'healthy' : 'degraded',
        uptime: metrics.system.uptime,
        timestamp: new Date().toISOString(),
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
            .reduce((acc, [type, count]) => { acc[type] = count; return acc; }, {}),
        },
      },
      business: {
        payments: metrics.business.payments,
        bookings: metrics.business.bookings,
        activeUsers: metrics.business.activeUsers,
        quotes: metrics.business.quotes,
        conversions: metrics.business.conversions,
      },
    };
  }

  // Get alerts
  getAlerts() {
    const metrics = this.monitoring.getMetrics();
    return { active: metrics.alerts.active };
  }

  // Update alert thresholds
  async updateAlertThresholds(thresholds) {
    const validFields = ['errorRate', 'apiResponseTime', 'cpuUsage', 'memoryUsage', 'databaseLatency'];
    const filtered = Object.fromEntries(
      Object.entries(thresholds).filter(([k]) => validFields.includes(k))
    );

    if (Object.keys(filtered).length === 0) throw new Error('No valid thresholds provided');

    this.monitoring.updateAlertThresholds(filtered);

    try {
      await this.prisma.appConfig.upsert({
        where: { key: 'alert_thresholds' },
        create: { key: 'alert_thresholds', value: JSON.stringify(filtered) },
        update: { value: JSON.stringify(filtered) },
      });
    } catch (err) {
      logger.warn('Failed to persist thresholds', { error: err.message });
    }

    return { message: 'Alert thresholds updated', thresholds: filtered };
  }

  // Get alert thresholds
  getAlertThresholds() {
    return { thresholds: this.monitoring.getAlertThresholds() };
  }

  // Get performance metrics
  async getPerformanceMetrics() {
    const metrics = this.monitoring.getMetrics();
    return {
      slowestRoutes: Object.entries(metrics.requests.routeMetrics)
        .sort(([, a], [, b]) => b.avgResponseTime - a.avgResponseTime)
        .slice(0, 10)
        .reduce((acc, [route, data]) => { acc[route] = data; return acc; }, {}),
      mostErrorProneRoutes: Object.entries(metrics.errors.byRoute)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .reduce((acc, [route, count]) => { acc[route] = count; return acc; }, {}),
    };
  }

  // Get database performance
  async getDatabasePerformance() {
    const [dbHealth, metrics] = await Promise.all([
      this.healthCheck.checkDatabaseHealth(),
      Promise.resolve(this.monitoring.getMetrics()),
    ]);

    return {
      queries: metrics.database.queryCount,
      errorCount: metrics.database.errorCount,
      errorRate: metrics.database.errorRate,
      health: dbHealth.status,
    };
  }

  // Get business metrics
  getBusinessMetrics() {
    const metrics = this.monitoring.getMetrics();
    const conversions = metrics.business.conversions || 0;
    const quotes = metrics.business.quotes || 1;
    const rate = quotes > 0 ? (conversions / quotes) * 100 : 0;
    const conversionRate = rate === 0 ? '0' : rate.toFixed(2);

    return {
      payments: metrics.business.payments,
      bookings: metrics.business.bookings,
      activeUsers: metrics.business.activeUsers,
      conversions,
      conversionRate: `${conversionRate}%`,
    };
  }

  // Reset metrics
  resetMetrics() {
    this.monitoring.resetDailyMetrics();
    return { message: 'Metrics reset', timestamp: new Date().toISOString() };
  }

  // Get health check
  async getHealth() {
    try {
      const dbHealth = await this.healthCheck.checkDatabaseHealth();
      const metrics = this.monitoring.getMetrics();
      return {
        status: dbHealth.status === 'healthy' ? 'healthy' : 'degraded',
        services: { api: 'healthy', database: dbHealth.status },
        uptime: metrics.system.uptime,
        memory: metrics.system.memory,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error('Health check failed');
    }
  }
}

module.exports = MonitoringModule;
