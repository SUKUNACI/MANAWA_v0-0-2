const request = require('supertest');
const express = require('express');
const { proToken, clientToken, adminToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  professional: {
    findUnique: jest.fn(),
  },
  promoCode: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  promoUsage: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  subscription: {
    upsert: jest.fn(),
  },
  appConfig: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
}));

jest.mock('../../utils/geniuspay', () => ({
  createPayment: jest.fn(),
  getPayment: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  verifyWebhookTimestamp: jest.fn(),
}));

jest.mock('../../utils/appConfig', () => ({
  getConfig: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt']),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
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
  optionalAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      try {
        req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      } catch {}
    }
    next();
  },
}));

const prisma = require('../../config/db');
const geniuspay = require('../../utils/geniuspay');
const { getConfig } = require('../../utils/appConfig');

const subscriptionsRouter = require('../../routes/subscriptions');
const { getActiveTier, getTierConfig, TIERS } = require('../../routes/subscriptions');

const app = express();
app.use(express.json());
app.use('/api/subscriptions', subscriptionsRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message || 'Erreur interne' });
});

// ============ HELPERS ============

const MOCK_PRO_USER_ID = 'pro-user-1';
const MOCK_PRO_ID = 'pro-id-1';

function mockDynamicPrices() {
  getConfig.mockImplementation((key) => {
    const prices = { price_essentiel: 2500, price_pro: 5000, price_elite: 10000 };
    return Promise.resolve(prices[key] ?? null);
  });
}

const mockPro = {
  id: MOCK_PRO_ID,
  userId: MOCK_PRO_USER_ID,
  trialEndsAt: null,
  subscription: null,
  user: {
    id: MOCK_PRO_USER_ID,
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean@example.com',
    phone: '+225070000000',
  },
};

// ============ UNIT TESTS: getActiveTier / getTierConfig ============

describe('getActiveTier()', () => {
  it('retourne GRATUIT si pas de subscription ni de trial', () => {
    expect(getActiveTier(null, { trialEndsAt: null })).toBe('GRATUIT');
  });

  it('retourne PRO si trial actif', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    expect(getActiveTier(null, { trialEndsAt: future })).toBe('PRO');
  });

  it('retourne GRATUIT si trial expiré', () => {
    const past = new Date(Date.now() - 1000);
    expect(getActiveTier(null, { trialEndsAt: past })).toBe('GRATUIT');
  });

  it('retourne le tier de la subscription ACTIVE non expirée', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const sub = { status: 'ACTIVE', tier: 'ELITE', expiresAt: future };
    expect(getActiveTier(sub, { trialEndsAt: null })).toBe('ELITE');
  });

  it('retourne ESSENTIEL si subscription ACTIVE sans tier', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const sub = { status: 'ACTIVE', tier: null, expiresAt: future };
    expect(getActiveTier(sub, { trialEndsAt: null })).toBe('ESSENTIEL');
  });

  it('retourne GRATUIT si subscription ACTIVE mais expirée', () => {
    const past = new Date(Date.now() - 1000);
    const sub = { status: 'ACTIVE', tier: 'PRO', expiresAt: past };
    expect(getActiveTier(sub, { trialEndsAt: null })).toBe('GRATUIT');
  });

  it('retourne GRATUIT si subscription PENDING_PAYMENT', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const sub = { status: 'PENDING_PAYMENT', tier: 'PRO', expiresAt: future };
    expect(getActiveTier(sub, { trialEndsAt: null })).toBe('GRATUIT');
  });

  it('trial prime sur subscription payée', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const sub = { status: 'ACTIVE', tier: 'ESSENTIEL', expiresAt: future };
    expect(getActiveTier(sub, { trialEndsAt: future })).toBe('PRO');
  });
});

describe('getTierConfig()', () => {
  it('retourne la config du tier sans prix dynamiques', () => {
    const config = getTierConfig('PRO', null);
    expect(config.label).toBe('Pro');
    expect(config.price).toBe(5000);
    expect(config.maxTrades).toBe(6);
  });

  it('écrase le prix avec les prix dynamiques si fournis', () => {
    const config = getTierConfig('ESSENTIEL', { essentiel: 3000, pro: 6000, elite: 12000 });
    expect(config.price).toBe(3000);
    expect(config.label).toBe('Essentiel');
  });

  it('retourne GRATUIT si tier inconnu', () => {
    const config = getTierConfig('INVALIDE', null);
    expect(config.label).toBe('Gratuit');
    expect(config.price).toBe(0);
  });

  it('ne modifie pas le prix de GRATUIT', () => {
    const config = getTierConfig('GRATUIT', { essentiel: 3000, pro: 6000, elite: 12000 });
    expect(config.price).toBe(0);
  });
});

