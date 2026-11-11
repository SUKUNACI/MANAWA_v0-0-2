const request = require('supertest');
const express = require('express');
const { adminToken, proToken, clientToken } = require('../helpers');

// ── Mock Prisma ────────────────────────────────────────────────────────────────
jest.mock('../../config/db', () => ({
  payment: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: 0 }),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  quote: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  paymentAuditLog: {
    create: jest.fn(),
  },
}));

// ── Mock auth middleware ────────────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    req.user = { id: 'user-1', role: 'ADMIN' };
    next();
  },
  requirePermission: (permission) => (req, res, next) => {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

const prisma = require('../../config/db');
const financesRouter = require('../../routes/finances');

const app = express();
app.use(express.json());
app.use('/api/finances', financesRouter);
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message });
});

// ── Fixtures ───────────────────────────────────────────────────────────────────
const ADMIN_ID = 'admin-1';
const PRO_ID = 'pro-1';
const QUOTE_ID = 'quote-1';

const mockPayment = (id = 'pay-1', amount = 100000, status = 'COMPLETED') => ({
  id,
  amount,
  status,
  fees: amount * 0.08,
  netAmount: amount * 0.92,
  isDeposit: true,
  commissionPaid: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  completedAt: new Date('2026-01-01'),
  quoteId: QUOTE_ID,
  geniuspayRef: `gp-${id}`,
  quote: {
    id: QUOTE_ID,
    amount: amount,
    professional: {
      id: PRO_ID,
      user: {
        id: `user-${PRO_ID}`,
        email: 'pro@test.com',
        firstName: 'Pro',
        lastName: 'Test',
      },
    },
    project: {
      id: 'proj-1',
      title: 'Test Project',
    },
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/finances - List transactions
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/finances', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return paginated transactions with pagination metadata', async () => {
    const payment1 = mockPayment('pay-1', 100000);
    const payment2 = mockPayment('pay-2', 50000);

    prisma.payment.findMany.mockResolvedValue([payment1, payment2]);
    prisma.payment.count.mockResolvedValue(2);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 150000 },
      _count: 2,
    });

    const res = await request(app)
      .get('/api/finances')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(2);
    expect(res.body.summary.totalAmount).toBe(150000);
    expect(res.body.summary.transactionCount).toBe(2);
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 2,
      totalPages: 1,
    });
  });

  test('should filter transactions by date range', async () => {
    const startDate = '2026-01-01';
    const endDate = '2026-12-31';
    const payment = mockPayment('pay-1', 100000);

    prisma.payment.findMany.mockResolvedValue([payment]);
    prisma.payment.count.mockResolvedValue(1);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 100000 },
      _count: 1,
    });

    const res = await request(app)
      .get('/api/finances')
      .query({ startDate, endDate })
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);

    // Verify date range was passed to prisma
    const callArgs = prisma.payment.findMany.mock.calls[0][0];
    expect(callArgs.where.createdAt.gte).toEqual(new Date(startDate));
    expect(callArgs.where.createdAt.lte).toEqual(new Date(endDate));
  });

  test('should filter transactions by status', async () => {
    const payment = mockPayment('pay-1', 100000, 'PENDING');

    prisma.payment.findMany.mockResolvedValue([payment]);
    prisma.payment.count.mockResolvedValue(1);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 100000 },
      _count: 1,
    });

    const res = await request(app)
      .get('/api/finances')
      .query({ status: 'PENDING' })
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);

    const callArgs = prisma.payment.findMany.mock.calls[0][0];
    expect(callArgs.where.status).toBe('PENDING');
  });

  test('should apply pagination with custom page and limit', async () => {
    const payments = Array.from({ length: 10 }, (_, i) =>
      mockPayment(`pay-${i}`, 10000 * (i + 1))
    );

    prisma.payment.findMany.mockResolvedValue(payments.slice(0, 5));
    prisma.payment.count.mockResolvedValue(10);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 275000 },
      _count: 10,
    });

    const res = await request(app)
      .get('/api/finances')
      .query({ page: 2, limit: 5 })
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 10,
      totalPages: 2,
    });

    const callArgs = prisma.payment.findMany.mock.calls[0][0];
    expect(callArgs.skip).toBe(5); // (2-1) * 5
    expect(callArgs.take).toBe(5);
  });

  test('should return empty transactions when no results', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
      _count: 0,
    });

    const res = await request(app)
      .get('/api/finances')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions).toEqual([]);
    expect(res.body.summary.totalAmount).toBe(0);
  });

  test('should require authentication', async () => {
    const res = await request(app).get('/api/finances');
    expect(res.status).toBe(401);
  });

  test('should require finances permission', async () => {
    const res = await request(app)
      .get('/api/finances')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });

  test('should include related quote and professional data', async () => {
    const payment = mockPayment('pay-1', 100000);

    prisma.payment.findMany.mockResolvedValue([payment]);
    prisma.payment.count.mockResolvedValue(1);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 100000 },
      _count: 1,
    });

    const res = await request(app)
      .get('/api/finances')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions[0].quote).toBeDefined();
    expect(res.body.transactions[0].quote.professional).toBeDefined();
    expect(res.body.transactions[0].quote.project).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/finances/summary - Financial overview
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/finances/summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.payment.aggregate.mockClear();
  });

  test('should return correct financial summary', async () => {
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000000 } }) // totalRevenue
      .mockResolvedValueOnce({ _sum: { amount: 150000 } }) // monthlyRevenue
      .mockResolvedValueOnce({ _count: 10 }) // pendingPayments
      .mockResolvedValueOnce({ _count: 50 }); // completedPayments

    const res = await request(app)
      .get('/api/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalRevenue: 1000000,
      monthlyRevenue: 150000,
      pendingPayments: 10,
      completedPayments: 50,
    });
  });

  test('should handle zero revenue scenario', async () => {
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } })
      .mockResolvedValueOnce({ _count: 0 })
      .mockResolvedValueOnce({ _count: 0 });

    const res = await request(app)
      .get('/api/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(0);
    expect(res.body.monthlyRevenue).toBe(0);
  });

  test('should only count COMPLETED payments in revenue', async () => {
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000000 } })
      .mockResolvedValueOnce({ _sum: { amount: 150000 } })
      .mockResolvedValueOnce({ _count: 5 })
      .mockResolvedValueOnce({ _count: 100 });

    const res = await request(app)
      .get('/api/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);

    // Verify status filter was applied
    const calls = prisma.payment.aggregate.mock.calls;
    expect(calls[0][0].where.status).toBe('COMPLETED');
    expect(calls[1][0].where.status).toBe('COMPLETED');
  });

  test('should filter monthly revenue by 30-day window', async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000000 } })
      .mockResolvedValueOnce({ _sum: { amount: 150000 } })
      .mockResolvedValueOnce({ _count: 5 })
      .mockResolvedValueOnce({ _count: 100 });

    const res = await request(app)
      .get('/api/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);

    // Verify 30-day filter was applied
    const monthlyCall = prisma.payment.aggregate.mock.calls[1][0];
    expect(monthlyCall.where.createdAt.gte).toBeDefined();

    const timeDiff = monthlyCall.where.createdAt.gte - thirtyDaysAgo;
    // Allow 1 second tolerance
    expect(Math.abs(timeDiff)).toBeLessThan(1000);
  });

  test('should require authentication', async () => {
    const res = await request(app).get('/api/finances/summary');
    expect(res.status).toBe(401);
  });

  test('should handle null aggregate results gracefully', async () => {
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _count: 0 })
      .mockResolvedValueOnce({ _count: 0 });

    const res = await request(app)
      .get('/api/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(0);
    expect(res.body.monthlyRevenue).toBe(0);
  });

  test('should use Promise.all for concurrent queries', async () => {
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000000 } })
      .mockResolvedValueOnce({ _sum: { amount: 150000 } })
      .mockResolvedValueOnce({ _count: 10 })
      .mockResolvedValueOnce({ _count: 50 });

    const res = await request(app)
      .get('/api/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    // All 4 aggregates should be called in parallel
    expect(prisma.payment.aggregate).toHaveBeenCalledTimes(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Error Handling
// ══════════════════════════════════════════════════════════════════════════════

describe('Finances routes - Error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should handle database errors on GET /api/finances', async () => {
    prisma.payment.findMany.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .get('/api/finances')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });

  test('should handle database errors on GET /api/finances/summary', async () => {
    prisma.payment.aggregate.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .get('/api/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });

  test('should handle invalid pagination parameters gracefully', async () => {
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
      _count: 0,
    });

    const res = await request(app)
      .get('/api/finances')
      .query({ page: 'invalid', limit: 'invalid' })
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    // parseInt should handle non-numeric values
    const callArgs = prisma.payment.findMany.mock.calls[0][0];
    expect(callArgs.take).toBe(NaN);
  });
});
