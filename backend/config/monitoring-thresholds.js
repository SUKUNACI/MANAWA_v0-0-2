/**
 * Q78: Monitoring Thresholds Configuration
 * Defines alert levels for automatic rollback decisions
 */

module.exports = {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Error Rate Thresholds
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  errorRate: {
    // Trigger automatic rollback if error rate exceeds 1% for 5 minutes
    CRITICAL_THRESHOLD: 1.0, // Percentage
    ALERT_THRESHOLD: 0.5,    // Percentage - send alert only
    MONITOR_WINDOW_MINUTES: 5, // Time window to evaluate
    MIN_REQUESTS_SAMPLE: 100, // Minimum requests to consider metric valid
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Latency Thresholds (P95)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  latency: {
    // Trigger rollback if P95 latency exceeds 3 seconds consistently
    CRITICAL_THRESHOLD_MS: 3000, // Milliseconds
    ALERT_THRESHOLD_MS: 1500,    // Milliseconds
    CRITICAL_WINDOW_MINUTES: 5,  // Time window for critical threshold
    ALERT_WINDOW_MINUTES: 10,    // Time window for alert threshold
    MIN_SAMPLES: 100, // Minimum samples to consider metric valid
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Memory Usage Thresholds
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  memory: {
    // Trigger rollback if memory usage exceeds 85% for 10 minutes
    CRITICAL_THRESHOLD_PERCENT: 85,
    ALERT_THRESHOLD_PERCENT: 75,
    CRITICAL_WINDOW_MINUTES: 10,
    ALERT_WINDOW_MINUTES: 15,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CPU Usage Thresholds
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cpu: {
    // Trigger alert if CPU exceeds 80% for extended period
    CRITICAL_THRESHOLD_PERCENT: 85,
    ALERT_THRESHOLD_PERCENT: 70,
    CRITICAL_WINDOW_MINUTES: 10,
    ALERT_WINDOW_MINUTES: 15,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Database Connection Pool
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  database: {
    // Alert if connection pool utilization exceeds threshold
    CONNECTION_POOL_WARNING_PERCENT: 80,
    CONNECTION_POOL_CRITICAL_PERCENT: 95,
    MAX_QUERY_TIME_MS: 30000, // Kill queries taking longer
    SLOW_QUERY_THRESHOLD_MS: 1000,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Cache Performance
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cache: {
    // Alert if cache hit rate drops below threshold
    MIN_HIT_RATE_PERCENT: 60,
    ALERT_WINDOW_MINUTES: 5,
    MIN_SAMPLES: 100,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Rollback Strategy Configuration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  rollback: {
    // Check metrics this often
    HEALTH_CHECK_INTERVAL_SECONDS: 10,

    // Only trigger rollback if conditions persist for this long
    CONFIRMATION_WINDOW_SECONDS: 30,

    // Maximum rollback frequency (prevent thrashing)
    MIN_INTERVAL_BETWEEN_ROLLBACKS_MINUTES: 30,

    // Auto-trigger conditions
    AUTO_ROLLBACK_ON_ERROR_SPIKE: true,
    AUTO_ROLLBACK_ON_LATENCY_SPIKE: false, // More conservative
    AUTO_ROLLBACK_ON_MEMORY_LEAK: true,

    // Notification recipients
    NOTIFICATION_EMAILS: process.env.ROLLBACK_ALERT_EMAILS?.split(',') || [],
    SLACK_WEBHOOK_URL: process.env.SLACK_ROLLBACK_WEBHOOK || null,
    SENTRY_ENABLED: true,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Backup Integrity Checks
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  backupIntegrity: {
    // Run hourly
    CHECK_INTERVAL_MINUTES: 60,

    // Timeout for each check
    CHECK_TIMEOUT_SECONDS: 300,

    // Verification levels
    VERIFY_FULL_BACKUP: true,
    VERIFY_INCREMENTAL: true,
    VERIFY_DATABASE_CONSISTENCY: true,
    VERIFY_FILESYSTEM_INTEGRITY: true,

    // Performance baselines
    EXPECTED_FULL_BACKUP_DURATION_SECONDS: 600,
    EXPECTED_INCREMENTAL_DURATION_SECONDS: 300,

    // Retention policy
    KEEP_FAILED_CHECKS_DAYS: 30,
    KEEP_SUCCESS_CHECKS_DAYS: 90,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Alert Escalation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  escalation: {
    LEVEL_1_DELAY_MINUTES: 1,    // First alert
    LEVEL_2_DELAY_MINUTES: 5,    // Escalate to team lead
    LEVEL_3_DELAY_MINUTES: 15,   // Escalate to CTO
    CRITICAL_DELAY_MINUTES: 0,   // Immediate for critical
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Utility Functions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Check if error rate warrants automatic rollback
   * @param {number} errorRate - Current error rate percentage
   * @param {number} durationMinutes - How long error rate has been elevated
   * @returns {boolean}
   */
  shouldRollbackOnErrorRate(errorRate, durationMinutes) {
    return (
      errorRate > this.errorRate.CRITICAL_THRESHOLD &&
      durationMinutes >= this.errorRate.MONITOR_WINDOW_MINUTES
    );
  },

  /**
   * Check if latency warrants automatic rollback
   * @param {number} latencyP95Ms - P95 latency in milliseconds
   * @param {number} durationMinutes - How long latency has been elevated
   * @returns {boolean}
   */
  shouldRollbackOnLatency(latencyP95Ms, durationMinutes) {
    if (!this.rollback.AUTO_ROLLBACK_ON_LATENCY_SPIKE) return false;
    return (
      latencyP95Ms > this.latency.CRITICAL_THRESHOLD_MS &&
      durationMinutes >= this.latency.CRITICAL_WINDOW_MINUTES
    );
  },

  /**
   * Check if memory usage warrants automatic rollback
   * @param {number} memoryPercent - Current memory usage percentage
   * @param {number} durationMinutes - How long memory has been elevated
   * @returns {boolean}
   */
  shouldRollbackOnMemory(memoryPercent, durationMinutes) {
    if (!this.rollback.AUTO_ROLLBACK_ON_MEMORY_LEAK) return false;
    return (
      memoryPercent > this.memory.CRITICAL_THRESHOLD_PERCENT &&
      durationMinutes >= this.memory.CRITICAL_WINDOW_MINUTES
    );
  },

  /**
   * Determine alert level
   * @param {Object} metrics - Current system metrics
   * @returns {string} - 'OK' | 'ALERT' | 'CRITICAL'
   */
  getAlertLevel(metrics = {}) {
    const { errorRate = 0, latencyP95Ms = 0, memoryPercent = 0 } = metrics;

    if (
      errorRate > this.errorRate.CRITICAL_THRESHOLD ||
      latencyP95Ms > this.latency.CRITICAL_THRESHOLD_MS ||
      memoryPercent > this.memory.CRITICAL_THRESHOLD_PERCENT
    ) {
      return 'CRITICAL';
    }

    if (
      errorRate > this.errorRate.ALERT_THRESHOLD ||
      latencyP95Ms > this.latency.ALERT_THRESHOLD_MS ||
      memoryPercent > this.memory.ALERT_THRESHOLD_PERCENT
    ) {
      return 'ALERT';
    }

    return 'OK';
  },
};