// ============ GET /api/subscriptions/me ============

describe('GET /api/subscriptions/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamicPrices();
  });

  it('retourne 401 sans token', async () => {
    const res = await request(app).get('/api/subscriptions/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Non authentifié/i);
  });

  it('retourne 403 si rôle CLIENT', async () => {
    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Accès refusé/i);
  });

  it('retourne 403 si rôle ADMIN', async () => {
    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 404 si professionnel non trouvé', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Professionnel non trouvé/i);
  });

  it('retourne 200 avec données GRATUIT (pas de subscription)', async () => {
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro,
      trialEndsAt: null,
      subscription: null,
    });

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('GRATUIT');
    expect(res.body.isPremium).toBe(false);
    expect(res.body.isOnTrial).toBe(false);
    expect(res.body.trialDaysLeft).toBeNull();
    expect(res.body.plans).toHaveLength(3); // ESSENTIEL, PRO, ELITE
    expect(res.body.plans.map(p => p.key)).toContain('PRO');
  });

  it('retourne 200 avec trial actif', async () => {
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro,
      trialEndsAt: trialEnd,
      subscription: null,
    });

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('PRO');
    expect(res.body.isOnTrial).toBe(true);
    expect(res.body.isPremium).toBe(true);
    expect(res.body.trialDaysLeft).toBeGreaterThan(0);
    expect(res.body.trialEndsAt).toBeTruthy();
  });

  it('retourne 200 avec subscription ELITE active', async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro,
      trialEndsAt: null,
      subscription: {
        status: 'ACTIVE',
        tier: 'ELITE',
        expiresAt,
      },
    });

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('ELITE');
    expect(res.body.isPremium).toBe(true);
    expect(res.body.expiresAt).toBeTruthy();
    expect(res.body.tierConfig.badge).toBe('⭐ Élite');
  });

  it('retourne 200 avec subscription PENDING_PAYMENT (tier GRATUIT)', async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro,
      trialEndsAt: null,
      subscription: {
        status: 'PENDING_PAYMENT',
        tier: 'PRO',
        expiresAt,
      },
    });

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('GRATUIT');
    expect(res.body.status).toBe('PENDING_PAYMENT');
  });

  it('retourne 500 si Prisma échoue', async () => {
    prisma.professional.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/subscriptions/me')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /api/subscriptions/validate-promo ============

describe('POST /api/subscriptions/validate-promo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamicPrices();
  });

  it('retourne 401 sans token', async () => {
    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .send({ code: 'PROMO10', tier: 'PRO' });
    expect(res.status).toBe(401);
  });

  it('retourne 403 si CLIENT', async () => {
    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ code: 'PROMO10', tier: 'PRO' });
    expect(res.status).toBe(403);
  });

  it('retourne 400 si code manquant', async () => {
    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'PRO' });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si code trop court (< 3 chars)', async () => {
    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'AB', tier: 'PRO' });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si tier invalide', async () => {
    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'PROMO10', tier: 'INVALID_TIER' });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si code promo introuvable en base', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'INEXISTANT', tier: 'PRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Code promo invalide/i);
  });

  it('retourne 400 si code promo désactivé', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'DESAC10',
      active: false,
      validFrom: new Date(Date.now() - 1000),
      validUntil: null,
      maxUses: null,
      usedCount: 0,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 10,
    });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'DESAC10', tier: 'PRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/désactivé/i);
  });

  it('retourne 400 si code promo expiré', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'EXPIRE10',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: new Date(Date.now() - 1000),
      maxUses: null,
      usedCount: 0,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 10,
    });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'EXPIRE10', tier: 'PRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expiré/i);
  });

  it('retourne 400 si code pas encore actif', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'FUTUR10',
      active: true,
      validFrom: new Date(Date.now() + 100000),
      validUntil: null,
      maxUses: null,
      usedCount: 0,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 10,
    });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'FUTUR10', tier: 'PRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pas encore actif/i);
  });

  it('retourne 400 si code épuisé (maxUses atteint)', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'EPUISE',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: null,
      maxUses: 10,
      usedCount: 10,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 10,
    });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'EPUISE', tier: 'PRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/épuisé/i);
  });

  it('retourne 400 si code non applicable au tier', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'ESSENTIEL10',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: null,
      maxUses: null,
      usedCount: 0,
      applicableTiers: ['ESSENTIEL'],
      discountType: 'PERCENT',
      discountValue: 10,
    });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'ESSENTIEL10', tier: 'PRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non applicable/i);
  });

  it('retourne 400 si déjà utilisé par ce professionnel', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'DEJAUTILISE',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: null,
      maxUses: null,
      usedCount: 1,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 10,
    });
    prisma.promoUsage.findUnique.mockResolvedValue({ id: 'usage-1' });

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'DEJAUTILISE', tier: 'PRO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà utilisé/i);
  });

  it('retourne 200 avec réduction PERCENT valide', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'PROMO10',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: null,
      maxUses: null,
      usedCount: 0,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 10,
      description: '-10% sur tout',
    });
    prisma.promoUsage.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'PROMO10', tier: 'PRO' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.originalAmount).toBe(5000);
    expect(res.body.discountAmount).toBe(500);
    expect(res.body.finalAmount).toBe(4500);
    expect(res.body.discountType).toBe('PERCENT');
  });

  it('retourne 200 avec réduction FIXED valide', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-2',
      code: 'FLAT500',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: null,
      maxUses: null,
      usedCount: 0,
      applicableTiers: [],
      discountType: 'FIXED',
      discountValue: 500,
      description: '-500 FCFA',
    });
    prisma.promoUsage.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'FLAT500', tier: 'PRO' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.discountAmount).toBe(500);
    expect(res.body.finalAmount).toBe(4500);
  });

  it('utilise ESSENTIEL comme tier par défaut si non fourni', async () => {
    prisma.professional.findUnique.mockResolvedValue({ id: MOCK_PRO_ID });
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-3',
      code: 'DEFAULT20',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: null,
      maxUses: null,
      usedCount: 0,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 20,
      description: '-20%',
    });
    prisma.promoUsage.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/subscriptions/validate-promo')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ code: 'DEFAULT20' });

    expect(res.status).toBe(200);
    expect(res.body.originalAmount).toBe(2500);
    expect(res.body.finalAmount).toBe(2000);
  });
});

