/**
 * Monitoring and Metrics Collection
 * Tracks API performance, errors, database health, and business metrics
 * Exports metrics in Prometheus format
 */

const prisma = require('../config/db');
const logger = require('./logger');
const os = require('os');

// Metrics store
const metrics = {
  // Request metrics
  requestCount: 0,
  requestsByMethod: {},
  requestsByRoute: {},
  requestsByStatus: {},
  totalResponseTime: 0,
  responseTimeByRoute: {},
  requestCountByRoute: {},

  // Error metrics
  errorCount: 0,
  errorsByType: {},
  errorsByRoute: {},

  // Database metrics
  dbQueryCount: 0,
  dbErrorCount: 0,
  dbConnectionPoolStatus: null,

  // Business metrics
  paymentsProcessedToday: 0,
  paymentsFailedToday: 0,
  paymentsTotalAmountToday: 0,
  bookingsCreatedToday: 0,
  activeUsersThisHour: new Set(),
  quotesGeneratedToday: 0,
  conversionsToday: 0,

  // System metrics
  memoryUsage: process.memoryUsage(),
  cpuUsage: process.cpuUsage(),
  uptime: process.uptime(),
  lastMetricsReset: new Date(),
};

// Alert thresholds
const alertThresholds = {
  errorRate: 5, // percentage
  apiResponseTime: 2000, // milliseconds
  dbConnectionPoolUsage: 80, // percentage
  paymentFailureRate: 10, // per hour
  queueDepth: 1000,
  memoryUsage: 80, // percentage
  cpuUsage: 90, // percentage
};

// Active alerts
const activeAlerts = new Map();

/**
 * Record an HTTP request
 */
function recordRequest(req, res, responseTime) {
  metrics.requestCount++;
  const method = req.method || 'UNKNOWN';
  const route = req.route?.path || req.path || 'unknown';
  const status = res.statusCode || 500;

  // Track by method
  metrics.requestsByMethod[method] = (metrics.requestsByMethod[method] || 0) + 1;

  // Track by route
  metrics.requestsByRoute[route] = (metrics.requestsByRoute[route] || 0) + 1;

  // Track by status
  metrics.requestsByStatus[status] = (metrics.requestsByStatus[status] || 0) + 1;

  // Track response time
  metrics.totalResponseTime += responseTime;
  if (!metrics.responseTimeByRoute[route]) {
    metrics.responseTimeByRoute[route] = { total: 0, count: 0, max: 0, min: Infinity };
  }
  metrics.responseTimeByRoute[route].total += responseTime;
  metrics.responseTimeByRoute[route].count++;
  metrics.responseTimeByRoute[route].max = Math.max(metrics.responseTimeByRoute[route].max, responseTime);
  metrics.responseTimeByRoute[route].min = Math.min(metrics.responseTimeByRoute[route].min, responseTime);

  if (!metrics.requestCountByRoute[route]) {
    metrics.requestCountByRoute[route] = 0;
  }
  metrics.requestCountByRoute[route]++;

  // Check for high response time alert
  if (responseTime > alertThresholds.apiResponseTime) {
    triggerAlert('HIGH_API_LATENCY', {
      route,
      responseTime,
      threshold: alertThresholds.apiResponseTime,
      method,
      status,
    });
  }

  // Track high status codes as errors
  if (status >= 400 && status < 500) {
    recordError('CLIENT_ERROR', { route, status, method });
  } else if (status >= 500) {
    recordError('SERVER_ERROR', { route, status, method });
  }
}

/**
 * Record an error
 */
function recordError(errorType, errorDetails = {}) {
  metrics.errorCount++;
  metrics.errorsByType[errorType] = (metrics.errorsByType[errorType] || 0) + 1;

  const route = errorDetails.route || 'unknown';
  metrics.errorsByRoute[route] = (metrics.errorsByRoute[route] || 0) + 1;

  // Check error rate threshold
  const errorRate = (metrics.errorCount / Math.max(metrics.requestCount, 1)) * 100;
  if (errorRate > alertThresholds.errorRate) {
    triggerAlert('HIGH_ERROR_RATE', {
      errorRate: errorRate.toFixed(2),
      threshold: alertThresholds.errorRate,
      errorCount: metrics.errorCount,
      requestCount: metrics.requestCount,
    });
  }
}

/**
 * Record a database operation
 */
function recordDatabaseOperation(success = true, responseTime = 0, query = 'unknown') {
  metrics.dbQueryCount++;
  if (!success) {
    metrics.dbErrorCount++;
  }
}

/**
 * Record a payment
 */
