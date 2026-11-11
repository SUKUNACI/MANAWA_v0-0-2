/**
 * Default Monitoring Configuration
 * Can be overridden via environment variables or admin API
 */

module.exports = {
  // Alert Thresholds
  alertThresholds: {
    // API Performance
    errorRate: parseInt(process.env.ALERT_ERROR_RATE || '5', 10), // percentage
    apiResponseTime: parseInt(process.env.ALERT_API_RESPONSE_TIME || '2000', 10), // milliseconds

    // Database
    dbConnectionPoolUsage: parseInt(process.env.ALERT_DB_POOL || '80', 10), // percentage

    // Payments
    paymentFailureRate: parseInt(process.env.ALERT_PAYMENT_FAILURE_RATE || '10', 10), // per hour

    // Queue
    queueDepth: parseInt(process.env.ALERT_QUEUE_DEPTH || '1000', 10), // jobs

    // System Resources
    memoryUsage: parseInt(process.env.ALERT_MEMORY || '80', 10), // percentage
    cpuUsage: parseInt(process.env.ALERT_CPU || '90', 10), // percentage
  },

  // Metrics Retention
  metricsRetention: {
    dailyMetricsReset: 24 * 60 * 60 * 1000, // Reset daily metrics every 24 hours
    alertDeduplicationWindow: 5 * 60 * 1000, // Suppress duplicate alerts for 5 minutes
    activeUsersTrackingWindow: 60 * 60 * 1000, // Track active users per hour
  },

  // Alert Destinations
  alertDestinations: {
    email: {
      enabled: !!process.env.ALERT_EMAIL,
      recipients: (process.env.ALERT_EMAIL || 'admin@manawa.com').split(',').map(e => e.trim()),
      from: process.env.ALERT_EMAIL_FROM || 'alerts@manawa.com',
    },
    slack: {
      enabled: !!process.env.SLACK_WEBHOOK_URL,
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: process.env.SLACK_ALERT_CHANNEL || '#alerts',
    },
    logs: {
      enabled: true, // Always log alerts
      level: 'warn',
    },
  },

  // Metrics Export
  metricsExport: {
    prometheusFormat: true,
    includeBusiness: true,
    includeSystem: true,
  },

  // Middleware Configuration
  middleware: {
    enabled: true,
    recordAllRequests: true,
    excludePaths: [
      '/api/monitoring/health', // Avoid recursive metrics
      '/api/monitoring/metrics',
      '/favicon.ico',
    ],
  },

  // Feature Flags
  features: {
    enableAlerts: process.env.ENABLE_ALERTS !== 'false',
    enableMetrics: process.env.ENABLE_METRICS !== 'false',
    enableDashboard: process.env.ENABLE_DASHBOARD !== 'false',
  },

  // Logging
  logging: {
    verbose: process.env.DEBUG === 'true',
    logMetricsCollection: process.env.DEBUG === 'true',
    logAlertTriggers: true,
  },
};
