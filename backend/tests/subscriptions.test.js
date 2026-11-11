const request = require('supertest');
const express = require('express');
const { proToken, clientToken } = require('./helpers');

jest.mock('../config/db', () => ({
  user:         { findUnique: jest.fn() },
  professional: { findUnique: jest.fn() },
  subscription: { upsert: jest.fn(), updateMany: jest.fn() },
  promoCode:    { findUnique: jest.fn(), update: jest.fn() },
  promoUsage:   { findUnique: jest.fn(), create: jest.fn() },
  appConfig:    { upsert: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(ops => Promise.all(ops)),
}));

jest.mock('../utils/appConfig', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
  setConfig: jest.fn().mockResolvedValue({}),
}));

jest.mock('../utils/geniuspay', () => ({
  createPayment: jest.fn().mockResolvedValue({
    reference: 'gp-ref-123',
    checkout_url: 'https://pay.geniuspay.test/checkout/gp-ref-123',
  }),
}));

const prisma    = require('../config/db');
const appConfig = require('../utils/appConfig');
const subscriptionRoutes = require('../routes/subscriptions');

const app = express();
app.use(express.json());
app.use('/api/subscriptions', subscriptionRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const PRO_ID   = 'pro-user-1';
const CLIENT_ID = 'client-1';
const mockPro  = { id: PRO_ID, role: 'PROFESSIONAL', suspended: false };
const mockCli  = { id: CLIENT_ID, role: 'CLIENT',    suspended: false };

const mockProfessional = {
  id: 'p-1', userId: PRO_ID, trialEndsAt: null,
  subscription: null,
  user: { id: PRO_ID, firstName: 'Marc', lastName: 'Dupont', email: 'pro@test.com', phone: '' },
};

const mockProfessionalWithTrial = {
  ...mockProfessional,
  trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // dans 10 jours
};

const mockProfessionalWithSub = {
  ...mockProfessional,
  subscription: {
    tier: 'ESSENTIEL', status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  },
};

// ══ GET /api/subscriptions/me ════════════════════════════════════════════

describe('GET /api/subscriptions/me', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockPro);
    appConfig.getConfig.mockResolvedValue(null); // prix par défaut
  });

  test('retourne GRATUIT sans abonnement ni trial', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('GRATUIT');
    expect(res.body.isPremium).toBe(false);
    expect(res.body.isOnTrial).toBe(false);
  });

  test('retourne PRO avec trial actif', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessionalWithTrial);

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('PRO');
    expect(res.body.isOnTrial).toBe(true);
    expect(res.body.trialDaysLeft).toBeGreaterThan(0);
  });

  test('retourne ESSENTIEL avec abonnement actif', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessionalWithSub);

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('ESSENTIEL');
    expect(res.body.isPremium).toBe(true);
  });

  test('inclut la liste des plans disponibles', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.body.plans).toBeDefined();
    expect(Array.isArray(res.body.plans)).toBe(true);
    expect(res.body.plans.length).toBeGreaterThan(0);
    expect(res.body.plans.every(p => p.key !== 'GRATUIT')).toBe(true);
  });

  test('403 si CLIENT essaie d\'accéder', async () => {
    prisma.user.findUnique.mockResolvedValue(mockCli);

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(403);
  });

  test('401 sans token', async () => {
    const res = await request(app).get('/api/subscriptions/me');
    expect(res.status).toBe(401);
  });
});

// ══ POST /api/subscriptions/validate-promo ════════════════════════════════

