/**
 * Tests for admin-recovery routes (DR, backup/restore, compliance)
 * Module: routes/admin-recovery.js — 7 endpoints admin POST/GET
 * No prior tests exist (0% coverage).
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  auditLog: {
    create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
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
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
  },
  requireRole: (role) => (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
}));

jest.mock('../../middleware/validateInput', () => ({
  handleValidationErrors: (req, res, next) => next(),
}));

jest.mock('express-validator', () => {
  const makeChain = () => {
    const chain = function (req, res, next) { next(); };
    const methods = [
      'notEmpty', 'trim', 'isLength', 'isString', 'isBoolean', 'isInt',
      'isFloat', 'isUUID', 'isISO8601', 'isIn', 'optional', 'withMessage',
      'custom', 'escape', 'isEmail', 'isNumeric', 'isArray',
      'defaultValue', 'default', 'bail',
    ];
    methods.forEach((m) => { chain[m] = () => chain; });
    return chain;
  };
  return {
    body: () => makeChain(),
    param: () => makeChain(),
    query: () => makeChain(),
    validationResult: () => ({ isEmpty: () => true, array: () => [] }),
    matchedData: (req) => req.body || {},
  };
});

jest.mock('../../utils/pagination-helper', () => ({
  applyPagination: jest.fn().mockReturnValue({ take: 20, skip: 0 }),
  validatePaginationQuery: jest.fn().mockReturnValue({ limit: 20, offset: 0 }),
  buildPaginatedResponse: jest.fn().mockReturnValue({ data: [], pagination: {} }),
}));

const adminRecoveryRoutes = require('../../routes/admin-recovery');

const app = express();
app.use(express.json());
app.use('/recovery', adminRecoveryRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

describe('Admin Recovery Routes', () => {
  describe('GET /recovery/status', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/recovery/status');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/recovery/status')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 for admin', async () => {
      const prisma = require('../../config/db');
      prisma.$queryRaw.mockResolvedValueOnce([{ 1: 1 }]);
      const res = await request(app)
        .get('/recovery/status')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('POST /recovery/backup', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/recovery/backup').send({ type: 'full' });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/recovery/backup')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ type: 'full' });
      expect(res.status).toBe(403);
    });

    it('should return 200 for admin with full backup', async () => {
      const prisma = require('../../config/db');
      prisma.auditLog.create.mockResolvedValueOnce({ id: 'log-1' });
      const res = await request(app)
        .post('/recovery/backup')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'full', description: 'manual', priority: 'normal' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('initiated');
    });

    it('should return 200 for incremental backup', async () => {
      const prisma = require('../../config/db');
      prisma.auditLog.create.mockResolvedValueOnce({ id: 'log-2' });
      const res = await request(app)
        .post('/recovery/backup')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'incremental' });
      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe('incremental');
    });
  });

  describe('POST /recovery/restore', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/recovery/restore').send({});
      expect(res.status).toBe(401);
    });

    it('should return 403 for production restore without dryRun', async () => {
      const res = await request(app)
        .post('/recovery/restore')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ targetEnvironment: 'production', dryRun: false });
      expect(res.status).toBe(403);
      expect(res.body.requiresApproval).toBe(true);
    });

    it('should return 200 for staging dryRun restore', async () => {
      const prisma = require('../../config/db');
      prisma.auditLog.create.mockResolvedValueOnce({ id: 'log-3' });
      const res = await request(app)
        .post('/recovery/restore')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ targetEnvironment: 'staging', dryRun: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
    });
  });

  describe('POST /recovery/restore/confirm', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/recovery/restore/confirm').send({});
      expect(res.status).toBe(401);
    });

    it('should return 403 for invalid approval token', async () => {
      const res = await request(app)
        .post('/recovery/restore/confirm')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ restoreId: 'restore-1', approvalToken: 'short-invalid' });
      expect(res.status).toBe(403);
    });

    it('should return 200 for valid 64-char token', async () => {
      const prisma = require('../../config/db');
      prisma.auditLog.create.mockResolvedValueOnce({ id: 'log-4' });
      const validToken = 'a'.repeat(64);
      const res = await request(app)
        .post('/recovery/restore/confirm')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ restoreId: 'restore-123', approvalToken: validToken });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in_progress');
    });
  });

  describe('GET /recovery/restore/:restoreId', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/recovery/restore/restore-1');
      expect(res.status).toBe(401);
    });

    it('should return 200 with restore status for admin', async () => {
      const res = await request(app)
        .get('/recovery/restore/restore-123')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.restoreId).toBe('restore-123');
    });
  });

  describe('POST /recovery/test', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/recovery/test').send({});
      expect(res.status).toBe(401);
    });

    it('should return 200 for weekly DR test', async () => {
      const prisma = require('../../config/db');
      prisma.auditLog.create.mockResolvedValueOnce({ id: 'log-5' });
      const res = await request(app)
        .post('/recovery/test')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'weekly' });
      expect(res.status).toBe(200);
      expect(res.body.data.testType).toBe('weekly');
    });

    it('should return 200 for monthly DR test', async () => {
      const prisma = require('../../config/db');
      prisma.auditLog.create.mockResolvedValueOnce({ id: 'log-6' });
      const res = await request(app)
        .post('/recovery/test')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'monthly' });
      expect(res.status).toBe(200);
      expect(res.body.data.estimatedDuration).toBe('60 minutes');
    });
  });

  describe('GET /recovery/test', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/recovery/test');
      expect(res.status).toBe(401);
    });

    it('should return 200 with test results for admin', async () => {
      const res = await request(app)
        .get('/recovery/test')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.latest).toBeDefined();
      expect(res.body.data.schedule).toBeDefined();
    });
  });

  describe('GET /recovery/compliance', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/recovery/compliance');
      expect(res.status).toBe(401);
    });

    it('should return 200 with compliance status', async () => {
      const res = await request(app)
        .get('/recovery/compliance')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('compliant');
      expect(res.body.data.regulations).toBeDefined();
    });
  });

  describe('GET /recovery/audit-log', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/recovery/audit-log');
      expect(res.status).toBe(401);
    });

    it('should return 200 with audit log for admin', async () => {
      const prisma = require('../../config/db');
      prisma.auditLog.findMany.mockResolvedValueOnce([
        { id: 'log-1', action: 'BACKUP_TRIGGERED', createdAt: new Date() },
      ]);
      prisma.auditLog.count.mockResolvedValueOnce(1);
      const res = await request(app)
        .get('/recovery/audit-log')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
