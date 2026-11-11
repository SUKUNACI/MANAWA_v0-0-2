const request = require('supertest');
const express = require('express');
const { adminToken } = require('./helpers');

// ── Mock Prisma ────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  user: {
    findUnique: jest.fn(),
  },
  supportTicket: {
    count:      jest.fn().mockResolvedValue(0),
    findMany:   jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    groupBy:    jest.fn().mockResolvedValue([]),
    update:     jest.fn(),
  },
  supportMessage: {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn(),
  },
  message: {
    findMany:  jest.fn().mockResolvedValue([]),
    count:     jest.fn().mockResolvedValue(0),
    groupBy:   jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    delete:    jest.fn(),
  },
  review: {
    count:    jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    update:   jest.fn(),
    delete:   jest.fn(),
  },
  portfolioComment: {
    delete: jest.fn(),
  },
}));

// ── Mock appConfig ─────────────────────────────────────────────────────────────
jest.mock('../utils/appConfig', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
}));

const prisma = require('../config/db');
const adminRoutes = require('../routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ── Fixtures ───────────────────────────────────────────────────────────────────
const ADMIN_ID  = 'admin-1';
const mockAdminUser = { id: ADMIN_ID, role: 'ADMIN', email: 'admin@test.com', suspended: false, adminLevel: 'SUPER', adminPermissions: null };

function useAdmin() {
  prisma.user.findUnique.mockResolvedValue(mockAdminUser);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUPPORT TICKET MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/support/stats', () => {
  beforeEach(() => {
    useAdmin();
    prisma.supportTicket.count
      .mockResolvedValueOnce(10)  // total
      .mockResolvedValueOnce(4)   // OPEN
      .mockResolvedValueOnce(3)   // IN_PROGRESS
      .mockResolvedValueOnce(2)   // RESOLVED
      .mockResolvedValueOnce(1);  // CLOSED
    prisma.supportTicket.groupBy.mockResolvedValue([
      { category: 'PAYMENT', _count: { _all: 5 } },
      { category: 'ACCOUNT', _count: { _all: 3 } },
    ]);
    prisma.supportTicket.findMany.mockResolvedValue([]);
  });

  test('retourne les compteurs par statut', async () => {
    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.open).toBe(4);
    expect(res.body.inProgress).toBe(3);
    expect(res.body.resolved).toBe(2);
    expect(res.body.closed).toBe(1);
  });

  test('retourne byCategory indexé par clé', async () => {
    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.byCategory.PAYMENT).toBe(5);
    expect(res.body.byCategory.ACCOUNT).toBe(3);
  });

  test('avgResolutionHours est null sans tickets résolus', async () => {
    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.avgResolutionHours).toBeNull();
  });

  test('calcule avgResolutionHours sur les tickets résolus', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now - 48 * 3600 * 1000);
    prisma.supportTicket.findMany.mockResolvedValue([
      { createdAt: twoDaysAgo, updatedAt: now },
    ]);

    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.avgResolutionHours).toBe(48);
  });
});

describe('GET /api/admin/support/tickets — filtre category', () => {
  beforeEach(() => {
    useAdmin();
    prisma.supportTicket.findMany.mockResolvedValue([]);
  });

  test('passe category au where Prisma', async () => {
    await request(app)
      .get('/api/admin/support/tickets?category=PAYMENT')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'PAYMENT' }) })
    );
  });

  test('passe status au where Prisma', async () => {
    await request(app)
      .get('/api/admin/support/tickets?status=OPEN')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'OPEN' }) })
    );
  });

  test('retourne 200 avec tableau vide', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
  });
});

describe('ADMIN EXTENDED: Support Ticket Management (Advanced)', () => {
  beforeEach(() => {
    useAdmin();
    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 'ticket-1', userId: 'user-1', subject: 'Payment Issue',
      status: 'OPEN', priority: 'MEDIUM', category: 'PAYMENT',
      createdAt: new Date(), updatedAt: new Date(), messages: [],
    });
    prisma.supportMessage.findMany.mockResolvedValue([]);
  });

  test('PATCH /api/admin/support/tickets/:id/priority - change priority', async () => {
    prisma.supportTicket.update.mockResolvedValue({
      id: 'ticket-1', priority: 'HIGH',
    });

    const res = await request(app)
      .patch('/api/admin/support/tickets/ticket-1/priority')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ priority: 'HIGH' });

    expect(res.status).toBe(200);
  });

  test('PATCH /api/admin/support/tickets/:id/assign - assign to admin', async () => {
    prisma.supportTicket.update.mockResolvedValue({
      id: 'ticket-1', assignedToAdminId: 'admin-2',
    });

    const res = await request(app)
      .patch('/api/admin/support/tickets/ticket-1/assign')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ assignedToAdminId: 'admin-2' });

    expect(res.status).toBe(200);
  });

  test('GET /api/admin/support/tickets?search=payment - search tickets', async () => {
    prisma.supportTicket.findMany.mockResolvedValue([
      { id: 'ticket-1', subject: 'payment issue' },
    ]);

    const res = await request(app)
      .get('/api/admin/support/tickets?search=payment')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/admin/support/tickets?status=OPEN - filter by status', async () => {
    prisma.supportTicket.findMany.mockResolvedValue([
      { id: 'ticket-1', status: 'OPEN' },
    ]);

    const res = await request(app)
      .get('/api/admin/support/tickets?status=OPEN')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGING ADMIN
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/messaging/stats', () => {
  beforeEach(() => {
    useAdmin();
    prisma.message.count.mockResolvedValue(100);
    prisma.message.findMany.mockResolvedValue([]);
    prisma.message.groupBy.mockResolvedValue([]);
  });

  test('retourne 200 avec les clés attendues', async () => {
    const res = await request(app)
      .get('/api/admin/messaging/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('unread');
    expect(res.body).toHaveProperty('totalConversations');
    expect(res.body).toHaveProperty('activeConversations');
    expect(res.body).toHaveProperty('topSenders');
  });
});

describe('DELETE /api/admin/messaging/messages/:id', () => {
  beforeEach(() => {
    useAdmin();
  });

  test('supprime le message et retourne success', async () => {
    prisma.message.findUnique.mockResolvedValue({ id: 'msg-1', content: 'hello' });
    prisma.message.delete.mockResolvedValue({ id: 'msg-1' });

    const res = await request(app)
      .delete('/api/admin/messaging/messages/msg-1')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.message.delete).toHaveBeenCalledWith({ where: { id: 'msg-1' } });
  });

  test('retourne 404 si message introuvable', async () => {
    prisma.message.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/admin/messaging/messages/inexistant')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });
});
