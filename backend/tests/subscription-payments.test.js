'use strict';

/**
 * Tests permanents — Phase 3 : Paiements et renouvellements d'abonnements
 * Sujet Redmi V1.0
 *
 * Coverage :
 *   - Checkout : PENDING_PAYMENT, stockage geniuspayRef, champs client corrects,
 *                idempotency key, scheduledStartAt pendant essai.
 *   - Webhook : activation sur payment.succeeded, idempotence, vérification montant,
 *               période de grâce sur payment.failed, payment.cancelled/expired,
 *               double activation ignorée.
 *   - getActiveTier : GRACE_PERIOD conserve le tier, INACTIVE → GRATUIT.
 *   - Crons : module chargeable sans erreur, fonctions exportées présentes.
 */

const express = require('express');
const request = require('supertest');
const helpers = require('./helpers');
const proToken = helpers.proToken();

// ─── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../config/db', () => ({
  user: {
    findUnique: jest.fn().mockImplementation(({ where }) => {
      if (where?.id === 'pro-user-1') {
        return Promise.resolve({
          id: 'pro-user-1',
          role: 'PROFESSIONAL',
          email: 'pro@test.com',
          suspended: false,
          deletedAt: null,
          adminLevel: null,
          adminPermissions: null,
          adminRoleTypeId: null,
          adminRoleType: null,
        });
      }
      return Promise.resolve(null);
    }),
  },
  professional: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  subscription: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  subscriptionPaymentAttempt: {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
      id: 'mock-attempt-id',
      geniuspayRef: null,
      status: data.status || 'CREATED',
      ...data,
    })),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  payment: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  notification: {
    create: jest.fn().mockResolvedValue({}),
  },
  promoCode:  { findUnique: jest.fn() },
  promoUsage: { findUnique: jest.fn() },
  appConfig:  { upsert: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(opsOrCallback =>
    typeof opsOrCallback === 'function'
      ? opsOrCallback(require('../config/db'))
      : Promise.all(opsOrCallback)
  ),
}));

jest.mock('../utils/appConfig', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
  setConfig:  jest.fn().mockResolvedValue({}),
}));

const mockGeniuspay = {
  createPayment:            jest.fn(),
  verifyWebhookSignature:   jest.fn(),
  verifyWebhookTimestamp:   jest.fn(),
};
jest.mock('../utils/geniuspay', () => mockGeniuspay);

