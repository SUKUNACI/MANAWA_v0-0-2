/**
 * Tests for admin-data-inventory routes
 * Module: routes/admin-data-inventory.js
 * Endpoints (all static, no DB calls):
 *   GET /inventory
 *   GET /classification
 *   GET /pii-fields
 *   GET /gdpr-article-30
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken, proToken } = require('../helpers');

jest.mock('../../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const jwt = require('jsonwebtoken');
    try {
      req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token invalide' });
    }
  },
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
}));

const dataInventoryRoutes = require('../../routes/admin-data-inventory');
const { DATA_INVENTORY, CLASSIFICATION_LEVELS } = require('../../routes/admin-data-inventory');

const app = express();
app.use(express.json());
app.use('/admin/data-inventory', dataInventoryRoutes);

describe('Admin Data Inventory Routes', () => {
  // ─── GET /inventory ───────────────────────────────────────────────────────

  describe('GET /admin/data-inventory/inventory', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/data-inventory/inventory');
      expect(res.status).toBe(401);
    });

    it('returns 403 for CLIENT role', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/inventory')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 for PROFESSIONAL role', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/inventory')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with full inventory for admin', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/inventory')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.inventory)).toBe(true);
      expect(res.body.data.inventory.length).toBe(DATA_INVENTORY.length);
    });

    it('returns correct summary counts', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/inventory')
        .set('Authorization', `Bearer ${adminToken()}`);

      const { summary } = res.body.data;
      expect(summary.totalEntities).toBe(DATA_INVENTORY.length);

      const expectedTotalFields = DATA_INVENTORY.reduce((s, e) => s + e.fields.length, 0);
      expect(summary.totalFields).toBe(expectedTotalFields);

      const expectedPiiFields = DATA_INVENTORY.reduce(
        (s, e) => s + e.fields.filter(f => f.pii).length, 0
      );
      expect(summary.piiFields).toBe(expectedPiiFields);
    });

    it('returns byClassification counts that sum to totalFields', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/inventory')
        .set('Authorization', `Bearer ${adminToken()}`);

      const { summary } = res.body.data;
      const classTotal = Object.values(summary.byClassification).reduce((s, v) => s + v, 0);
      expect(classTotal).toBe(summary.totalFields);
    });

    it('inventory entries include entity, table, and fields array', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/inventory')
        .set('Authorization', `Bearer ${adminToken()}`);

      const first = res.body.data.inventory[0];
      expect(first).toHaveProperty('entity');
      expect(first).toHaveProperty('table');
      expect(Array.isArray(first.fields)).toBe(true);
    });
  });

  // ─── GET /classification ──────────────────────────────────────────────────

  describe('GET /admin/data-inventory/classification', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/data-inventory/classification');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/classification')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with classification levels for admin', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/classification')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.levels).toBeDefined();
      expect(res.body.data.policies).toBeDefined();
      expect(res.body.data.gdprCategories).toBeDefined();
    });

    it('includes PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED levels', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/classification')
        .set('Authorization', `Bearer ${adminToken()}`);

      const levelKeys = Object.keys(res.body.data.levels);
      expect(levelKeys).toContain('PUBLIC');
      expect(levelKeys).toContain('INTERNAL');
      expect(levelKeys).toContain('CONFIDENTIAL');
      expect(levelKeys).toContain('RESTRICTED');
    });

    it('levels have ascending numeric level values', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/classification')
        .set('Authorization', `Bearer ${adminToken()}`);

      const levels = res.body.data.levels;
      expect(levels.PUBLIC.level).toBeLessThan(levels.INTERNAL.level);
      expect(levels.INTERNAL.level).toBeLessThan(levels.CONFIDENTIAL.level);
      expect(levels.CONFIDENTIAL.level).toBeLessThan(levels.RESTRICTED.level);
    });

    it('gdprCategories include legalBasis and retentionNote', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/classification')
        .set('Authorization', `Bearer ${adminToken()}`);

      const categories = res.body.data.gdprCategories;
      expect(Array.isArray(categories)).toBe(true);
      categories.forEach(cat => {
        expect(cat).toHaveProperty('category');
        expect(cat).toHaveProperty('legalBasis');
        expect(cat).toHaveProperty('retentionNote');
      });
    });
  });

  // ─── GET /pii-fields ──────────────────────────────────────────────────────

  describe('GET /admin/data-inventory/pii-fields', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/data-inventory/pii-fields');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/pii-fields')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with PII fields only', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/pii-fields')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.piiFields)).toBe(true);
      expect(res.body.data.count).toBe(res.body.data.piiFields.length);
    });

    it('all returned fields have pii=true in source data', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/pii-fields')
        .set('Authorization', `Bearer ${adminToken()}`);

      // Every field returned must come from a PII field in the source inventory
      const allPiiFieldNames = DATA_INVENTORY.flatMap(e =>
        e.fields.filter(f => f.pii).map(f => f.field)
      );
      res.body.data.piiFields.forEach(f => {
        expect(allPiiFieldNames).toContain(f.field);
      });
    });

    it('PII fields include required keys', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/pii-fields')
        .set('Authorization', `Bearer ${adminToken()}`);

      const first = res.body.data.piiFields[0];
      expect(first).toHaveProperty('entity');
      expect(first).toHaveProperty('table');
      expect(first).toHaveProperty('field');
      expect(first).toHaveProperty('classification');
      expect(first).toHaveProperty('gdprCategory');
      expect(first).toHaveProperty('retention');
    });

    it('includes exportedAt timestamp', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/pii-fields')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.body.data.exportedAt).toBeDefined();
      expect(() => new Date(res.body.data.exportedAt)).not.toThrow();
    });
  });

  // ─── GET /gdpr-article-30 ─────────────────────────────────────────────────

  describe('GET /admin/data-inventory/gdpr-article-30', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/data-inventory/gdpr-article-30');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/gdpr-article-30')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with RoPA structure for admin', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/gdpr-article-30')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.controller).toBeDefined();
      expect(Array.isArray(res.body.data.processingActivities)).toBe(true);
    });

    it('controller has name, address, contact', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/gdpr-article-30')
        .set('Authorization', `Bearer ${adminToken()}`);

      const { controller } = res.body.data;
      expect(controller).toHaveProperty('name');
      expect(controller).toHaveProperty('address');
      expect(controller).toHaveProperty('contact');
    });

    it('each processing activity has required GDPR fields', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/gdpr-article-30')
        .set('Authorization', `Bearer ${adminToken()}`);

      res.body.data.processingActivities.forEach(activity => {
        expect(activity).toHaveProperty('name');
        expect(activity).toHaveProperty('purpose');
        expect(activity).toHaveProperty('legalBasis');
        expect(activity).toHaveProperty('dataCategories');
        expect(activity).toHaveProperty('retention');
        expect(activity).toHaveProperty('recipients');
      });
    });

    it('includes generatedAt timestamp', async () => {
      const res = await request(app)
        .get('/admin/data-inventory/gdpr-article-30')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.body.data.generatedAt).toBeDefined();
      expect(() => new Date(res.body.data.generatedAt)).not.toThrow();
    });
  });
});
