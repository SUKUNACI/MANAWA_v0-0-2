/**
 * Tests du guard d'environnement webhook GeniusPay (D1/D3).
 *
 * Couvre :
 *   - Payload live + header live → accepté
 *   - Payload sandbox + header sandbox → accepté
 *   - Payload live + header sandbox → rejet 400 (contradiction D1)
 *   - Payload sandbox + header live → rejet 400 (contradiction D1)
 *   - Payload seul (sans header)
 *   - Header seul (sans payload.environment)
 *   - Aucun environnement fourni → permissif + warn en production (D3)
 */

const request = require('supertest');
const express = require('express');

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../../../config/db', () => ({
  subscriptionPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(null) },
  subscription:               { findFirst:  jest.fn().mockResolvedValue(null) },
  payment:                    { findFirst:  jest.fn().mockResolvedValue(null) },
  notification:               { create:     jest.fn().mockResolvedValue({}) },
}));

jest.mock('../../../utils/geniuspay', () => ({
  verifyWebhookSignature: jest.fn().mockReturnValue(true),
  verifyWebhookTimestamp: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../utils/paymentAudit', () => ({
  logPaymentStatus: jest.fn().mockResolvedValue({}),
}));

const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('../../../utils/logger', () => mockLogger);

jest.mock('../../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));
jest.mock('../../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt']),
}));
jest.mock('../../../utils/subscriptionMailer', () => ({
  sendSubscriptionActivated: jest.fn().mockResolvedValue({}),
  sendPaymentFailed:         jest.fn().mockResolvedValue({}),
  sendPaymentCancelled:      jest.fn().mockResolvedValue({}),
  sendPaymentExpired:        jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../utils/subscriptionBilling', () => ({
  computeExpiresAt:    jest.fn().mockReturnValue(new Date()),
  isPeriodAlreadyPaid: jest.fn().mockResolvedValue(false),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const TIMESTAMP = String(Math.floor(Date.now() / 1000));
const ORIG_NODE_ENV = process.env.NODE_ENV;

function buildApp() {
  const webhookRoutes = require('../../../routes/webhooks-geniuspay');
  const app = express();
  app.use(express.json());
  app.use('/webhooks/geniuspay', webhookRoutes);
  return app;
}

function baseHeaders(extra = {}) {
  return {
    'x-webhook-signature': 'valid-sig',
    'x-webhook-timestamp': TIMESTAMP,
    ...extra,
  };
}

function body(envValue) {
  const b = { event: { type: 'payment.succeeded' }, data: { reference: 'ref-1' } };
  if (envValue !== undefined) b.environment = envValue;
  return b;
}

beforeEach(() => {
  jest.clearAllMocks();
  const gp = require('../../../utils/geniuspay');
  gp.verifyWebhookSignature.mockReturnValue(true);
  gp.verifyWebhookTimestamp.mockReturnValue(true);
});

afterAll(() => {
  process.env.NODE_ENV = ORIG_NODE_ENV;
});

// ══════════════════════════════════════════════════════════════════════════════
// Guard environnement — production (attendu : "live")
// ══════════════════════════════════════════════════════════════════════════════

describe('Guard environnement webhook — production (expected: live)', () => {
  beforeAll(() => { process.env.NODE_ENV = 'production'; });
  afterAll(() => { process.env.NODE_ENV = ORIG_NODE_ENV; });

  test('200 — payload.environment=live + X-Webhook-Environment=live → accepté', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders({ 'x-webhook-environment': 'live' }))
      .send(body('live'));
    expect(res.status).toBe(200);
  });

  test('400 — payload.environment=live + header=sandbox → contradiction rejetée (D1)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders({ 'x-webhook-environment': 'sandbox' }))
      .send(body('live'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contradiction/i);
    expect(res.body.bodyEnv).toBe('live');
    expect(res.body.headerEnv).toBe('sandbox');
  });

  test('400 — payload.environment=sandbox + header=live → contradiction rejetée (D1)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders({ 'x-webhook-environment': 'live' }))
      .send(body('sandbox'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contradiction/i);
    expect(res.body.bodyEnv).toBe('sandbox');
    expect(res.body.headerEnv).toBe('live');
  });

  test('400 — payload.environment=sandbox seul → mismatch en production', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders())
      .send(body('sandbox'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mismatch/i);
    expect(res.body.received).toBe('sandbox');
    expect(res.body.expected).toBe('live');
  });

  test('400 — header=sandbox seul → mismatch en production', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders({ 'x-webhook-environment': 'sandbox' }))
      .send(body());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mismatch/i);
    expect(res.body.received).toBe('sandbox');
  });

  test('200 — payload.environment=live seul (pas de header) → accepté', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders())
      .send(body('live'));
    expect(res.status).toBe(200);
  });

  test('200 — header=live seul (pas de payload.environment) → accepté', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders({ 'x-webhook-environment': 'live' }))
      .send(body());
    expect(res.status).toBe(200);
  });

  test('200 + warn — aucun environnement fourni en production → permissif avec logger.warn (D3)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders())
      .send(body());
    expect(res.status).toBe(200);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/environment absent/i),
      expect.objectContaining({ nodeEnv: 'production' }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Guard environnement — development (attendu : "sandbox")
// ══════════════════════════════════════════════════════════════════════════════

describe('Guard environnement webhook — development (expected: sandbox)', () => {
  beforeAll(() => { process.env.NODE_ENV = 'development'; });
  afterAll(() => { process.env.NODE_ENV = ORIG_NODE_ENV; });

  test('200 — payload.environment=sandbox + header=sandbox → accepté', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders({ 'x-webhook-environment': 'sandbox' }))
      .send(body('sandbox'));
    expect(res.status).toBe(200);
  });

  test('400 — payload.environment=sandbox + header=live → contradiction rejetée (D1)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders({ 'x-webhook-environment': 'live' }))
      .send(body('sandbox'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contradiction/i);
  });

  test('400 — payload.environment=live + header=sandbox → contradiction rejetée (D1)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders({ 'x-webhook-environment': 'sandbox' }))
      .send(body('live'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contradiction/i);
  });

  test('200 — aucun environnement fourni en development → permissif sans warn', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(baseHeaders())
      .send(body());
    expect(res.status).toBe(200);
    const warnAbsentCalls = mockLogger.warn.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('environment absent')
    );
    expect(warnAbsentCalls).toHaveLength(0);
  });
});
