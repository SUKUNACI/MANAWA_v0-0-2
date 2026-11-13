/**
 * Tests unitaires — routes/webhooks-geniuspay.js
 *
 * Couvre :
 *   POST /  (vérification signature HMAC, timestamp anti-replay,
 *            événements payment.succeeded / payment.failed /
 *            payment.cancelled / payment.expired / inconnu,
 *            détection de mismatch de montant, notifications)
 */

const request = require('supertest');
const express = require('express');

// ── Mock Prisma ───────────────────────────────────────────────────────────────
jest.mock('../../config/db', () => ({
  payment: {
    findFirst: jest.fn(),
    update:    jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
}));

// ── Mock GeniusPay utils ──────────────────────────────────────────────────────
jest.mock('../../utils/geniuspay', () => ({
  verifyWebhookSignature: jest.fn(),
  verifyWebhookTimestamp: jest.fn(),
}));

// ── Mock paymentAudit ─────────────────────────────────────────────────────────
jest.mock('../../utils/paymentAudit', () => ({
  logPaymentStatus: jest.fn().mockResolvedValue({}),
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
jest.mock('../../utils/logger', () => ({
  info:  jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
}));

// ── Mock sorting helpers (importés dans la route) ─────────────────────────────
jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));
jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt']),
}));

const prisma           = require('../../config/db');
const geniuspay        = require('../../utils/geniuspay');
const { logPaymentStatus } = require('../../utils/paymentAudit');
const webhookRoutes    = require('../../routes/webhooks-geniuspay');

