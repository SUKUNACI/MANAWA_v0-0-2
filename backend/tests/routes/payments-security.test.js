/**
 * Security test: Payment amount must be server-calculated
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../../config/db', () => ({
  quote: { findUnique: jest.fn() },
  payment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
}));

jest.mock('../../utils/geniuspay', () => ({
  createPayment: jest.fn().mockResolvedValue({ payment_url: 'https://pay.example.com', reference: 'ref-123' }),
}));

jest.mock('../../utils/paymentAudit', () => ({
  logPaymentStatus: jest.fn().mockResolvedValue({}),
}));

const JWT_SECRET = 'test-secret-key-min-32-characters-long';
process.env.JWT_SECRET = JWT_SECRET;

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
}));

const prisma = require('../../config/db');
const paymentsRoute = require('../../routes/payments');

const app = express();
app.use(express.json());
app.use('/api', paymentsRoute);

const userId = 'client-123';
const quoteId = '550e8400-e29b-41d4-a716-446655440000';
const authToken = jwt.sign({ id: userId, role: 'CLIENT', email: 'client@test.com' }, JWT_SECRET);

describe('Payments Security — Amount Server-Calculated', () => {
  beforeEach(() => jest.clearAllMocks());

  test('Amount from quote, not client — attacker sends amount: 1 for 100000 devis', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      id: quoteId,
      clientId: userId,
      amount: 100000,
      status: 'ACCEPTED',
      client: { id: userId },
      professional: { id: 'prof-123' },
    });
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockResolvedValue({
      id: 'payment-123',
      quoteId,
      amount: 100000,
      status: 'pending',
      idempotencyKey: `payment-${quoteId}-full`,
    });
    prisma.payment.update.mockResolvedValue({ id: 'payment-123', geniuspayRef: 'ref-123' });

    const res = await request(app)
      .post('/api/create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ quoteId, amount: 1, isDeposit: false });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(100000);

    const createCall = prisma.payment.create.mock.calls[0][0];
    expect(createCall.data.amount).toBe(100000);
  });

  test('Idempotency: Same quoteId + isDeposit = same key (not Date.now())', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      id: quoteId, clientId: userId, amount: 100000, status: 'ACCEPTED',
      client: { id: userId }, professional: { id: 'prof-123' },
    });
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockResolvedValue({
      id: 'payment-123', quoteId, amount: 100000, status: 'pending',
      idempotencyKey: `payment-${quoteId}-full`,
    });
    prisma.payment.update.mockResolvedValue({ id: 'payment-123', geniuspayRef: 'ref-123' });

    await request(app)
      .post('/api/create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ quoteId, amount: 50000, isDeposit: false });

    const key1 = prisma.payment.create.mock.calls[0][0].data.idempotencyKey;
    expect(key1).toMatch(/^payment-/);
    expect(key1).not.toMatch(/\d{13}$/);
  });
});