function recordPayment(amount, status) {
  if (status === 'succeeded') {
    metrics.paymentsProcessedToday++;
    metrics.paymentsTotalAmountToday += amount;
  } else if (status === 'failed') {
    metrics.paymentsFailedToday++;

    // Check payment failure rate
    const failureRate = (metrics.paymentsFailedToday / Math.max(metrics.paymentsProcessedToday + metrics.paymentsFailedToday, 1)) * 100;
    if (metrics.paymentsFailedToday > alertThresholds.paymentFailureRate && failureRate > 20) {
      triggerAlert('HIGH_PAYMENT_FAILURE_RATE', {
        failedPayments: metrics.paymentsFailedToday,
        totalPayments: metrics.paymentsProcessedToday + metrics.paymentsFailedToday,
        failureRate: failureRate.toFixed(2),
        threshold: alertThresholds.paymentFailureRate,
      });
    }
  }
}

/**
 * Record a booking
 */
function recordBooking() {
  metrics.bookingsCreatedToday++;
}

/**
 * Record an active user
 */
function recordActiveUser(userId) {
  if (userId) {
    metrics.activeUsersThisHour.add(userId);
  }
}

/**
 * Record a quote
 */
function recordQuote() {
  metrics.quotesGeneratedToday++;
}

/**
 * Record a conversion
 */
function recordConversion() {
  metrics.conversionsToday++;
}

/**
 * Trigger an alert
 */
function triggerAlert(alertType, alertData) {
  const alertKey = `${alertType}`;
  const now = Date.now();

  // Avoid duplicate alerts within 5 minutes
  if (activeAlerts.has(alertKey)) {
    const lastAlert = activeAlerts.get(alertKey);
    if (now - lastAlert.timestamp < 5 * 60 * 1000) {
      return;
    }
  }

  activeAlerts.set(alertKey, {
    timestamp: now,
    alertType,
    alertData,
    status: 'active',
  });

  logger.warn(`ALERT: ${alertType}`, alertData);

  // In production, send to external services (email, Slack, etc)
  if (process.env.NODE_ENV === 'production') {
    sendAlertNotifications(alertType, alertData).catch(err => {
      logger.error('Failed to send alert notifications', { alertType, error: err.message });
    });
  }
}

/**
 * Send alert notifications to external services
 */
async function sendAlertNotifications(alertType, alertData) {
  try {
    // Email alert
    if (process.env.ALERT_EMAIL) {
      // Send email via Mailjet (async, no await)
      sendEmailAlert(alertType, alertData).catch(err => {
        logger.error('Failed to send email alert', { alertType, error: err.message });
      });
    }

    // Slack alert
    if (process.env.SLACK_WEBHOOK_URL) {
      // Send to Slack (async, no await)
      sendSlackAlert(alertType, alertData).catch(err => {
        logger.error('Failed to send Slack alert', { alertType, error: err.message });
      });
    }
  } catch (err) {
    logger.error('Failed to send alert notifications', { alertType, error: err.message });
  }
}

/**
 * Send email alert
 */
async function sendEmailAlert(alertType, alertData) {
  const Mailjet = require('node-mailjet').Client;
  const mailjet = new Mailjet({
    apiKey: process.env.MAILJET_API_KEY,
    apiSecret: process.env.MAILJET_SECRET_KEY,
  });

  const alertEmail = process.env.ALERT_EMAIL || 'admin@manawa.com';

  try {
    await mailjet.post('send', { version: 'v3.1' }).request({
      Messages: [
        {
          From: {
            Email: 'alerts@manawa.com',
            Name: 'MANAWA Alerts',
          },
          To: [
            {
              Email: alertEmail,
              Name: 'Admin',
            },
          ],
          Subject: `ALERT: ${alertType}`,
          HTMLPart: `
            <h2>MANAWA System Alert</h2>
            <p><strong>Alert Type:</strong> ${alertType}</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <pre>${JSON.stringify(alertData, null, 2)}</pre>
            <p>Please check the monitoring dashboard for more details.</p>
          `,
        },
      ],
    });
    logger.info('Email alert sent', { alertType, recipient: alertEmail });
  } catch (err) {
    logger.error('Failed to send email alert via Mailjet', { alertType, error: err.message });
  }
}

/**
 * Send Slack alert
 */
