/**
 * Tests for admin-alerts routes (Q89)
 * Module: routes/admin-alerts.js — alert events, acknowledge, resolve, silence, stats
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  alertEvent: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
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

const alertsRouter = require('../../routes/admin-alerts');

const app = express();
app.use(express.json());
app.use('/alerts', alertsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

describe('Admin Alerts Routes', () => {
  let prisma;

  beforeEach(() => {
    prisma = require('../../config/db');
    jest.clearAllMocks();
  });

  // ─── GET /alerts/events ───────────────────────────────────────────────────

  describe('GET /alerts/events', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/alerts/events');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/alerts/events')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with events list for admin', async () => {
      const fakeEvents = [
        { id: 'evt-1', type: 'error_rate', severity: 'CRITICAL', status: 'OPEN', message: 'High error rate', createdAt: new Date() },
      ];
      prisma.alertEvent.findMany.mockResolvedValue(fakeEvents);
      prisma.alertEvent.count
        .mockResolvedValueOnce(1)   // total
        .mockResolvedValueOnce(1)   // openCritical
        .mockResolvedValueOnce(0);  // openWarn

      const res = await request(app)
        .get('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.events).toHaveLength(1);
      expect(res.body.data.openSummary).toBeDefined();
      expect(res.body.data.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      prisma.alertEvent.findMany.mockResolvedValue([]);
      prisma.alertEvent.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/alerts/events?status=OPEN')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(prisma.alertEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'OPEN' }) })
      );
    });

    it('should filter by severity', async () => {
      prisma.alertEvent.findMany.mockResolvedValue([]);
      prisma.alertEvent.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/alerts/events?severity=CRITICAL')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(prisma.alertEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ severity: 'CRITICAL' }) })
      );
    });

    it('should return 400 for invalid status filter', async () => {
      const res = await request(app)
        .get('/alerts/events?status=INVALID_STATUS')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid severity filter', async () => {
      const res = await request(app)
        .get('/alerts/events?severity=EXTREME')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(400);
    });

    it('should handle date range filters', async () => {
      prisma.alertEvent.findMany.mockResolvedValue([]);
      prisma.alertEvent.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/alerts/events?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
    });

    it('should return 500 on database error', async () => {
      prisma.alertEvent.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to list alert events');
    });
  });

  // ─── POST /alerts/events ──────────────────────────────────────────────────

  describe('POST /alerts/events', () => {
    const validPayload = {
      type: 'error_rate',
      severity: 'CRITICAL',
      message: 'Error rate above 5%',
    };

    it('should return 401 without auth', async () => {
      const res = await request(app).post('/alerts/events').send(validPayload);
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/alerts/events')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send(validPayload);
      expect(res.status).toBe(403);
    });

    it('should return 201 and create an event for admin', async () => {
      const fakeEvent = { id: 'evt-1', ...validPayload, status: 'OPEN', channel: null, value: null, threshold: null };
      prisma.alertEvent.create.mockResolvedValue(fakeEvent);

      const res = await request(app)
        .post('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event).toBeDefined();
    });

    it('should create event with optional fields', async () => {
      const fakeEvent = { id: 'evt-2', ...validPayload, status: 'OPEN', value: 7.5, threshold: 5.0, channel: 'slack' };
      prisma.alertEvent.create.mockResolvedValue(fakeEvent);

      const res = await request(app)
        .post('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validPayload, value: 7.5, threshold: 5.0, channel: 'slack' });

      expect(res.status).toBe(201);
      expect(res.body.data.event.channel).toBe('slack');
    });

    it('should return 400 for missing type', async () => {
      const res = await request(app)
        .post('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ severity: 'CRITICAL', message: 'Test' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid type', async () => {
      const res = await request(app)
        .post('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'invalid_type', severity: 'CRITICAL', message: 'Test' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid severity', async () => {
      const res = await request(app)
        .post('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'error_rate', severity: 'EXTREME', message: 'Test' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid channel', async () => {
      const res = await request(app)
        .post('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validPayload, channel: 'telegram' });
      expect(res.status).toBe(400);
    });

    it('should return 500 on database error', async () => {
      prisma.alertEvent.create.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/alerts/events')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validPayload);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fire alert event');
    });
  });

  // ─── PATCH /alerts/events/:id/acknowledge ────────────────────────────────

  describe('PATCH /alerts/events/:id/acknowledge', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).patch('/alerts/events/evt-1/acknowledge');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .patch('/alerts/events/evt-1/acknowledge')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 and acknowledge an OPEN event', async () => {
      const fakeEvent = { id: 'evt-1', status: 'OPEN', severity: 'CRITICAL' };
      const updatedEvent = { ...fakeEvent, status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: 'admin-1' };
      prisma.alertEvent.findUnique.mockResolvedValue(fakeEvent);
      prisma.alertEvent.update.mockResolvedValue(updatedEvent);

      const res = await request(app)
        .patch('/alerts/events/evt-1/acknowledge')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.status).toBe('ACKNOWLEDGED');
    });

    it('should return 404 when event not found', async () => {
      prisma.alertEvent.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/alerts/events/nonexistent/acknowledge')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Alert event not found');
    });

    it('should return 400 when event is not OPEN', async () => {
      const fakeEvent = { id: 'evt-1', status: 'RESOLVED' };
      prisma.alertEvent.findUnique.mockResolvedValue(fakeEvent);

      const res = await request(app)
        .patch('/alerts/events/evt-1/acknowledge')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot acknowledge');
    });

    it('should return 500 on database error', async () => {
      prisma.alertEvent.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .patch('/alerts/events/evt-1/acknowledge')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── PATCH /alerts/events/:id/resolve ────────────────────────────────────

  describe('PATCH /alerts/events/:id/resolve', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).patch('/alerts/events/evt-1/resolve');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .patch('/alerts/events/evt-1/resolve')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 and resolve an event', async () => {
      const fakeEvent = { id: 'evt-1', status: 'OPEN' };
      const updatedEvent = { ...fakeEvent, status: 'RESOLVED', resolvedAt: new Date() };
      prisma.alertEvent.findUnique.mockResolvedValue(fakeEvent);
      prisma.alertEvent.update.mockResolvedValue(updatedEvent);

      const res = await request(app)
        .patch('/alerts/events/evt-1/resolve')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.status).toBe('RESOLVED');
    });

    it('should return 404 when event not found', async () => {
      prisma.alertEvent.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/alerts/events/nonexistent/resolve')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
    });

    it('should return 400 when event already resolved', async () => {
      const fakeEvent = { id: 'evt-1', status: 'RESOLVED' };
      prisma.alertEvent.findUnique.mockResolvedValue(fakeEvent);

      const res = await request(app)
        .patch('/alerts/events/evt-1/resolve')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Alert already resolved');
    });

    it('should return 500 on database error', async () => {
      prisma.alertEvent.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .patch('/alerts/events/evt-1/resolve')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── PATCH /alerts/events/:id/silence ────────────────────────────────────

  describe('PATCH /alerts/events/:id/silence', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).patch('/alerts/events/evt-1/silence').send({ minutes: 30 });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .patch('/alerts/events/evt-1/silence')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ minutes: 30 });
      expect(res.status).toBe(403);
    });

    it('should return 200 and silence an event', async () => {
      const fakeEvent = { id: 'evt-1', status: 'OPEN' };
      const updatedEvent = { ...fakeEvent, status: 'SILENCED', silencedUntil: new Date() };
      prisma.alertEvent.findUnique.mockResolvedValue(fakeEvent);
      prisma.alertEvent.update.mockResolvedValue(updatedEvent);

      const res = await request(app)
        .patch('/alerts/events/evt-1/silence')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ minutes: 30 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.silencedUntil).toBeDefined();
    });

    it('should return 404 when event not found', async () => {
      prisma.alertEvent.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch('/alerts/events/nonexistent/silence')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ minutes: 30 });

      expect(res.status).toBe(404);
    });

    it('should return 400 for missing minutes', async () => {
      const res = await request(app)
        .patch('/alerts/events/evt-1/silence')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 400 for minutes = 0', async () => {
      const res = await request(app)
        .patch('/alerts/events/evt-1/silence')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ minutes: 0 });
      expect(res.status).toBe(400);
    });

    it('should return 400 for minutes > 1440', async () => {
      const res = await request(app)
        .patch('/alerts/events/evt-1/silence')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ minutes: 1441 });
      expect(res.status).toBe(400);
    });

    it('should return 500 on database error', async () => {
      prisma.alertEvent.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .patch('/alerts/events/evt-1/silence')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ minutes: 30 });

      expect(res.status).toBe(500);
    });
  });

  // ─── GET /alerts/stats ────────────────────────────────────────────────────

  describe('GET /alerts/stats', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/alerts/stats');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/alerts/stats')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with stats for admin', async () => {
      const fakeEvents = [
        { type: 'error_rate', severity: 'CRITICAL', status: 'RESOLVED', createdAt: new Date(), acknowledgedAt: new Date(), resolvedAt: new Date() },
        { type: 'latency', severity: 'WARN', status: 'OPEN', createdAt: new Date(), acknowledgedAt: null, resolvedAt: null },
      ];
      prisma.alertEvent.findMany.mockResolvedValue(fakeEvents);

      const res = await request(app)
        .get('/alerts/stats')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.byType).toBeDefined();
      expect(res.body.data.bySeverity).toBeDefined();
    });

    it('should return stats for custom days param', async () => {
      prisma.alertEvent.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/alerts/stats?days=7')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.period).toBe('7 days');
    });

    it('should return null for MTTR when no resolved events', async () => {
      prisma.alertEvent.findMany.mockResolvedValue([
        { type: 'cpu', severity: 'INFO', status: 'OPEN', createdAt: new Date(), acknowledgedAt: null, resolvedAt: null },
      ]);

      const res = await request(app)
        .get('/alerts/stats')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.meanTimeToResolveMs).toBeNull();
      expect(res.body.data.meanTimeToAcknowledgeMs).toBeNull();
    });

    it('should compute MTTA and MTTR when events have timestamps', async () => {
      const created = new Date('2026-01-01T10:00:00Z');
      const acked   = new Date('2026-01-01T10:05:00Z');
      const resolved = new Date('2026-01-01T10:30:00Z');
      prisma.alertEvent.findMany.mockResolvedValue([
        { type: 'cpu', severity: 'CRITICAL', status: 'RESOLVED', createdAt: created, acknowledgedAt: acked, resolvedAt: resolved },
      ]);

      const res = await request(app)
        .get('/alerts/stats')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.meanTimeToAcknowledgeMs).toBeGreaterThan(0);
      expect(res.body.data.meanTimeToResolveMs).toBeGreaterThan(0);
    });

    it('should return 200 even for days=0 (no validation check in handler)', async () => {
      // The /stats route declares a validator but does not call validationResult,
      // so invalid query params are silently ignored and the handler still runs.
      prisma.alertEvent.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/alerts/stats?days=0')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('should return 500 on database error', async () => {
      prisma.alertEvent.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/alerts/stats')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to compute alert stats');
    });
  });
});
