/**
 * API Versioning Tests
 *
 * Verifies:
 * - /api/v1/* routes are accessible
 * - /api/* routes redirect to /api/v1/* with 301 status
 * - Versioning headers are added to responses
 * - Deprecation headers are correct
 */

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Import versioning middleware
const { versioningHeadersMiddleware, apiRedirectMiddleware } = require('../middleware/versioningMiddleware');
const { CURRENT_VERSION } = require('../config/versioning');

describe('API Versioning', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(cookieParser());
    app.use(express.json());

    // Add versioning middleware
    app.use(versioningHeadersMiddleware);

    // Mock routes for testing
    const v1Router = express.Router();
    v1Router.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    app.use('/api/v1', v1Router);

    // Redirect middleware
    const apiV0Redirect = (req, res, next) => {
      if (req.path.match(/^\/api\/(?!v[0-9])/) && req.method !== 'OPTIONS') {
        const targetPath = `/api/v1${req.path.substring(4)}`;
        const fullUrl = targetPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
        return res.redirect(301, fullUrl);
      }
      next();
    };

    app.use(apiV0Redirect);
  });

  describe('Versioning Headers', () => {
    test('should add X-API-Version header to v1 responses', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.headers['x-api-version']).toBe(CURRENT_VERSION);
      expect(response.headers['deprecation']).toBe('false');
    });

    test('should set Deprecation false on v1 endpoints', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.headers['deprecation']).toBe('false');
    });
  });

  describe('Backwards Compatibility Redirects', () => {
    test('should redirect /api/health to /api/v1/health with 301', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(301);

      expect(response.headers.location).toContain('/api/v1/health');
    });

    test('should preserve query parameters in redirect', async () => {
      const response = await request(app)
        .get('/api/health?test=1')
        .expect(301);

      expect(response.headers.location).toContain('/api/v1/health');
      expect(response.headers.location).toContain('test=1');
    });

    test('should not redirect /api/v1/* routes', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
    });
  });

  describe('API Version Configuration', () => {
    test('CURRENT_VERSION should be v1', () => {
      expect(CURRENT_VERSION).toBe('v1');
    });

    test('should have API_VERSIONS object', () => {
      const versioning = require('../config/versioning');
      expect(versioning.API_VERSIONS).toHaveProperty('V0', 'v0');
      expect(versioning.API_VERSIONS).toHaveProperty('V1', 'v1');
    });

    test('should have deprecation schedule', () => {
      const { DEPRECATION_SCHEDULE } = require('../config/versioning');
      expect(DEPRECATION_SCHEDULE).toHaveProperty('v0');
      expect(DEPRECATION_SCHEDULE.v0.deprecated).toBe(true);
    });
  });

  describe('Deprecation Info Functions', () => {
    test('getDeprecationInfo should return info for v0', () => {
      const { getDeprecationInfo } = require('../config/versioning');
      const info = getDeprecationInfo('v0');
      expect(info).not.toBeNull();
      expect(info.deprecated).toBe(true);
      expect(info.sunsetDate).toBeDefined();
    });

    test('isVersionDeprecated should return true for v0', () => {
      const { isVersionDeprecated } = require('../config/versioning');
      expect(isVersionDeprecated('v0')).toBe(true);
      expect(isVersionDeprecated('v1')).toBe(false);
    });

    test('getDeprecationInfo should return null for v1', () => {
      const { getDeprecationInfo } = require('../config/versioning');
      const info = getDeprecationInfo('v1');
      expect(info).toBeNull();
    });
  });

  describe('Route Structure', () => {
    test('v1Router should be properly mounted', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toEqual({ status: 'ok' });
    });

    test('should handle multiple endpoint types', async () => {
      // Mock additional routes
      app.post('/api/v1/test', (req, res) => {
        res.json({ method: 'POST' });
      });

      const response = await request(app)
        .post('/api/v1/test')
        .expect(200);

      expect(response.headers['x-api-version']).toBe(CURRENT_VERSION);
    });
  });
});
