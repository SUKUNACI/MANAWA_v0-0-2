/**
 * Unit tests for payments-retry route — fully mocked (no real DB needed).
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// --- Mocks ---
jest.mock('../../config/db', () => ({
  payment: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  promoCode: {
    findUnique: jest.fn(),
  },
  paymentAuditLog: {
    create: jest.fn(),
  },
}));

jest.mock('../../utils/geniuspay', () => ({
  createPayment: jest.fn(),
  getPayment: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  verifyWebhookTimestamp: jest.fn(),
}));

jest.mock('../../config/queue', () => ({
  emailQueue: { add: jest.fn().mockResolvedValue({}) },
  notificationQueue: { add: jest.fn().mockResolvedValue({}) },
  smsQueue: { add: jest.fn().mockResolvedValue({}) },
  analyticsQueue: { add: jest.fn().mockResolvedValue({}) },
  pdfQueue: { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../../utils/notification-triggers', () => ({
  sendNotification: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn(() => ({})),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn(() => []),
}));

jest.mock('../../middleware/validateInput', () => ({
  handleValidationErrors: (req, res, next) => next(),
}));

// Mock requireAuth middleware
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const jwtLib = require('jsonwebtoken');
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Non authentifié' });
    try {
      req.user = jwtLib.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token invalide' });
    }
  },
}));

const prisma = require('../../config/db');
const geniuspayMock = require('../../utils/geniuspay');
const paymentsRetryRouter = require('../../routes/payments-retry');

const app = express();
app.use(express.json());
app.use('/payments', paymentsRetryRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

function makeToken(payload = {}) {
  return jwt.sign(
    { id: 'client-user-id', role: 'CLIENT', email: 'client@test.com', ...payload },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const CLIENT_USER_ID = 'client-user-id';
const TOKEN = makeToken({ id: CLIENT_USER_ID });

function makePayment(overrides = {}) {
  return {
    id: uuidv4(),
    amount: 500,
    status: 'failed',
    isDeposit: true,
    geniuspayRef: null,
    metadata: JSON.stringify({ promoCodeId: null }),
    auditLogs: [],
    quote: {
      id: uuidv4(),
      professionalId: 'pro-id',
      project: {
        id: uuidv4(),
        title: 'Test Project',
        clientId: CLIENT_USER_ID,
        client: {
          id: CLIENT_USER_ID,
          email: 'client@test.com',
          firstName: 'Jean',
          lastName: 'Dupont',
          phone: '+225001234',
        },
      },
      professional: {
        id: 'pro-id',
        userId: 'pro-user-id',
        user: {
          id: 'pro-user-id',
          email: 'pro@test.com',
          firstName: 'Marie',
          lastName: 'Martin',
        },
      },
    },
    ...overrides,
  };
}

describe('POST /payments/:paymentId/retry — unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app)
      .post(`/payments/${uuidv4()}/retry`)
      .send({});

    expect(res.status).toBe(401);
  });

  test('should return 404 if payment not found', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/payments/${uuidv4()}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('introuvable');
  });

  test('should return 403 if user is not payment owner', async () => {
    const payment = makePayment({
      quote: {
        ...makePayment().quote,
        project: {
          ...makePayment().quote.project,
          clientId: 'other-client-id',
        },
        professional: {
          id: 'pro-id',
          userId: 'pro-user-id',
          user: { id: 'pro-user-id' },
        },
      },
    });
    prisma.payment.findUnique.mockResolvedValue(payment);

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(403);
  });

  test('should return 400 if payment status is not "failed"', async () => {
    const payment = makePayment({ status: 'succeeded' });
    prisma.payment.findUnique.mockResolvedValue(payment);

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ne peut pas être réessayé');
  });

  test('should return 400 if max retry attempts (3) exceeded', async () => {
    const payment = makePayment({
      auditLogs: [
        { reason: 'retry' },
        { reason: 'retry' },
        { reason: 'retry' },
      ],
    });
    prisma.payment.findUnique.mockResolvedValue(payment);

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Maximum');
  });

  test('should return 500 if GeniusPay createPayment fails', async () => {
    const payment = makePayment();
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.paymentAuditLog.create.mockResolvedValue({});
    geniuspayMock.createPayment.mockRejectedValue(new Error('GeniusPay down'));

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Impossible de réessayer');
  });

  test('should return 200 with paymentLink on successful retry', async () => {
    const payment = makePayment();
    prisma.payment.findUnique.mockResolvedValue(payment);
    geniuspayMock.createPayment.mockResolvedValue({
      reference: 'GP_REF_001',
      payment_link: 'https://pay.example.com/GP_REF_001',
    });
    prisma.payment.update.mockResolvedValue({
      ...payment,
      id: payment.id,
      status: 'pending',
      amount: 500,
      geniuspayRef: 'GP_REF_001',
    });
    prisma.paymentAuditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.geniuspayRef).toBe('GP_REF_001');
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.retryAttempt).toBe(1);
  });

  test('should reapply PERCENT promo code when metadata has promoCodeId', async () => {
    const promoCodeId = uuidv4();
    const payment = makePayment({
      amount: 1000,
      metadata: JSON.stringify({ promoCodeId }),
    });
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.promoCode.findUnique.mockResolvedValue({
      id: promoCodeId,
      code: 'PROMO10',
      active: true,
      validUntil: null,
      discountType: 'PERCENT',
      discountValue: 10,
    });
    geniuspayMock.createPayment.mockResolvedValue({
      reference: 'GP_REF_PROMO',
      payment_link: 'https://pay.example.com/GP_REF_PROMO',
    });
    prisma.payment.update.mockResolvedValue({
      ...payment,
      status: 'pending',
      amount: 900,
      geniuspayRef: 'GP_REF_PROMO',
    });
    prisma.paymentAuditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.appliedPromoCode).toBe('PROMO10');
    expect(res.body.data.discountAmount).toBe(100); // 10% of 1000
    expect(res.body.data.amount).toBe(900); // 1000 - 100
  });

  test('should reapply FIXED promo code when metadata has promoCodeId', async () => {
    const promoCodeId = uuidv4();
    const payment = makePayment({
      amount: 500,
      metadata: JSON.stringify({ promoCodeId }),
    });
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.promoCode.findUnique.mockResolvedValue({
      id: promoCodeId,
      code: 'FIXED50',
      active: true,
      validUntil: null,
      discountType: 'FIXED',
      discountValue: 50,
    });
    geniuspayMock.createPayment.mockResolvedValue({
      reference: 'GP_REF_FIXED',
      payment_link: 'https://pay.example.com/GP_REF_FIXED',
    });
    prisma.payment.update.mockResolvedValue({
      ...payment,
      status: 'pending',
      amount: 450,
      geniuspayRef: 'GP_REF_FIXED',
    });
    prisma.paymentAuditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.appliedPromoCode).toBe('FIXED50');
    expect(res.body.data.discountAmount).toBe(50);
  });

  test('should skip promo if promoCode is inactive', async () => {
    const promoCodeId = uuidv4();
    const payment = makePayment({
      amount: 500,
      metadata: JSON.stringify({ promoCodeId }),
    });
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.promoCode.findUnique.mockResolvedValue({
      id: promoCodeId,
      code: 'EXPIRED',
      active: false,
      discountType: 'PERCENT',
      discountValue: 10,
    });
    geniuspayMock.createPayment.mockResolvedValue({
      reference: 'GP_REF_NOPROMO',
      payment_link: 'https://pay.example.com/GP_REF_NOPROMO',
    });
    prisma.payment.update.mockResolvedValue({
      ...payment,
      status: 'pending',
      amount: 500,
      geniuspayRef: 'GP_REF_NOPROMO',
    });
    prisma.paymentAuditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.appliedPromoCode).toBeNull();
  });

  test('should allow professional (payment owner) to retry', async () => {
    const PRO_USER_ID = 'pro-user-id';
    const proToken = makeToken({ id: PRO_USER_ID });
    const payment = makePayment();
    // clientId is different from proToken user, but professional userId matches
    prisma.payment.findUnique.mockResolvedValue({
      ...payment,
      quote: {
        ...payment.quote,
        project: {
          ...payment.quote.project,
          clientId: 'other-client',
        },
        professional: {
          id: 'pro-id',
          userId: PRO_USER_ID,
          user: { id: PRO_USER_ID },
        },
      },
    });
    geniuspayMock.createPayment.mockResolvedValue({
      reference: 'GP_REF_PRO',
      payment_link: 'https://pay.example.com/GP_REF_PRO',
    });
    prisma.payment.update.mockResolvedValue({
      ...payment,
      status: 'pending',
      amount: 500,
      geniuspayRef: 'GP_REF_PRO',
    });
    prisma.paymentAuditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 500 if GeniusPay does not return a reference', async () => {
    const payment = makePayment();
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.paymentAuditLog.create.mockResolvedValue({});
    geniuspayMock.createPayment.mockResolvedValue({ payment_link: 'https://pay.example.com' }); // no reference

    const res = await request(app)
      .post(`/payments/${payment.id}/retry`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Impossible de réessayer');
  });
});
