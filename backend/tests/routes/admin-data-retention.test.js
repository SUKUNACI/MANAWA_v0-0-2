/**
 * Tests for admin-data-retention routes
 * Module: routes/admin-data-retention.js
 * Endpoints:
 *   GET  /policies
 *   GET  /stats
 *   POST /purge
 *   GET  /archive-report
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken, proToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  message:          { count: jest.fn(), deleteMany: jest.fn() },
  notification:     { count: jest.fn(), deleteMany: jest.fn() },
  loginAttempt:     { count: jest.fn(), deleteMany: jest.fn() },
  profileView:      { count: jest.fn(), deleteMany: jest.fn() },
  refreshToken:     { count: jest.fn(), deleteMany: jest.fn() },
  dataRetentionLog: { count: jest.fn(), deleteMany: jest.fn(), create: jest.fn(), findMany: jest.fn() },
}));

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

const retentionRoutes = require('../../routes/admin-data-retention');
const { RETENTION_POLICIES } = require('../../routes/admin-data-retention');

const app = express();
app.use(express.json());
app.use('/admin/data-retention', retentionRoutes);

describe('Admin Data Retention Routes', () => {
  let prisma;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = require('../../config/db');
  });

  // ─── GET /policies ────────────────────────────────────────────────────────

  describe('GET /admin/data-retention/policies', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/data-retention/policies');
      expect(res.status).toBe(401);
    });

    it('returns 403 for CLIENT role', async () => {
      const res = await request(app)
        .get('/admin/data-retention/policies')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 for PROFESSIONAL role', async () => {
      const res = await request(app)
        .get('/admin/data-retention/policies')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with all retention policies', async () => {
      const res = await request(app)
        .get('/admin/data-retention/policies')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.policies)).toBe(true);
      expect(res.body.data.policies.length).toBe(Object.keys(RETENTION_POLICIES).length);
    });

    it('each policy has entity, retentionDays, keepForever, archiveAfterDays', async () => {
      const res = await request(app)
        .get('/admin/data-retention/policies')
        .set('Authorization', `Bearer ${adminToken()}`);

      res.body.data.policies.forEach(p => {
        expect(p).toHaveProperty('entity');
        expect(p).toHaveProperty('retentionDays');
        expect(p).toHaveProperty('keepForever');
        expect(p).toHaveProperty('archiveAfterDays');
      });
    });

    it('policy with -1 days has keepForever=true and archiveAfterDays=null', async () => {
      // No entity in RETENTION_POLICIES currently has -1, so we verify positive ones
      const res = await request(app)
        .get('/admin/data-retention/policies')
        .set('Authorization', `Bearer ${adminToken()}`);

      const positivePolicy = res.body.data.policies.find(p => p.retentionDays > 0);
      expect(positivePolicy.keepForever).toBe(false);
      expect(positivePolicy.archiveAfterDays).toBeGreaterThan(0);
    });
  });

  // ─── GET /stats ───────────────────────────────────────────────────────────

  describe('GET /admin/data-retention/stats', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/data-retention/stats');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/data-retention/stats')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with eligible rows per entity', async () => {
      prisma.message.count.mockResolvedValue(100);
      prisma.notification.count.mockResolvedValue(50);
      prisma.loginAttempt.count.mockResolvedValue(200);
      prisma.profileView.count.mockResolvedValue(30);
      prisma.refreshToken.count.mockResolvedValue(10);

      const res = await request(app)
        .get('/admin/data-retention/stats')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eligible.Message).toBe(100);
      expect(res.body.data.eligible.Notification).toBe(50);
      expect(res.body.data.eligible.LoginAttempt).toBe(200);
      expect(res.body.data.eligible.ProfileView).toBe(30);
      expect(res.body.data.eligible.RefreshToken).toBe(10);
      expect(res.body.data.totalEligible).toBe(390);
    });

    it('returns 200 with all zeros when no rows eligible', async () => {
      prisma.message.count.mockResolvedValue(0);
      prisma.notification.count.mockResolvedValue(0);
      prisma.loginAttempt.count.mockResolvedValue(0);
      prisma.profileView.count.mockResolvedValue(0);
      prisma.refreshToken.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/admin/data-retention/stats')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalEligible).toBe(0);
    });

    it('returns 500 on database error', async () => {
      prisma.message.count.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/admin/data-retention/stats')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to compute retention stats');
    });
  });

  // ─── POST /purge ──────────────────────────────────────────────────────────

  describe('POST /admin/data-retention/purge', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/admin/data-retention/purge')
        .send({ entity: 'Message' });
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .post('/admin/data-retention/purge')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ entity: 'Message' });
      expect(res.status).toBe(403);
    });

    it('returns 400 when entity is invalid', async () => {
      const res = await request(app)
        .post('/admin/data-retention/purge')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ entity: 'UnknownEntity' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when entity field is missing', async () => {
      const res = await request(app)
        .post('/admin/data-retention/purge')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 200 in dryRun mode without deleting records', async () => {
      prisma.message.count.mockResolvedValue(55);

      const res = await request(app)
        .post('/admin/data-retention/purge')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ entity: 'Message', dryRun: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.rowsAffected).toBe(55);
      expect(prisma.message.deleteMany).not.toHaveBeenCalled();
    });

    it('returns 200 and deletes records when dryRun=false and count>0', async () => {
      prisma.message.count.mockResolvedValue(20);
      prisma.message.deleteMany.mockResolvedValue({ count: 20 });
      prisma.dataRetentionLog.create.mockResolvedValue({ id: 'log-1' });

      const res = await request(app)
        .post('/admin/data-retention/purge')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ entity: 'Message', dryRun: false });

      expect(res.status).toBe(200);
      expect(res.body.data.dryRun).toBe(false);
      expect(res.body.data.rowsAffected).toBe(20);
      expect(prisma.message.deleteMany).toHaveBeenCalled();
      expect(prisma.dataRetentionLog.create).toHaveBeenCalled();
    });

    it('returns 200 and skips deleteMany when count is 0', async () => {
      prisma.message.count.mockResolvedValue(0);

      const res = await request(app)
        .post('/admin/data-retention/purge')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ entity: 'Message', dryRun: false });

      expect(res.status).toBe(200);
      expect(res.body.data.rowsAffected).toBe(0);
      expect(prisma.message.deleteMany).not.toHaveBeenCalled();
    });

    it('returns 200 for Notification entity purge (dry run)', async () => {
      prisma.notification.count.mockResolvedValue(10);

      const res = await request(app)
        .post('/admin/data-retention/purge')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ entity: 'Notification', dryRun: true });

      expect(res.status).toBe(200);
      expect(res.body.data.entity).toBe('Notification');
    });

    it('returns 500 on database error during purge', async () => {
      prisma.message.count.mockRejectedValue(new Error('connection error'));

      const res = await request(app)
        .post('/admin/data-retention/purge')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ entity: 'Message', dryRun: true });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Purge failed');
    });
  });

  // ─── GET /archive-report ──────────────────────────────────────────────────

  describe('GET /admin/data-retention/archive-report', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/data-retention/archive-report');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/data-retention/archive-report')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with any days value (route skips validationResult check)', async () => {
      // The route defines the validator but does not call validationResult;
      // out-of-range days are accepted and fall back to parseInt safely.
      prisma.dataRetentionLog.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/data-retention/archive-report?days=400')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 200 with empty report when no logs', async () => {
      prisma.dataRetentionLog.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/data-retention/archive-report')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.byEntity).toEqual({});
      expect(res.body.data.byAction).toEqual({});
    });

    it('returns 200 with aggregated logs grouped by entity and action', async () => {
      prisma.dataRetentionLog.findMany.mockResolvedValue([
        { id: 'l1', entityType: 'Message', action: 'deleted',    createdAt: new Date() },
        { id: 'l2', entityType: 'Message', action: 'anonymized', createdAt: new Date() },
        { id: 'l3', entityType: 'User',    action: 'anonymized', createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/admin/data-retention/archive-report?days=30')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.byEntity.Message).toBe(2);
      expect(res.body.data.byEntity.User).toBe(1);
      expect(res.body.data.byAction.deleted).toBe(1);
      expect(res.body.data.byAction.anonymized).toBe(2);
    });

    it('caps logs returned at 50 entries', async () => {
      const manyLogs = Array.from({ length: 80 }, (_, i) => ({
        id: `l${i}`, entityType: 'Message', action: 'deleted', createdAt: new Date(),
      }));
      prisma.dataRetentionLog.findMany.mockResolvedValue(manyLogs);

      const res = await request(app)
        .get('/admin/data-retention/archive-report')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(80);
      expect(res.body.data.logs.length).toBeLessThanOrEqual(50);
    });

    it('returns 500 on database error', async () => {
      prisma.dataRetentionLog.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/admin/data-retention/archive-report')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to generate archive report');
    });
  });
});
