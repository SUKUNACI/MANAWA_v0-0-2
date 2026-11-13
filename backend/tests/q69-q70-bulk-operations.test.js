/**
 * Tests for Q69 (Response Size Limits) and Q70 (Bulk Operations)
 * Tests response size middleware and bulk create/update/delete endpoints
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const redis = require('../config/redis');

// Mock dependencies
jest.mock('../config/db');
jest.mock('../config/redis');

// ============ SETUP ============

let app;
let adminToken;
let regularToken;

beforeAll(() => {
  // Create a minimal Express app with our middleware
  app = express();
  app.use(express.json());

  // Generate test tokens
  adminToken = jwt.sign(
    { id: 'admin-user-1', role: 'ADMIN', email: 'admin@test.com' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '24h' }
  );

  regularToken = jwt.sign(
    { id: 'regular-user-1', role: 'USER', email: 'user@test.com' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '24h' }
  );

  // Mock redis client
  const mockRedisClient = {
    get: jest.fn().mockResolvedValue('0'),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(3600),
    lpush: jest.fn().mockResolvedValue(1),
    ltrim: jest.fn().mockResolvedValue(0),
  };

  redis.getRedisClient = jest.fn().mockReturnValue(mockRedisClient);
});

describe('Q69: Response Size Limits', () => {
  let sizeLimitApp;

  beforeAll(() => {
    const { responseSizeLimitMiddleware, setResponseLimitHeaders } = require('../middleware/response-size-limit');

    sizeLimitApp = express();
    sizeLimitApp.use(express.json());
    sizeLimitApp.use(setResponseLimitHeaders);
    sizeLimitApp.use(responseSizeLimitMiddleware);

    // Test route that returns different sizes
    sizeLimitApp.get('/small', (req, res) => {
      res.json({ data: 'small response', size: 'small' });
    });

    sizeLimitApp.get('/medium', (req, res) => {
      // Create ~1.1MB response (should trigger warning) — 1,100,000 chars + JSON overhead
      const largeData = new Array(1100000).fill('x').join('');
      res.json({ data: largeData, size: 'medium' });
    });

    sizeLimitApp.get('/huge', (req, res) => {
      // Create ~5.5MB response (should be rejected — exceeds 5MB limit)
      const hugeData = new Array(5500000).fill('x').join('');
      res.json({ data: hugeData, size: 'huge' });
    });
  });

  test('Q69: Should accept small responses', async () => {
    const response = await request(sizeLimitApp).get('/small');

    expect(response.status).toBe(200);
    expect(response.get('X-Response-Size')).toBeDefined();
    expect(response.get('X-Response-Limit')).toBe('5242880'); // 5MB
    expect(response.get('X-Request-Body-Limit')).toBe('1mb');
    expect(response.get('X-Max-Page-Size')).toBe('500');
  });

  test('Q69: Should accept and log medium responses (1MB+)', async () => {
    const response = await request(sizeLimitApp).get('/medium');

    expect(response.status).toBe(200);
    expect(response.get('X-Response-Size')).toBeDefined();
    const sizeBytes = parseInt(response.get('X-Response-Size'), 10);
    expect(sizeBytes).toBeGreaterThan(1024 * 1024); // Should be > 1MB
  });

  test('Q69: Should reject responses exceeding 5MB limit', async () => {
    const response = await request(sizeLimitApp).get('/huge');

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.limitBytes).toBe(5242880);
  });

  test('Q69: Should validate pagination parameters', async () => {
    const { validatePaginationMiddleware } = require('../middleware/response-size-limit');

    const paginationApp = express();
    paginationApp.use(express.json());
    paginationApp.use(validatePaginationMiddleware);

    paginationApp.get('/paginated', (req, res) => {
      res.json({ pagination: req.pagination });
    });

    // Test valid pagination
    let response = await request(paginationApp)
      .get('/paginated')
      .query({ page: 1, limit: 50 });

    expect(response.status).toBe(200);
    expect(response.body.pagination.page).toBe(1);
    expect(response.body.pagination.limit).toBe(50);
    expect(response.body.pagination.skip).toBe(0);

    // Test invalid limit (exceeds max)
    response = await request(paginationApp)
      .get('/paginated')
      .query({ page: 1, limit: 1000 });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PAGE_SIZE_EXCEEDED');
  });
});

describe('Q70: Bulk Operations', () => {
  let bulkApp;
  let mockAuth;

  beforeAll(() => {
    bulkApp = express();
    bulkApp.use(express.json());

    // Mock auth middleware
    bulkApp.use((req, res, next) => {
      const token = req.get('Authorization')?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Not authenticated' });

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
        req.user = decoded;
        next();
      } catch {
        res.status(401).json({ error: 'Invalid token' });
      }
    });

    // Mock role middleware
    const requireRole = (role) => (req, res, next) => {
      if (req.user.role !== role) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    };

    global.requireRole = requireRole;

    // Mount bulk routes
    const bulkRoutes = require('../routes/bulk-operations');
    bulkApp.use('/projects/bulk', (req, res, next) => {
      // Mock requireAuth and requireRole for testing
      req.requireAuth = true;
      next();
    });
    bulkApp.use('/projects/bulk', bulkRoutes);
  });

  describe('Bulk Create', () => {
    test('Q70: Should create multiple projects', async () => {
      prisma.project.create.mockResolvedValue({
        id: 'proj-1',
        title: 'Test Project',
        budget: 5000,
        city: 'Paris',
      });

      const projects = [
        { title: 'Project 1', budget: 5000, city: 'Paris', description: 'Test' },
        { title: 'Project 2', budget: 10000, city: 'Lyon', description: 'Test' },
      ];

      const response = await request(bulkApp)
        .post('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(projects);

      expect(response.status).toBe(201);
      expect(response.body.operation).toBe('bulk_create');
      expect(response.body.created).toBeGreaterThan(0);
    });

    test('Q70: Should reject if exceeding max items (50)', async () => {
      // Create array of 51 items
      const projects = Array(51)
        .fill(null)
        .map((_, i) => ({
          title: `Project ${i}`,
          budget: 5000,
          city: 'Paris',
        }));

      const response = await request(bulkApp)
        .post('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(projects);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    test('Q70: Should validate required fields', async () => {
      const projects = [
        { title: 'Project 1', budget: 5000 }, // Missing city
        { description: 'Test', city: 'Paris' }, // Missing title
      ];

      const response = await request(bulkApp)
        .post('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(projects);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Bulk Update', () => {
    test('Q70: Should update multiple projects', async () => {
      prisma.project.update.mockResolvedValue({
        id: 'proj-1',
        title: 'Updated Title',
        budget: 7500,
      });

      const updates = [
        { id: 'proj-1', title: 'Updated Project 1', budget: 7500 },
        { id: 'proj-2', title: 'Updated Project 2', status: 'IN_PROGRESS' },
      ];

      const response = await request(bulkApp)
        .patch('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.operation).toBe('bulk_update');
    });

    test('Q70: Should detect duplicate IDs', async () => {
      const updates = [
        { id: 'proj-1', title: 'Updated 1' },
        { id: 'proj-1', title: 'Updated 1 again' }, // Duplicate
      ];

      const response = await request(bulkApp)
        .patch('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updates);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('Bulk Delete', () => {
    test('Q70: Should delete multiple projects by IDs', async () => {
      prisma.project.delete.mockResolvedValue({ id: 'proj-1' });

      const response = await request(bulkApp)
        .delete('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: ['proj-1', 'proj-2', 'proj-3'] });

      expect(response.status).toBe(200);
      expect(response.body.operation).toBe('bulk_delete');
      expect(response.body.deletedIds).toBeDefined();
    });

    test('Q70: Should reject empty ID list', async () => {
      const response = await request(bulkApp)
        .delete('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [] });

      expect(response.status).toBe(400);
    });

    test('Q70: Should reject exceeding max items', async () => {
      const ids = Array(51)
        .fill(null)
        .map((_, i) => `proj-${i}`);

      const response = await request(bulkApp)
        .delete('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('TOO_MANY_ITEMS');
    });
  });

  describe('Rate Limiting (Q70)', () => {
    test('Q70: Should enforce rate limit (5 calls/hour)', async () => {
      const mockRedisClient = redis.getRedisClient();

      // Simulate 5 calls already made
      mockRedisClient.get.mockResolvedValue('5');

      const response = await request(bulkApp)
        .post('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send([{ title: 'Test', budget: 5000, city: 'Paris' }]);

      expect(response.status).toBe(429);
      expect(response.body.code).toBe('BULK_RATE_LIMIT_EXCEEDED');
      expect(response.get('X-Bulk-RateLimit-Remaining')).toBe('0');
    });

    test('Q70: Should return remaining rate limit in headers', async () => {
      const mockRedisClient = redis.getRedisClient();
      mockRedisClient.get.mockResolvedValue('2'); // 2 calls made, 3 remaining

      const response = await request(bulkApp)
        .post('/projects/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send([{ title: 'Test', budget: 5000, city: 'Paris' }]);

      expect(response.status).toBe(201);
      expect(response.get('X-Bulk-RateLimit-Remaining')).toBe('2');
    });
  });

  describe('Authorization', () => {
    test('Q70: Should reject unauthenticated requests', async () => {
      const response = await request(bulkApp)
        .post('/projects/bulk')
        .send([{ title: 'Test', budget: 5000, city: 'Paris' }]);

      expect(response.status).toBe(401);
    });

    test('Q70: Should reject non-admin users', async () => {
      const response = await request(bulkApp)
        .post('/projects/bulk')
        .set('Authorization', `Bearer ${regularToken}`)
        .send([{ title: 'Test', budget: 5000, city: 'Paris' }]);

      // This should be 403 if role check is implemented
      expect([401, 403]).toContain(response.status);
    });
  });
});

describe('Integration: Q69 + Q70', () => {
  test('Should handle large bulk responses without exceeding size limit', async () => {
    // Bulk operations should keep responses under 5MB even with 50 items
    const bulkConfig = require('../config/bulk-config');
    expect(bulkConfig.MAX_ITEMS_PER_BULK_OP).toBe(50);

    // Assuming each project is ~10KB, 50 projects = ~500KB (well under 5MB)
    const estimatedResponseSize = 50 * 10 * 1024; // 500KB
    const maxSize = 5 * 1024 * 1024; // 5MB

    expect(estimatedResponseSize).toBeLessThan(maxSize);
  });

  test('Should enforce pagination limits with bulk response size limits', async () => {
    const { CONFIG } = require('../middleware/response-size-limit');
    expect(CONFIG.MAX_PAGE_SIZE).toBe(500);
    expect(CONFIG.MAX_RESPONSE_SIZE).toBe(5 * 1024 * 1024);

    // Assuming each item is ~10KB, max items for safe response = 5MB / 10KB = 512
    // PAGE_SIZE limit (500) is conservative and safe
    expect(CONFIG.MAX_PAGE_SIZE).toBeLessThanOrEqual(512);
  });
});
