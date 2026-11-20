'use strict';

/**
 * Tests permanents — Essai gratuit 14j & Vérification d'identité
 * Phase 2 — Sujet Redmi V1.0
 *
 * Coverage:
 *   - Essai : durée exacte (14j), date de début enregistrée, retour à GRATUIT,
 *             conservation des données après expiration, blocage second essai.
 *   - Identité : soumission, unicité, blocage/autorisation devis par statut.
 *   - Sécurité : numéro absent des réponses API et des logs.
 *   - Crypto : HMAC et AES-GCM fonctionnels.
 */

// ─── Env setup for crypto tests ────────────────────────────────────────────────
// 64 hex chars = 32 bytes each
process.env.IDENTITY_HMAC_SECRET = 'a'.repeat(64);
process.env.IDENTITY_AES_KEY     = 'b'.repeat(64);

const express = require('express');
const request = require('supertest');
const { proToken, clientToken } = require('./helpers');

// ─── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../config/db', () => ({
  user: {
    // requireAuth calls user.findUnique to validate the JWT payload
    findUnique: jest.fn().mockImplementation(({ where }) => {
      if (where?.id === 'pro-user-1') {
        return Promise.resolve({ id: 'pro-user-1', role: 'PROFESSIONAL', email: 'pro@test.com', suspended: false, deletedAt: null, adminLevel: null, adminPermissions: null, adminRoleTypeId: null, adminRoleType: null });
      }
      if (where?.id === 'client-1') {
        return Promise.resolve({ id: 'client-1', role: 'CLIENT', email: 'client@test.com', suspended: false, deletedAt: null, adminLevel: null, adminPermissions: null, adminRoleTypeId: null, adminRoleType: null });
      }
      return Promise.resolve(null);
    }),
  },
  professional: {
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    update:     jest.fn(),
  },
  subscription: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  subscriptionPaymentAttempt: {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
      id: 'mock-attempt-id', geniuspayRef: null, status: data.status || 'CREATED', ...data,
    })),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  payment:    { findFirst: jest.fn().mockResolvedValue(null) },
  promoCode:  { findUnique: jest.fn() },
  promoUsage: { findUnique: jest.fn() },
  appConfig:  { upsert: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(ops => Promise.all(ops)),
}));

jest.mock('../utils/appConfig', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
  setConfig:  jest.fn().mockResolvedValue({}),
}));