async function sendSlackAlert(alertType, alertData) {
  const axios = require('axios');
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) return;

  try {
    const color = alertType.includes('HIGH') || alertType.includes('CRITICAL') ? 'danger' : 'warning';

    await axios.post(webhookUrl, {
      attachments: [
        {
          color,
          title: `MANAWA Alert: ${alertType}`,
          text: JSON.stringify(alertData, null, 2),
          ts: Math.floor(Date.now() / 1000),
          footer: 'MANAWA Monitoring',
          mrkdwn_in: ['text'],
        },
      ],
    });
    logger.info('Slack alert sent', { alertType });
  } catch (err) {
    logger.error('Failed to send Slack alert', { alertType, error: err.message });
  }
}

/**
 * Get current metrics
 */
function getMetrics() {
  const cpuUsage = process.cpuUsage();
  const memoryUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryPercent = (usedMemory / totalMemory) * 100;

  const errorRate = (metrics.errorCount / Math.max(metrics.requestCount, 1)) * 100;
  const avgResponseTime = metrics.requestCount > 0 ? metrics.totalResponseTime / metrics.requestCount : 0;

  return {
    requests: {
      total: metrics.requestCount,
      byMethod: metrics.requestsByMethod,
      byStatus: metrics.requestsByStatus,
      byRoute: metrics.requestsByRoute,
      avgResponseTime: avgResponseTime.toFixed(2),
      routeMetrics: Object.entries(metrics.responseTimeByRoute).reduce((acc, [route, data]) => {
        acc[route] = {
          count: data.count,
          avgTime: (data.total / data.count).toFixed(2),
          maxTime: data.max,
          minTime: data.min === Infinity ? 0 : data.min,
        };
        return acc;
      }, {}),
    },
    errors: {
      total: metrics.errorCount,
      rate: errorRate.toFixed(2) + '%',
      byType: metrics.errorsByType,
      byRoute: metrics.errorsByRoute,
    },
    database: {
      queryCount: metrics.dbQueryCount,
      errorCount: metrics.dbErrorCount,
      errorRate: (metrics.dbErrorCount / Math.max(metrics.dbQueryCount, 1) * 100).toFixed(2) + '%',
    },
    business: {
      payments: {
        processed: metrics.paymentsProcessedToday,
        failed: metrics.paymentsFailedToday,
        totalAmount: metrics.paymentsTotalAmountToday.toFixed(2),
        failureRate: ((metrics.paymentsFailedToday / Math.max(metrics.paymentsProcessedToday + metrics.paymentsFailedToday, 1)) * 100).toFixed(2) + '%',
      },
      bookings: metrics.bookingsCreatedToday,
      activeUsers: metrics.activeUsersThisHour.size,
      quotes: metrics.quotesGeneratedToday,
      conversions: metrics.conversionsToday,
    },
    system: {
      uptime: (process.uptime() / 3600).toFixed(2) + ' hours',
      memory: {
        heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
        rss: (memoryUsage.rss / 1024 / 1024).toFixed(2) + ' MB',
        external: (memoryUsage.external / 1024 / 1024).toFixed(2) + ' MB',
        systemMemoryPercent: memoryPercent.toFixed(2) + '%',
      },
      cpu: {
        user: (cpuUsage.user / 1000).toFixed(2) + ' ms',
        system: (cpuUsage.system / 1000).toFixed(2) + ' ms',
      },
    },
    alerts: {
      active: Array.from(activeAlerts.values()),
      thresholds: alertThresholds,
    },
    timestamp: new Date().toISOString(),
    metricsCollectionStarted: metrics.lastMetricsReset.toISOString(),
  };
}

/**
 * Export metrics in Prometheus format
 */
