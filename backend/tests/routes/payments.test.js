/**
 * Tests unitaires — routes/payments.js
 * Couvre : POST /create, GET /:paymentId, GET /, GET /stats/overview
 */

const request = require('supertest');
const express = require('express');
const { clientToken, adminToken, proToken } = require('../helpers');

// IDs fixes pour les tests (UUIDs v4 valides : version nibble = 4, variant = [89ab])
const CLIENT_ID  = 'client-1';
const ADMIN_ID   = 'admin-1';
const PRO_ID     = 'pro-user-1';
const QUOTE_ID   = 'c4e3b2a1-1234-4abc-8def-000000000001';
const PAYMENT_ID = 'c4e3b2a1-1234-4abc-8def-000000000002';

// ── Mock Prisma ───────────────────────────────────────────────────────────────
jest.mock('../../config/db', () => ({
  quote: {
    findUnique: jest.fn(),
  },
  payment: {
    findUnique:  jest.fn(),
    findMany:    jest.fn(),
    create:      jest.fn(),
    update:      jest.fn(),
    count:       jest.fn(),
    aggregate:   jest.fn(),
    groupBy:     jest.fn(),
  },
}));

// ── Mock GeniusPay ────────────────────────────────────────────────────────────
jest.mock('../../utils/geniuspay', () => ({
  createPayment: jest.fn(),
  getPayment:    jest.fn(),
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

// ── Mock PaymentsModule ───────────────────────────────────────────────────────
jest.mock('../../modules/payments', () => {
  return jest.fn().mockImplementation(() => ({
    refundPayment: jest.fn().mockImplementation(async (paymentId, reason, metadata) => {
      return {
        id: paymentId,
        status: 'refunded',
        refundReason: reason,
        refundedAt: new Date(),
      };
    }),
  }));
});

// ── Mock sorting helpers ──────────────────────────────────────────────────────
jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt', 'status']),
}));

// ── Mock middleware/auth ──────────────────────────────────────────────────────
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
}));

const prisma           = require('../../config/db');
const { createPayment: gpCreate } = require('../../utils/geniuspay');
const { logPaymentStatus }        = require('../../utils/paymentAudit');
const paymentsRouter   = require('../../routes/payments');