// ── Monter l'app ──────────────────────────────────────────────────────────────
const app = express();
// express.json() AVANT la route — le middleware interne saute rawBody si req n'est plus lisible
app.use(express.json());
app.use('/webhooks/geniuspay', webhookRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const TIMESTAMP = String(Math.floor(Date.now() / 1000));
const VALID_SIG = 'valid-hmac-signature';

const mockClient = {
  id:        'client-1',
  email:     'client@manawa.com',
  firstName: 'Jean',
  lastName:  'Dupont',
};

const mockPayment = {
  id:          'payment-1',
  quoteId:     'quote-1',
  geniuspayRef: 'gp-ref-123',
  amount:      5000,
  status:      'pending',
  quote: {
    project: {
      client: mockClient,
    },
    professional: { id: 'pro-1' },
  },
};

function buildPayload(eventType, data = {}) {
  return {
    event: { type: eventType },
    data:  { reference: 'gp-ref-123', ...data },
  };
}

function validHeaders() {
  return {
    'x-geniuspay-signature': VALID_SIG,
    'x-geniuspay-timestamp': TIMESTAMP,
  };
}

// ── Réinitialisation ──────────────────────────────────────────────────────────
beforeEach(() => {
  geniuspay.verifyWebhookSignature.mockReturnValue(true);
  geniuspay.verifyWebhookTimestamp.mockReturnValue(true);
  prisma.payment.findFirst.mockResolvedValue(mockPayment);
  prisma.payment.update.mockResolvedValue({ ...mockPayment, status: 'succeeded' });
  prisma.notification.create.mockResolvedValue({ id: 'notif-1' });
  logPaymentStatus.mockResolvedValue({});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Vérification de signature et timestamp
// ═══════════════════════════════════════════════════════════════════════════════
describe('Vérification signature et timestamp', () => {
  test('400 — headers signature + timestamp absents', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .send(buildPayload('payment.succeeded'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing signature or timestamp/i);
  });

  test('400 — signature absente, timestamp présent', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set('x-geniuspay-timestamp', TIMESTAMP)
      .send(buildPayload('payment.succeeded'));

    expect(res.status).toBe(400);
  });

  test('400 — timestamp absent, signature présente', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set('x-geniuspay-signature', VALID_SIG)
      .send(buildPayload('payment.succeeded'));

    expect(res.status).toBe(400);
  });

  test('401 — signature invalide', async () => {
    geniuspay.verifyWebhookSignature.mockReturnValue(false);

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded'));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid signature/i);
  });

  test('401 — timestamp trop ancien (replay attack)', async () => {
    geniuspay.verifyWebhookTimestamp.mockReturnValue(false);

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded'));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/timestamp too old/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Événement payment.succeeded
// ═══════════════════════════════════════════════════════════════════════════════
describe('Événement payment.succeeded', () => {
  test('200 — met le statut à succeeded avec montant correct', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.processed).toBe(true);

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-1' },
        data:  expect.objectContaining({ status: 'succeeded' }),
      })
    );
  });

  test('200 — logPaymentStatus appelé avec toStatus=succeeded', async () => {
    await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    expect(logPaymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'payment-1',
        toStatus:  'succeeded',
        reason:    'webhook',
      })
    );
  });

  test('200 — idempotent si statut déjà succeeded', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, status: 'succeeded' });

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    expect(res.status).toBe(200);
    // Aucune mise à jour ne doit être effectuée
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  test('200 — mismatch de montant → statut failed', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5010 })); // Écart > 1 XOF

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-1' },
        data:  expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — montant à ±1 XOF → succeeded (tolérance)', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5001 })); // Écart = 1 → OK

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'succeeded' }),
      })
    );
  });

  test('200 — alias payment.completed traité comme payment.succeeded', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.completed', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'succeeded' }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Événement payment.failed
// ═══════════════════════════════════════════════════════════════════════════════
describe('Événement payment.failed', () => {
  test('200 — met le statut à failed avec failure_reason', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.failed', { failure_reason: 'Card declined' }));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-1' },
        data:  expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — idempotent si statut déjà failed', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, status: 'failed' });

    await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.failed', { failure_reason: 'Card declined' }));

    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  test('200 — logPaymentStatus appelé avec toStatus=failed', async () => {
    await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.failed', { failure_reason: 'Insufficient funds' }));

    expect(logPaymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'failed' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Événement payment.cancelled
// ═══════════════════════════════════════════════════════════════════════════════
describe('Événement payment.cancelled', () => {
  test('200 — met le statut à failed avec cancellation_reason', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.cancelled', { cancellation_reason: 'User cancelled' }));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — idempotent si statut déjà failed', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, status: 'failed' });

    await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.cancelled'));

    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Événement payment.expired
// ═══════════════════════════════════════════════════════════════════════════════
describe('Événement payment.expired', () => {
  test('200 — met le statut à failed avec reason expired', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.expired'));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — idempotent si statut déjà failed', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, status: 'failed' });

    await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.expired'));

    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Paiement introuvable en base
// ═══════════════════════════════════════════════════════════════════════════════
describe('Paiement introuvable', () => {
  test('200 — retourne received:true même si référence inconnue', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { reference: 'unknown-ref' }));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Payload incomplet / inconnu
// ═══════════════════════════════════════════════════════════════════════════════
describe('Payload incomplet ou type inconnu', () => {
  test('200 — received:true si eventType absent', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send({ data: { reference: 'gp-ref-123' } }); // pas de event

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  test('200 — received:true si eventData absent', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send({ event: { type: 'payment.succeeded' } }); // pas de data

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  test('200 — type d\'événement inconnu ignoré proprement', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.refunded'));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Notifications
// ═══════════════════════════════════════════════════════════════════════════════
describe('Notifications client', () => {
  test('notification PAYMENT_RECEIVED créée après payment.succeeded', async () => {
    await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: mockClient.id,
          type:   'PAYMENT_RECEIVED',
        }),
      })
    );
  });

  test('notification PAYMENT_FAILED créée après payment.failed', async () => {
    await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.failed', { failure_reason: 'Decline' }));

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: mockClient.id,
          type:   'PAYMENT_FAILED',
        }),
      })
    );
  });

  test('200 — webhook ne crashe pas si notification.create lève une erreur', async () => {
    prisma.notification.create.mockRejectedValue(new Error('Notification service down'));

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test('pas de notification si client absent dans la relation quote', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      ...mockPayment,
      quote: { project: { client: null }, professional: null },
    });

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  test('pas de notification si quote absent du paiement', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      ...mockPayment,
      quote: null,
    });

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Résilience — erreur inattendue
// ═══════════════════════════════════════════════════════════════════════════════
describe('Résilience erreur interne', () => {
  test('200 — retourne received:true même si prisma.payment.update plante', async () => {
    prisma.payment.update.mockRejectedValue(new Error('DB crashed'));

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    // La route catch-all renvoie 200 pour éviter les retries GeniusPay
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test('200 — retourne received:true même si prisma.payment.findFirst plante', async () => {
    prisma.payment.findFirst.mockRejectedValue(new Error('DB unavailable'));

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.succeeded', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
