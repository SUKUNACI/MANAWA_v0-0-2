'use strict';

/**
 * Tests — SubscriptionPaymentAttempt architecture
 *
 * Coverage (32 scenarios from mission spec):
 *
 * A. Création des tentatives (1-5)
 * B. Webhooks tardifs (6-10)
 * C. Sécurité financière (11-16)
 * D. Renouvellements (17-23)
 * E. Doubles paiements (24-27)
 * F. Historique et reçus (28-32)
 */

const express = require('express');
const request = require('supertest');
const helpers = require('./helpers');
const proToken = helpers.proToken();

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockGeniuspay = {
  createPayment: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  verifyWebhookTimestamp: jest.fn(),
  getPayment: jest.fn(),
};
jest.mock('../utils/geniuspay', () => mockGeniuspay);
jest.mock('../utils/paymentAudit', () => ({ logPaymentStatus: jest.fn().mockResolvedValue({}) }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../utils/subscriptionMailer', () => ({
  sendSubscriptionActivated: jest.fn().mockResolvedValue({}),
  sendPaymentFailed: jest.fn().mockResolvedValue({}),
  sendPaymentCancelled: jest.fn().mockResolvedValue({}),
  sendPaymentExpired: jest.fn().mockResolvedValue({}),
  sendGraceReminder: jest.fn().mockResolvedValue({}),
  sendSubscriptionExpired: jest.fn().mockResolvedValue({}),
}));
jest.mock('../utils/generateSubscriptionReceipt', () => ({
  generateSubscriptionReceiptBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')),
}));
jest.mock('../utils/appConfig', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
  setConfig: jest.fn().mockResolvedValue({}),
}));