function getPrometheusMetrics() {
  const cpuUsage = process.cpuUsage();
  const memoryUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryPercent = (usedMemory / totalMemory) * 100;

  const errorRate = (metrics.errorCount / Math.max(metrics.requestCount, 1)) * 100;
  const avgResponseTime = metrics.requestCount > 0 ? metrics.totalResponseTime / metrics.requestCount : 0;

  let output = '# HELP manawa_http_requests_total Total number of HTTP requests\n';
  output += '# TYPE manawa_http_requests_total counter\n';
  output += `manawa_http_requests_total ${metrics.requestCount}\n\n`;

  output += '# HELP manawa_http_request_duration_seconds HTTP request duration\n';
  output += '# TYPE manawa_http_request_duration_seconds gauge\n';
  output += `manawa_http_request_duration_seconds ${(avgResponseTime / 1000).toFixed(4)}\n\n`;

  output += '# HELP manawa_errors_total Total number of errors\n';
  output += '# TYPE manawa_errors_total counter\n';
  output += `manawa_errors_total ${metrics.errorCount}\n\n`;

  output += '# HELP manawa_error_rate_percent Error rate percentage\n';
  output += '# TYPE manawa_error_rate_percent gauge\n';
  output += `manawa_error_rate_percent ${errorRate.toFixed(2)}\n\n`;

  output += '# HELP manawa_db_queries_total Total database queries\n';
  output += '# TYPE manawa_db_queries_total counter\n';
  output += `manawa_db_queries_total ${metrics.dbQueryCount}\n\n`;

  output += '# HELP manawa_db_errors_total Total database errors\n';
  output += '# TYPE manawa_db_errors_total counter\n';
  output += `manawa_db_errors_total ${metrics.dbErrorCount}\n\n`;

  output += '# HELP manawa_payments_processed_total Payments processed today\n';
  output += '# TYPE manawa_payments_processed_total counter\n';
  output += `manawa_payments_processed_total ${metrics.paymentsProcessedToday}\n\n`;

  output += '# HELP manawa_payments_failed_total Failed payments today\n';
  output += '# TYPE manawa_payments_failed_total counter\n';
  output += `manawa_payments_failed_total ${metrics.paymentsFailedToday}\n\n`;

  output += '# HELP manawa_payments_amount_total Total payment amount today\n';
  output += '# TYPE manawa_payments_amount_total gauge\n';
  output += `manawa_payments_amount_total ${metrics.paymentsTotalAmountToday.toFixed(2)}\n\n`;

  output += '# HELP manawa_bookings_created_total Bookings created today\n';
  output += '# TYPE manawa_bookings_created_total counter\n';
  output += `manawa_bookings_created_total ${metrics.bookingsCreatedToday}\n\n`;

  output += '# HELP manawa_active_users_current Active users this hour\n';
  output += '# TYPE manawa_active_users_current gauge\n';
  output += `manawa_active_users_current ${metrics.activeUsersThisHour.size}\n\n`;

  output += '# HELP manawa_memory_heap_bytes Heap memory usage\n';
  output += '# TYPE manawa_memory_heap_bytes gauge\n';
  output += `manawa_memory_heap_bytes ${memoryUsage.heapUsed}\n\n`;

  output += '# HELP manawa_memory_rss_bytes RSS memory usage\n';
  output += '# TYPE manawa_memory_rss_bytes gauge\n';
  output += `manawa_memory_rss_bytes ${memoryUsage.rss}\n\n`;

  output += '# HELP manawa_memory_system_percent System memory usage percent\n';
  output += '# TYPE manawa_memory_system_percent gauge\n';
  output += `manawa_memory_system_percent ${memoryPercent.toFixed(2)}\n\n`;

  output += '# HELP manawa_uptime_seconds Server uptime in seconds\n';
  output += '# TYPE manawa_uptime_seconds gauge\n';
  output += `manawa_uptime_seconds ${process.uptime()}\n\n`;

  return output;
}

/**
 * Reset daily metrics
 */
function resetDailyMetrics() {
  metrics.paymentsProcessedToday = 0;
  metrics.paymentsFailedToday = 0;
  metrics.paymentsTotalAmountToday = 0;
  metrics.bookingsCreatedToday = 0;
  metrics.activeUsersThisHour.clear();
  metrics.quotesGeneratedToday = 0;
  metrics.conversionsToday = 0;
}

/**
 * Reset all metrics — used in tests to avoid singleton state leakage between test cases
 */
function resetAllMetrics() {
  metrics.requestCount = 0;
  metrics.requestsByMethod = {};
  metrics.requestsByRoute = {};
  metrics.requestsByStatus = {};
  metrics.totalResponseTime = 0;
  metrics.responseTimeByRoute = {};
  metrics.requestCountByRoute = {};
  metrics.errorCount = 0;
  metrics.errorsByType = {};
  metrics.errorsByRoute = {};
  metrics.dbQueryCount = 0;
  metrics.dbErrorCount = 0;
  metrics.dbConnectionPoolStatus = null;
  resetDailyMetrics();
  metrics.lastMetricsReset = new Date();
}

/**
 * Update alert thresholds
 */
function updateAlertThresholds(newThresholds) {
  Object.assign(alertThresholds, newThresholds);
  logger.info('Alert thresholds updated', { thresholds: alertThresholds });
}

/**
 * Get alert thresholds
 */
function getAlertThresholds() {
  return { ...alertThresholds };
}

module.exports = {
  recordRequest,
  recordError,
  recordDatabaseOperation,
  recordPayment,
  recordBooking,
  recordActiveUser,
  recordQuote,
  recordConversion,
  triggerAlert,
  getMetrics,
  getPrometheusMetrics,
  resetDailyMetrics,
  resetAllMetrics,
  updateAlertThresholds,
  getAlertThresholds,
};
