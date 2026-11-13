/**
 * Tests for docs routes
 * Module: routes/docs.js — swagger UI, swagger.json, openapi.json, openapi.yaml, health, stats
 */

const request = require('supertest');
const express = require('express');
const path = require('path');

// Mock swagger-ui-express before requiring the route.
// setup() must call next() for all paths other than the root so that
// sub-routes (/swagger.json, /health, etc.) are reachable in tests.
jest.mock('swagger-ui-express', () => ({
  serve: (req, res, next) => next(),
  setup: () => (req, res, next) => {
    // Only intercept the bare root path; let everything else pass through.
    if (req.path === '/' || req.path === '') {
      return res.send('<html>Swagger UI</html>');
    }
    return next();
  },
}));

// Mock the swagger spec
jest.mock('../../docs/swagger', () => ({
  openapi: '3.0.0',
  info: { title: 'MANAWA API', version: '1.0.0' },
  paths: {},
}), { virtual: true });

// Mock fs for yaml reading
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn((filePath, encoding) => {
    if (filePath.includes('openapi.yaml')) {
      return 'openapi: "3.0.0"\ninfo:\n  title: MANAWA API\n  version: "1.0.0"';
    }
    return jest.requireActual('fs').readFileSync(filePath, encoding);
  }),
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
  app.use('/docs', require('../../routes/docs'));
});

// ─── GET /swagger.json ────────────────────────────────────────────────────────

describe('GET /swagger.json', () => {
  it('200 retourne le spec JSON', async () => {
    const res = await request(app).get('/docs/swagger.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi');
  });
});

// ─── GET /openapi.json ────────────────────────────────────────────────────────

describe('GET /openapi.json', () => {
  it('200 retourne le spec JSON', async () => {
    const res = await request(app).get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi');
  });
});

// ─── GET /openapi.yaml ────────────────────────────────────────────────────────

describe('GET /openapi.yaml', () => {
  it('200 retourne le spec YAML', async () => {
    const res = await request(app).get('/docs/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/yaml/);
  });

  it('500 si le fichier YAML est introuvable', async () => {
    const fs = require('fs');
    fs.readFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT: no such file');
    });

    const res = await request(app).get('/docs/openapi.yaml');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to load/);
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('200 retourne l\'état de santé de la doc', async () => {
    const res = await request(app).get('/docs/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.endpoints).toHaveProperty('ui');
    expect(res.body.endpoints).toHaveProperty('swagger_json');
  });
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

describe('GET /stats', () => {
  it('200 retourne les statistiques API', async () => {
    const res = await request(app).get('/docs/stats');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('MANAWA API Statistics');
    expect(typeof res.body.totalEndpoints).toBe('number');
    expect(Array.isArray(res.body.modules)).toBe(true);
  });
});

// ─── GET /redirect ────────────────────────────────────────────────────────────

describe('GET /redirect', () => {
  it('3xx redirection vers /docs', async () => {
    const res = await request(app).get('/docs/redirect');
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });
});
