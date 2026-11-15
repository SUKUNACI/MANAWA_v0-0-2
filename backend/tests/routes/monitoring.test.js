/**
 * Tests for monitoring routes
 * System health, performance metrics, database monitoring
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../utils/health-check', () => ({
  checkDatabaseHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
}));

jest.mock('../../utils/monitoring', () => ({
  current: { requests: 100, errors: 5 },
  getPrometheusMetrics: jest.fn().mockReturnValue('# HELP prometheus_metrics\nmetrics'),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../modules/MonitoringModule');

const monitoringRouter = require('../../routes/monitoring');

const app = express();
app.use(express.json());
app.use('/monitoring', monitoringRouter);

describe('Monitoring Routes', () => {
  describe('GET /monitoring/metrics', () => {
    it('should return 200 with metrics', async () => {
      const res = await request(app).get('/monitoring/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toBeDefined();
    });
  });

  describe('Monitoring routes exist', () => {
    it('should have /health endpoint', async () => {
      const res = await request(app).get('/monitoring/health');
      expect([200, 503]).toContain(res.status);
    });

    it('should have /admin/monitoring endpoint', async () => {
      const res = await request(app).get('/monitoring/admin/monitoring');
      expect([401, 200, 503]).toContain(res.status);
    });
  });
});
