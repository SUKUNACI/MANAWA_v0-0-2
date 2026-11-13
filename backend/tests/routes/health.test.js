/**
 * Tests for health routes
 * Module: routes/health.js — GET /health
 */

const request = require('supertest');
const express = require('express');

jest.mock('express-rate-limit', () => () => (req, res, next) => next());

const mockCheckDatabaseHealth = jest.fn();
jest.mock('../../utils/health-check', () => ({
  checkDatabaseHealth: mockCheckDatabaseHealth,
}));

const mockRedis = {
  healthCheck: jest.fn(),
};
jest.mock('../../config/redis', () => mockRedis);

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn(() => ({ skip: 0, take: 20 })),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn(() => []),
}));

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api', require('../../routes/health'));
});

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('200 quand DB et Redis sont sains', async () => {
    mockCheckDatabaseHealth.mockResolvedValue({ status: 'healthy' });
    mockRedis.healthCheck.mockResolvedValue({ status: 'ok' });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.services.database.status).toBe('healthy');
    expect(res.body.services.cache.status).toBe('ok');
  });

  it('503 quand la DB est dégradée', async () => {
    mockCheckDatabaseHealth.mockResolvedValue({ status: 'unhealthy' });
    mockRedis.healthCheck.mockResolvedValue({ status: 'ok' });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });

  it('503 quand Redis est dégradé', async () => {
    mockCheckDatabaseHealth.mockResolvedValue({ status: 'healthy' });
    mockRedis.healthCheck.mockResolvedValue({ status: 'error' });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });

  it('503 quand checkDatabaseHealth lève une exception', async () => {
    mockCheckDatabaseHealth.mockRejectedValue(new Error('Connection timeout'));
    mockRedis.healthCheck.mockResolvedValue({ status: 'ok' });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.error).toBe('Health check failed');
  });

  it('503 quand Redis lève une exception', async () => {
    mockCheckDatabaseHealth.mockResolvedValue({ status: 'healthy' });
    mockRedis.healthCheck.mockRejectedValue(new Error('Redis down'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('contient un timestamp', async () => {
    mockCheckDatabaseHealth.mockResolvedValue({ status: 'healthy' });
    mockRedis.healthCheck.mockResolvedValue({ status: 'ok' });

    const res = await request(app).get('/api/health');

    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });
});
