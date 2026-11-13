/**
 * Tests for monitoring.js
 * Tests all exported functions: recordRequest, recordError, recordDatabaseOperation,
 * recordPayment, recordBooking, recordActiveUser, recordQuote, recordConversion,
 * triggerAlert, getMetrics, getPrometheusMetrics, resetDailyMetrics, resetAllMetrics,
 * updateAlertThresholds, getAlertThresholds
 */

jest.mock('../../config/db', () => ({
  $queryRaw: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Monitoring', () => {
  let monitoring;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    monitoring = require('../../utils/monitoring');
    // Always start from clean slate
    monitoring.resetAllMetrics();
  });

  // ─────────────────────────────────────────────
  // Exports
  // ─────────────────────────────────────────────
  describe('Exports', () => {
    const expectedFunctions = [
      'recordRequest',
      'recordError',
      'recordDatabaseOperation',
      'recordPayment',
      'recordBooking',
      'recordActiveUser',
      'recordQuote',
      'recordConversion',
      'triggerAlert',
      'getMetrics',
      'getPrometheusMetrics',
      'resetDailyMetrics',
      'resetAllMetrics',
      'updateAlertThresholds',
      'getAlertThresholds',
    ];

    expectedFunctions.forEach(fn => {
      it(`should export ${fn}`, () => {
        expect(typeof monitoring[fn]).toBe('function');
      });
    });
  });

  // ─────────────────────────────────────────────
  // recordRequest
  // ─────────────────────────────────────────────
  describe('recordRequest', () => {
    it('should increment requestCount', () => {
      // Arrange
      const req = { method: 'GET', path: '/api/test' };
      const res = { statusCode: 200 };

      // Act
      monitoring.recordRequest(req, res, 100);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.requests.total).toBe(1);
    });

    it('should track requests by method', () => {
      // Arrange
      const req = { method: 'POST', path: '/api/items' };
      const res = { statusCode: 201 };

      // Act
      monitoring.recordRequest(req, res, 50);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.requests.byMethod['POST']).toBe(1);
    });

    it('should track requests by route', () => {
      // Arrange
      const req = { method: 'GET', route: { path: '/api/users' }, path: '/api/users' };
      const res = { statusCode: 200 };

      // Act
      monitoring.recordRequest(req, res, 80);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.requests.byRoute['/api/users']).toBe(1);
    });

    it('should use req.path as fallback when route is missing', () => {
      // Arrange
      const req = { method: 'GET', path: '/fallback-path' };
      const res = { statusCode: 200 };

      // Act
      monitoring.recordRequest(req, res, 60);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.requests.byRoute['/fallback-path']).toBe(1);
    });

    it('should track requests by status code', () => {
      // Arrange
      const req = { method: 'GET', path: '/api/test' };
      const res = { statusCode: 404 };

      // Act
      monitoring.recordRequest(req, res, 30);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.requests.byStatus[404]).toBe(1);
    });

    it('should record client error (4xx) as CLIENT_ERROR type', () => {
      // Arrange
      const req = { method: 'GET', path: '/api/test' };
      const res = { statusCode: 400 };

      // Act
      monitoring.recordRequest(req, res, 30);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.errors.byType['CLIENT_ERROR']).toBeGreaterThanOrEqual(1);
    });

    it('should record server error (5xx) as SERVER_ERROR type', () => {
      // Arrange
      const req = { method: 'POST', path: '/api/test' };
      const res = { statusCode: 500 };

      // Act
      monitoring.recordRequest(req, res, 200);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.errors.byType['SERVER_ERROR']).toBeGreaterThanOrEqual(1);
    });

    it('should compute route min/max response times correctly', () => {
      // Arrange
      const req = { method: 'GET', path: '/route' };
      const res = { statusCode: 200 };

      // Act
      monitoring.recordRequest(req, res, 100);
      monitoring.recordRequest(req, res, 300);
      monitoring.recordRequest(req, res, 50);

      // Assert
      const m = monitoring.getMetrics();
      const routeMetric = m.requests.routeMetrics['/route'];
      expect(routeMetric.maxTime).toBe(300);
      expect(routeMetric.minTime).toBe(50);
      expect(routeMetric.count).toBe(3);
    });

    it('should use UNKNOWN when req.method is missing', () => {
      // Arrange
      const req = { path: '/api/test' };
      const res = { statusCode: 200 };

      // Act
      monitoring.recordRequest(req, res, 10);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.requests.byMethod['UNKNOWN']).toBe(1);
    });
  });

  // ─────────────────────────────────────────────
  // recordError
  // ─────────────────────────────────────────────
  describe('recordError', () => {
    it('should increment errorCount', () => {
      // Act
      monitoring.recordError('CUSTOM_ERROR', { route: '/api/test' });

      // Assert
      const m = monitoring.getMetrics();
      expect(m.errors.total).toBe(1);
    });

    it('should track errors by type', () => {
      // Act
      monitoring.recordError('DB_ERROR', {});
      monitoring.recordError('DB_ERROR', {});
      monitoring.recordError('TIMEOUT', {});

      // Assert
      const m = monitoring.getMetrics();
      expect(m.errors.byType['DB_ERROR']).toBe(2);
      expect(m.errors.byType['TIMEOUT']).toBe(1);
    });

    it('should track errors by route', () => {
      // Act
      monitoring.recordError('API_ERROR', { route: '/api/payments' });

      // Assert
      const m = monitoring.getMetrics();
      expect(m.errors.byRoute['/api/payments']).toBe(1);
    });

    it('should use "unknown" as route fallback when errorDetails is empty', () => {
      // Act
      monitoring.recordError('GENERIC_ERROR');

      // Assert
      const m = monitoring.getMetrics();
      expect(m.errors.byRoute['unknown']).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────
  // recordDatabaseOperation
  // ─────────────────────────────────────────────
  describe('recordDatabaseOperation', () => {
    it('should increment dbQueryCount on success', () => {
      // Act
      monitoring.recordDatabaseOperation(true, 50, 'SELECT');

      // Assert
      const m = monitoring.getMetrics();
      expect(m.database.queryCount).toBe(1);
      expect(m.database.errorCount).toBe(0);
    });

    it('should increment dbErrorCount on failure', () => {
      // Act
      monitoring.recordDatabaseOperation(false, 100, 'INSERT');

      // Assert
      const m = monitoring.getMetrics();
      expect(m.database.queryCount).toBe(1);
      expect(m.database.errorCount).toBe(1);
    });

    it('should use defaults when called with no arguments', () => {
      // Act
      monitoring.recordDatabaseOperation();

      // Assert
      const m = monitoring.getMetrics();
      expect(m.database.queryCount).toBe(1);
      expect(m.database.errorCount).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // recordPayment
  // ─────────────────────────────────────────────
  describe('recordPayment', () => {
    it('should increment paymentsProcessedToday on succeeded', () => {
      // Act
      monitoring.recordPayment(100.0, 'succeeded');

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.payments.processed).toBe(1);
      expect(Number(m.business.payments.totalAmount)).toBeCloseTo(100.0);
    });

    it('should increment paymentsFailedToday on failed', () => {
      // Act
      monitoring.recordPayment(50.0, 'failed');

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.payments.failed).toBe(1);
    });

    it('should compute failure rate correctly', () => {
      // Act
      monitoring.recordPayment(100, 'succeeded');
      monitoring.recordPayment(100, 'succeeded');
      monitoring.recordPayment(100, 'failed');

      // Assert
      const m = monitoring.getMetrics();
      const rate = parseFloat(m.business.payments.failureRate);
      expect(rate).toBeCloseTo(33.33, 1);
    });

    it('should not alter totals for unrecognized status', () => {
      // Act
      monitoring.recordPayment(200, 'pending');

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.payments.processed).toBe(0);
      expect(m.business.payments.failed).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // recordBooking
  // ─────────────────────────────────────────────
  describe('recordBooking', () => {
    it('should increment bookingsCreatedToday', () => {
      // Act
      monitoring.recordBooking();
      monitoring.recordBooking();

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.bookings).toBe(2);
    });
  });

  // ─────────────────────────────────────────────
  // recordActiveUser
  // ─────────────────────────────────────────────
  describe('recordActiveUser', () => {
    it('should count unique active users', () => {
      // Act
      monitoring.recordActiveUser('user-1');
      monitoring.recordActiveUser('user-2');
      monitoring.recordActiveUser('user-1'); // duplicate

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.activeUsers).toBe(2);
    });

    it('should not add null/undefined userId', () => {
      // Act
      monitoring.recordActiveUser(null);
      monitoring.recordActiveUser(undefined);

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.activeUsers).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // recordQuote
  // ─────────────────────────────────────────────
  describe('recordQuote', () => {
    it('should increment quotesGeneratedToday', () => {
      // Act
      monitoring.recordQuote();
      monitoring.recordQuote();
      monitoring.recordQuote();

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.quotes).toBe(3);
    });
  });

  // ─────────────────────────────────────────────
  // recordConversion
  // ─────────────────────────────────────────────
  describe('recordConversion', () => {
    it('should increment conversionsToday', () => {
      // Act
      monitoring.recordConversion();

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.conversions).toBe(1);
    });
  });

  // ─────────────────────────────────────────────
  // triggerAlert
  // ─────────────────────────────────────────────
  describe('triggerAlert', () => {
    it('should add alert to activeAlerts', () => {
      // Act
      monitoring.triggerAlert('HIGH_LATENCY', { route: '/api/test', value: 5000 });

      // Assert
      const m = monitoring.getMetrics();
      const activeAlert = m.alerts.active.find(a => a.alertType === 'HIGH_LATENCY');
      expect(activeAlert).toBeDefined();
      expect(activeAlert.status).toBe('active');
    });

    it('should not create duplicate alert within 5 minutes', () => {
      // Act
      monitoring.triggerAlert('DUPLICATE_ALERT', { count: 1 });
      monitoring.triggerAlert('DUPLICATE_ALERT', { count: 2 });

      // Assert
      const m = monitoring.getMetrics();
      const duplicates = m.alerts.active.filter(a => a.alertType === 'DUPLICATE_ALERT');
      expect(duplicates.length).toBe(1);
    });

    it('should log warning via logger', () => {
      // Arrange
      const logger = require('../../utils/logger');

      // Act
      monitoring.triggerAlert('TEST_ALERT', { foo: 'bar' });

      // Assert
      expect(logger.warn).toHaveBeenCalledWith(
        'ALERT: TEST_ALERT',
        expect.objectContaining({ foo: 'bar' })
      );
    });
  });

  // ─────────────────────────────────────────────
  // getMetrics
  // ─────────────────────────────────────────────
  describe('getMetrics', () => {
    it('should return complete metrics structure', () => {
      // Act
      const m = monitoring.getMetrics();

      // Assert
      expect(m).toHaveProperty('requests');
      expect(m).toHaveProperty('errors');
      expect(m).toHaveProperty('database');
      expect(m).toHaveProperty('business');
      expect(m).toHaveProperty('system');
      expect(m).toHaveProperty('alerts');
      expect(m).toHaveProperty('timestamp');
    });

    it('should compute avgResponseTime as 0 when no requests', () => {
      // Act
      const m = monitoring.getMetrics();

      // Assert
      expect(Number(m.requests.avgResponseTime)).toBe(0);
    });

    it('should compute error rate correctly', () => {
      // Arrange
      monitoring.recordRequest(
        { method: 'GET', path: '/ok' },
        { statusCode: 200 },
        100
      );
      monitoring.recordError('TEST_ERR', { route: '/bad' });

      // Act
      const m = monitoring.getMetrics();

      // Assert
      expect(m.errors.rate).toContain('%');
    });

    it('should include system memory info', () => {
      // Act
      const m = monitoring.getMetrics();

      // Assert
      expect(m.system.memory).toHaveProperty('heapUsed');
      expect(m.system.memory).toHaveProperty('rss');
    });
  });

  // ─────────────────────────────────────────────
  // getPrometheusMetrics
  // ─────────────────────────────────────────────
  describe('getPrometheusMetrics', () => {
    it('should return a string', () => {
      // Act
      const output = monitoring.getPrometheusMetrics();

      // Assert
      expect(typeof output).toBe('string');
    });

    it('should contain prometheus metric names', () => {
      // Act
      const output = monitoring.getPrometheusMetrics();

      // Assert
      expect(output).toContain('manawa_http_requests_total');
      expect(output).toContain('manawa_errors_total');
      expect(output).toContain('manawa_db_queries_total');
    });

    it('should contain HELP and TYPE lines', () => {
      // Act
      const output = monitoring.getPrometheusMetrics();

      // Assert
      expect(output).toContain('# HELP');
      expect(output).toContain('# TYPE');
    });

    it('should reflect current metric values', () => {
      // Arrange
      monitoring.recordBooking();
      monitoring.recordBooking();

      // Act
      const output = monitoring.getPrometheusMetrics();

      // Assert
      expect(output).toContain('manawa_bookings_created_total 2');
    });
  });

  // ─────────────────────────────────────────────
  // resetDailyMetrics
  // ─────────────────────────────────────────────
  describe('resetDailyMetrics', () => {
    it('should reset all daily business counters to 0', () => {
      // Arrange
      monitoring.recordPayment(100, 'succeeded');
      monitoring.recordBooking();
      monitoring.recordQuote();
      monitoring.recordConversion();
      monitoring.recordActiveUser('user-1');

      // Act
      monitoring.resetDailyMetrics();

      // Assert
      const m = monitoring.getMetrics();
      expect(m.business.payments.processed).toBe(0);
      expect(m.business.bookings).toBe(0);
      expect(m.business.quotes).toBe(0);
      expect(m.business.conversions).toBe(0);
      expect(m.business.activeUsers).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // resetAllMetrics
  // ─────────────────────────────────────────────
  describe('resetAllMetrics', () => {
    it('should reset all metrics including request and error counts', () => {
      // Arrange
      monitoring.recordRequest(
        { method: 'GET', path: '/test' },
        { statusCode: 200 },
        100
      );
      monitoring.recordError('TEST', {});

      // Act
      monitoring.resetAllMetrics();

      // Assert
      const m = monitoring.getMetrics();
      expect(m.requests.total).toBe(0);
      expect(m.errors.total).toBe(0);
      expect(m.database.queryCount).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // updateAlertThresholds / getAlertThresholds
  // ─────────────────────────────────────────────
  describe('updateAlertThresholds / getAlertThresholds', () => {
    it('should update alert thresholds', () => {
      // Act
      monitoring.updateAlertThresholds({ errorRate: 10 });

      // Assert
      const thresholds = monitoring.getAlertThresholds();
      expect(thresholds.errorRate).toBe(10);
    });

    it('should return a copy of thresholds', () => {
      // Act
      const t1 = monitoring.getAlertThresholds();
      t1.errorRate = 999;
      const t2 = monitoring.getAlertThresholds();

      // Assert — mutation of returned object should not affect internal state
      expect(t2.errorRate).not.toBe(999);
    });

    it('should merge partial threshold updates without losing existing keys', () => {
      // Arrange
      monitoring.updateAlertThresholds({ apiResponseTime: 5000 });

      // Act
      const thresholds = monitoring.getAlertThresholds();

      // Assert
      expect(thresholds.apiResponseTime).toBe(5000);
      expect(thresholds.memoryUsage).toBeDefined();
    });
  });
});
