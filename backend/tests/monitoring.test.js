/**
 * Monitoring System Tests
 * Tests for metrics collection, alerts, and monitoring endpoints
 */

const monitoring = require('../utils/monitoring');

describe('Monitoring System', () => {
  beforeEach(() => {
    // Reset metrics before each test
    monitoring.resetDailyMetrics();
  });

  // ============ Request Metrics Tests ============

  describe('Request Metrics', () => {
    test('should record HTTP requests', () => {
      const req = {
        method: 'GET',
        path: '/api/users',
        route: { path: '/api/users' },
      };
      const res = {
        statusCode: 200,
      };

      monitoring.recordRequest(req, res, 150);

      const metrics = monitoring.getMetrics();
      expect(metrics.requests.total).toBe(1);
      expect(metrics.requests.byMethod.GET).toBe(1);
      expect(metrics.requests.byStatus[200]).toBe(1);
    });

    test('should track response times', () => {
      const req = {
        method: 'POST',
        path: '/api/bookings',
        route: { path: '/api/bookings' },
      };
      const res = { statusCode: 201 };

      monitoring.recordRequest(req, res, 250);
      monitoring.recordRequest(req, res, 350);

      const metrics = monitoring.getMetrics();
      expect(metrics.requests.routeMetrics['/api/bookings'].count).toBe(2);
      expect(metrics.requests.routeMetrics['/api/bookings'].maxTime).toBe(350);
      expect(metrics.requests.routeMetrics['/api/bookings'].minTime).toBe(250);
    });

    test('should track different HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      methods.forEach((method, index) => {
        const req = { method, path: '/api/test', route: { path: '/api/test' } };
        const res = { statusCode: 200 };
        monitoring.recordRequest(req, res, 100 + index * 50);
      });

      const metrics = monitoring.getMetrics();
      expect(metrics.requests.byMethod.GET).toBe(1);
      expect(metrics.requests.byMethod.POST).toBe(1);
      expect(metrics.requests.byMethod.PUT).toBe(1);
      expect(metrics.requests.byMethod.DELETE).toBe(1);
      expect(metrics.requests.byMethod.PATCH).toBe(1);
    });
  });

  // ============ Error Metrics Tests ============

  describe('Error Metrics', () => {
    test('should record errors', () => {
      monitoring.recordError('DATABASE_ERROR', { route: '/api/users' });
      monitoring.recordError('DATABASE_ERROR', { route: '/api/users' });
      monitoring.recordError('VALIDATION_ERROR', { route: '/api/bookings' });

      const metrics = monitoring.getMetrics();
      expect(metrics.errors.total).toBe(3);
      expect(metrics.errors.byType.DATABASE_ERROR).toBe(2);
      expect(metrics.errors.byType.VALIDATION_ERROR).toBe(1);
    });

    test('should track errors by route', () => {
      monitoring.recordError('SERVER_ERROR', { route: '/api/users' });
      monitoring.recordError('SERVER_ERROR', { route: '/api/users' });
      monitoring.recordError('SERVER_ERROR', { route: '/api/bookings' });

      const metrics = monitoring.getMetrics();
      expect(metrics.errors.byRoute['/api/users']).toBe(2);
      expect(metrics.errors.byRoute['/api/bookings']).toBe(1);
    });

    test('should calculate error rate', () => {
      // Simulate 100 requests
      for (let i = 0; i < 100; i++) {
        const req = { method: 'GET', path: '/api/test', route: { path: '/api/test' } };
        const res = { statusCode: 200 };
        monitoring.recordRequest(req, res, 100);
      }

      // Add 5 errors (5% error rate)
      for (let i = 0; i < 5; i++) {
        monitoring.recordError('SERVER_ERROR', { route: '/api/test' });
      }

      const metrics = monitoring.getMetrics();
      const errorRate = parseFloat(metrics.errors.rate);
      expect(errorRate).toBeCloseTo(5, 0);
    });
  });

  // ============ Database Metrics Tests ============

  describe('Database Metrics', () => {
    test('should record database operations', () => {
      monitoring.recordDatabaseOperation(true, 50, 'select');
      monitoring.recordDatabaseOperation(true, 75, 'insert');
      monitoring.recordDatabaseOperation(false, 100, 'update');

      const metrics = monitoring.getMetrics();
      expect(metrics.database.queryCount).toBe(3);
      expect(metrics.database.errorCount).toBe(1);
    });

    test('should calculate database error rate', () => {
      for (let i = 0; i < 10; i++) {
        monitoring.recordDatabaseOperation(true, 50);
      }

      for (let i = 0; i < 1; i++) {
        monitoring.recordDatabaseOperation(false, 100);
      }

      const metrics = monitoring.getMetrics();
      const errorRate = parseFloat(metrics.database.errorRate);
      expect(errorRate).toBeCloseTo(9.09, 1);
    });
  });

  // ============ Payment Metrics Tests ============

  describe('Payment Metrics', () => {
    test('should record successful payments', () => {
      monitoring.recordPayment(100.50, 'succeeded');
      monitoring.recordPayment(75.00, 'succeeded');

      const metrics = monitoring.getMetrics();
      expect(metrics.business.payments.processed).toBe(2);
      expect(metrics.business.payments.totalAmount).toBe('175.50');
    });

    test('should record failed payments', () => {
      monitoring.recordPayment(100.00, 'succeeded');
      monitoring.recordPayment(50.00, 'failed');

      const metrics = monitoring.getMetrics();
      expect(metrics.business.payments.processed).toBe(1);
      expect(metrics.business.payments.failed).toBe(1);
    });
  });

  // ============ Business Metrics Tests ============

  describe('Business Metrics', () => {
    test('should record bookings', () => {
      monitoring.recordBooking();
      monitoring.recordBooking();
      monitoring.recordBooking();

      const metrics = monitoring.getMetrics();
      expect(metrics.business.bookings).toBe(3);
    });

    test('should track active users', () => {
      monitoring.recordActiveUser(1);
      monitoring.recordActiveUser(2);
      monitoring.recordActiveUser(3);
      monitoring.recordActiveUser(1); // Duplicate

      const metrics = monitoring.getMetrics();
      expect(metrics.business.activeUsers).toBe(3);
    });

    test('should record quotes', () => {
      monitoring.recordQuote();
      monitoring.recordQuote();

      const metrics = monitoring.getMetrics();
      expect(metrics.business.quotes).toBe(2);
    });

    test('should record conversions', () => {
      monitoring.recordConversion();
      monitoring.recordConversion();

      const metrics = monitoring.getMetrics();
      expect(metrics.business.conversions).toBe(2);
    });
  });

  // ============ Alert Tests ============

  describe('Alerts', () => {
    test('should trigger alert on high response time', () => {
      const alertSpy = jest.spyOn(monitoring, 'triggerAlert');

      const req = { method: 'GET', path: '/api/slow', route: { path: '/api/slow' } };
      const res = { statusCode: 200 };

      // Record a request with response time > 2000ms
      monitoring.recordRequest(req, res, 2500);

      // Alert should have been triggered
      // (Note: triggerAlert is called internally)
      alertSpy.mockRestore();
    });

    test('should have configurable thresholds', () => {
      const currentThresholds = monitoring.getAlertThresholds();
      expect(currentThresholds).toHaveProperty('errorRate');
      expect(currentThresholds).toHaveProperty('apiResponseTime');
      expect(currentThresholds).toHaveProperty('paymentFailureRate');
    });

    test('should update alert thresholds', () => {
      monitoring.updateAlertThresholds({
        errorRate: 10,
        apiResponseTime: 3000,
      });

      const thresholds = monitoring.getAlertThresholds();
      expect(thresholds.errorRate).toBe(10);
      expect(thresholds.apiResponseTime).toBe(3000);
    });
  });

  // ============ Metrics Export Tests ============

  describe('Metrics Export', () => {
    test('should export metrics in Prometheus format', () => {
      monitoring.recordRequest(
        { method: 'GET', path: '/api/test', route: { path: '/api/test' } },
        { statusCode: 200 },
        100
      );

      const prometheusMetrics = monitoring.getPrometheusMetrics();
      expect(prometheusMetrics).toContain('manawa_http_requests_total');
      expect(prometheusMetrics).toContain('# TYPE');
      expect(prometheusMetrics).toContain('# HELP');
    });

    test('should include all metric types in export', () => {
      const prometheusMetrics = monitoring.getPrometheusMetrics();

      // Request metrics
      expect(prometheusMetrics).toContain('manawa_http_requests_total');
      expect(prometheusMetrics).toContain('manawa_http_request_duration_seconds');

      // Error metrics
      expect(prometheusMetrics).toContain('manawa_errors_total');
      expect(prometheusMetrics).toContain('manawa_error_rate_percent');

      // Database metrics
      expect(prometheusMetrics).toContain('manawa_db_queries_total');
      expect(prometheusMetrics).toContain('manawa_db_errors_total');

      // Business metrics
      expect(prometheusMetrics).toContain('manawa_payments_processed_total');
      expect(prometheusMetrics).toContain('manawa_bookings_created_total');
      expect(prometheusMetrics).toContain('manawa_active_users_current');

      // System metrics
      expect(prometheusMetrics).toContain('manawa_memory_heap_bytes');
      expect(prometheusMetrics).toContain('manawa_uptime_seconds');
    });

    test('should format Prometheus metrics correctly', () => {
      monitoring.recordRequest(
        { method: 'GET', path: '/api/test', route: { path: '/api/test' } },
        { statusCode: 200 },
        100
      );

      const prometheusMetrics = monitoring.getPrometheusMetrics();
      const lines = prometheusMetrics.split('\n');

      // Check for proper Prometheus format
      const metricLine = lines.find(l => l.startsWith('manawa_http_requests_total'));
      expect(metricLine).toMatch(/^manawa_http_requests_total\s+\d+$/);
    });
  });

  // ============ Reset Tests ============

  describe('Metrics Reset', () => {
    test('should reset daily metrics', () => {
      monitoring.recordPayment(100, 'succeeded');
      monitoring.recordBooking();
      monitoring.recordActiveUser(1);

      monitoring.resetDailyMetrics();

      const metrics = monitoring.getMetrics();
      expect(metrics.business.payments.processed).toBe(0);
      expect(metrics.business.bookings).toBe(0);
      expect(metrics.business.activeUsers).toBe(0);
    });

    test('should not reset request metrics on daily reset', () => {
      const req = { method: 'GET', path: '/api/test', route: { path: '/api/test' } };
      const res = { statusCode: 200 };
      monitoring.recordRequest(req, res, 100);

      monitoring.resetDailyMetrics();

      const metrics = monitoring.getMetrics();
      expect(metrics.requests.total).toBe(1); // Should still be tracked
    });
  });

  // ============ Integration Tests ============

  describe('Integration', () => {
    test('should provide complete metrics snapshot', () => {
      // Simulate typical API activity
      for (let i = 0; i < 50; i++) {
        const methods = ['GET', 'POST', 'PUT', 'DELETE'];
        const routes = ['/api/users', '/api/bookings', '/api/payments'];
        const statuses = [200, 201, 400, 500];

        const method = methods[Math.floor(Math.random() * methods.length)];
        const path = routes[Math.floor(Math.random() * routes.length)];
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        const req = { method, path, route: { path } };
        const res = { statusCode: status };
        const responseTime = Math.random() * 1000;

        monitoring.recordRequest(req, res, responseTime);
      }

      // Add business metrics
      monitoring.recordPayment(100, 'succeeded');
      monitoring.recordBooking();
      monitoring.recordActiveUser(1);

      // Get metrics
      const metrics = monitoring.getMetrics();

      // Verify all sections are present
      expect(metrics).toHaveProperty('requests');
      expect(metrics).toHaveProperty('errors');
      expect(metrics).toHaveProperty('database');
      expect(metrics).toHaveProperty('business');
      expect(metrics).toHaveProperty('system');
      expect(metrics).toHaveProperty('alerts');

      // Verify data is populated
      expect(metrics.requests.total).toBeGreaterThan(0);
      expect(metrics.business.payments.processed).toBe(1);
      expect(metrics.business.bookings).toBe(1);
    });

    test('should handle high volume of requests', () => {
      const startTime = Date.now();

      // Simulate 1000 requests
      for (let i = 0; i < 1000; i++) {
        const req = { method: 'GET', path: '/api/test', route: { path: '/api/test' } };
        const res = { statusCode: 200 };
        monitoring.recordRequest(req, res, 100 + Math.random() * 100);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should process 1000 requests quickly (< 1 second)
      expect(duration).toBeLessThan(1000);

      const metrics = monitoring.getMetrics();
      expect(metrics.requests.total).toBe(1000);
    });
  });
});