// ============ POST /api/subscriptions/checkout ============

describe('POST /api/subscriptions/checkout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamicPrices();
  });

  it('retourne 401 sans token', async () => {
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .send({ tier: 'PRO' });
    expect(res.status).toBe(401);
  });

  it('retourne 403 si CLIENT', async () => {
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ tier: 'PRO' });
    expect(res.status).toBe(403);
  });

  it('retourne 400 si tier manquant', async () => {
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('retourne 400 si tier invalide', async () => {
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'TITANIUM' });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si tier = GRATUIT', async () => {
    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'GRATUIT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tier invalide/i);
  });

  it('crée un paiement GeniusPay et retourne paymentUrl', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    geniuspay.createPayment.mockResolvedValue({
      reference: 'GP-REF-001',
      checkout_url: 'https://pay.example.com/GP-REF-001',
    });
    prisma.subscription.upsert.mockResolvedValue({});

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(200);
    expect(res.body.paymentUrl).toBe('https://pay.example.com/GP-REF-001');
    expect(res.body.reference).toBe('GP-REF-001');
    expect(res.body.tier).toBe('PRO');
    expect(res.body.finalAmount).toBe(5000);
    expect(geniuspay.createPayment).toHaveBeenCalledTimes(1);
  });

  it('utilise checkoutUrl si checkout_url est absent', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    geniuspay.createPayment.mockResolvedValue({
      reference: 'GP-REF-002',
      checkoutUrl: 'https://pay.example.com/checkout/002',
    });
    prisma.subscription.upsert.mockResolvedValue({});

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'ESSENTIEL' });

    expect(res.status).toBe(200);
    expect(res.body.paymentUrl).toBe('https://pay.example.com/checkout/002');
  });

  it('utilise payment_url comme fallback', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    geniuspay.createPayment.mockResolvedValue({
      reference: 'GP-REF-003',
      payment_url: 'https://pay.example.com/pay/003',
    });
    prisma.subscription.upsert.mockResolvedValue({});

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'ELITE' });

    expect(res.status).toBe(200);
    expect(res.body.paymentUrl).toBe('https://pay.example.com/pay/003');
  });

  it('active directement si finalAmount = 0 (promo 100%)', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-free',
      code: 'FREE100',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: null,
      maxUses: null,
      usedCount: 0,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 100,
    });
    prisma.promoUsage.findUnique.mockResolvedValue(null);
    prisma.subscription.upsert.mockResolvedValue({});
    prisma.$transaction.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'PRO', promoCode: 'FREE100' });

    expect(res.status).toBe(200);
    expect(res.body.activated).toBe(true);
    expect(res.body.finalAmount).toBe(0);
    expect(res.body.tier).toBe('PRO');
    expect(geniuspay.createPayment).not.toHaveBeenCalled();
  });

  it('retourne 400 si promoCode invalide au checkout', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    prisma.promoCode.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'PRO', promoCode: 'FAUX' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Code promo invalide/i);
  });

  it('retourne 503 si GeniusPay répond 401', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    const err = new Error('Unauthorized');
    err.response = { status: 401, data: { error: { code: 'INVALID_API_KEY' } } };
    geniuspay.createPayment.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Service de paiement/i);
  });

  it('retourne 502 si GeniusPay a un message d\'erreur', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    const err = new Error('Bad Gateway');
    err.response = { status: 400, data: { error: { message: 'Montant insuffisant' } } };
    geniuspay.createPayment.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Montant insuffisant');
  });

  it('retourne 500 si erreur inattendue', async () => {
    prisma.professional.findUnique.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'PRO' });

    expect(res.status).toBe(500);
  });

  it('stocke la promo en attente dans appConfig si finalAmount > 0', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-part',
      code: 'HALF50',
      active: true,
      validFrom: new Date(Date.now() - 10000),
      validUntil: null,
      maxUses: null,
      usedCount: 0,
      applicableTiers: [],
      discountType: 'PERCENT',
      discountValue: 50,
    });
    prisma.promoUsage.findUnique.mockResolvedValue(null);
    geniuspay.createPayment.mockResolvedValue({
      reference: 'GP-PROMO-005',
      checkout_url: 'https://pay.example.com/promo',
    });
    prisma.subscription.upsert.mockResolvedValue({});
    prisma.appConfig.upsert.mockResolvedValue({});

    const res = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ tier: 'PRO', promoCode: 'HALF50' });

    expect(res.status).toBe(200);
    expect(res.body.finalAmount).toBe(2500);
    expect(res.body.discount).toBe(2500);
    expect(prisma.appConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: `pending_promo_test_code_001` },
      })
    );
  });
});