jest.mock('../utils/geniuspay', () => ({
  createPayment: jest.fn().mockResolvedValue({
    reference:    'gp-ref-test',
    checkout_url: 'https://pay.geniuspay.test/checkout/gp-ref-test',
  }),
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const prisma           = require('../config/db');
const quoteRoutes      = require('../routes/quotes');
const professionalRoutes = require('../routes/professionals');

// ─── App fixture ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/quotes', quoteRoutes);
  app.use('/api/professionals', professionalRoutes);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

function mockProWith(overrides = {}) {
  return {
    id: 'pro-id-1',
    userId: 'pro-user-1',
    verifiedByAdmin: true,
    identityStatus: 'APPROVED',
    trialEndsAt: null,
    trialStartedAt: null,
    idDocumentHash: null,
    subscription: null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. CRYPTO MODULE
// ════════════════════════════════════════════════════════════════════════════════

describe('identityCrypto', () => {
  const { hashDocumentNumber, encryptDocumentNumber, decryptDocumentNumber } = require('../utils/identityCrypto');

  describe('hashDocumentNumber', () => {
    it('produces a consistent hex string', () => {
      const hash = hashDocumentNumber('AB123456');
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic — same input produces same hash', () => {
      expect(hashDocumentNumber('AB123456')).toBe(hashDocumentNumber('AB123456'));
    });

    it('normalises to uppercase before hashing', () => {
      expect(hashDocumentNumber('ab123456')).toBe(hashDocumentNumber('AB123456'));
    });

    it('different inputs produce different hashes', () => {
      expect(hashDocumentNumber('AB123456')).not.toBe(hashDocumentNumber('AB123457'));
    });

    it('throws on empty input', () => {
      expect(() => hashDocumentNumber('')).toThrow();
    });
  });

  describe('encryptDocumentNumber / decryptDocumentNumber', () => {
    it('round-trips successfully', () => {
      const enc = encryptDocumentNumber('AB123456');
      const dec = decryptDocumentNumber(enc);
      expect(dec).toBe('AB123456');
    });

    it('produces different ciphertexts for the same input (random IV)', () => {
      const enc1 = encryptDocumentNumber('AB123456');
      const enc2 = encryptDocumentNumber('AB123456');
      expect(enc1).not.toBe(enc2);
    });

    it('throws on tampered ciphertext', () => {
      const enc = encryptDocumentNumber('AB123456');
      const buf = Buffer.from(enc, 'base64');
      buf[buf.length - 1] ^= 0xff;
      expect(() => decryptDocumentNumber(buf.toString('base64'))).toThrow();
    });

    it('throws on empty input', () => {
      expect(() => encryptDocumentNumber('')).toThrow();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. ESSAI GRATUIT — durée et champs
// ════════════════════════════════════════════════════════════════════════════════

describe('AdminModule.verifyProfessional — trial activation', () => {
  const AdminModule = require('../modules/admin');

  it('sets trialEndsAt exactly 14 days from trialStartedAt', async () => {
    const mockPrisma = {
      professional: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', trialEndsAt: null }),
        update: jest.fn().mockImplementation((args) => Promise.resolve(args.data)),
      },
    };
    const admin = new AdminModule(mockPrisma);
    const result = await admin.verifyProfessional('p1');

    const msIn14Days = 14 * 24 * 60 * 60 * 1000;
    const diff = result.trialEndsAt - result.trialStartedAt;
    expect(diff).toBeGreaterThanOrEqual(msIn14Days - 2000);
    expect(diff).toBeLessThanOrEqual(msIn14Days + 2000);
  });

  it('records trialStartedAt at activation time', async () => {
    const before = new Date();
    const mockPrisma = {
      professional: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', trialEndsAt: null }),
        update: jest.fn().mockImplementation((args) => Promise.resolve(args.data)),
      },
    };
    const admin = new AdminModule(mockPrisma);
    const result = await admin.verifyProfessional('p1');
    const after = new Date();

    expect(result.trialStartedAt).toBeInstanceOf(Date);
    expect(result.trialStartedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.trialStartedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('does NOT overwrite an existing trial', async () => {
    const existingTrialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const mockPrisma = {
      professional: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', trialEndsAt: existingTrialEnd }),
        update: jest.fn().mockImplementation((args) => Promise.resolve(args.data)),
      },
    };
    const admin = new AdminModule(mockPrisma);
    const result = await admin.verifyProfessional('p1');
    // No trial fields should be in the update payload
    expect(result.trialEndsAt).toBeUndefined();
    expect(result.trialStartedAt).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. getActiveTier — expiration de l'essai
// ════════════════════════════════════════════════════════════════════════════════

describe('getActiveTier — trial expiry and data preservation', () => {
  const { getActiveTier } = require('../routes/subscriptions');

  it('returns PRO during an active trial', () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    expect(getActiveTier(null, { trialEndsAt: future })).toBe('PRO');
  });

  it('returns GRATUIT after trial has expired', () => {
    const past = new Date(Date.now() - 1000);
    expect(getActiveTier(null, { trialEndsAt: past })).toBe('GRATUIT');
  });

  it('returns GRATUIT when no trial and no subscription', () => {
    expect(getActiveTier(null, { trialEndsAt: null })).toBe('GRATUIT');
  });

  it('returns paid tier when subscription ACTIVE after trial expires', () => {
    const past   = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const sub    = { status: 'ACTIVE', tier: 'ESSENTIEL', expiresAt: future };
    expect(getActiveTier(sub, { trialEndsAt: past })).toBe('ESSENTIEL');
  });

  it('does not mutate the pro object (trialEndsAt preserved)', () => {
    const past = new Date(Date.now() - 86400000);
    const pro = { trialEndsAt: new Date(past) };
    getActiveTier(null, pro);
    expect(pro.trialEndsAt.getTime()).toBe(past.getTime());
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. POST /api/professionals/me/identity
// ════════════════════════════════════════════════════════════════════════════════

describe('POST /api/professionals/me/identity', () => {
  let app;
  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  it('accepts a valid document number and returns PENDING status', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProWith({ idDocumentHash: null }));
    prisma.professional.findFirst.mockResolvedValue(null);
    prisma.professional.update.mockResolvedValue({});

    const res = await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: 'AB123456', documentType: 'CNI' });

    expect(res.status).toBe(200);
    expect(res.body.identityStatus).toBe('PENDING');
  });

  it('rejects a document number already used by another professional (409)', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProWith({ id: 'pro-id-1', idDocumentHash: null }));
    prisma.professional.findFirst.mockResolvedValue({ id: 'pro-id-OTHER' });

    const res = await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: 'AB123456', documentType: 'CNI' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DOCUMENT_ALREADY_USED');
  });

  it('allows re-submission of the same number by the same professional', async () => {
    const { hashDocumentNumber } = require('../utils/identityCrypto');
    const hash = hashDocumentNumber('AB123456');

    prisma.professional.findUnique.mockResolvedValue(mockProWith({ id: 'pro-id-1', idDocumentHash: hash }));
    prisma.professional.update.mockResolvedValue({});

    const res = await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: 'AB123456', documentType: 'CNI' });

    expect(res.status).toBe(200);
    expect(prisma.professional.findFirst).not.toHaveBeenCalled();
  });

  it('rejects empty document number (400)', async () => {
    const res = await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: '' });

    expect(res.status).toBe(400);
  });

  it('never returns the raw document number in the response body', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProWith({ idDocumentHash: null }));
    prisma.professional.findFirst.mockResolvedValue(null);
    prisma.professional.update.mockResolvedValue({});

    const SECRET = 'SUPERSECRETDOCNUMBER';
    const res = await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: SECRET });

    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('never writes the raw document number to prisma.update call', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProWith({ idDocumentHash: null }));
    prisma.professional.findFirst.mockResolvedValue(null);
    prisma.professional.update.mockResolvedValue({});

    const SECRET = 'SUPERSECRETDOCNUMBER';
    await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: SECRET });

    const updateArgs = JSON.stringify(prisma.professional.update.mock.calls);
    expect(updateArgs).not.toContain(SECRET);
  });

  it('rejects unauthenticated requests (401)', async () => {
    const res = await request(app)
      .post('/api/professionals/me/identity')
      .send({ documentNumber: 'AB123456' });

    expect(res.status).toBe(401);
  });

  it('handles P2002 concurrent race — returns 409 without exposing other account', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProWith({ idDocumentHash: null }));
    prisma.professional.findFirst.mockResolvedValue(null); // passed the app-level check
    const p2002 = new Error('Unique constraint failed on the fields: (`idDocumentHash`)');
    p2002.code = 'P2002';
    prisma.professional.update.mockRejectedValue(p2002);

    const res = await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: 'AB123456' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DOCUMENT_ALREADY_USED');
    // Must not reveal which account owns the document
    expect(JSON.stringify(res.body)).not.toMatch(/pro-id|userId|user/i);
  });

  it('stores documentType when provided', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProWith({ idDocumentHash: null }));
    prisma.professional.findFirst.mockResolvedValue(null);
    prisma.professional.update.mockResolvedValue({});

    await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: 'AB123456', documentType: 'PASSEPORT' });

    const updateData = prisma.professional.update.mock.calls[0][0].data;
    expect(updateData.idDocumentType).toBe('PASSEPORT');
  });

  it('stores idDocumentType as null when documentType is omitted', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProWith({ idDocumentHash: null }));
    prisma.professional.findFirst.mockResolvedValue(null);
    prisma.professional.update.mockResolvedValue({});

    await request(app)
      .post('/api/professionals/me/identity')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ documentNumber: 'AB123456' });

    const updateData = prisma.professional.update.mock.calls[0][0].data;
    expect(updateData.idDocumentType).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. POST /api/quotes — blocage identité