jest.mock('../utils/paymentAudit', () => ({ logPaymentStatus: jest.fn().mockResolvedValue({}) }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const prisma = require('../config/db');
const subscriptionRoutes = require('../routes/subscriptions');
const webhookRoutes      = require('../routes/webhooks-geniuspay');
const { getActiveTier }  = require('../routes/subscriptions');

// ─── App fixture ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/subscriptions', subscriptionRoutes);
  app.use('/api/v1/webhooks/geniuspay', webhookRoutes);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

function mockPro(overrides = {}) {
  return {
    id: 'pro-id-1',
    userId: 'pro-user-1',
    trialEndsAt: null,
    trialStartedAt: null,
    subscription: null,
    user: {
      id: 'pro-user-1',
      email: 'pro@test.com',
      firstName: 'Alice',
      lastName: 'Dupont',
      phone: '+22500000000',
      expoPushToken: null,
    },
    ...overrides,
  };
}

function mockSubscription(overrides = {}) {
  return {
    id: 'sub-id-1',
    professionalId: 'pro-id-1',
    status: 'PENDING_PAYMENT',
    tier: 'PRO',
    billingCycle: 'MONTHLY',
    amount: 5000,
    geniuspayRef: null,
    scheduledStartAt: null,
    gracePeriodEndsAt: null,
    expiresAt: null,
    startedAt: null,
    lastPaymentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    professional: null,
    ...overrides,
  };
}

function mockAttempt(overrides = {}) {
  const tier = overrides.tier || 'PRO';
  const billingCycle = overrides.billingCycle || 'MONTHLY';
  const expectedAmount = overrides.expectedAmount !== undefined ? overrides.expectedAmount : 5000;
  const geniuspayRef = overrides.geniuspayRef || 'gp-ref';
  return {
    id: 'attempt-id-1',
    subscriptionId: 'sub-id-1',
    idempotencyKey: `sub-checkout-pro-id-1-${tier}-${billingCycle}-2026-11-20`,
    geniuspayRef,
    provider: 'geniuspay',
    tier,
    billingCycle,
    expectedAmount,
    confirmedAmount: null,
    status: 'PENDING',
    providerData: null,
    confirmedAt: null,
    duplicateOfId: null,
    scheduledStartAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    subscription: {
      id: 'sub-id-1',
      professionalId: 'pro-id-1',
      status: 'PENDING_PAYMENT',
      tier,
      billingCycle,
      amount: expectedAmount,
      geniuspayRef,
      gracePeriodEndsAt: null,
      expiresAt: null,
      startedAt: null,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', lastName: 'D' },
      },
    },
    ...overrides,
  };
}

function webhookPayload(eventType, overrides = {}) {
  return {
    event: { type: eventType },
    data: {
      reference: 'gp-ref-sub-1',
      amount: 5000,
      currency: 'XOF',
      ...overrides,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGeniuspay.verifyWebhookSignature.mockReturnValue(true);
  mockGeniuspay.verifyWebhookTimestamp.mockReturnValue(true);
  prisma.payment.findFirst.mockResolvedValue(null);
  prisma.subscription.update.mockResolvedValue({});
  prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
  prisma.notification.create.mockResolvedValue({});
});

// ════════════════════════════════════════════════════════════════════════════════
// 1. CHECKOUT
// ════════════════════════════════════════════════════════════════════════════════

describe('POST /api/subscriptions/checkout', () => {
  const app = makeApp();

  it('creates PENDING_PAYMENT and returns checkout_url', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());
    prisma.subscription.upsert.mockResolvedValue(mockSubscription({ id: 'sub-id-1', geniuspayRef: null }));
    mockGeniuspay.createPayment.mockResolvedValue({
      reference: 'gp-ref-sub-1',
      checkout_url: 'https://pay.geniuspay.test/checkout/gp-ref-sub-1',
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(200);
    expect(res.body.paymentUrl).toBe('https://pay.geniuspay.test/checkout/gp-ref-sub-1');
    expect(res.body.reference).toBe('gp-ref-sub-1');
    expect(res.body.tier).toBe('PRO');
    expect(res.body.billingCycle).toBe('MONTHLY');
  });

  it('stores geniuspayRef on subscription after createPayment', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());
    prisma.subscription.upsert.mockResolvedValue(mockSubscription({ id: 'sub-id-1' }));
    mockGeniuspay.createPayment.mockResolvedValue({
      reference: 'gp-ref-sub-99',
      checkout_url: 'https://pay.example.com/checkout/99',
    });

    await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'ESSENTIEL' });

    const updateCall = prisma.subscription.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe('sub-id-1');
    expect(updateCall.data.geniuspayRef).toBe('gp-ref-sub-99');
  });

  it('sends correct customer fields to GeniusPay', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());
    prisma.subscription.upsert.mockResolvedValue(mockSubscription());
    mockGeniuspay.createPayment.mockResolvedValue({
      reference: 'gp-x',
      checkout_url: 'https://p.test/checkout/gp-x',
    });

    await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO' });

    const gpCall = mockGeniuspay.createPayment.mock.calls[0][0];
    expect(gpCall.customerName).toBe('Alice Dupont');
    expect(gpCall.customerEmail).toBe('pro@test.com');
    expect(gpCall.customerPhone).toBe('+22500000000');
    // Legacy customer object must NOT be sent
    expect(gpCall.customer).toBeUndefined();
  });

  it('sets scheduledStartAt = day after trial when trial is active', async () => {
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    prisma.professional.findUnique.mockResolvedValue(mockPro({ trialEndsAt }));
    prisma.subscription.upsert.mockResolvedValue(mockSubscription({ scheduledStartAt: null }));
    mockGeniuspay.createPayment.mockResolvedValue({
      reference: 'gp-y',
      checkout_url: 'https://p.test/checkout/gp-y',
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(200);
    const scheduled = new Date(res.body.scheduledStartAt);
    expect(scheduled > trialEndsAt).toBe(true);
  });

  it('does not set scheduledStartAt when no active trial', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro({ trialEndsAt: null }));
    prisma.subscription.upsert.mockResolvedValue(mockSubscription());
    mockGeniuspay.createPayment.mockResolvedValue({
      reference: 'gp-z',
      checkout_url: 'https://p.test/checkout/gp-z',
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(200);
    expect(res.body.scheduledStartAt).toBeNull();
  });

  it('returns 400 for invalid tier', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'GRATUIT' });

    expect(res.status).toBe(400);
  });

  it('returns 500 when GeniusPay returns no checkout_url', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());
    prisma.subscription.upsert.mockResolvedValue(mockSubscription());
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-err' });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(500);
  });

  it('free tier (amount=0 via promo) activates without autoRenew or metadata fields', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1', code: 'FREE100', active: true,
      validUntil: null, maxUses: null, usedCount: 0,
      applicableTiers: [], discountType: 'PERCENT', discountValue: 100,
    });
    prisma.promoUsage.findUnique.mockResolvedValue(null);
    prisma.subscription.upsert.mockResolvedValue(mockSubscription({ status: 'ACTIVE', amount: 0 }));

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', promoCode: 'FREE100' });

    expect(res.status).toBe(200);
    expect(res.body.activated).toBe(true);

    const upsertCall = prisma.subscription.upsert.mock.calls[0][0];
    expect(upsertCall.create.autoRenew).toBeUndefined();
    expect(upsertCall.update.autoRenew).toBeUndefined();
    expect(upsertCall.create.metadata).toBeUndefined();
    expect(upsertCall.update.metadata).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. WEBHOOK — SUBSCRIPTION PATH
