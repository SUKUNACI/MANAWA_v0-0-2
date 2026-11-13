/**
 * Tests for admin-gdpr routes (Q93/Q94)
 * Module: routes/admin-gdpr.js — requests, execute, reject, soft-deleted, restore
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken, makeToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  gdprDeletionRequest: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  },
  refreshToken: { deleteMany: jest.fn() },
  loginAttempt: { deleteMany: jest.fn() },
  pushToken: { deleteMany: jest.fn() },
  notification: { deleteMany: jest.fn() },
  dataRetentionLog: { create: jest.fn() },
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

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function superAdminToken(id = 'superadmin-1') {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ id, role: 'SUPER_ADMIN', email: 'superadmin@test.com' }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

const gdprRouter = require('../../routes/admin-gdpr');

const app = express();
app.use(express.json());
app.use('/gdpr', gdprRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

describe('Admin GDPR Routes', () => {
  let prisma;

  beforeEach(() => {
    prisma = require('../../config/db');
    jest.clearAllMocks();
  });

  // ─── GET /gdpr/requests ───────────────────────────────────────────────────

  describe('GET /gdpr/requests', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/gdpr/requests');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin CLIENT', async () => {
      const res = await request(app)
        .get('/gdpr/requests')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with requests list for admin', async () => {
      prisma.gdprDeletionRequest.findMany.mockResolvedValue([
        { id: 'req-1', userId: 'user-1', status: 'PENDING', createdAt: new Date() },
      ]);
      prisma.gdprDeletionRequest.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/gdpr/requests')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requests).toHaveLength(1);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      prisma.gdprDeletionRequest.findMany.mockResolvedValue([]);
      prisma.gdprDeletionRequest.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/gdpr/requests?status=PENDING')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(prisma.gdprDeletionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' } })
      );
    });

    it('should return 400 for invalid status', async () => {
      const res = await request(app)
        .get('/gdpr/requests?status=INVALID')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should return 500 on database error', async () => {
      prisma.gdprDeletionRequest.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/gdpr/requests')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /gdpr/requests ──────────────────────────────────────────────────

  describe('POST /gdpr/requests', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/gdpr/requests').send({ userId: 'user-1' });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/gdpr/requests')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ userId: 'user-1' });
      expect(res.status).toBe(403);
    });

    it('should return 201 and create a deletion request', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.com' });
      prisma.gdprDeletionRequest.findFirst.mockResolvedValue(null);
      prisma.gdprDeletionRequest.create.mockResolvedValue({
        id: 'req-1', userId: 'user-1', status: 'PENDING', requestedBy: 'admin-1',
      });

      const res = await request(app)
        .post('/gdpr/requests')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ userId: 'user-1', reason: 'User requested deletion' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.request.status).toBe('PENDING');
    });

    it('should return 400 for missing userId', async () => {
      const res = await request(app)
        .post('/gdpr/requests')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 404 when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/gdpr/requests')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ userId: 'nonexistent-user' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('should return 409 when active request already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.gdprDeletionRequest.findFirst.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

      const res = await request(app)
        .post('/gdpr/requests')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ userId: 'user-1' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('active deletion request already exists');
    });

    it('should return 500 on database error', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/gdpr/requests')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ userId: 'user-1' });

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /gdpr/requests/:id/execute ─────────────────────────────────────

  describe('POST /gdpr/requests/:id/execute', () => {
    const mockRequest = { id: 'req-1', userId: 'user-1', status: 'PENDING' };

    it('should return 401 without auth', async () => {
      const res = await request(app).post('/gdpr/requests/req-1/execute');
      expect(res.status).toBe(401);
    });

    it('should return 403 for ADMIN (requires SUPER_ADMIN)', async () => {
      const res = await request(app)
        .post('/gdpr/requests/req-1/execute')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 403 for CLIENT', async () => {
      const res = await request(app)
        .post('/gdpr/requests/req-1/execute')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 and execute hard delete for SUPER_ADMIN', async () => {
      prisma.gdprDeletionRequest.findUnique.mockResolvedValue(mockRequest);
      prisma.gdprDeletionRequest.update.mockResolvedValue({ ...mockRequest, status: 'IN_PROGRESS' });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
      prisma.loginAttempt.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.notification.deleteMany.mockResolvedValue({ count: 2 });
      prisma.user.delete.mockResolvedValue({});
      prisma.dataRetentionLog.create.mockResolvedValue({ id: 'log-1' });
      prisma.gdprDeletionRequest.update
        .mockResolvedValueOnce({ ...mockRequest, status: 'IN_PROGRESS' })
        .mockResolvedValueOnce({ ...mockRequest, status: 'COMPLETED' });

      const res = await request(app)
        .post('/gdpr/requests/req-1/execute')
        .set('Authorization', `Bearer ${superAdminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('permanently deleted');
    });

    it('should return 404 when request not found', async () => {
      prisma.gdprDeletionRequest.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/gdpr/requests/nonexistent/execute')
        .set('Authorization', `Bearer ${superAdminToken()}`);

      expect(res.status).toBe(404);
    });

    it('should return 400 when request status is COMPLETED', async () => {
      prisma.gdprDeletionRequest.findUnique.mockResolvedValue({ id: 'req-1', userId: 'user-1', status: 'COMPLETED' });

      const res = await request(app)
        .post('/gdpr/requests/req-1/execute')
        .set('Authorization', `Bearer ${superAdminToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot execute');
    });

    it('should return 400 when request status is REJECTED', async () => {
      prisma.gdprDeletionRequest.findUnique.mockResolvedValue({ id: 'req-1', userId: 'user-1', status: 'REJECTED' });

      const res = await request(app)
        .post('/gdpr/requests/req-1/execute')
        .set('Authorization', `Bearer ${superAdminToken()}`);

      expect(res.status).toBe(400);
    });

    it('should return 500 on database error', async () => {
      prisma.gdprDeletionRequest.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/gdpr/requests/req-1/execute')
        .set('Authorization', `Bearer ${superAdminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── PATCH /gdpr/requests/:id/reject ─────────────────────────────────────

  describe('PATCH /gdpr/requests/:id/reject', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .patch('/gdpr/requests/req-1/reject')
        .send({ rejectionNote: 'Ongoing legal dispute' });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .patch('/gdpr/requests/req-1/reject')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ rejectionNote: 'Ongoing legal dispute' });
      expect(res.status).toBe(403);
    });

    it('should return 200 and reject a PENDING request', async () => {
      prisma.gdprDeletionRequest.findUnique.mockResolvedValue({ id: 'req-1', status: 'PENDING' });
      prisma.gdprDeletionRequest.update.mockResolvedValue({
        id: 'req-1', status: 'REJECTED', rejectionNote: 'Ongoing legal dispute', rejectedAt: new Date(),
      });

      const res = await request(app)
        .patch('/gdpr/requests/req-1/reject')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rejectionNote: 'Ongoing legal dispute' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.request.status).toBe('REJECTED');
    });

    it('should return 400 for missing rejectionNote', async () => {
      const res = await request(app)
        .patch('/gdpr/requests/req-1/reject')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 400 for empty rejectionNote', async () => {
      const res = await request(app)
        .patch('/gdpr/requests/req-1/reject')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rejectionNote: '   ' });
      expect(res.status).toBe(400);
    });

    it('should return 404 when request not found', async () => {
      prisma.gdprDeletionRequest.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/gdpr/requests/nonexistent/reject')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rejectionNote: 'Reason' });

      expect(res.status).toBe(404);
    });

    it('should return 400 when request is not PENDING', async () => {
      prisma.gdprDeletionRequest.findUnique.mockResolvedValue({ id: 'req-1', status: 'IN_PROGRESS' });

      const res = await request(app)
        .patch('/gdpr/requests/req-1/reject')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rejectionNote: 'Reason' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Only PENDING requests can be rejected');
    });

    it('should return 500 on database error', async () => {
      prisma.gdprDeletionRequest.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .patch('/gdpr/requests/req-1/reject')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rejectionNote: 'Reason' });

      expect(res.status).toBe(500);
    });
  });

  // ─── GET /gdpr/soft-deleted ───────────────────────────────────────────────

  describe('GET /gdpr/soft-deleted', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/gdpr/soft-deleted');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/gdpr/soft-deleted')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with soft-deleted users for admin', async () => {
      const fakeUsers = [
        { id: 'user-1', email: 'deleted@test.com', firstName: 'John', lastName: 'Doe', deletedAt: new Date(), createdAt: new Date() },
      ];
      prisma.user.findMany.mockResolvedValue(fakeUsers);
      prisma.user.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/gdpr/soft-deleted')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toHaveLength(1);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('should return empty list when no soft-deleted users', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/gdpr/soft-deleted')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(0);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it('should return 500 on database error', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/gdpr/soft-deleted')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /gdpr/restore/:userId ───────────────────────────────────────────

  describe('POST /gdpr/restore/:userId', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/gdpr/restore/user-1');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/gdpr/restore/user-1')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 and restore a soft-deleted user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.com', deletedAt: new Date() });
      prisma.user.update.mockResolvedValue({ id: 'user-1', deletedAt: null });

      const res = await request(app)
        .post('/gdpr/restore/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('restored');
    });

    it('should return 404 when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/gdpr/restore/nonexistent')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('should return 400 when user is not soft-deleted', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.com', deletedAt: null });

      const res = await request(app)
        .post('/gdpr/restore/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('User is not soft-deleted');
    });

    it('should return 500 on database error', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/gdpr/restore/user-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });
});