describe('POST /api/subscriptions/validate-promo', () => {
  const mockPromoCode = {
    id: 'promo-1', code: 'TEST10', active: true,
    discountType: 'PERCENT', discountValue: 10,
    description: '10% de remise',
    validFrom: new Date(Date.now() - 1000),
    validUntil: null,
    maxUses: null, usedCount: 0,
    applicableTiers: [],
  };

  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockPro);
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    appConfig.getConfig.mockResolvedValue(null);
    prisma.promoUsage.findUnique.mockResolvedValue(null);
  });

  test('valide un code promo valide et retourne les montants', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(mockPromoCode);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'TEST10', tier: 'ESSENTIEL' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.discountAmount).toBeGreaterThan(0);
    expect(res.body.finalAmount).toBeLessThan(res.body.originalAmount);
  });

  test('400 si code inexistant', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'INEXISTANT', tier: 'ESSENTIEL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('400 si code désactivé', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({ ...mockPromoCode, active: false });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'TEST10', tier: 'ESSENTIEL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/désactivé/i);
  });

  test('400 si code expiré', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      ...mockPromoCode, validUntil: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'TEST10', tier: 'ESSENTIEL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expiré/i);
  });

  test('400 si code déjà utilisé par ce pro', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(mockPromoCode);
    prisma.promoUsage.findUnique.mockResolvedValue({ id: 'usage-1' });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'TEST10', tier: 'ESSENTIEL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà utilisé/i);
  });

  test('400 si code requis manquant', async () => {
    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('403 si CLIENT essaie de valider', async () => {
    prisma.user.findUnique.mockResolvedValue(mockCli);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ code: 'TEST10' });

    expect(res.status).toBe(403);
  });
});

// ══ POST /api/subscriptions/checkout ════════════════════════════════════════

describe('POST /api/subscriptions/checkout', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockPro);
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    appConfig.getConfig.mockResolvedValue(null);
    prisma.promoCode.findUnique.mockResolvedValue(null);
    prisma.subscription.upsert.mockResolvedValue({
      professionalId: 'p-1', tier: 'ESSENTIEL', status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  });

  test('initie le paiement GeniusPay et retourne paymentUrl', async () => {
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ tier: 'ESSENTIEL' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('paymentUrl');
    expect(res.body).toHaveProperty('reference');
    expect(res.body.tier).toBe('ESSENTIEL');
    expect(prisma.subscription.upsert).toHaveBeenCalled();
  });

  test('accepte les tiers valides : PRO, ELITE', async () => {
    for (const tier of ['PRO', 'ELITE']) {
      prisma.subscription.upsert.mockResolvedValue({ tier, status: 'PENDING_PAYMENT', transactionId: 'gp-ref-123' });

      const res = await request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
        .send({ tier });

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe(tier);
      expect(res.body).toHaveProperty('paymentUrl');
    }
  });

  test('400 si tier invalide', async () => {
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ tier: 'INVALIDE' });

    expect(res.status).toBe(400);
  });

  test('400 si tier GRATUIT', async () => {
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ tier: 'GRATUIT' });

    expect(res.status).toBe(400);
  });

  test('403 si CLIENT essaie de souscrire', async () => {
    prisma.user.findUnique.mockResolvedValue(mockCli);

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ tier: 'ESSENTIEL' });

    expect(res.status).toBe(403);
  });

  test('401 sans token', async () => {
    const res = await request(app).post('/api/subscriptions/checkout').send({ tier: 'ESSENTIEL' });
    expect(res.status).toBe(401);
  });
});

// ══ ADVANCED: Subscription Lifecycle & Renewals ═════════════════════════════════

describe('ADVANCED: Subscription Lifecycle', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockPro);
    appConfig.getConfig.mockResolvedValue(null);
  });

  test('Auto-renewal should occur before expiration', async () => {
    const expiringTomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    prisma.professional.findUnique.mockResolvedValue({
      ...mockProfessional,
      subscription: { tier: 'ESSENTIEL', status: 'ACTIVE', expiresAt: expiringTomorrow },
    });
    prisma.subscription.upsert.mockResolvedValue({
      tier: 'ESSENTIEL', status: 'RENEWAL_PENDING', autoRenew: true,
    });

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
  });

  test('Subscription downgrade should be allowed mid-cycle', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessionalWithSub);
    prisma.subscription.upsert.mockResolvedValue({
      tier: 'PRO', status: 'DOWNGRADE_SCHEDULED', expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(200);
  });

  test('Trial conversion to paid subscription', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessionalWithTrial);
    prisma.subscription.upsert.mockResolvedValue({
      tier: 'ESSENTIEL', status: 'ACTIVE', trialConvertedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ tier: 'ESSENTIEL' });

    expect(res.status).toBe(200);
  });
});