const mockPrisma = {
  user: {
    findUnique: jest.fn().mockImplementation(({ where }) =>
      where?.id === 'pro-user-1'
        ? Promise.resolve({
            id: 'pro-user-1', role: 'PROFESSIONAL', email: 'pro@test.com',
            suspended: false, deletedAt: null, adminLevel: null,
            adminPermissions: null, adminRoleTypeId: null, adminRoleType: null,
          })
        : Promise.resolve(null)
    ),
  },
  professional: { findUnique: jest.fn(), findFirst: jest.fn() },
  subscription: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  subscriptionPaymentAttempt: {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  payment: { findFirst: jest.fn().mockResolvedValue(null) },
  notification: { create: jest.fn().mockResolvedValue({}) },
  promoCode: { findUnique: jest.fn() },
  promoUsage: { findUnique: jest.fn() },
  appConfig: { upsert: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(opsOrCallback =>
    typeof opsOrCallback === 'function'
      ? opsOrCallback(require('../config/db'))
      : Promise.all(opsOrCallback)
  ),
};

jest.mock('../config/db', () => mockPrisma);

// ─── App fixture ───────────────────────────────────────────────────────────────

const subscriptionRoutes = require('../routes/subscriptions');
const webhookRoutes = require('../routes/webhooks-geniuspay');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/subscriptions', subscriptionRoutes);
  app.use('/api/v1/webhooks/geniuspay', webhookRoutes);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const app = makeApp();

// ─── Helpers ───────────────────────────────────────────────────────────────────

function mockPro(overrides = {}) {
  return {
    id: 'pro-id-1', userId: 'pro-user-1', trialEndsAt: null, trialStartedAt: null,
    subscription: null,
    user: { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', lastName: 'Dupont', phone: '+22500000000', expoPushToken: null },
    ...overrides,
  };
}

function mockSubscription(overrides = {}) {
  return {
    id: 'sub-id-1', professionalId: 'pro-id-1', status: 'PENDING_PAYMENT',
    tier: 'PRO', billingCycle: 'MONTHLY', amount: 5000, geniuspayRef: null,
    scheduledStartAt: null, gracePeriodEndsAt: null, expiresAt: null,
    startedAt: null, lastPaymentAt: null, createdAt: new Date(), updatedAt: new Date(),
    professional: null, paymentAttempts: [],
    ...overrides,
  };
}

function mockAttempt(overrides = {}) {
  return {
    id: 'attempt-id-1', subscriptionId: 'sub-id-1', idempotencyKey: 'ik-1',
    geniuspayRef: 'gp-ref-A', provider: 'geniuspay',
    tier: 'PRO', billingCycle: 'MONTHLY', expectedAmount: 5000,
    confirmedAmount: null, status: 'PENDING',
    providerData: null, confirmedAt: null, duplicateOfId: null,
    scheduledStartAt: null, createdAt: new Date(), updatedAt: new Date(),
    subscription: null,
    ...overrides,
  };
}

function webhookPayload(eventType, overrides = {}) {
  return {
    event: { type: eventType },
    data: { reference: 'gp-ref-A', amount: 5000, currency: 'XOF', ...overrides },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGeniuspay.verifyWebhookSignature.mockReturnValue(true);
  mockGeniuspay.verifyWebhookTimestamp.mockReturnValue(true);
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  mockPrisma.professional.findUnique.mockResolvedValue(null);
  mockPrisma.professional.findFirst.mockResolvedValue(null);
  mockPrisma.subscription.findUnique.mockResolvedValue(null);
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
  mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription());
  mockPrisma.subscription.update.mockResolvedValue({});
  mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscriptionPaymentAttempt.update.mockResolvedValue({});
  mockPrisma.subscriptionPaymentAttempt.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(mockAttempt());
  mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
  mockPrisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue(null);
  mockPrisma.notification.create.mockResolvedValue({});
});

// ════════════════════════════════════════════════════════════════════════════════
// A. CREATION DES TENTATIVES
// ════════════════════════════════════════════════════════════════════════════════

describe('A. Creation des tentatives', () => {
  // Scenario 1
  it('1. Cree une premiere tentative et retourne la checkout_url', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription({ id: 'sub-id-1' }));
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    const createdAttempt = mockAttempt({ id: 'attempt-A', geniuspayRef: null, status: 'CREATED' });
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(createdAttempt);
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-ref-A', checkout_url: 'https://pay.test/A' });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(200);
    expect(res.body.reference).toBe('gp-ref-A');
    expect(res.body.paymentUrl).toBe('https://pay.test/A');
    expect(res.body.attemptId).toBe('attempt-A');
    expect(mockPrisma.subscriptionPaymentAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CREATED', tier: 'PRO', billingCycle: 'MONTHLY', expectedAmount: 5000 }),
      })
    );
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ geniuspayRef: 'gp-ref-A', status: 'PENDING' }),
      })
    );
  });

  // Scenario 2
  it('2. Cree une deuxieme tentative independante (cle idempotence differente)', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription());
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    const attemptB = mockAttempt({ id: 'attempt-B', geniuspayRef: null, status: 'CREATED', tier: 'ELITE', expectedAmount: 10000 });
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(attemptB);
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-ref-B', checkout_url: 'https://pay.test/B' });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'ELITE', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(200);
    expect(res.body.reference).toBe('gp-ref-B');
    expect(res.body.attemptId).toBe('attempt-B');
    expect(mockPrisma.subscriptionPaymentAttempt.create).toHaveBeenCalledTimes(1);
  });

  // Scenario 3
  it('3. Deux tentatives coexistent — create appele par tentative, pas upsert', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription());
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValueOnce(mockAttempt({ id: 'A' }));
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-ref-A', checkout_url: 'https://pay.test/A' });

    await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'MONTHLY' });

    expect(mockPrisma.subscriptionPaymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.subscription.upsert).toHaveBeenCalledTimes(1);
  });

  // Scenario 4
  it('4. Reuse de la meme cle d idempotence — retourne la tentative existante', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    const existing = mockAttempt({ id: 'existing-attempt', geniuspayRef: 'gp-existing', status: 'PENDING' });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(existing);
    mockPrisma.subscription.findUnique.mockResolvedValue(mockSubscription({ id: 'sub-id-1' }));

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(200);
    expect(res.body.reference).toBe('gp-existing');
    expect(res.body.idempotent).toBe(true);
    expect(mockPrisma.subscriptionPaymentAttempt.create).not.toHaveBeenCalled();
    expect(mockGeniuspay.createPayment).not.toHaveBeenCalled();
  });

  // Scenario 5
  it('5. Echec GeniusPay — tentative conservee en etat CREATED pour reprise', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription());
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(
      mockAttempt({ id: 'attempt-err', status: 'CREATED', geniuspayRef: null })
    );
    mockGeniuspay.createPayment.mockRejectedValue(new Error('Network timeout'));

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(500);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CREATED' }),
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// B. WEBHOOKS TARDIFS
// ════════════════════════════════════════════════════════════════════════════════

