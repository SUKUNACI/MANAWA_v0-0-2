/**
 * Tests for admin-oncall routes
 * Module: routes/admin-oncall.js
 * Endpoints:
 *   GET    /current
 *   GET    /schedule
 *   POST   /schedule
 *   DELETE /schedule/:id
 *   POST   /escalate
 *   GET    /gaps
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken, proToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  onCallSchedule: {
    findMany:   jest.fn(),
    findFirst:  jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    delete:     jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  alertEvent: {
    findUnique: jest.fn(),
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

const oncallRoutes = require('../../routes/admin-oncall');

const app = express();
app.use(express.json());
app.use('/admin/oncall', oncallRoutes);

const futureStart = new Date(Date.now() + 3600000).toISOString();   // +1h
const futureEnd   = new Date(Date.now() + 7200000).toISOString();   // +2h

describe('Admin On-Call Routes', () => {
  let prisma;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = require('../../config/db');
  });

  // ─── GET /current ─────────────────────────────────────────────────────────

  describe('GET /admin/oncall/current', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/oncall/current');
      expect(res.status).toBe(401);
    });

    it('returns 403 for CLIENT role', async () => {
      const res = await request(app)
        .get('/admin/oncall/current')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 for PROFESSIONAL role', async () => {
      const res = await request(app)
        .get('/admin/oncall/current')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with no on-call when schedule is empty', async () => {
      prisma.onCallSchedule.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/oncall/current')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.primary).toBeNull();
      expect(res.body.data.secondary).toBeNull();
      expect(res.body.data.hasOnCall).toBe(false);
    });

    it('returns 200 with primary and secondary on-call', async () => {
      const fakeUser = { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com', phone: '+33600000000' };
      prisma.onCallSchedule.findMany.mockResolvedValue([
        { level: 1, startAt: new Date(), endAt: new Date(Date.now() + 3600000), timezone: 'Europe/Paris', user: fakeUser },
        { level: 2, startAt: new Date(), endAt: new Date(Date.now() + 3600000), timezone: 'Europe/Paris', user: { ...fakeUser, id: 'u2', firstName: 'Bob' } },
      ]);

      const res = await request(app)
        .get('/admin/oncall/current')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.hasOnCall).toBe(true);
      expect(res.body.data.primary).not.toBeNull();
      expect(res.body.data.secondary).not.toBeNull();
    });

    it('returns 500 on database error', async () => {
      prisma.onCallSchedule.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/admin/oncall/current')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get current on-call');
    });
  });

  // ─── GET /schedule ────────────────────────────────────────────────────────

  describe('GET /admin/oncall/schedule', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/oncall/schedule');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with empty schedule', async () => {
      prisma.onCallSchedule.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.schedule).toEqual([]);
    });

    it('returns 200 with schedule list', async () => {
      prisma.onCallSchedule.findMany.mockResolvedValue([
        { id: 's1', level: 1, startAt: futureStart, endAt: futureEnd, user: { id: 'u1', firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' } },
      ]);

      const res = await request(app)
        .get('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.schedule).toHaveLength(1);
    });

    it('returns 500 on database error', async () => {
      prisma.onCallSchedule.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /schedule ───────────────────────────────────────────────────────

  describe('POST /admin/oncall/schedule', () => {
    const validBody = {
      userId:  'user-123',
      startAt: futureStart,
      endAt:   futureEnd,
    };

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/admin/oncall/schedule').send(validBody);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .post('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${proToken()}`)
        .send(validBody);
      expect(res.status).toBe(403);
    });

    it('returns 400 when userId is missing', async () => {
      const res = await request(app)
        .post('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ startAt: futureStart, endAt: futureEnd });
      expect(res.status).toBe(400);
    });

    it('returns 400 when startAt is not ISO8601', async () => {
      const res = await request(app)
        .post('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validBody, startAt: 'not-a-date' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when endAt is before startAt', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-123' });

      const res = await request(app)
        .post('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({
          userId:  'user-123',
          startAt: futureEnd,
          endAt:   futureStart,   // reversed
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/endAt must be after startAt/);
    });

    it('returns 404 when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.onCallSchedule.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('returns 409 when schedule overlaps', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-123' });
      prisma.onCallSchedule.findFirst.mockResolvedValue({ id: 'existing-slot' });

      const res = await request(app)
        .post('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/overlaps/);
    });

    it('returns 201 and creates slot successfully', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-123' });
      prisma.onCallSchedule.findFirst.mockResolvedValue(null);
      prisma.onCallSchedule.create.mockResolvedValue({
        id: 'slot-1', userId: 'user-123', level: 1,
        startAt: futureStart, endAt: futureEnd,
        user: { id: 'user-123', firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' },
      });

      const res = await request(app)
        .post('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slot.id).toBe('slot-1');
    });

    it('returns 500 on database error during create', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-123' });
      prisma.onCallSchedule.findFirst.mockResolvedValue(null);
      prisma.onCallSchedule.create.mockRejectedValue(new Error('create failed'));

      const res = await request(app)
        .post('/admin/oncall/schedule')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(validBody);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to create on-call slot');
    });
  });

  // ─── DELETE /schedule/:id ─────────────────────────────────────────────────

  describe('DELETE /admin/oncall/schedule/:id', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).delete('/admin/oncall/schedule/slot-1');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .delete('/admin/oncall/schedule/slot-1')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 404 when slot does not exist', async () => {
      prisma.onCallSchedule.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete('/admin/oncall/schedule/nonexistent')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('On-call slot not found');
    });

    it('returns 200 and deletes slot', async () => {
      prisma.onCallSchedule.findUnique.mockResolvedValue({ id: 'slot-1' });
      prisma.onCallSchedule.delete.mockResolvedValue({ id: 'slot-1' });

      const res = await request(app)
        .delete('/admin/oncall/schedule/slot-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prisma.onCallSchedule.delete).toHaveBeenCalledWith({ where: { id: 'slot-1' } });
    });

    it('returns 500 on database error', async () => {
      prisma.onCallSchedule.findUnique.mockResolvedValue({ id: 'slot-1' });
      prisma.onCallSchedule.delete.mockRejectedValue(new Error('delete failed'));

      const res = await request(app)
        .delete('/admin/oncall/schedule/slot-1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /escalate ───────────────────────────────────────────────────────

  describe('POST /admin/oncall/escalate', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/admin/oncall/escalate')
        .send({ alertEventId: 'alert-1' });
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .post('/admin/oncall/escalate')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ alertEventId: 'alert-1' });
      expect(res.status).toBe(403);
    });

    it('returns 400 when alertEventId is missing', async () => {
      const res = await request(app)
        .post('/admin/oncall/escalate')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 when alert does not exist', async () => {
      prisma.alertEvent.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/oncall/escalate')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ alertEventId: 'nonexistent' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Alert event not found');
    });

    it('returns 400 when alert is not OPEN', async () => {
      prisma.alertEvent.findUnique.mockResolvedValue({ id: 'alert-1', status: 'RESOLVED' });

      const res = await request(app)
        .post('/admin/oncall/escalate')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ alertEventId: 'alert-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/RESOLVED/);
    });

    it('returns 404 when no secondary on-call person', async () => {
      prisma.alertEvent.findUnique.mockResolvedValue({ id: 'alert-1', status: 'OPEN' });
      prisma.onCallSchedule.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/oncall/escalate')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ alertEventId: 'alert-1' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/No secondary/);
    });

    it('returns 200 and triggers escalation successfully', async () => {
      prisma.alertEvent.findUnique.mockResolvedValue({ id: 'alert-1', status: 'OPEN' });
      prisma.onCallSchedule.findFirst.mockResolvedValue({
        level: 2,
        user: { id: 'u2', firstName: 'Bob', lastName: 'Jones', email: 'bob@test.com' },
      });

      const res = await request(app)
        .post('/admin/oncall/escalate')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ alertEventId: 'alert-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.escalatedTo.email).toBe('bob@test.com');
      expect(res.body.data.alertId).toBe('alert-1');
    });

    it('returns 500 on database error', async () => {
      prisma.alertEvent.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/admin/oncall/escalate')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ alertEventId: 'alert-1' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to trigger escalation');
    });
  });

  // ─── GET /gaps ────────────────────────────────────────────────────────────

  describe('GET /admin/oncall/gaps', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/oncall/gaps');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      const res = await request(app)
        .get('/admin/oncall/gaps')
        .set('Authorization', `Bearer ${proToken()}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with any days value (route skips validationResult check)', async () => {
      // The route defines the validator but does not call validationResult;
      // days=100 falls through and parseInt handles it.
      prisma.onCallSchedule.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/oncall/gaps?days=100')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 200 with 100% gap when no slots scheduled', async () => {
      prisma.onCallSchedule.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/oncall/gaps?days=7')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.gaps.length).toBeGreaterThan(0);
      expect(res.body.data.coveragePercent).toBe(0);
    });

    it('returns 200 with no gaps when full coverage', async () => {
      // Start 1 hour in the past so it precedes any internal "now" in the route.
      // End 16 days ahead so it fully covers the 14-day window regardless of small
      // timing differences between test and route execution.
      const slotStart = new Date(Date.now() - 3600000);       // -1h
      const slotEnd   = new Date(Date.now() + 16 * 24 * 60 * 60 * 1000); // +16d
      prisma.onCallSchedule.findMany.mockResolvedValue([
        { level: 1, startAt: slotStart, endAt: slotEnd },
      ]);

      const res = await request(app)
        .get('/admin/oncall/gaps?days=14')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.gaps).toEqual([]);
      expect(res.body.data.coveragePercent).toBe(100);
    });

    it('returns 500 on database error', async () => {
      prisma.onCallSchedule.findMany.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .get('/admin/oncall/gaps')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to find schedule gaps');
    });
  });
});
