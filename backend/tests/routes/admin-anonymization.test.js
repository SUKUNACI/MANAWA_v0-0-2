/**
 * Tests for admin-anonymization routes
 * Module: routes/admin-anonymization.js
 * Endpoints:
 *   POST /user/:userId
 *   POST /messages/bulk
 *   GET  /aggregates/users
 *   GET  /aggregates/payments
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken, proToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
    groupBy:    jest.fn(),
  },
  message: {
    count:      jest.fn(),
    updateMany: jest.fn(),
  },
  payment: {
    findMany: jest.fn(),
  },
  dataRetentionLog: {
    create: jest.fn(),
  },
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

const anonRoutes = require('../../routes/admin-anonymization');

const app = express();
app.use(express.json());
app.use('/admin/anonymization', anonRoutes);

describe('Admin Anonymization Routes', () => {
  let prisma;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = require('../../config/db');
  });

  // ─── POST /user/:userId ────────────────────────────────────────────────────

  describe('POST /admin/anonymization/user/:userId', () => {
    it('returns 401 without auth token', async () => {
      const res = await request(app).post('/admin/anonymization/user/user-1');
      expect(res.status).toBe(401);
    });

    it('returns 403 for CLIENT role', async () => {
      const res = await request(app)
        .post('/admin/anonymization/user/user-1')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 for PROFESSIONAL role', async () => {
      const res = await request(app)
        .post('/admin/anonymization/user/user-1')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 404 when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/anonymization/user/nonexistent-id')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('returns 200 and anonymizes user successfully', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-123', email: 'real@example.com' });
      prisma.user.update.mockResolvedValue({ id: 'user-123', email: 'anon_abc123@anonymized.invalid' });
      prisma.dataRetentionLog.create.mockResolvedValue({ id: 'log-1' });

      const res = await request(app)
        .post('/admin/anonymization/user/user-123')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toMatch(/user-123/);
      expect(res.body.data.anonId).toBeDefined();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
          data: expect.objectContaining({
            firstName: 'Anonymized',
            lastName:  'User',
            passwordHash: 'ANONYMIZED',
          }),
        })
      );
    });

    it('returns 500 when database update fails', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-123' });
      prisma.user.update.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/admin/anonymization/user/user-123')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Anonymization failed');
    });
  });

  // ─── POST /messages/bulk ──────────────────────────────────────────────────

  describe('POST /admin/anonymization/messages/bulk', () => {
    it('returns 401 without auth token', async () => {
      const res = await request(app)
        .post('/admin/anonymization/messages/bulk')
        .send({ olderThanDays: 30 });
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .post('/admin/anonymization/messages/bulk')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ olderThanDays: 30 });
      expect(res.status).toBe(403);
    });

    it('returns 400 when olderThanDays is missing', async () => {
      const res = await request(app)
        .post('/admin/anonymization/messages/bulk')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it('returns 400 when olderThanDays is 0 (below min)', async () => {
      const res = await request(app)
        .post('/admin/anonymization/messages/bulk')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ olderThanDays: 0 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when olderThanDays exceeds max (3650)', async () => {
      const res = await request(app)
        .post('/admin/anonymization/messages/bulk')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ olderThanDays: 9999 });
      expect(res.status).toBe(400);
    });

    it('returns 200 in dryRun mode without updating messages', async () => {
      prisma.message.count.mockResolvedValue(42);

      const res = await request(app)
        .post('/admin/anonymization/messages/bulk')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ olderThanDays: 90, dryRun: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.messagesAffected).toBe(42);
      expect(prisma.message.updateMany).not.toHaveBeenCalled();
    });

    it('returns 200 and updates messages when dryRun is false and count > 0', async () => {
      prisma.message.count.mockResolvedValue(15);
      prisma.message.updateMany.mockResolvedValue({ count: 15 });
      prisma.dataRetentionLog.create.mockResolvedValue({ id: 'log-2' });

      const res = await request(app)
        .post('/admin/anonymization/messages/bulk')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ olderThanDays: 90, dryRun: false });

      expect(res.status).toBe(200);
      expect(res.body.data.dryRun).toBe(false);
      expect(res.body.data.messagesAffected).toBe(15);
      expect(prisma.message.updateMany).toHaveBeenCalled();
    });

    it('returns 200 and skips updateMany when count is 0', async () => {
      prisma.message.count.mockResolvedValue(0);

      const res = await request(app)
        .post('/admin/anonymization/messages/bulk')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ olderThanDays: 90, dryRun: false });

      expect(res.status).toBe(200);
      expect(res.body.data.messagesAffected).toBe(0);
      expect(prisma.message.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── GET /aggregates/users ────────────────────────────────────────────────

  describe('GET /admin/anonymization/aggregates/users', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/anonymization/aggregates/users');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/anonymization/aggregates/users')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with aggregated stats suppressing cities < 5 users', async () => {
      prisma.user.count
        .mockResolvedValueOnce(100)      // total
        .mockResolvedValueOnce(80)       // verifiedCount
        .mockResolvedValueOnce(5);       // suspendedCount

      prisma.user.groupBy
        .mockResolvedValueOnce([         // byRole
          { role: 'CLIENT', _count: { id: 70 } },
          { role: 'PROFESSIONAL', _count: { id: 30 } },
        ])
        .mockResolvedValueOnce([         // byCityRaw
          { city: 'Paris', _count: { id: 10 } },
          { city: 'Lyon',  _count: { id: 3  } },  // should be suppressed
        ]);

      const res = await request(app)
        .get('/admin/anonymization/aggregates/users')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(100);
      // Lyon has < 5 users — must be suppressed
      const cityNames = res.body.data.topCities.map(c => c.city);
      expect(cityNames).toContain('Paris');
      expect(cityNames).not.toContain('Lyon');
      expect(res.body.data.kAnonymityThreshold).toBe(5);
    });

    it('returns 200 with 0 percentages when total is 0', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.groupBy.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/anonymization/aggregates/users')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.verifiedPercent).toBe(0);
      expect(res.body.data.suspendedPercent).toBe(0);
    });

    it('returns 500 on database error', async () => {
      prisma.user.count.mockRejectedValue(new Error('DB failure'));

      const res = await request(app)
        .get('/admin/anonymization/aggregates/users')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to compute user aggregates');
    });
  });

  // ─── GET /aggregates/payments ─────────────────────────────────────────────

  describe('GET /admin/anonymization/aggregates/payments', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/anonymization/aggregates/payments');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/anonymization/aggregates/payments')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 400 for invalid ISO8601 date in query', async () => {
      const res = await request(app)
        .get('/admin/anonymization/aggregates/payments?from=not-a-date')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('returns 200 with payment aggregates', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { amount: 100, currency: 'EUR' },
        { amount: 200, currency: 'EUR' },
        { amount: 300, currency: 'EUR' },
      ]);

      const res = await request(app)
        .get('/admin/anonymization/aggregates/payments')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transactionCount).toBe(3);
      expect(res.body.data.totalAmountEur).toBe(600);
      expect(res.body.data.averageAmountEur).toBe(200);
    });

    it('returns 200 with zeros when no payments', async () => {
      prisma.payment.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/anonymization/aggregates/payments')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.transactionCount).toBe(0);
      expect(res.body.data.totalAmountEur).toBe(0);
      expect(res.body.data.averageAmountEur).toBe(0);
      expect(res.body.data.medianAmountEur).toBe(0);
    });

    it('returns 500 on database error', async () => {
      prisma.payment.findMany.mockRejectedValue(new Error('connection failed'));

      const res = await request(app)
        .get('/admin/anonymization/aggregates/payments')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to compute payment aggregates');
    });
  });
});