describe('B. Webhooks tardifs', () => {
  const sub = mockSubscription({ status: 'PENDING_PAYMENT' });
  const proUser = { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', lastName: 'Dupont' };

  // Scenario 6
  it('6. Confirmation de A apres creation de B — A retrouve et active', async () => {
    const attemptA = mockAttempt({
      id: 'attempt-A', geniuspayRef: 'gp-ref-A', status: 'PENDING',
      subscription: { ...sub, professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attemptA);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', expiresAt: null });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-ref-A', amount: 5000 }));

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(true);
    // The SUCCEEDED transition is done via updateMany (concurrent guard) inside the $transaction
    expect(mockPrisma.subscriptionPaymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED', confirmedAmount: 5000 }) })
    );
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) })
    );
  });

  // Scenario 7
  it('7. Confirmation de B avant A — B retrouve et active independamment', async () => {
    const attemptB = mockAttempt({
      id: 'attempt-B', geniuspayRef: 'gp-ref-B', status: 'PENDING',
      subscription: { ...sub, professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockImplementation(({ where }) =>
      where?.geniuspayRef === 'gp-ref-B' ? Promise.resolve(attemptB) : Promise.resolve(null)
    );
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', expiresAt: null });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-ref-B', amount: 5000 }));

    expect(res.status).toBe(200);
    // The SUCCEEDED transition is done via updateMany (concurrent guard) inside the $transaction
    expect(mockPrisma.subscriptionPaymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) })
    );
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) })
    );
  });

  // Scenario 8
  it('8. Confirmation repetee de A — idempotence, pas de double activation', async () => {
    const attemptA = mockAttempt({
      id: 'attempt-A', geniuspayRef: 'gp-ref-A', status: 'SUCCEEDED',
      subscription: { ...sub, professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attemptA);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-ref-A', amount: 5000 }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    expect(mockPrisma.subscriptionPaymentAttempt.update).not.toHaveBeenCalled();
  });

  // Scenario 9
  it('9. payment.failed apres succeeded — ACTIVE non retrograde', async () => {
    const succeededAttempt = mockAttempt({
      id: 'attempt-A', geniuspayRef: 'gp-ref-A', status: 'SUCCEEDED',
      subscription: { ...sub, status: 'ACTIVE', professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(succeededAttempt);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE' });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.failed', { reference: 'gp-ref-A' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  // Scenario 10
  it('10. Reference inconnue — 200 acknowledged, aucune modification DB', async () => {
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    mockPrisma.payment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'unknown-ref' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    expect(mockPrisma.subscriptionPaymentAttempt.update).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// C. SECURITE FINANCIERE
// ════════════════════════════════════════════════════════════════════════════════

describe('C. Securite financiere', () => {
  const proUser = { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', lastName: 'Dupont' };
  const sub = mockSubscription({ status: 'PENDING_PAYMENT' });

  function pendingAttempt(overrides = {}) {
    return mockAttempt({
      id: 'attempt-A', geniuspayRef: 'gp-ref-A', status: 'PENDING', expectedAmount: 5000,
      subscription: { ...sub, professional: { user: proUser } },
      ...overrides,
    });
  }

  beforeEach(() => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', expiresAt: null });
  });

  // Scenario 11
  it('11. Montant exact — activation', async () => {
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(pendingAttempt());

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) })
    );
  });

  // Scenario 12
  it('12. Montant superieur (+2 au-dela de tolerance) — REVIEW_REQUIRED', async () => {
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(pendingAttempt());

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { amount: 5002 }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });

  // Scenario 13
  it('13. Montant inferieur (-2 au-dela de tolerance) — REVIEW_REQUIRED', async () => {
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(pendingAttempt());

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { amount: 4998 }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });

  // Scenario 14
  it('14. Montant absent — REVIEW_REQUIRED, pas d activation', async () => {
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(pendingAttempt());

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send({ event: { type: 'payment.succeeded' }, data: { reference: 'gp-ref-A', currency: 'XOF' } });

    expect(res.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });

  // Scenario 15
  it('15. Signature incorrecte — 401, aucune modification', async () => {
    mockGeniuspay.verifyWebhookSignature.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'bad-sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded'));

    expect(res.status).toBe(401);
    expect(mockPrisma.subscriptionPaymentAttempt.update).not.toHaveBeenCalled();
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });

  // Scenario 16
  it('16. Event payment.succeeded repete sur tentative SUCCEEDED — no-op', async () => {
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(pendingAttempt({ status: 'SUCCEEDED' }));

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).not.toHaveBeenCalled();
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// D. RENOUVELLEMENTS
// ════════════════════════════════════════════════════════════════════════════════

describe('D. Renouvellements', () => {
  const proUser = { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', lastName: 'Dupont' };

  // Scenario 17
  it('17. Renouvellement ACTIVE — nouvelle tentative creee, status subscription preserve', async () => {
    const activeSub = mockSubscription({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000) });
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro({ subscription: activeSub }));
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'sub-id-1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000) });
    mockPrisma.subscription.upsert.mockResolvedValue({ ...activeSub, tier: 'PRO', billingCycle: 'MONTHLY' });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(mockAttempt({ id: 'renewal-att', status: 'CREATED', geniuspayRef: null }));
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-renewal', checkout_url: 'https://pay.test/renewal' });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(200);
    // isCurrentlyActive=true: upsert.update must NOT contain status: 'PENDING_PAYMENT'
    const updateArg = mockPrisma.subscription.upsert.mock.calls[0][0].update;
    expect(updateArg).not.toHaveProperty('status');
    expect(res.body.paymentUrl).toBe('https://pay.test/renewal');
  });

  // Scenario 18
  it('18. Echec renouvellement — sub reste ACTIVE, tentative FAILED', async () => {
    const activeSub = mockSubscription({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000), professional: { user: proUser } });
    const renewalAttempt = mockAttempt({
      id: 'renewal-A', geniuspayRef: 'gp-renewal', status: 'PENDING', expectedAmount: 5000,
      subscription: { ...activeSub, professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(renewalAttempt);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE' });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.failed', { reference: 'gp-renewal' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    );
    expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  // Scenario 19
  it('19. Confirmation tardive d un renouvellement — activation correcte', async () => {
    const activeSub = mockSubscription({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000), professional: { user: proUser } });
    const renewalAttempt = mockAttempt({
      id: 'renewal-late', geniuspayRef: 'gp-late', status: 'PENDING', expectedAmount: 5000,
      subscription: { ...activeSub, professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(renewalAttempt);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE', expiresAt: new Date(Date.now() - 1) });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-late', amount: 5000 }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) })
    );
  });

  // Scenario 20
  it('20. Grace period 3 jours apres echec sur abonnement non-ACTIVE', async () => {
    const pendingSub = mockSubscription({ status: 'PENDING_PAYMENT', professional: { user: proUser } });
    const attempt = mockAttempt({
      id: 'att-fail', geniuspayRef: 'gp-fail', status: 'PENDING', expectedAmount: 5000,
      subscription: { ...pendingSub, professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT' });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.failed', { reference: 'gp-fail' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'ACTIVE' } }),
        data: expect.objectContaining({ status: 'GRACE_PERIOD' }),
      })
    );
    const gracePeriodEndsAt = mockPrisma.subscription.updateMany.mock.calls[0][0].data.gracePeriodEndsAt;
    expect(gracePeriodEndsAt.getTime()).toBeGreaterThan(Date.now() + 2 * 24 * 60 * 60 * 1000);
  });

  // Scenario 21
  it('21. Paiement incertain (event inconnu) — aucune activation', async () => {
    const attempt = mockAttempt({
      id: 'att-unk', geniuspayRef: 'gp-unk', status: 'PENDING',
      subscription: { ...mockSubscription({ status: 'PENDING_PAYMENT' }), professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send({ event: { type: 'payment.processing' }, data: { reference: 'gp-unk', amount: 5000 } });

    expect(res.status).toBe(200);
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    expect(mockPrisma.subscriptionPaymentAttempt.update).not.toHaveBeenCalled();
  });

  // Scenario 22
  it('22. Tentative annulee — CANCELLED sur la tentative, pas de grace period', async () => {
    const attempt = mockAttempt({
      id: 'att-cancel', geniuspayRef: 'gp-cancel', status: 'PENDING',
      subscription: { ...mockSubscription({ status: 'PENDING_PAYMENT' }), professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.cancelled', { reference: 'gp-cancel' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) })
    );
    expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  // Scenario 23
  it('23. Tentative expiree — EXPIRED sur la tentative, pas de grace period', async () => {
    const attempt = mockAttempt({
      id: 'att-exp', geniuspayRef: 'gp-exp', status: 'PENDING',
      subscription: { ...mockSubscription({ status: 'PENDING_PAYMENT' }), professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.expired', { reference: 'gp-exp' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) })
    );
    expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// E. DOUBLES PAIEMENTS
// ════════════════════════════════════════════════════════════════════════════════

describe('E. Doubles paiements', () => {
  const proUser = { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', lastName: 'Dupont' };

  // Scenario 24
  it('24. Confirmation de deux tentatives — toutes deux enregistrees independamment', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', professional: { user: proUser } });

    // Confirm A (sub not yet ACTIVE)
    const attemptA = mockAttempt({ id: 'A', geniuspayRef: 'gp-A', status: 'PENDING', subscription: { ...sub, professional: { user: proUser } } });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValueOnce(attemptA);
    mockPrisma.subscription.findUnique.mockResolvedValueOnce({ status: 'PENDING_PAYMENT', expiresAt: null });

    const res1 = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-A', amount: 5000 }));

    expect(res1.status).toBe(200);
    expect(mockPrisma.subscription.update).toHaveBeenCalled();

    jest.clearAllMocks();
    mockGeniuspay.verifyWebhookSignature.mockReturnValue(true);
    mockGeniuspay.verifyWebhookTimestamp.mockReturnValue(true);
    mockPrisma.subscriptionPaymentAttempt.update.mockResolvedValue({});
    mockPrisma.subscriptionPaymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.subscription.update.mockResolvedValue({});
    mockPrisma.notification.create.mockResolvedValue({});
    // Simulate that attempt A already SUCCEEDED (triggers isPeriodAlreadyPaid legacy path)
    mockPrisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue(
      mockAttempt({ id: 'A', status: 'SUCCEEDED', confirmedAt: new Date() })
    );

    // Confirm B (sub now ACTIVE from A) — should be REVIEW_REQUIRED
    const attemptB = mockAttempt({ id: 'B', geniuspayRef: 'gp-B', status: 'PENDING', subscription: { ...sub, professional: { user: proUser } } });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attemptB);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 86400000) });

    const res2 = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-B', amount: 5000 }));

    expect(res2.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
  });

  // Scenario 25
  it('25. Detection paiement excessif — REVIEW_REQUIRED + notification admin', async () => {
    const sub = mockSubscription({ status: 'ACTIVE', professional: { user: proUser } });
    const attemptB = mockAttempt({
      id: 'B', geniuspayRef: 'gp-B', status: 'PENDING', expectedAmount: 5000,
      subscription: { ...sub, professional: { user: proUser } },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attemptB);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 86400000) });
    // Simulate another SUCCEEDED attempt for the same subscription (legacy path)
    mockPrisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue(
      mockAttempt({ id: 'A', status: 'SUCCEEDED', confirmedAt: new Date() })
    );

    await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-B', amount: 5000 }));

    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SUBSCRIPTION_DUPLICATE_PAYMENT' }),
      })
    );
  });

  // Scenario 26
  it('26. Pas de double prolongation — subscription.update appele une seule fois', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', professional: { user: proUser } });
    const attemptA = mockAttempt({ id: 'A', geniuspayRef: 'gp-A', status: 'PENDING', subscription: { ...sub, professional: { user: proUser } } });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attemptA);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'PENDING_PAYMENT', expiresAt: null });

    await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-A', amount: 5000 }));

    const activations = mockPrisma.subscription.update.mock.calls.filter(c => c[0].data?.status === 'ACTIVE');
    expect(activations).toHaveLength(1);
  });

  // Scenario 27
  it('27. Pas de double activation — second paiement n active pas si sub deja ACTIVE', async () => {
    const activeSub = mockSubscription({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 86400000), professional: { user: proUser } });
    const attemptB = mockAttempt({ id: 'B', geniuspayRef: 'gp-B', status: 'PENDING', subscription: { ...activeSub, professional: { user: proUser } } });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attemptB);
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 86400000) });
    // Simulate another SUCCEEDED attempt for same subscription (legacy path — no periodStartAt on attempt)
    mockPrisma.subscriptionPaymentAttempt.findFirst.mockResolvedValue(
      mockAttempt({ id: 'A', status: 'SUCCEEDED', confirmedAt: new Date() })
    );

    await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-B', amount: 5000 }));

    const activations = mockPrisma.subscription.update.mock.calls.filter(c => c[0]?.data?.status === 'ACTIVE');
    expect(activations).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// F. HISTORIQUE ET RECUS
// ════════════════════════════════════════════════════════════════════════════════

describe('F. Historique et recus', () => {
  // Scenario 28
  it('28. Historique retourne plusieurs tentatives triees', async () => {
    const attempts = [
      { id: 'a1', geniuspayRef: 'gp-1', provider: 'geniuspay', tier: 'PRO', billingCycle: 'MONTHLY', expectedAmount: 5000, confirmedAmount: 5000, status: 'SUCCEEDED', confirmedAt: new Date('2026-01-01'), createdAt: new Date('2026-01-01'), scheduledStartAt: null },
      { id: 'a2', geniuspayRef: 'gp-2', provider: 'geniuspay', tier: 'PRO', billingCycle: 'MONTHLY', expectedAmount: 5000, confirmedAmount: null, status: 'FAILED', confirmedAt: null, createdAt: new Date('2025-12-01'), scheduledStartAt: null },
    ];
    const sub = { id: 'sub-id-1', tier: 'PRO', billingCycle: 'MONTHLY', status: 'ACTIVE', expiresAt: new Date('2026-02-01'), gracePeriodEndsAt: null, paymentAttempts: attempts };
    mockPrisma.professional.findUnique.mockResolvedValue({ ...mockPro(), subscription: sub });

    const res = await request(app)
      .get('/api/subscriptions/history')
      .set('Authorization', `Bearer ${proToken}`);

    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.payments[0].status).toBe('SUCCEEDED');
    expect(res.body.payments[1].status).toBe('FAILED');
  });

  // Scenario 29
  it('29. Historique vide si aucune tentative', async () => {
    const sub = { id: 'sub-id-1', tier: 'PRO', billingCycle: 'MONTHLY', status: 'PENDING_PAYMENT', expiresAt: null, gracePeriodEndsAt: null, paymentAttempts: [] };
    mockPrisma.professional.findUnique.mockResolvedValue({ ...mockPro(), subscription: sub });

    const res = await request(app)
      .get('/api/subscriptions/history')
      .set('Authorization', `Bearer ${proToken}`);

    expect(res.status).toBe(200);
    expect(res.body.payments).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  // Scenario 30
  it('30. Isolation — pro ne voit que ses propres tentatives', async () => {
    const sub = { id: 'sub-id-2', tier: 'ESSENTIEL', billingCycle: 'MONTHLY', status: 'ACTIVE', expiresAt: new Date(), gracePeriodEndsAt: null, paymentAttempts: [
      { id: 'pro2-att', geniuspayRef: 'gp-pro2', provider: 'geniuspay', tier: 'ESSENTIEL', billingCycle: 'MONTHLY', expectedAmount: 2500, confirmedAmount: 2500, status: 'SUCCEEDED', confirmedAt: new Date(), createdAt: new Date(), scheduledStartAt: null },
    ]};
    mockPrisma.professional.findUnique.mockResolvedValue({ ...mockPro(), id: 'pro-id-2', subscription: sub });

    const res = await request(app)
      .get('/api/subscriptions/history')
      .set('Authorization', `Bearer ${proToken}`);

    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].id).toBe('pro2-att');
  });

  // Scenario 31
  it('31. Recu genere pour la bonne transaction (par attemptId)', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({
      ...mockPro(),
      subscription: { id: 'sub-id-1', startedAt: new Date('2026-01-01'), expiresAt: new Date('2026-02-01') },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue({
      id: 'att-receipt', subscriptionId: 'sub-id-1', geniuspayRef: 'gp-receipt',
      tier: 'PRO', billingCycle: 'MONTHLY', expectedAmount: 5000, confirmedAmount: 5000,
      status: 'SUCCEEDED', confirmedAt: new Date('2026-01-01'), createdAt: new Date(),
    });

    const res = await request(app)
      .get('/api/subscriptions/receipt?attemptId=att-receipt')
      .set('Authorization', `Bearer ${proToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    const { generateSubscriptionReceiptBuffer } = require('../utils/generateSubscriptionReceipt');
    expect(generateSubscriptionReceiptBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'PRO', amount: 5000, reference: 'gp-receipt' })
    );
  });

  // Scenario 32
  it('32. Refus du recu pour paiement non confirme (tentative PENDING)', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({
      ...mockPro(),
      subscription: { id: 'sub-id-1', startedAt: null, expiresAt: null },
    });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue({
      id: 'att-pending', subscriptionId: 'sub-id-1', status: 'PENDING',
    });

    const res = await request(app)
      .get('/api/subscriptions/receipt?attemptId=att-pending')
      .set('Authorization', `Bearer ${proToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/paiement confirm/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// G. PERIODES DE FACTURATION (upgrade / downgrade / renouvellement / cycle)
// ════════════════════════════════════════════════════════════════════════════════

describe('G. Periodes de facturation', () => {
  // Scenario 33 — Renouvellement (meme tier + meme cycle) → periodStartAt = expiresAt
  it('33. Renouvellement meme formule: periodStartAt = expiresAt de la sub courante', async () => {
    const future = new Date(Date.now() + 10 * 86400000);
    const activeSub33 = { id: 'sub-id-1', status: 'ACTIVE', expiresAt: future, tier: 'PRO', billingCycle: 'MONTHLY' };
    // Reset explicite pour isoler ce test des effets des tests E précédents
    mockPrisma.professional.findUnique.mockReset();
    mockPrisma.subscription.findUnique.mockReset();
    mockPrisma.subscriptionPaymentAttempt.create.mockReset();
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    // existingSub: ACTIVE, tier PRO MONTHLY — même tier et cycle que la requête
    mockPrisma.subscription.findUnique.mockResolvedValue(activeSub33);
    mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription({ id: 'sub-id-1' }));
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(mockAttempt({ id: 'renewal-33', status: 'CREATED', geniuspayRef: null }));
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-33', checkout_url: 'https://pay.test/33' });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(200);
    const createCall = mockPrisma.subscriptionPaymentAttempt.create.mock.calls[0][0].data;
    // periodStartAt doit être égal à expiresAt (± 500ms de marge pour l'exécution)
    expect(createCall.periodStartAt).toBeDefined();
    expect(Math.abs(new Date(createCall.periodStartAt).getTime() - future.getTime())).toBeLessThan(500);
  });

  // Scenario 34 — Upgrade ESSENTIEL→PRO → periodStartAt = now (activation immédiate)
  it('34. Upgrade (ESSENTIEL vers PRO): periodStartAt = now, pas expiresAt', async () => {
    const future = new Date(Date.now() + 10 * 86400000);
    const beforeCheckout = Date.now();
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    // existingSub: ACTIVE tier ESSENTIEL — différent du tier demandé PRO
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-id-1', status: 'ACTIVE', expiresAt: future, tier: 'ESSENTIEL', billingCycle: 'MONTHLY',
    });
    mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription({ id: 'sub-id-1', tier: 'PRO' }));
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(mockAttempt({ id: 'upgrade-34', status: 'CREATED', geniuspayRef: null }));
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-34', checkout_url: 'https://pay.test/34' });

    await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'MONTHLY' });

    const createCall = mockPrisma.subscriptionPaymentAttempt.create.mock.calls[0][0].data;
    expect(createCall.periodStartAt).toBeDefined();
    // periodStartAt doit être proche de maintenant (< 5s), PAS de expiresAt (10 jours futur)
    const diff = new Date(createCall.periodStartAt).getTime() - beforeCheckout;
    expect(diff).toBeGreaterThanOrEqual(0);
    expect(diff).toBeLessThan(5000);
    // Confirme que ce n'est pas expiresAt
    expect(Math.abs(new Date(createCall.periodStartAt).getTime() - future.getTime())).toBeGreaterThan(1000);
  });

  // Scenario 35 — Downgrade PRO→ESSENTIEL → periodStartAt = expiresAt (effet au prochain cycle)
  it('35. Downgrade (PRO vers ESSENTIEL): periodStartAt = expiresAt de la sub courante', async () => {
    const future = new Date(Date.now() + 15 * 86400000);
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    // existingSub: ACTIVE tier PRO, downgrade vers ESSENTIEL
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-id-1', status: 'ACTIVE', expiresAt: future, tier: 'PRO', billingCycle: 'MONTHLY',
    });
    mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription({ id: 'sub-id-1', tier: 'ESSENTIEL' }));
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(mockAttempt({ id: 'down-35', status: 'CREATED', geniuspayRef: null }));
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-35', checkout_url: 'https://pay.test/35' });

    await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'ESSENTIEL', billingCycle: 'MONTHLY' });

    const createCall = mockPrisma.subscriptionPaymentAttempt.create.mock.calls[0][0].data;
    expect(createCall.periodStartAt).toBeDefined();
    // Downgrade = pas un upgrade → periodStartAt = expiresAt
    expect(Math.abs(new Date(createCall.periodStartAt).getTime() - future.getTime())).toBeLessThan(1000);
  });

  // Scenario 36 — Changement de cycle MONTHLY→YEARLY → periodStartAt = expiresAt
  it('36. Changement cycle (MONTHLY vers YEARLY): periodStartAt = expiresAt de la sub courante', async () => {
    const future = new Date(Date.now() + 20 * 86400000);
    mockPrisma.professional.findUnique.mockResolvedValue(mockPro());
    // existingSub: ACTIVE tier PRO MONTHLY, passage à YEARLY
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-id-1', status: 'ACTIVE', expiresAt: future, tier: 'PRO', billingCycle: 'MONTHLY',
    });
    mockPrisma.subscription.upsert.mockResolvedValue(mockSubscription({ id: 'sub-id-1', billingCycle: 'YEARLY' }));
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(null);
    mockPrisma.subscriptionPaymentAttempt.create.mockResolvedValue(mockAttempt({ id: 'cycle-36', status: 'CREATED', geniuspayRef: null }));
    mockGeniuspay.createPayment.mockResolvedValue({ reference: 'gp-36', checkout_url: 'https://pay.test/36' });

    await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ tier: 'PRO', billingCycle: 'YEARLY' });

    const createCall = mockPrisma.subscriptionPaymentAttempt.create.mock.calls[0][0].data;
    expect(createCall.periodStartAt).toBeDefined();
    // Cycle change = pas un renouvellement pur → periodStartAt = expiresAt (effet différé)
    expect(Math.abs(new Date(createCall.periodStartAt).getTime() - future.getTime())).toBeLessThan(1000);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// H. CONCURRENCE (simulation via mock)
// ════════════════════════════════════════════════════════════════════════════════

describe('H. Concurrence (simulation via mock)', () => {
  const proUser = { id: 'pro-user-1', email: 'pro@test.com', firstName: 'Alice', lastName: 'Dupont' };

  // Scenario 37 — Guard optimiste : si updateMany retourne count=0, l'activation est sautée
  it('37. Guard optimiste: updateMany count=0 → activation sautee (deja traitee)', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', professional: { user: proUser } });
    const attempt = mockAttempt({ id: 'att-37', geniuspayRef: 'gp-37', status: 'PENDING', subscription: { ...sub, professional: { user: proUser } } });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);
    // Simuler qu'un concurrent a déjà traité l'attempt (count=0)
    mockPrisma.subscriptionPaymentAttempt.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-37', amount: 5000 }));

    expect(res.status).toBe(200);
    // subscription.update (activation) ne doit PAS avoir été appelé
    const activations = mockPrisma.subscription.update.mock.calls.filter(c => c[0]?.data?.status === 'ACTIVE');
    expect(activations).toHaveLength(0);
  });

  // Scenario 38 — Violation index unique P2002 → REVIEW_REQUIRED + notification admin
  it('38. Violation index unique (P2002): tentative marquee REVIEW_REQUIRED + notif admin', async () => {
    const sub = mockSubscription({ status: 'PENDING_PAYMENT', professional: { user: proUser } });
    const attempt = mockAttempt({ id: 'att-38', geniuspayRef: 'gp-38', status: 'PENDING', expectedAmount: 5000, subscription: { ...sub, professional: { user: proUser } } });
    mockPrisma.subscriptionPaymentAttempt.findUnique.mockResolvedValue(attempt);

    // Simuler une violation d'index unique Prisma (P2002)
    const p2002 = new Error('Unique constraint violation');
    p2002.code = 'P2002';
    mockPrisma.$transaction.mockRejectedValueOnce(p2002);

    const res = await request(app)
      .post('/api/v1/webhooks/geniuspay')
      .set('x-webhook-signature', 'sig')
      .set('x-webhook-timestamp', '123')
      .send(webhookPayload('payment.succeeded', { reference: 'gp-38', amount: 5000 }));

    expect(res.status).toBe(200);
    expect(mockPrisma.subscriptionPaymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW_REQUIRED' }) })
    );
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SUBSCRIPTION_DUPLICATE_PAYMENT' }),
      })
    );
  });
});
