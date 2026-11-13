/**
 * Tests for routes/monitoring.js
 * Covers: GET /health, GET /metrics, GET /admin/monitoring, GET /admin/alerts,
 *         POST /admin/alerts/config, GET /admin/alerts/config,
 *         GET /admin/performance/top-routes, GET /admin/performance/database,
 *         GET /admin/business/metrics, POST /admin/monitoring/reset
 * No prior tests (0% coverage).
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

jest.mock('../../utils/health-check', () => ({
  checkDatabaseHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
}));

jest.mock('../../utils/monitoring', () => ({
  getPrometheusMetrics: jest.fn().mockReturnValue('# metrics\nup 1\n'),
  getMetrics: jest.fn().mockReturnValue({
    system: {
      uptime: '1.00',
      memory: { heapUsed: '50 MB', heapTotal: '100 MB', systemMemoryPercent: 60 },
      cpu: { user: 0, system: 0 },
    },
    requests: {
      total: 100,
      avgResponseTime: '25ms',
      byRoute: {},
      routeMetrics: {},
    },
    errors: {
      total: 2,
      rate: 0.02,
      byType: { TypeError: 1, Error: 1 },
      byRoute: {},
    },
    database: { queryCount: 50, errorCount: 0, errorRate: 0 },
    business: {
      payments: { processed: 10, failed: 1, totalAmount: 500000, failureRate: 0.1 },
      bookings: 5,
      activeUsers: 20,
      quotes: 15,
      conversions: 3,
    },
    alerts: { active: [], thresholds: {} },
  }),
  updateAlertThresholds: jest.fn(),
  getAlertThresholds: jest.fn().mockReturnValue({ errorRate: 5, apiResponseTime: 2000 }),
  resetDailyMetrics: jest.fn(),
}));

jest.mock('../../config/db', () => ({
  appConfig: {
    upsert: jest.fn().mockResolvedValue({ key: 'alert_thresholds', value: '{}' }),
  },
}));

const monitoringRoutes = require('../../routes/monitoring');

const app = express();
app.use(express.json());
app.use('/', monitoringRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

describe('Monitoring Routes (routes/monitoring.js)', () => {
  describe('GET /health', () => {
    it('should return 200 with healthy status', async () => {
      const { checkDatabaseHealth } = require('../../utils/health-check');
      checkDatabaseHealth.mockResolvedValueOnce({ status: 'healthy' });
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.services).toBeDefined();
      expect(res.body.memory).toBeDefined();
    });

    it('should return 503 when database is unhealthy', async () => {
      const { checkDatabaseHealth } = require('../../utils/health-check');
      checkDatabaseHealth.mockResolvedValueOnce({ status: 'unhealthy' });
      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
    });

    it('should return 503 on health check exception', async () => {
      const { checkDatabaseHealth } = require('../../utils/health-check');
      checkDatabaseHealth.mockRejectedValueOnce(new Error('DB unavailable'));
      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus text format', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('up 1');
    });
  });

  describe('GET /admin/monitoring', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/admin/monitoring');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin token', async () => {
      const res = await request(app)
        .get('/admin/monitoring')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 for admin', async () => {
      const { checkDatabaseHealth } = require('../../utils/health-check');
      checkDatabaseHealth.mockResolvedValueOnce({ status: 'healthy' });
      const res = await request(app)
        .get('/admin/monitoring')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.performance).toBeDefined();
      expect(res.body.business).toBeDefined();
    });
  });

  describe('GET /admin/alerts', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/admin/alerts');
      expect(res.status).toBe(401);
    });

    it('should return 200 for admin', async () => {
      const res = await request(app)
        .get('/admin/alerts')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.active).toBeDefined();
    });
  });

  describe('POST /admin/alerts/config', () => {
    it('should return 401 without token', async () => {
      const res = await request(app)
        .post('/admin/alerts/config')
        .send({ errorRate: 5 });
      expect(res.status).toBe(401);
    });

    it('should return 400 when no valid thresholds provided', async () => {
      const res = await request(app)
        .post('/admin/alerts/config')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ invalidField: 'value' });
      expect(res.status).toBe(400);
    });

    it('should return 200 for valid thresholds', async () => {
      const res = await request(app)
        .post('/admin/alerts/config')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ errorRate: 10, apiResponseTime: 3000 });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('updated');
    });

    it('should continue even if DB persistence fails', async () => {
      const prisma = require('../../config/db');
      prisma.appConfig.upsert.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .post('/admin/alerts/config')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ errorRate: 5 });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /admin/alerts/config', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/admin/alerts/config');
      expect(res.status).toBe(401);
    });

    it('should return 200 with thresholds for admin', async () => {
      const res = await request(app)
        .get('/admin/alerts/config')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.thresholds).toBeDefined();
    });
  });

  describe('GET /admin/performance/top-routes', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/admin/performance/top-routes');
      expect(res.status).toBe(401);
    });

    it('should return 200 for admin', async () => {
      const res = await request(app)
        .get('/admin/performance/top-routes')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.slowestRoutes).toBeDefined();
      expect(res.body.mostErrorProneRoutes).toBeDefined();
    });
  });

  describe('GET /admin/performance/database', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/admin/performance/database');
      expect(res.status).toBe(401);
    });

    it('should return 200 for admin', async () => {
      const { checkDatabaseHealth } = require('../../utils/health-check');
      checkDatabaseHealth.mockResolvedValueOnce({ status: 'healthy' });
      const res = await request(app)
        .get('/admin/performance/database')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.queries).toBeDefined();
      expect(res.body.health).toBeDefined();
    });
  });

  describe('GET /admin/business/metrics', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/admin/business/metrics');
      expect(res.status).toBe(401);
    });

    it('should return 200 for admin', async () => {
      const res = await request(app)
        .get('/admin/business/metrics')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.payments).toBeDefined();
      expect(res.body.conversionRate).toBeDefined();
    });

    it('should return 0% conversion rate when no bookings', async () => {
      const monitoring = require('../../utils/monitoring');
      monitoring.getMetrics.mockReturnValueOnce({
        ...monitoring.getMetrics(),
        business: {
          payments: { processed: 0, failed: 0, totalAmount: 0, failureRate: 0 },
          bookings: 0,
          activeUsers: 0,
          quotes: 0,
          conversions: 0,
        },
      });
      const res = await request(app)
        .get('/admin/business/metrics')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.conversionRate).toBe('0%');
    });
  });

  describe('POST /admin/monitoring/reset', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).post('/admin/monitoring/reset');
      expect(res.status).toBe(401);
    });

    it('should return 200 and reset metrics for admin', async () => {
      const monitoring = require('../../utils/monitoring');
      const res = await request(app)
        .post('/admin/monitoring/reset')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('reset');
      expect(monitoring.resetDailyMetrics).toHaveBeenCalled();
    });
  });
});