// ════════════════════════════════════════════════════════════════════════════════

describe('POST /api/quotes — identity verification gate', () => {
  let app;
  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  ['NOT_SUBMITTED', 'PENDING', 'REJECTED'].forEach(identityStatus => {
    it(`blocks quote when identityStatus=${identityStatus}`, async () => {
      prisma.professional.findUnique.mockResolvedValue(
        mockProWith({ verifiedByAdmin: false, identityStatus })
      );
      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: 'proj-1', description: 'Test devis' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('IDENTITY_NOT_VERIFIED');
    });
  });

  it('does not apply identity block to CLIENT role', async () => {
    const QuoteModule = require('../modules/quote');
    jest.spyOn(QuoteModule.prototype, 'respond').mockRejectedValue(
      Object.assign(new Error('Quote not found'), { status: 404 })
    );
    const res = await request(app)
      .patch('/api/quotes/q-1')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });

    expect(res.status).not.toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6. POST /api/quotes/:id/revise — même blocage
// ════════════════════════════════════════════════════════════════════════════════

describe('POST /api/quotes/:id/revise — identity gate', () => {
  let app;
  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  it('blocks revision when identity is PENDING', async () => {
    prisma.professional.findUnique.mockResolvedValue(
      mockProWith({ verifiedByAdmin: false, identityStatus: 'PENDING' })
    );
    const res = await request(app)
      .post('/api/quotes/q-1/revise')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ description: 'Rev', amount: 2000 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('IDENTITY_NOT_VERIFIED');
  });

  it('blocks revision when identity is REJECTED', async () => {
    prisma.professional.findUnique.mockResolvedValue(
      mockProWith({ verifiedByAdmin: false, identityStatus: 'REJECTED' })
    );
    const res = await request(app)
      .post('/api/quotes/q-1/revise')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ description: 'Rev', amount: 2000 });

    expect(res.status).toBe(403);
  });

  it('blocks revision when identity is NOT_SUBMITTED', async () => {
    prisma.professional.findUnique.mockResolvedValue(
      mockProWith({ verifiedByAdmin: false, identityStatus: 'NOT_SUBMITTED' })
    );
    const res = await request(app)
      .post('/api/quotes/q-1/revise')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ description: 'Rev', amount: 2000 });

    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 7. SubscriptionModule.createCheckout — souscription pendant l'essai
// ════════════════════════════════════════════════════════════════════════════════

describe('SubscriptionModule.createCheckout — scheduledStartAt during trial', () => {
  const SubscriptionModule = require('../modules/subscription');

  it('sets scheduledStartAt to day after trialEndsAt when trial is active', async () => {
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const mockPrisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation((args) =>
          Promise.resolve({ id: 'sub-1', ...args.create })
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      subscriptionPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'mock-attempt-id', geniuspayRef: null, ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      promoCode:  { findUnique: jest.fn() },
      promoUsage: { findUnique: jest.fn() },
    };
    const sub = new SubscriptionModule(mockPrisma);
    const professional = {
      id: 'p-1', trialEndsAt,
      user: { email: 'e@t.com', firstName: 'F', lastName: 'L', phone: '' },
    };

    const result = await sub.createCheckout('PRO', null, professional);

    expect(result.scheduledStartAt).toBeDefined();
    const expected = new Date(trialEndsAt);
    expected.setDate(expected.getDate() + 1);
    expected.setHours(0, 0, 0, 0);
    expect(result.scheduledStartAt.toDateString()).toBe(expected.toDateString());
  });

  it('sets scheduledStartAt to null when no active trial', async () => {
    const mockPrisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation((args) =>
          Promise.resolve({ id: 'sub-1', ...args.create })
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      subscriptionPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'mock-attempt-id', geniuspayRef: null, ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      promoCode:  { findUnique: jest.fn() },
      promoUsage: { findUnique: jest.fn() },
    };
    const sub = new SubscriptionModule(mockPrisma);
    const professional = {
      id: 'p-1', trialEndsAt: null,
      user: { email: 'e@t.com', firstName: 'F', lastName: 'L', phone: '' },
    };
    const result = await sub.createCheckout('PRO', null, professional);
    expect(result.scheduledStartAt).toBeNull();
  });

  it('sets scheduledStartAt to null when trial has already expired', async () => {
    const mockPrisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation((args) =>
          Promise.resolve({ id: 'sub-1', ...args.create })
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      subscriptionPaymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'mock-attempt-id', geniuspayRef: null, ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      promoCode:  { findUnique: jest.fn() },
      promoUsage: { findUnique: jest.fn() },
    };
    const sub = new SubscriptionModule(mockPrisma);
    const professional = {
      id: 'p-1',
      trialEndsAt: new Date(Date.now() - 1000), // expired
      user: { email: 'e@t.com', firstName: 'F', lastName: 'L', phone: '' },
    };
    const result = await sub.createCheckout('PRO', null, professional);
    expect(result.scheduledStartAt).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 8. expireTrials cron job
// ════════════════════════════════════════════════════════════════════════════════

describe('expireTrials — cron job', () => {
  const { expireTrials } = require('../jobs/cron-jobs');
  const logger = require('../utils/logger');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves without error when no trials are expired', async () => {
    prisma.professional.findMany.mockResolvedValue([]);
    await expect(expireTrials()).resolves.toBeUndefined();
  });

  it('skips professionals with in-flight payment (scheduledStartAt in future)', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    prisma.professional.findMany.mockResolvedValue([
      {
        id: 'p1',
        trialEndsAt: new Date(Date.now() - 1000),
        subscription: { id: 'sub-1', status: 'PENDING_PAYMENT', scheduledStartAt: future },
      },
    ]);

    await expireTrials();

    const infoCall = logger.info.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('effective tier')
    );
    expect(infoCall).toBeUndefined();
  });

  it('logs expired professionals without calling prisma.professional.update', async () => {
    prisma.professional.findMany.mockResolvedValue([
      { id: 'p2', trialEndsAt: new Date(Date.now() - 1000), subscription: null },
    ]);

    await expireTrials();

    expect(prisma.professional.update).not.toHaveBeenCalled();
  });
});
