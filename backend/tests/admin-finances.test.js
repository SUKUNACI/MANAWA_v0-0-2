const request = require('supertest');
const express = require('express');
const { adminToken } = require('./helpers');

// ── Mock Prisma ────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  user: {
    findUnique: jest.fn(),
  },
  payment: {
    findMany:  jest.fn().mockResolvedValue([]),
    count:     jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    findUnique: jest.fn(),
    update:    jest.fn(),
  },
  subscription: {
    count: jest.fn().mockResolvedValue(0),
  },
  dispute: {
    count:      jest.fn().mockResolvedValue(0),
    findMany:   jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    update:     jest.fn(),
  },
  commission: {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
}));

// ── Mock appConfig ─────────────────────────────────────────────────────────────
jest.mock('../utils/appConfig', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
}));

const prisma = require('../config/db');
const appConfig = require('../utils/appConfig');
const adminRoutes = require('../routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ── Fixtures ───────────────────────────────────────────────────────────────────
const ADMIN_ID  = 'admin-1';
const PRO_ID    = 'pro-1';
const mockAdminUser = { id: ADMIN_ID, role: 'ADMIN', email: 'admin@test.com', suspended: false, adminLevel: 'SUPER', adminPermissions: null };

function useAdmin() {
  prisma.user.findUnique.mockResolvedValue(mockAdminUser);
}

// Helper to create mock payment
const makePayment = (amount, commissionPaid = false) => ({
  id: `pay-${amount}`, amount, commissionPaid,
  isDeposit: false, status: 'succeeded',
  createdAt: new Date(), completedAt: new Date(),
  quote: { professional: { user: { firstName: 'A', lastName: 'B', email: 'a@b.com' } }, project: { title: 'P' } },
});

const makeFullPayment = (proId, amount, commissionPaid = false) => ({
  id: `pay-${proId}-${amount}`, amount, commissionPaid,
  createdAt: new Date(), completedAt: new Date(), status: 'succeeded', isDeposit: false,
  quote: {
    professional: {
      id: proId, trade: 'Maçon', subscription: null,
      user: { id: `user-${proId}`, firstName: 'Pro', lastName: proId, email: `${proId}@test.com`, avatarUrl: null, city: 'Abidjan' },
    },
    project: { title: 'Projet test', id: 'proj-1' },
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// FINANCES — SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/finances/summary', () => {
  beforeEach(() => {
    useAdmin();
    prisma.subscription.count.mockResolvedValue(2);
  });

  test('calcule totalTransactions, totalCommissions, commissionsDues correctement (taux 8%)', async () => {
    appConfig.getConfig.mockResolvedValue(null);
    prisma.payment.findMany.mockResolvedValue([
      makePayment(100000, false),
      makePayment(50000,  true),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalTransactions).toBe(150000);
    expect(res.body.totalCommissions).toBeCloseTo(12000);
    expect(res.body.commissionsDues).toBeCloseTo(8000);
    expect(res.body.commissionsPercues).toBeCloseTo(4000);
  });

  test('respecte un taux de commission personnalisé', async () => {
    appConfig.getConfig
      .mockResolvedValueOnce(0.10)
      .mockResolvedValue(null);
    prisma.payment.findMany.mockResolvedValue([makePayment(200000, false)]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.commissionRate).toBe(0.10);
    expect(res.body.totalCommissions).toBeCloseTo(20000);
    expect(res.body.commissionsDues).toBeCloseTo(20000);
  });

  test('retourne 0 partout sans paiements', async () => {
    appConfig.getConfig.mockResolvedValue(null);
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalTransactions).toBe(0);
    expect(res.body.totalCommissions).toBe(0);
    expect(res.body.commissionsDues).toBe(0);
    expect(res.body.commissionsPercues).toBe(0);
  });

  test('retourne revenueByMonth avec 12 entrées', async () => {
    appConfig.getConfig.mockResolvedValue(null);
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.revenueByMonth).toBeDefined();
    expect(Object.keys(res.body.revenueByMonth)).toHaveLength(12);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FINANCES — COMMISSIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/finances/commissions', () => {
  beforeEach(() => {
    useAdmin();
    appConfig.getConfig.mockResolvedValue(null);
  });

  test('regroupe les paiements par professionnel', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makeFullPayment('pro-a', 100000),
      makeFullPayment('pro-a', 50000),
      makeFullPayment('pro-b', 80000),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    const pros = res.body.professionals;
    expect(pros).toHaveLength(2);

    const proA = pros.find(p => p.professionalId === 'pro-a');
    expect(proA.totalTransactions).toBe(150000);
    expect(proA.commissionDue).toBeCloseTo(12000);
  });

  test('filtre status=due — exclut les pros sans commission due', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makeFullPayment('pro-a', 100000, false),
      makeFullPayment('pro-b', 50000,  true),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions?status=due')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.professionals).toHaveLength(1);
    expect(res.body.professionals[0].professionalId).toBe('pro-a');
  });

  test('filtre status=paid — exclut les pros avec commission due', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makeFullPayment('pro-a', 100000, false),
      makeFullPayment('pro-b', 50000,  true),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions?status=paid')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.professionals).toHaveLength(1);
    expect(res.body.professionals[0].professionalId).toBe('pro-b');
  });

  test('trie par commissionDue décroissante', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makeFullPayment('pro-petit',  10000, false),
      makeFullPayment('pro-grand', 200000, false),
      makeFullPayment('pro-moyen',  50000, false),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const dues = res.body.professionals.map(p => p.commissionDue);
    expect(dues[0]).toBeGreaterThan(dues[1]);
    expect(dues[1]).toBeGreaterThan(dues[2]);
  });

  test('pagination — retourne page 1 avec le bon total', async () => {
    const payments = Array.from({ length: 5 }, (_, i) => makeFullPayment(`pro-${i}`, 10000));
    prisma.payment.findMany.mockResolvedValue(payments);

    const res = await request(app)
      .get('/api/admin/finances/commissions?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.total).toBe(5);
    expect(res.body.professionals).toHaveLength(2);
    expect(res.body.totalPages).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FINANCES — COMMISSION MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('Admin EXTENDED: Financial & Commission Management', () => {
  beforeEach(() => {
    useAdmin();
  });

  test('PATCH /api/admin/finances/commissions/:professionalId/mark-paid - mark paid', async () => {
    prisma.commission.update.mockResolvedValue({
      id: 'comm-1', professionalId: PRO_ID, paid: true, paidAt: new Date(),
    });

    const res = await request(app)
      .patch(`/api/admin/finances/commissions/${PRO_ID}/mark-paid`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ paidAt: new Date() });

    expect(res.status).toBe(200);
  });

  test('GET /api/admin/finances/commissions - list all commissions', async () => {
    prisma.commission.findMany.mockResolvedValue([
      { id: 'comm-1', paid: false, amount: 100 },
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/admin/finances/commissions?paid=false - filter unpaid', async () => {
    prisma.commission.findMany.mockResolvedValue([
      { id: 'comm-1', paid: false, amount: 100 },
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions?paid=false')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/admin/finances/payments - list payments', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', amount: 500, status: 'COMPLETED' },
    ]);

    const res = await request(app)
      .get('/api/admin/finances/payments')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/admin/finances/payments/stats - payment statistics', async () => {
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 50000 }, _count: { id: 150 },
    });

    const res = await request(app)
      .get('/api/admin/finances/payments/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
  });
});
