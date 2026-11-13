const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCKS ============

jest.mock('../../config/db', () => ({
  payment: { findUnique: jest.fn() },
  dispute: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  pushToken: { findMany: jest.fn().mockResolvedValue([]) },
}));

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true),
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
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue([]),
}));

const prisma = require('../../config/db');
const disputeRoutes = require('../../routes/disputes');

const app = express();
app.use(express.json());
app.use('/api/disputes', disputeRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ Fixtures ============

const CLIENT_ID = 'client-1';
const PRO_USER_ID = 'pro-user-1';
const PAYMENT_ID = 'payment-abc';
const DISPUTE_ID = 'dispute-xyz';

const mockPayment = {
  id: PAYMENT_ID,
  status: 'succeeded',
  quote: {
    project: { clientId: CLIENT_ID, title: 'Mon Projet' },
    professional: {
      user: { id: PRO_USER_ID, firstName: 'Pierre', lastName: 'Dupont' },
    },
  },
};

const mockDispute = {
  id: DISPUTE_ID,
  paymentId: PAYMENT_ID,
  clientId: CLIENT_ID,
  reason: 'Travaux non conformes',
  description: 'Les travaux ne correspondent pas au devis',
  status: 'OPEN',
  createdAt: new Date().toISOString(),
};

// ============ POST /api/disputes ============

describe('POST /api/disputes', () => {
  beforeEach(() => {
    prisma.payment.findUnique.mockResolvedValue(mockPayment);
    prisma.dispute.findFirst.mockResolvedValue(null);
    prisma.dispute.create.mockResolvedValue(mockDispute);
    prisma.pushToken.findMany.mockResolvedValue([]);
  });

  test('201 — crée un litige avec succès', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Travaux non conformes', description: 'Détail' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', DISPUTE_ID);
    expect(res.body.status).toBe('OPEN');
  });

  test('201 — sans description (optionnelle)', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Travaux non conformes' });

    expect(res.status).toBe(201);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .send({ paymentId: PAYMENT_ID, reason: 'Test' });

    expect(res.status).toBe(401);
  });

  test('403 — un professionnel ne peut pas créer un litige', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Test' });

    expect(res.status).toBe(403);
  });

  test('403 — un admin ne peut pas créer un litige', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Test' });

    expect(res.status).toBe(403);
  });

  test('400 — paymentId manquant (validation express-validator)', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ reason: 'Test' });

    expect(res.status).toBe(400);
  });

  test('400 — reason manquante (validation express-validator)', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID });

    expect(res.status).toBe(400);
  });

  test('400 — description trop longue', async () => {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Test', description: 'x'.repeat(1001) });

    expect(res.status).toBe(400);
  });

  test('404 — paiement introuvable', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: 'unknown', reason: 'Test' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('403 — le paiement appartient à un autre client', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...mockPayment,
      quote: { ...mockPayment.quote, project: { clientId: 'other-client', title: 'Autre' } },
    });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Test' });

    expect(res.status).toBe(403);
  });

  test('400 — paiement non confirmé (status pending)', async () => {
    prisma.payment.findUnique.mockResolvedValue({ ...mockPayment, status: 'pending' });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmé/i);
  });

  test('409 — litige déjà ouvert sur ce paiement', async () => {
    prisma.dispute.findFirst.mockResolvedValue({ id: 'existing-dispute', status: 'OPEN' });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Test' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/déjà ouvert/i);
  });

  test('envoie une notification push au pro si des tokens existent', async () => {
    const { sendPushNotification } = require('../../config/pushNotifications');
    prisma.pushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[abc]' }]);

    await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Test' });

    expect(sendPushNotification).toHaveBeenCalled();
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.payment.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ paymentId: PAYMENT_ID, reason: 'Test' });

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/disputes/mine ============

describe('GET /api/disputes/mine', () => {
  beforeEach(() => {
    prisma.dispute.findMany.mockResolvedValue([mockDispute]);
  });

  test('200 — retourne les litiges du client', async () => {
    const res = await request(app)
      .get('/api/disputes/mine')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(prisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: CLIENT_ID } })
    );
  });

  test('200 — retourne liste vide si aucun litige', async () => {
    prisma.dispute.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/disputes/mine')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('401 — sans token', async () => {
    const res = await request(app).get('/api/disputes/mine');
    expect(res.status).toBe(401);
  });

  test('403 — un professionnel ne peut pas accéder à /mine', async () => {
    const res = await request(app)
      .get('/api/disputes/mine')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(403);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.dispute.findMany.mockRejectedValue(new Error('DB failure'));

    const res = await request(app)
      .get('/api/disputes/mine')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/disputes/:id ============

describe('GET /api/disputes/:id', () => {
  beforeEach(() => {
    prisma.dispute.findFirst.mockResolvedValue(mockDispute);
  });

  test('200 — un client accède à son propre litige', async () => {
    const res = await request(app)
      .get(`/api/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', DISPUTE_ID);
  });

  test('200 — un admin accède à n\'importe quel litige', async () => {
    const res = await request(app)
      .get(`/api/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
  });

  test('200 — un professionnel accède à un litige le concernant', async () => {
    const res = await request(app)
      .get(`/api/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('401 — sans token', async () => {
    const res = await request(app).get(`/api/disputes/${DISPUTE_ID}`);
    expect(res.status).toBe(401);
  });

  test('404 — litige introuvable', async () => {
    prisma.dispute.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/disputes/not-found')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.dispute.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get(`/api/disputes/${DISPUTE_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});
