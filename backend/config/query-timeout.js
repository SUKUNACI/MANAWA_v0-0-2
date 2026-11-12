/**
 * Query Timeout Configuration for MANAWA Database
 * Defines timeout limits for individual queries and transactions
 *
 * Strategy:
 * - Per-query timeout: 30 seconds (prevent runaway queries)
 * - Lock timeout: 5 seconds (prevent deadlocks)
 * - Transaction timeout: 60 seconds (prevent long transactions)
 * - Read-heavy timeout: 10 seconds (for analytics)
 */

class QueryTimeoutConfig {
  constructor() {
    this.environment = process.env.NODE_ENV || 'development';
    this.isProduction = this.environment === 'production';
  }

  /**
   * Get query timeout settings (in milliseconds)
   */
  getQueryTimeouts() {
    return {
      // Standard database operation timeout
      default: {
        name: 'Default Query Timeout',
        milliseconds: 30000,
        seconds: 30,
        description: 'Standard timeout for most queries (SELECT, UPDATE, INSERT)',
        use_case: 'CRUD operations, simple queries',
      },

      // Short timeout for interactive responses
      interactive: {
        name: 'Interactive Query Timeout',
        milliseconds: 5000,
        seconds: 5,
        description: 'Short timeout for user-facing operations',
        use_case: 'API endpoints that must respond quickly',
      },

      // Long timeout for background/batch operations
      batch: {
        name: 'Batch Query Timeout',
        milliseconds: 120000,
        seconds: 120,
        description: 'Extended timeout for batch/bulk operations',
        use_case: 'Data migrations, mass updates, imports',
      },

      // Timeout for analytics queries (can be expensive)
      analytics: {
        name: 'Analytics Query Timeout',
        milliseconds: 60000,
        seconds: 60,
        description: 'Timeout for complex analytics and reporting queries',
        use_case: 'Dashboard queries, reports, aggregations',
      },

      // Timeout for read replicas (slightly more generous)
      readReplica: {
        name: 'Read Replica Timeout',
        milliseconds: 45000,
        seconds: 45,
        description: 'Timeout for queries against read replicas',
        use_case: 'Non-critical reads, reporting',
      },
    };
  }

  /**
   * Get lock timeout settings (PostgreSQL-specific)
   * Prevents transactions from waiting indefinitely on row locks
   */
  getLockTimeouts() {
    return {
      // Row-level lock timeout
      rowLock: {
        name: 'Row Lock Timeout',
        milliseconds: 5000,
        seconds: 5,
        sql: "SET lock_timeout = '5s'",
        description: 'Max time to wait for row lock acquisition',
        use_case: 'Prevent deadlocks on concurrent updates',
      },

      // Statement-level lock timeout
      statementLock: {
        name: 'Statement Lock Timeout',
        milliseconds: 10000,
        seconds: 10,
        sql: "SET statement_timeout = '10s'",
        description: 'Max time for a single statement to execute',
        use_case: 'Prevent slow queries from blocking others',
      },

      // Transaction-level lock timeout
      transactionLock: {
        name: 'Transaction Lock Timeout',
        milliseconds: 30000,
        seconds: 30,
        sql: "SET transaction_isolation = 'read_committed'; SET lock_timeout = '30s'",
        description: 'Max time transaction can hold locks',
        use_case: 'Long-running transactions',
      },

      // Deadlock detection timeout
      deadlockDetection: {
        name: 'Deadlock Detection Timeout',
        milliseconds: 1000,
        seconds: 1,
        sql: "SET deadlock_timeout = '1s'",
        description: 'Time before PostgreSQL checks for deadlocks',
        use_case: 'Automatic deadlock detection and victim selection',
      },
    };
  }

  /**
   * Get transaction timeout settings
   */
  getTransactionTimeouts() {
    return {
      // Standard transaction timeout
      default: {
        name: 'Default Transaction Timeout',
        milliseconds: 60000,
        seconds: 60,
        description: 'Standard timeout for transactions',
        use_case: 'Multi-statement transactions',
      },

      // Quick transaction timeout
      quick: {
        name: 'Quick Transaction Timeout',
        milliseconds: 10000,
        seconds: 10,
        description: 'Timeout for quick transactional operations',
        use_case: 'User registrations, order processing',
      },

      // Long-running transaction timeout
      longRunning: {
        name: 'Long-Running Transaction Timeout',
        milliseconds: 300000,
        seconds: 300,
        description: 'Timeout for explicitly long-running transactions',
        use_case: 'Data migrations, batch processing',
      },
    };
  }

