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
  subscriptionPaymentAttempt: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
  subscription: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  payment: {
    findFirst: jest.fn(),
    update:    jest.fn(),
  },
  booking: {
    findUnique: jest.fn(),
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
const logger           = require('../../utils/logger');
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
    event: eventType,
    timestamp: Math.floor(Date.now() / 1000),
    data: { reference: 'gp-ref-123', ...data },
    environment: 'sandbox',
  };
}

function validHeaders() {
  return {
    'x-webhook-signature': VALID_SIG,
    'x-webhook-timestamp': TIMESTAMP,
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
      .send(buildPayload('payment.success'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing signature or timestamp/i);
  });

  test('400 — signature absente, timestamp présent', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set('x-webhook-timestamp', TIMESTAMP)
      .send(buildPayload('payment.success'));

    expect(res.status).toBe(400);
  });

  test('400 — timestamp absent, signature présente', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set('x-webhook-signature', VALID_SIG)
      .send(buildPayload('payment.success'));

    expect(res.status).toBe(400);
  });

  test('401 — signature invalide', async () => {
    geniuspay.verifyWebhookSignature.mockReturnValue(false);

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success'));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid signature/i);
  });

  test('401 — timestamp trop ancien (replay attack)', async () => {
    geniuspay.verifyWebhookTimestamp.mockReturnValue(false);

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success'));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/timestamp too old/i);
  });

  test('400 — X-Webhook-Event en contradiction avec event du payload', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .set('x-webhook-event', 'payment.failed') // Header says failed
      .send(buildPayload('payment.success')); // But payload says success

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Event type mismatch/i);
  });

  test('200 — X-Webhook-Event cohérent avec event du payload (validation réussie)', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .set('x-webhook-event', 'payment.success') // Header matches payload
      .send(buildPayload('payment.success'));

    expect(res.status).toBe(200);
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
      .send(buildPayload('payment.success', { amount: 5000 }));

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
      .send(buildPayload('payment.success', { amount: 5000 }));

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
      .send(buildPayload('payment.success', { amount: 5000 }));

    expect(res.status).toBe(200);
    // Aucune mise à jour ne doit être effectuée
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  test('200 — montant inférieur de 1 XOF → statut failed (validation stricte)', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 4999 }));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-1' },
        data:  expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — montant supérieur de 1 XOF → statut failed (validation stricte)', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 5001 }));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-1' },
        data:  expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — payment.completed non officiel est ignoré (pas de mise à jour)', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.completed', { amount: 5000 }));

    // payment.completed n'est pas un événement officiel GeniusPay
    // Le webhook est reçu (200) mais non traité
    expect(res.status).toBe(200);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  test('200 — montant absent → statut failed', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', {})); // pas d'amount

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — montant non numérique → statut failed', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 'invalid' }));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — montant zéro → statut failed', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 0 }));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  test('200 — montant négatif → statut failed', async () => {
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: -5000 }));

    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
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
      .send(buildPayload('payment.success', { reference: 'unknown-ref' }));

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
      .send(buildPayload('payment.success', { amount: 5000 }));

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
      .send(buildPayload('payment.success', { amount: 5000 }));

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
      .send(buildPayload('payment.success', { amount: 5000 }));

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
      .send(buildPayload('payment.success', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T2.03 — Webhook booking confirmation
// ═══════════════════════════════════════════════════════════════════════════════
describe('T2.03 — Webhook booking confirmation', () => {
  test('payment.success confirme le booking associé au quote', async () => {
    // Arrange
    const mockBooking = {
      id: 'booking-t2-03',
      status: 'PENDING',
    };

    prisma.payment.findFirst.mockResolvedValue({
      ...mockPayment,
      quoteId: 'quote-123',
    });

    prisma.booking.findUnique.mockResolvedValue(mockBooking);
    prisma.booking.update.mockResolvedValue({
      ...mockBooking,
      status: 'CONFIRMED',
      confirmedAt: new Date('2026-11-27T10:00:00Z'),
    });

    // Act
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 5000 }));

    // Assert
    expect(res.status).toBe(200);
    expect(prisma.booking.findUnique).toHaveBeenCalledWith({
      where: { quoteId: 'quote-123' },
      select: { id: true, status: true },
    });
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-t2-03' },
      data: {
        status: 'CONFIRMED',
        confirmedAt: expect.any(Date),
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      '[Webhook GeniusPay] Confirming booking after successful payment',
      expect.objectContaining({
        paymentId: 'payment-1',
        quoteId: 'quote-123',
        bookingId: 'booking-t2-03',
        fromStatus: 'PENDING',
      })
    );
  });

  test('T2.03 idempotence: booking déjà CONFIRMED ne se reconfirme pas', async () => {
    // Arrange
    prisma.payment.findFirst.mockResolvedValue({
      ...mockPayment,
      quoteId: 'quote-456',
    });

    prisma.booking.findUnique.mockResolvedValue({
      id: 'booking-confirmed',
      status: 'CONFIRMED',
    });

    // Act
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 5000 }));

    // Assert
    expect(res.status).toBe(200);
    expect(prisma.booking.findUnique).toHaveBeenCalled();
    expect(prisma.booking.update).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[Webhook GeniusPay] Booking already in terminal state, skipping confirmation',
      expect.objectContaining({
        bookingId: 'booking-confirmed',
        currentStatus: 'CONFIRMED',
      })
    );
  });

  test('T2.03 error resilience: erreur booking ne bloque pas paiement', async () => {
    // Arrange
    prisma.payment.findFirst.mockResolvedValue({
      ...mockPayment,
      quoteId: 'quote-789',
    });

    prisma.payment.update.mockResolvedValue({ id: 'payment-1', status: 'succeeded' });
    prisma.booking.findUnique.mockRejectedValue(new Error('DB connection failed'));

    // Act
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 5000 }));

    // Assert
    expect(res.status).toBe(200);
    expect(prisma.payment.update).toHaveBeenCalled();
    expect(prisma.booking.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[Webhook GeniusPay] Failed to confirm booking after payment',
      expect.objectContaining({
        paymentId: 'payment-1',
        quoteId: 'quote-789',
      })
    );
  });

  test('T2.03 sans quoteId: ne tente pas de confirmer booking', async () => {
    // Arrange
    prisma.payment.findFirst.mockResolvedValue({
      ...mockPayment,
      quoteId: null, // Pas de quote → pas de booking
    });

    // Act
    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 5000 }));

    // Assert
    expect(res.status).toBe(200);
    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
    expect(prisma.booking.update).not.toHaveBeenCalled();
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
      .send(buildPayload('payment.success', { amount: 5000 }));

    // La route catch-all renvoie 200 pour éviter les retries GeniusPay
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test('200 — retourne received:true même si prisma.payment.findFirst plante', async () => {
    prisma.payment.findFirst.mockRejectedValue(new Error('DB unavailable'));

    const res = await request(app)
      .post('/webhooks/geniuspay')
      .set(validHeaders())
      .send(buildPayload('payment.success', { amount: 5000 }));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