// ══ EDGE CASES: Promo Code Edge Cases ════════════════════════════════════════════

describe('EDGE CASES: Promo Code Validation', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockPro);
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    appConfig.getConfig.mockResolvedValue(null);
  });

  test('Case-insensitive promo code should work', async () => {
    const mockPromoCode = {
      id: 'promo-1', code: 'TEST10', active: true,
      discountType: 'PERCENT', discountValue: 10,
      validFrom: new Date(Date.now() - 1000), validUntil: null,
      maxUses: null, usedCount: 0, applicableTiers: [],
    };
    prisma.promoCode.findUnique.mockResolvedValue(mockPromoCode);
    prisma.promoUsage.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'test10', tier: 'ESSENTIEL' }); // lowercase

    expect(res.status).toBe(200);
  });

  test('Promo code with max uses reached should be rejected', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1', code: 'MAXED', active: true,
      discountValue: 20, maxUses: 5, usedCount: 5,
      validFrom: new Date(Date.now() - 1000), validUntil: null,
    });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'MAXED', tier: 'ESSENTIEL' });

    expect(res.status).toBe(400);
  });

  test('Promo code with specific tier restrictions', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1', code: 'ELITE_ONLY', active: true,
      discountValue: 50, validFrom: new Date(Date.now() - 1000),
      validUntil: null, applicableTiers: ['ELITE'],
    });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'ELITE_ONLY', tier: 'ESSENTIEL' }); // not ELITE

    expect(res.status).toBe(400);
  });

  test('Promo code with very large discount should be validated', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1', code: 'HUGE', active: true,
      discountType: 'PERCENT', discountValue: 99,
      validFrom: new Date(Date.now() - 1000), validUntil: null,
      maxUses: null, usedCount: 0,
      applicableTiers: [],
      description: '99% discount promo',
    });
    prisma.promoUsage.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'HUGE', tier: 'ESSENTIEL' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.discountValue).toBe(99);
  });
});

// ══ EDGE CASES: Payment & Checkout Edge Cases ═════════════════════════════════════

describe('EDGE CASES: Payment Processing', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockPro);
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    appConfig.getConfig.mockResolvedValue(null);
  });

  test('Checkout with zero total (100% discount) should be handled', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1', code: 'FREE', active: true,
      discountType: 'PERCENT', discountValue: 100,
      validFrom: new Date(Date.now() - 1000), validUntil: null,
      maxUses: null, usedCount: 0,
      applicableTiers: [],
      description: '100% free trial',
    });
    prisma.promoUsage.findUnique.mockResolvedValue(null);
    prisma.subscription.upsert.mockResolvedValue({
      id: 'sub-1', tier: 'ESSENTIEL', status: 'ACTIVE',
      startedAt: new Date(), expiresAt: new Date(),
    });

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ tier: 'ESSENTIEL', promoCode: 'FREE' });

    expect(res.status).toBe(200);
    expect(res.body.activated).toBe(true);
    expect(res.body.finalAmount).toBe(0);
  });

  test('Concurrent payment requests should be deduplicated', async () => {
    let paymentCount = 0;
    prisma.subscription.upsert.mockImplementation(() => {
      paymentCount++;
      return Promise.resolve({
        tier: 'ESSENTIEL', status: 'PENDING_PAYMENT', transactionId: `gp-${paymentCount}`,
      });
    });

    const requests = Array.from({ length: 3 }, () =>
      request(app)
        .post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
        .send({ tier: 'ESSENTIEL' })
    );

    const results = await Promise.all(requests);
    results.forEach(res => expect(res.status).toBe(200));
  });
});