// ════════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/webhooks/geniuspay — subscription path', () => {
  const app = makeApp();

  it('activates subscription on payment.succeeded', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', geniuspayRef: 'gp-ref-sub-1' });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.succeeded'));

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(true);

    const updateData = prisma.subscription.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('ACTIVE');
    expect(updateData.startedAt).toBeInstanceOf(Date);
    expect(updateData.expiresAt).toBeInstanceOf(Date);
    expect(updateData.lastPaymentAt).toBeInstanceOf(Date);
    expect(updateData.gracePeriodEndsAt).toBeNull();
  });

  it('idempotent — already ACTIVE subscription skips update on payment.succeeded', async () => {
    const sub = mockSubscription({ status: 'ACTIVE', geniuspayRef: 'gp-ref-sub-1' });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.succeeded'));

    expect(res.status).toBe(200);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('amount mismatch on payment.succeeded — leaves PENDING_PAYMENT, no update', async () => {
    const sub = mockSubscription({ amount: 5000, geniuspayRef: 'gp-ref-sub-1', status: 'PENDING_PAYMENT' });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.succeeded', { amount: 1000 }));

    // Amount mismatch: no paid benefits — subscription stays PENDING_PAYMENT for admin review
    expect(res.status).toBe(200);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('payment.failed starts 3-day grace period', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', geniuspayRef: 'gp-ref-sub-1' });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.failed', { failure_reason: 'insufficient_funds' }));

    expect(res.status).toBe(200);
    // payment.failed uses updateMany (conditional write: guards against concurrent ACTIVE state)
    const updateData = prisma.subscription.updateMany.mock.calls[0][0].data;
    expect(updateData.status).toBe('GRACE_PERIOD');
    expect(updateData.gracePeriodEndsAt).toBeInstanceOf(Date);
    const graceMs = updateData.gracePeriodEndsAt - new Date();
    expect(graceMs).toBeGreaterThan(2 * 24 * 60 * 60 * 1000);
  });

  it('payment.failed on already GRACE_PERIOD is idempotent — no update', async () => {
    const sub = mockSubscription({ status: 'GRACE_PERIOD', geniuspayRef: 'gp-ref-sub-1' });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.failed'));

    expect(res.status).toBe(200);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('payment.cancelled on PENDING_PAYMENT does not update subscription', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', geniuspayRef: 'gp-ref-sub-1' });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.cancelled'));

    expect(res.status).toBe(200);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('payment.expired on PENDING_PAYMENT does not update subscription', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', geniuspayRef: 'gp-ref-sub-1' });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.expired'));

    expect(res.status).toBe(200);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('unknown geniuspayRef falls through to 200 acknowledged', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.succeeded', { reference: 'unknown-ref' }));

    expect(res.status).toBe(200);
  });

  it('invalid signature returns 401', async () => {
    mockGeniuspay.verifyWebhookSignature.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'bad-sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.succeeded'));

    expect(res.status).toBe(401);
  });

  it('expired timestamp returns 401', async () => {
    mockGeniuspay.verifyWebhookTimestamp.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '1000000000')
      .send(webhookPayload('payment.succeeded'));

    expect(res.status).toBe(401);
  });

  it('scheduledStartAt in the future: activation uses scheduledStartAt as startedAt', async () => {
    const scheduledStartAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const sub = mockSubscription({
      status: 'PENDING_PAYMENT',
      geniuspayRef: 'gp-ref-sub-1',
      scheduledStartAt,
      amount: 5000,
    });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });

    await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.succeeded'));

    const updateData = prisma.subscription.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('ACTIVE');
    expect(updateData.startedAt.getTime()).toBe(scheduledStartAt.getTime());
  });

  it('notification failure does not block webhook 200 response', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', geniuspayRef: 'gp-ref-sub-1' });
    prisma.subscription.findFirst.mockResolvedValue({
      ...sub,
      professional: {
        user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', expoPushToken: null },
      },
    });
    prisma.notification.create.mockRejectedValue(new Error('DB notification error'));

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(webhookPayload('payment.succeeded'));

    expect(res.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. getActiveTier — GRACE_PERIOD
// ════════════════════════════════════════════════════════════════════════════════

describe('getActiveTier — grace period', () => {
  it('returns tier during active grace period', () => {
    const sub = {
      status: 'GRACE_PERIOD',
      tier: 'PRO',
      gracePeriodEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      expiresAt: null,
    };
    expect(getActiveTier(sub, {})).toBe('PRO');
  });

  it('returns GRATUIT when grace period has expired', () => {
    const sub = {
      status: 'GRACE_PERIOD',
      tier: 'PRO',
      gracePeriodEndsAt: new Date(Date.now() - 1000),
      expiresAt: null,
    };
    expect(getActiveTier(sub, {})).toBe('GRATUIT');
  });

  it('returns GRATUIT when status is INACTIVE', () => {
    const sub = {
      status: 'INACTIVE',
      tier: 'ELITE',
      gracePeriodEndsAt: null,
      expiresAt: null,
    };
    expect(getActiveTier(sub, {})).toBe('GRATUIT');
  });

  it('trial overrides GRACE_PERIOD', () => {
    const sub = {
      status: 'GRACE_PERIOD',
      tier: 'ESSENTIEL',
      gracePeriodEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      expiresAt: null,
    };
    const pro = { trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
    expect(getActiveTier(sub, pro)).toBe('PRO');
  });

  it('ACTIVE with valid expiresAt returns correct tier', () => {
    const sub = {
      status: 'ACTIVE',
      tier: 'ELITE',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: null,
    };
    expect(getActiveTier(sub, {})).toBe('ELITE');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. CRON JOBS — module integrity
// ════════════════════════════════════════════════════════════════════════════════

describe('cron-jobs module', () => {
  it('loads without errors', () => {
    expect(() => require('../jobs/cron-jobs')).not.toThrow();
  });

  it('exports initializeCronJobs', () => {
    const cronJobs = require('../jobs/cron-jobs');
    expect(typeof cronJobs.initializeCronJobs).toBe('function');
  });

  it('exports expireTrials', () => {
    const cronJobs = require('../jobs/cron-jobs');
    expect(typeof cronJobs.expireTrials).toBe('function');
  });

  it('exports reconcilePendingSubscriptions', () => {
    const cronJobs = require('../jobs/cron-jobs');
    expect(typeof cronJobs.reconcilePendingSubscriptions).toBe('function');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. BILLING CYCLE — MONTHLY / YEARLY
// ════════════════════════════════════════════════════════════════════════════════

describe('POST /api/subscriptions/checkout — billingCycle', () => {
  const app = makeApp();

  it('accepts YEARLY billingCycle and returns it in response', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());
    prisma.subscription.upsert.mockResolvedValue(
      mockSubscription({ billingCycle: 'YEARLY', amount: 50000 }),
    );
    mockGeniuspay.createPayment.mockResolvedValue({
      reference: 'gp-yearly-1',
      checkout_url: 'https://pay.test/checkout/yearly',
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'YEARLY' });

    expect(res.status).toBe(200);
    expect(res.body.billingCycle).toBe('YEARLY');
  });

  it('defaults to MONTHLY when billingCycle is omitted', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());
    prisma.subscription.upsert.mockResolvedValue(mockSubscription({ billingCycle: 'MONTHLY' }));
    mockGeniuspay.createPayment.mockResolvedValue({
      reference: 'gp-monthly-def',
      checkout_url: 'https://pay.test/checkout/monthly',
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'ESSENTIEL' });

    expect(res.status).toBe(200);
    expect(res.body.billingCycle).toBe('MONTHLY');
  });

  it('returns 400 for invalid billingCycle value', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'WEEKLY' });

    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6. CANONICAL PRICING — getCanonicalPrice
// ════════════════════════════════════════════════════════════════════════════════

describe('getCanonicalPrice', () => {
  let getCanonicalPrice;

  beforeAll(() => {
    jest.isolateModules(() => {
      const mod = require('../modules/subscription');
      getCanonicalPrice = mod.getCanonicalPrice;
    });
  });

  it('returns 2500 for ESSENTIEL MONTHLY', () => {
    expect(getCanonicalPrice('ESSENTIEL', 'MONTHLY')).toBe(2500);
  });

  it('returns 25000 for ESSENTIEL YEARLY', () => {
    expect(getCanonicalPrice('ESSENTIEL', 'YEARLY')).toBe(25000);
  });

  it('returns 5000 for PRO MONTHLY', () => {
    expect(getCanonicalPrice('PRO', 'MONTHLY')).toBe(5000);
  });

  it('returns 50000 for PRO YEARLY', () => {
    expect(getCanonicalPrice('PRO', 'YEARLY')).toBe(50000);
  });

  it('returns 10000 for ELITE MONTHLY', () => {
    expect(getCanonicalPrice('ELITE', 'MONTHLY')).toBe(10000);
  });

  it('returns 100000 for ELITE YEARLY', () => {
    expect(getCanonicalPrice('ELITE', 'YEARLY')).toBe(100000);
  });

  it('returns null for GRATUIT', () => {
    expect(getCanonicalPrice('GRATUIT', 'MONTHLY')).toBeNull();
  });

  it('returns null for unknown tier', () => {
    expect(getCanonicalPrice('UNKNOWN', 'MONTHLY')).toBeNull();
  });
});

// NOTE: subscriptionMailer email tests live in tests/subscription-mailer.test.js
// (separate file required to control mailer/pdfkit/cloudinary mock isolation cleanly)

// ════════════════════════════════════════════════════════════════════════════════
// 7. WEBHOOK VIA ATTEMPT — new path tests
// ════════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/webhooks/geniuspay — via attempt', () => {
  const app = makeApp();

  // Helper: build a webhook payload routed through the attempt path
  function attemptWebhookPayload(eventType, overrides = {}) {
    return {
      event: { type: eventType },
      data: {
        reference: 'gp-ref',
        amount: 5000,
        currency: 'XOF',
        ...overrides,
      },
    };
  }

  it('early renewal: attempt with periodStartAt >= expiresAt activates and extends subscription', async () => {
    // Subscription is currently ACTIVE (expires 30 days from now).
    // The attempt covers the NEXT period (starts at expiresAt).
    const currentExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const periodStartAt = currentExpiresAt;
    const periodEndAt = new Date(currentExpiresAt.getTime() + 31 * 24 * 60 * 60 * 1000);

    const attempt = mockAttempt({
      status: 'PENDING',
      periodStartAt,
      periodEndAt,
    });
    // The attempt.subscription reflects current state
    attempt.subscription = {
      ...attempt.subscription,
      status: 'ACTIVE',
      expiresAt: currentExpiresAt,
    };

    // No other SUCCEEDED attempt overlaps this period
    prisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue(null);
    prisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);
    prisma.subscriptionPaymentAttempt.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(attemptWebhookPayload('payment.succeeded', { reference: 'gp-ref' }));

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(true);
    // subscription.update called inside the transaction
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });

  it('duplicate payment: two attempts covering the same period → REVIEW_REQUIRED, no double extension', async () => {
    const periodStartAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const periodEndAt = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);

    const attempt = mockAttempt({ status: 'PENDING', periodStartAt, periodEndAt });

    // Another SUCCEEDED attempt overlaps the same period
    const otherSucceeded = mockAttempt({
      id: 'attempt-id-2',
      status: 'SUCCEEDED',
      periodStartAt,
      periodEndAt,
    });
    prisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);
    // isPeriodAlreadyPaid calls findFirst looking for overlapping SUCCEEDED
    prisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue(otherSucceeded);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(attemptWebhookPayload('payment.succeeded', { reference: 'gp-ref' }));

    expect(res.status).toBe(200);
    // Attempt flagged REVIEW_REQUIRED
    expect(prisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) }),
    );
    // Subscription NOT updated (no double extension)
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('idempotence: attempt already SUCCEEDED → no-op', async () => {
    const attempt = mockAttempt({ status: 'SUCCEEDED' });
    prisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(attemptWebhookPayload('payment.succeeded', { reference: 'gp-ref' }));

    expect(res.status).toBe(200);
    expect(prisma.subscriptionPaymentAttempt.update).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('concurrent guard: updateMany returns count=0 → skip silently, no subscription update', async () => {
    const attempt = mockAttempt({ status: 'PENDING' });
    prisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);
    // No period overlap (not a duplicate)
    prisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue(null);
    // Simulate concurrent handler already processed: updateMany returns count=0
    prisma.subscriptionPaymentAttempt.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '9999999999')
      .send(attemptWebhookPayload('payment.succeeded', { reference: 'gp-ref' }));

    expect(res.status).toBe(200);
    // subscription.update must NOT have been called
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 9. IDEMPOTENCE — retry same-day after terminal attempt
// ════════════════════════════════════════════════════════════════════════════════

describe('createCheckout() — retry same-day after terminal attempt', () => {
  const app = makeApp();

  const terminalStatuses = ['FAILED', 'CANCELLED', 'EXPIRED', 'REVIEW_REQUIRED'];

  for (const terminalStatus of terminalStatuses) {
    it(`creates a NEW attempt when existing attempt is ${terminalStatus}`, async () => {
      prisma.professional.findUnique.mockResolvedValue(mockPro());
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.subscription.upsert.mockResolvedValue(mockSubscription({ id: 'sub-id-1' }));
      mockGeniuspay.createPayment.mockResolvedValue({
        reference: `gp-retry-${terminalStatus}`,
        checkout_url: `https://pay.test/checkout/retry-${terminalStatus}`,
      });

      // Base key already exists with terminal status
      const today = new Date().toISOString().slice(0, 10);
      const baseKey = `sub-checkout-pro-id-1-PRO-MONTHLY-${today}`;
      prisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue({
        id: 'old-attempt-id',
        subscriptionId: 'sub-id-1',
        idempotencyKey: baseKey,
        status: terminalStatus,
        geniuspayRef: null,
        subscription: null,
      });
      // count of existing attempts for the retry key suffix
      prisma.subscriptionPaymentAttempt.count = jest.fn().mockResolvedValue(1);

      const res = await request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ tier: 'PRO' });

      expect(res.status).toBe(200);
      // A new attempt must be created (not the old terminal one)
      expect(prisma.subscriptionPaymentAttempt.create).toHaveBeenCalledTimes(1);
      const createArg = prisma.subscriptionPaymentAttempt.create.mock.calls[0][0];
      // The new idempotency key must differ from the base key (has retry suffix)
      expect(createArg.data.idempotencyKey).not.toBe(baseKey);
      expect(createArg.data.idempotencyKey).toMatch(/-r\d+$/);
    });
  }

  it('returns idempotent response when existing attempt is PENDING (no retry needed)', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro());
    prisma.subscription.findUnique.mockResolvedValue(null);

    const today = new Date().toISOString().slice(0, 10);
    const baseKey = `sub-checkout-pro-id-1-PRO-MONTHLY-${today}`;
    prisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue({
      id: 'pending-attempt-id',
      subscriptionId: 'sub-id-1',
      idempotencyKey: baseKey,
      status: 'PENDING',
      geniuspayRef: 'gp-existing-ref',
      expectedAmount: 5000,
      subscription: null,
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.reference).toBe('gp-existing-ref');
    // No new attempt created
    expect(prisma.subscriptionPaymentAttempt.create).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 10. CRON reconcile — early renewal (non-overlapping periods)
// ════════════════════════════════════════════════════════════════════════════════

describe('reconcilePendingSubscriptions — early renewal (non-overlapping periods)', () => {
  let reconcile;

  beforeAll(() => {
    jest.isolateModules(() => {
      reconcile = require('../jobs/cron-jobs').reconcilePendingSubscriptions;
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGeniuspay.getPayment = jest.fn();
    prisma.subscription.update.mockResolvedValue({});
    prisma.subscriptionPaymentAttempt.updateMany.mockResolvedValue({ count: 1 });
  });

  it('activates and extends subscription when attempt covers non-overlapping next period', async () => {
    const currentExpiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // still active
    const periodStartAt = currentExpiresAt; // renewal for NEXT period
    const periodEndAt = new Date(currentExpiresAt.getTime() + 31 * 24 * 60 * 60 * 1000);

    const attempt = mockAttempt({
      geniuspayRef: 'gp-renewal-cron-1',
      expectedAmount: 5000,
      periodStartAt,
      periodEndAt,
    });
    attempt.subscription = {
      ...attempt.subscription,
      status: 'ACTIVE',
      expiresAt: currentExpiresAt,
    };

    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    // No overlapping SUCCEEDED attempt for this period
    prisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue(null);
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5000 });

    await reconcile();

    // Subscription must have been updated to ACTIVE with extended expiresAt
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          expiresAt: expect.any(Date),
        }),
      }),
    );
    const updateData = prisma.subscription.update.mock.calls[0][0].data;
    // New expiresAt must be in the future (beyond the current period)
    expect(updateData.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 8. RECONCILIATION — reconcilePendingSubscriptions
// ════════════════════════════════════════════════════════════════════════════════

describe('reconcilePendingSubscriptions', () => {
  let reconcilePendingSubscriptions;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGeniuspay.getPayment = jest.fn();
    prisma.subscription.update.mockResolvedValue({});
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.create.mockResolvedValue({});
  });

  beforeAll(() => {
    jest.isolateModules(() => {
      reconcilePendingSubscriptions = require('../jobs/cron-jobs').reconcilePendingSubscriptions;
    });
  });

  it('activates subscription when GeniusPay returns completed', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-rec-1', expectedAmount: 5000 });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    prisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', expiresAt: null });
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5000 });

    await reconcilePendingSubscriptions();

    const updateCall = prisma.subscription.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe('ACTIVE');
    expect(updateCall.data.expiresAt).toBeInstanceOf(Date);
    expect(updateCall.data.gracePeriodEndsAt).toBeNull();
  });

  it('moves to GRACE_PERIOD when GeniusPay returns failed', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-rec-2', expectedAmount: 5000 });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    prisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT' });
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'failed' });

    await reconcilePendingSubscriptions();

    const updateData = prisma.subscription.updateMany.mock.calls[0][0].data;
    expect(updateData.status).toBe('GRACE_PERIOD');
    expect(updateData.gracePeriodEndsAt).toBeInstanceOf(Date);
  });

  it('leaves PENDING_PAYMENT when GeniusPay still returns pending', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-rec-3' });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'pending' });

    await reconcilePendingSubscriptions();

    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('leaves PENDING_PAYMENT when GeniusPay is unreachable', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-rec-4' });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    mockGeniuspay.getPayment.mockRejectedValue(new Error('ECONNREFUSED'));

    await reconcilePendingSubscriptions();

    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('skips activation on amount mismatch (>1 XOF)', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-rec-5', expectedAmount: 5000 });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 1000 });

    await reconcilePendingSubscriptions();

    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('tolerates ±1 XOF amount difference (rounding)', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-rec-6', expectedAmount: 5000 });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    prisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', expiresAt: null });
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5001 });

    await reconcilePendingSubscriptions();

    const updateCall = prisma.subscription.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe('ACTIVE');
  });

  it('does nothing when no pending subscriptions exist', async () => {
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([]);

    await reconcilePendingSubscriptions();

    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(mockGeniuspay.getPayment).not.toHaveBeenCalled();
  });

  it('expiresAt is 30 days later for MONTHLY reconciliation', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-rec-mo', expectedAmount: 5000, billingCycle: 'MONTHLY' });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    prisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', expiresAt: null });
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5000 });

    await reconcilePendingSubscriptions();

    const { expiresAt, startedAt } = prisma.subscription.update.mock.calls[0][0].data;
    const diffMs = expiresAt - startedAt;
    // Should be ~30 days (27-32 days range to handle month-end clamping)
    expect(diffMs).toBeGreaterThan(27 * 24 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(32 * 24 * 60 * 60 * 1000);
  });

  it('expiresAt is ~365 days later for YEARLY reconciliation', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-rec-yr', expectedAmount: 50000, billingCycle: 'YEARLY', tier: 'PRO' });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    prisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', expiresAt: null });
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 50000 });

    await reconcilePendingSubscriptions();

    const { expiresAt, startedAt } = prisma.subscription.update.mock.calls[0][0].data;
    const diffMs = expiresAt - startedAt;
    // Should be ~365 days (360-367 days range)
    expect(diffMs).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(367 * 24 * 60 * 60 * 1000);
  });

  it('cancelled at GeniusPay clears geniuspayRef only — no grace period', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-rec-7', expectedAmount: 5000 });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'cancelled' });

    await reconcilePendingSubscriptions();

    // The attempt is marked CANCELLED — no grace period on the subscription
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    const updateCalls = prisma.subscription.update.mock.calls;
    for (const call of updateCalls) {
      expect(call[0].data.status).not.toBe('GRACE_PERIOD');
    }
  });

  it('expired at GeniusPay clears geniuspayRef only — no grace period', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-rec-8', expectedAmount: 5000 });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'expired' });

    await reconcilePendingSubscriptions();

    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    const updateCalls = prisma.subscription.update.mock.calls;
    for (const call of updateCalls) {
      expect(call[0].data.status).not.toBe('GRACE_PERIOD');
    }
  });

  it('ACTIVE subscription with pending renewal attempt — no overlapping period → activates (legitimate renewal)', async () => {
    // A renewal attempt is PENDING while the existing subscription is still ACTIVE.
    // With period-based duplicate detection (BUG 2 fix): since there is no other SUCCEEDED
    // attempt covering the same billing period, this is a legitimate early renewal.
    // The old "ACTIVE sub = always REVIEW_REQUIRED" guard has been removed.
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-renewal-1', expectedAmount: 5000 });
    attempt.subscription = {
      ...attempt.subscription,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    // No overlapping SUCCEEDED attempt → isPeriodAlreadyPaid returns false
    // (findFirst already mockResolvedValue(null) from top-level setup)
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5000 });

    await reconcilePendingSubscriptions();

    // Legitimate renewal: subscription.update called with ACTIVE, NOT flagged REVIEW_REQUIRED
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) })
    );
    expect(prisma.subscriptionPaymentAttempt.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
  });

  it('ACTIVE subscription + second SUCCEEDED attempt for same period → REVIEW_REQUIRED (true duplicate)', async () => {
    // True duplicate: another SUCCEEDED attempt was confirmed within 1h of this attempt's creation.
    // Legacy path (no periodStartAt): proximity check detects the duplicate.
    const createdAt = new Date();
    const attempt = mockAttempt({ geniuspayRef: 'gp-ref-dup-1', expectedAmount: 5000 });
    attempt.createdAt = createdAt;

    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    // findFirst returns a SUCCEEDED attempt confirmed 10 minutes before this one was created
    prisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue({
      id: 'other-succeeded-id',
      status: 'SUCCEEDED',
      confirmedAt: new Date(createdAt.getTime() - 10 * 60 * 1000), // 10 min ago
    });
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5000 });

    await reconcilePendingSubscriptions();

    // True duplicate: attempt flagged REVIEW_REQUIRED, subscription NOT updated
    expect(prisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  // ── Notification de doublon — exactement une par événement ──────────────────

  it('doublon détecté en transaction → exactement une notification admin, statut REVIEW_REQUIRED', async () => {
    // isPeriodAlreadyPaid retourne true (doublon détecté dans la transaction)
    const createdAt = new Date();
    const attempt = mockAttempt({ geniuspayRef: 'gp-notif-dup-1', expectedAmount: 5000 });
    attempt.createdAt = createdAt;

    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    prisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue({
      id: 'other-id',
      status: 'SUCCEEDED',
      confirmedAt: new Date(createdAt.getTime() - 5 * 60 * 1000),
    });
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5000 });

    await reconcilePendingSubscriptions();

    // REVIEW_REQUIRED commité
    expect(prisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
    // Exactement une notification — pas deux
    const dupNotifs = prisma.notification.create.mock.calls.filter(
      c => c[0]?.data?.type === 'SUBSCRIPTION_DUPLICATE_PAYMENT'
    );
    expect(dupNotifs).toHaveLength(1);
  });

  it('violation P2002 → exactement une notification admin, statut REVIEW_REQUIRED', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-notif-p2002', expectedAmount: 5000 });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5000 });

    // La transaction échoue avec P2002 (violation index unique)
    const p2002 = new Error('Unique constraint violation');
    p2002.code = 'P2002';
    prisma.$transaction.mockRejectedValueOnce(p2002);

    await reconcilePendingSubscriptions();

    // REVIEW_REQUIRED enregistré hors transaction
    expect(prisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
    // Exactement une notification — pas deux
    const dupNotifs = prisma.notification.create.mock.calls.filter(
      c => c[0]?.data?.type === 'SUBSCRIPTION_DUPLICATE_PAYMENT'
    );
    expect(dupNotifs).toHaveLength(1);
  });

  it('erreur de notification ne compromet pas le traitement (REVIEW_REQUIRED déjà commité)', async () => {
    const attempt = mockAttempt({ geniuspayRef: 'gp-notif-fail', expectedAmount: 5000 });
    prisma.subscriptionPaymentAttempt.findMany.mockResolvedValue([attempt]);

    const p2002 = new Error('Unique constraint violation');
    p2002.code = 'P2002';
    prisma.$transaction.mockRejectedValueOnce(p2002);
    // La notification échoue
    prisma.notification.create.mockRejectedValueOnce(new Error('DB notification error'));
    mockGeniuspay.getPayment.mockResolvedValue({ status: 'completed', amount: 5000 });

    // reconcile ne doit pas propager l'erreur de notification
    await expect(reconcilePendingSubscriptions()).resolves.not.toThrow();

    // REVIEW_REQUIRED bien enregistré malgré l'échec de notification
    expect(prisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
  });
});