const app = express();
app.use(express.json());
app.use('/api/payments', paymentsRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const mockClient = {
  id: CLIENT_ID,
  firstName: 'Jean',
  lastName: 'Dupont',
  email: 'jean@test.com',
  phone: '+225123456789',
};

const mockQuote = {
  id: QUOTE_ID,
  clientId: CLIENT_ID,
  projectId: 'project-1',
  amount: 100000,
  status: 'ACCEPTED',
  client: mockClient,
  professional: { id: 'pro-1', userId: PRO_ID },
};

const mockPayment = {
  id: PAYMENT_ID,
  quoteId: QUOTE_ID,
  amount: 50000,
  status: 'pending',
  isDeposit: true,
  idempotencyKey: 'key-abc',
  geniuspayRef: null,
  metadata: null,
  createdAt: new Date(),
  completedAt: null,
};

const mockPaymentWithQuote = {
  ...mockPayment,
  quote: { ...mockQuote, client: mockClient },
  auditLogs: [],
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. POST /create — validation d'entrée
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/payments/create — validation', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app)
      .post('/api/payments/create')
      .send({ quoteId: QUOTE_ID, amount: 500 });
    expect(res.status).toBe(401);
  });

  it('retourne 400 si quoteId absent', async () => {
    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ amount: 500 });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si quoteId n\'est pas un UUID valide', async () => {
    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: 'not-a-uuid', amount: 500 });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si amount absent', async () => {
    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si amount = 0 (non positif)', async () => {
    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 0 });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si amount est négatif', async () => {
    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: -100 });
    expect(res.status).toBe(400);
  });

  it('retourne 400 si isDeposit n\'est pas un booléen', async () => {
    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 500, isDeposit: 'oui' });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /create — logique métier
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/payments/create — logique métier', () => {
  it('retourne 404 si le devis n\'existe pas', async () => {
    prisma.quote.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/non trouvé/i);
  });

  it('retourne 403 si le client n\'est pas le propriétaire du devis', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      clientId: 'autre-client',
    });

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/non autorisé/i);
  });

  it('retourne 400 si un paiement pending existe déjà pour ce devis', async () => {
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.payment.findUnique.mockResolvedValue({
      ...mockPayment,
      status: 'pending',
    });

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000, isDeposit: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà en cours/i);
  });

  it('crée le paiement et l\'envoie à GeniusPay avec succès — 201', async () => {
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockResolvedValue(mockPayment);
    prisma.payment.update.mockResolvedValue({
      ...mockPayment,
      geniuspayRef: 'GP-REF-001',
    });
    gpCreate.mockResolvedValue({
      reference: 'GP-REF-001',
      payment_url: 'https://geniuspay.test/pay/GP-REF-001',
    });

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000, isDeposit: true });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('paymentId', PAYMENT_ID);
    expect(res.body.data).toHaveProperty('amount', 50000);
    expect(res.body.data).toHaveProperty('status', 'pending');
    expect(res.body.data).toHaveProperty('paymentUrl');
  });

  it('utilise checkout_url si payment_url absent dans la réponse GeniusPay', async () => {
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockResolvedValue(mockPayment);
    prisma.payment.update.mockResolvedValue(mockPayment);
    gpCreate.mockResolvedValue({
      id: 'gp-id-001',
      checkout_url: 'https://geniuspay.test/checkout/gp-id-001',
    });

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(res.status).toBe(201);
    expect(res.body.data.paymentUrl).toBe('https://geniuspay.test/checkout/gp-id-001');
  });

  it('log la création du paiement via logPaymentStatus', async () => {
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockResolvedValue(mockPayment);
    prisma.payment.update.mockResolvedValue(mockPayment);
    gpCreate.mockResolvedValue({
      reference: 'GP-REF-002',
      payment_url: 'https://geniuspay.test/pay/GP-REF-002',
    });

    await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(logPaymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: PAYMENT_ID,
        fromStatus: 'created',
        toStatus: 'pending',
        reason: 'payment_created',
      })
    );
  });

  it('passe si un paiement existant a un statut différent de "pending" (ex: failed)', async () => {
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.payment.findUnique.mockResolvedValue({
      ...mockPayment,
      status: 'failed',
    });
    prisma.payment.create.mockResolvedValue(mockPayment);
    prisma.payment.update.mockResolvedValue(mockPayment);
    gpCreate.mockResolvedValue({
      reference: 'GP-REF-003',
      payment_url: 'https://geniuspay.test/pay/GP-REF-003',
    });

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000, isDeposit: true });

    expect(res.status).toBe(201);
  });

  it('retourne 500 et marque le paiement failed si GeniusPay échoue', async () => {
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockResolvedValue(mockPayment);
    prisma.payment.update.mockResolvedValue({ ...mockPayment, status: 'failed' });
    gpCreate.mockRejectedValue(new Error('GeniusPay timeout'));

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/initialisation/i);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'failed' } })
    );
  });

  it('retourne 500 si prisma.quote.findUnique échoue', async () => {
    prisma.quote.findUnique.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/création/i);
  });

  it('retourne 500 si prisma.payment.create échoue', async () => {
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockRejectedValue(new Error('DB create crash'));

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(res.status).toBe(500);
  });

  it('retourne 409 si le devis est PENDING', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
    });

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('QUOTE_NOT_ACCEPTED');
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('retourne 409 si le devis est REFUSED', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'REFUSED',
    });

    const res = await request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ quoteId: QUOTE_ID, amount: 50000 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('QUOTE_NOT_ACCEPTED');
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. GET /:paymentId — détail d'un paiement
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/payments/:paymentId — détail', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).get(`/api/payments/${PAYMENT_ID}`);
    expect(res.status).toBe(401);
  });

  it('retourne 400 si paymentId n\'est pas un UUID valide', async () => {
    const res = await request(app)
      .get('/api/payments/not-a-uuid')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);
    expect(res.status).toBe(400);
  });

  it('retourne 404 si le paiement n\'existe pas', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/payments/${PAYMENT_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/non trouvé/i);
  });

  it('retourne 403 si le client n\'est pas le propriétaire et pas admin', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...mockPaymentWithQuote,
      quote: {
        ...mockQuote,
        clientId: 'autre-client',
        client: { ...mockClient, id: 'autre-client' },
      },
    });

    const res = await request(app)
      .get(`/api/payments/${PAYMENT_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/non autorisé/i);
  });

  it('retourne 200 avec les données du paiement au client propriétaire', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...mockPaymentWithQuote,
      quote: { ...mockQuote, clientId: CLIENT_ID, client: mockClient },
    });

    const res = await request(app)
      .get(`/api/payments/${PAYMENT_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id', PAYMENT_ID);
    expect(res.body.data).toHaveProperty('quoteId');
    expect(res.body.data).toHaveProperty('amount');
    expect(res.body.data).toHaveProperty('status');
    expect(res.body.data).toHaveProperty('isDeposit');
    expect(res.body.data).toHaveProperty('auditLogs');
  });

  it('retourne 200 à un admin même si ce n\'est pas son paiement', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...mockPaymentWithQuote,
      quote: {
        ...mockQuote,
        clientId: 'autre-client',
        client: { ...mockClient, id: 'autre-client' },
      },
    });

    const res = await request(app)
      .get(`/api/payments/${PAYMENT_ID}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('parse le metadata JSON si présent', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...mockPaymentWithQuote,
      metadata: JSON.stringify({ reference: 'GP-001' }),
      quote: { ...mockQuote, clientId: CLIENT_ID, client: mockClient },
    });

    const res = await request(app)
      .get(`/api/payments/${PAYMENT_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.metadata).toEqual({ reference: 'GP-001' });
  });

  it('renvoie metadata null si absent', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...mockPaymentWithQuote,
      metadata: null,
      quote: { ...mockQuote, clientId: CLIENT_ID, client: mockClient },
    });

    const res = await request(app)
      .get(`/api/payments/${PAYMENT_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.metadata).toBeNull();
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.payment.findUnique.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get(`/api/payments/${PAYMENT_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. GET / — liste des paiements de l'utilisateur
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/payments/ — liste', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).get('/api/payments/');
    expect(res.status).toBe(401);
  });

  it('retourne 400 si quoteId n\'est pas un UUID valide', async () => {
    const res = await request(app)
      .get('/api/payments/?quoteId=not-a-uuid')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);
    expect(res.status).toBe(400);
  });

  it('retourne 400 si status est invalide', async () => {
    const res = await request(app)
      .get('/api/payments/?status=INVALID')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);
    expect(res.status).toBe(400);
  });

  it('retourne 200 avec la liste des paiements de l\'utilisateur', async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        id: PAYMENT_ID,
        quoteId: QUOTE_ID,
        amount: 50000,
        status: 'pending',
        isDeposit: true,
        createdAt: new Date(),
        completedAt: null,
        quote: { id: QUOTE_ID, title: 'Mon projet' },
      },
    ]);

    const res = await request(app)
      .get('/api/payments/')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toHaveProperty('id', PAYMENT_ID);
  });

  it('retourne liste vide si aucun paiement', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/payments/')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('filtre par quoteId et status acceptés (pending)', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    await request(app)
      .get(`/api/payments/?quoteId=${QUOTE_ID}&status=pending`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    const whereArg = prisma.payment.findMany.mock.calls[0][0].where;
    expect(whereArg.quoteId).toBe(QUOTE_ID);
    expect(whereArg.status).toBe('pending');
  });

  it('accepte status=succeeded', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/payments/?status=succeeded')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
  });

  it('accepte status=failed', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/payments/?status=failed')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
  });

  it('scoped au clientId de l\'utilisateur connecté', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/payments/')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    const whereArg = prisma.payment.findMany.mock.calls[0][0].where;
    expect(whereArg.quote.clientId).toBe(CLIENT_ID);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.payment.findMany.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/payments/')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. GET /stats/overview — statistiques admin
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/payments/stats/overview — admin', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).get('/api/payments/stats/overview');
    expect(res.status).toBe(401);
  });

  it('retourne 403 si rôle CLIENT', async () => {
    const res = await request(app)
      .get('/api/payments/stats/overview')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administrateurs/i);
  });

  it('retourne 403 si rôle PROFESSIONAL', async () => {
    const res = await request(app)
      .get('/api/payments/stats/overview')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);
    expect(res.status).toBe(403);
  });

  it('retourne 200 avec les stats pour un admin', async () => {
    prisma.payment.groupBy.mockResolvedValue([
      { status: 'pending',   _count: 5,  _sum: { amount: 250000 } },
      { status: 'succeeded', _count: 10, _sum: { amount: 500000 } },
      { status: 'failed',    _count: 2,  _sum: { amount: 100000 } },
    ]);
    prisma.payment.count.mockResolvedValue(17);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 850000 } });

    const res = await request(app)
      .get('/api/payments/stats/overview')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('total', 17);
    expect(res.body.data).toHaveProperty('totalAmount', 850000);
    expect(res.body.data).toHaveProperty('byStatus');
    expect(res.body.data.byStatus).toHaveProperty('pending');
    expect(res.body.data.byStatus).toHaveProperty('succeeded');
  });

  it('renvoie totalAmount = 0 si aggregate retourne null', async () => {
    prisma.payment.groupBy.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });

    const res = await request(app)
      .get('/api/payments/stats/overview')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalAmount).toBe(0);
  });

  it('structure byStatus avec count et amount pour chaque statut', async () => {
    prisma.payment.groupBy.mockResolvedValue([
      { status: 'succeeded', _count: 3, _sum: { amount: 150000 } },
    ]);
    prisma.payment.count.mockResolvedValue(3);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 150000 } });

    const res = await request(app)
      .get('/api/payments/stats/overview')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.byStatus.succeeded).toEqual({
      count: 3,
      amount: 150000,
    });
  });

  it('renvoie amount = 0 pour un statut avec _sum.amount null', async () => {
    prisma.payment.groupBy.mockResolvedValue([
      { status: 'failed', _count: 1, _sum: { amount: null } },
    ]);
    prisma.payment.count.mockResolvedValue(1);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });

    const res = await request(app)
      .get('/api/payments/stats/overview')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.byStatus.failed.amount).toBe(0);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.payment.groupBy.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/payments/stats/overview')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/payments/:paymentId/refund — Refund payment (admin only)
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/payments/:paymentId/refund', () => {
  const REFUND_PAYMENT_ID = 'c4e3b2a1-1234-4abc-8def-000000000003';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('admin with valid reason → 200 with refunded payment', async () => {
    const mockPayment = {
      id: REFUND_PAYMENT_ID,
      status: 'succeeded',
      amount: 50000,
      geniuspayRef: 'gp-ref-123',
      quote: { id: QUOTE_ID, clientId: CLIENT_ID, professionalId: PRO_ID, amount: 50000 },
    };

    prisma.payment.findUnique.mockResolvedValue(mockPayment);
    prisma.payment.update.mockResolvedValue({
      ...mockPayment,
      status: 'refunded',
      refundedAt: new Date(),
      refundReason: 'Admin refund test',
    });

    const res = await request(app)
      .post(`/api/payments/${REFUND_PAYMENT_ID}/refund`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: 'Admin refund test' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('refunded');
    expect(prisma.payment.findUnique).toHaveBeenCalledWith({
      where: { id: REFUND_PAYMENT_ID },
      include: { quote: { select: { id: true, clientId: true, professionalId: true, amount: true } } },
    });
  });

  it('non-admin → 403 Forbidden', async () => {
    const res = await request(app)
      .post(`/api/payments/${REFUND_PAYMENT_ID}/refund`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ reason: 'Should fail' });

    expect(res.status).toBe(403);
  });

  it('missing reason → 400 Bad Request', async () => {
    const res = await request(app)
      .post(`/api/payments/${REFUND_PAYMENT_ID}/refund`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('reason exceeds 500 chars → 400 Bad Request', async () => {
    const longReason = 'a'.repeat(501);
    const res = await request(app)
      .post(`/api/payments/${REFUND_PAYMENT_ID}/refund`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: longReason });

    expect(res.status).toBe(400);
  });

  it('payment not found → 404 Not Found', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/payments/${REFUND_PAYMENT_ID}/refund`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: 'Should fail' });

    expect(res.status).toBe(404);
  });

});