// ============ GET /api/subscriptions/success ============

describe('GET /api/subscriptions/success', () => {
  it('retourne une page HTML avec deep link success', async () => {
    const res = await request(app)
      .get('/api/subscriptions/success')
      .query({ proId: 'pro-1', tier: 'PRO', ikey: 'abc123' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Abonnement activé');
    expect(res.text).toContain('manawa://subscription/success');
    expect(res.text).toContain('PRO');
  });

  it('fonctionne sans paramètres', async () => {
    const res = await request(app).get('/api/subscriptions/success');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Abonnement activé');
  });

  it('échappe les & dans le deep link', async () => {
    const res = await request(app)
      .get('/api/subscriptions/success')
      .query({ tier: 'ELITE' });

    expect(res.status).toBe(200);
    // L'attribut href doit avoir des & encodés
    expect(res.text).not.toContain('href="manawa://subscription/success?tier=ELITE&');
  });
});

// ============ GET /api/subscriptions/error ============

describe('GET /api/subscriptions/error', () => {
  it('retourne une page HTML avec deep link error', async () => {
    const res = await request(app)
      .get('/api/subscriptions/error')
      .query({ proId: 'pro-1', tier: 'PRO' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Paiement échoué');
    expect(res.text).toContain('manawa://subscription/error');
    expect(res.text).toContain('PRO');
  });

  it('fonctionne sans paramètres', async () => {
    const res = await request(app).get('/api/subscriptions/error');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Paiement échoué');
  });

  it('échappe les & dans le deep link error', async () => {
    const res = await request(app)
      .get('/api/subscriptions/error')
      .query({ tier: 'ESSENTIEL' });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('href="manawa://subscription/error?tier=ESSENTIEL&');
  });
});

// ============ EXPORTS vérification ============

describe('Exports du module subscriptions', () => {
  it('exporte TIERS avec 4 niveaux', () => {
    expect(Object.keys(TIERS)).toEqual(['GRATUIT', 'ESSENTIEL', 'PRO', 'ELITE']);
  });

  it('TIERS.PRO a searchPriority = true', () => {
    expect(TIERS.PRO.searchPriority).toBe(true);
  });

  it('TIERS.ELITE a earlyNotifications = true', () => {
    expect(TIERS.ELITE.earlyNotifications).toBe(true);
    expect(TIERS.ELITE.featuredOnHome).toBe(true);
  });

  it('TIERS.GRATUIT a price = 0', () => {
    expect(TIERS.GRATUIT.price).toBe(0);
  });
});