  /**
   * Apply timeout settings to a Prisma client
   * Must be called after creating a transaction
   */
  async applyTimeoutToPrismaTransaction(prismaTx, timeoutMs = 30000) {
    try {
      // Set statement timeout for this session
      await prismaTx.$executeRaw`SET statement_timeout TO ${timeoutMs}`;
      await prismaTx.$executeRaw`SET lock_timeout TO ${Math.min(timeoutMs / 2, 5000)}`;
      return true;
    } catch (err) {
      console.error('[Query Timeout] Failed to apply timeout:', err.message);
      return false;
    }
  }

  /**
   * Middleware wrapper to enforce query timeouts
   * Returns middleware function for Express routes
   */
  timeoutMiddleware(timeoutMs = 30000) {
    return (req, res, next) => {
      // Store timeout in request context for route handlers to use
      req.queryTimeout = timeoutMs;
      req.queryTimeoutSeconds = timeoutMs / 1000;

      // Set response timeout as well
      res.setTimeout(timeoutMs + 5000, () => {
        res.status(408).json({
          error: 'Request timeout',
          message: `Request exceeded ${req.queryTimeoutSeconds}s timeout`,
        });
      });

      next();
    };
  }

  /**
   * Get timeout recommendations by operation type
   */
  getTimeoutRecommendations() {
    return {
      'User Authentication': {
        query_timeout: 5000,
        lock_timeout: 3000,
        reason: 'Must be fast for user experience',
      },
      'Profile Lookup': {
        query_timeout: 3000,
        lock_timeout: 2000,
        reason: 'Read-only, should be cached',
      },
      'Project Creation': {
        query_timeout: 10000,
        lock_timeout: 5000,
        reason: 'Involves writes, some contention expected',
      },
      'Quote Processing': {
        query_timeout: 15000,
        lock_timeout: 8000,
        reason: 'Multiple related record updates',
      },
      'Payment Processing': {
        query_timeout: 20000,
        lock_timeout: 10000,
        reason: 'Critical business operation, needs careful handling',
      },
      'Booking Confirmation': {
        query_timeout: 15000,
        lock_timeout: 8000,
        reason: 'Temporal constraints, availability slots',
      },
      'Analytics Query': {
        query_timeout: 60000,
        lock_timeout: 30000,
        reason: 'Complex aggregations, can take time',
      },
      'Backup Operation': {
        query_timeout: 300000,
        lock_timeout: 60000,
        reason: 'Long-running operation, read snapshot',
      },
      'Data Migration': {
        query_timeout: 600000,
        lock_timeout: 120000,
        reason: 'Bulk operations, highest time allowance',
      },
      'Report Generation': {
        query_timeout: 120000,
        lock_timeout: 60000,
        reason: 'Can involve large datasets',
      },
    };
  }

  /**
   * Get SQL to set all timeout parameters
   */
  getTimeoutSetupSQL(timeoutMs = 30000, lockTimeoutMs = 5000) {
    return `
      SET statement_timeout = ${timeoutMs};
      SET lock_timeout = ${lockTimeoutMs};
      SET idle_in_transaction_session_timeout = ${timeoutMs};
    `;
  }

  /**
   * Monitor query performance and timeout occurrences
   */
  async monitorQueryPerformance(prisma) {
    try {
      const result = await prisma.$queryRaw`
        SELECT
          query,
          calls,
          total_time,
          mean_time,
          max_time,
          rows,
          CASE
            WHEN mean_time > 30000 THEN 'SLOW'
            WHEN mean_time > 10000 THEN 'MODERATE'
            ELSE 'FAST'
          END as performance_category
        FROM pg_stat_statements
        WHERE query NOT LIKE '%pg_stat_statements%'
        ORDER BY total_time DESC
        LIMIT 20
      `;
      return result;
    } catch (err) {
      console.error('[Query Monitor] Failed to get statistics:', err.message);
      return [];
    }
  }

  /**
   * Get deadlock recovery strategy
   */
  getDeadlockRecoveryStrategy() {
    return {
      detection: 'PostgreSQL detects via deadlock_timeout parameter (1-5s)',
      victim_selection: 'PostgreSQL kills the transaction causing least work loss',
      retry_strategy: {
        max_retries: 3,
        initial_backoff_ms: 100,
        backoff_multiplier: 2,
        max_backoff_ms: 1000,
        total_retry_time: '~1.3 seconds',
      },
      prevention: [
        'Acquire locks in consistent order (by table name)',
        'Keep transactions short',
        'Use lower isolation levels when safe',
        'Implement optimistic locking with version numbers',
      ],
    };
  }
}

module.exports = new QueryTimeoutConfig();
