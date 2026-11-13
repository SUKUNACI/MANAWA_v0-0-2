/**
 * Tests for support routes
 * Module: routes/support.js — tickets list, create, detail, messages, patch status
 */

const request = require('supertest');
const express = require('express');
const { clientToken, proToken } = require('../helpers');

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

jest.mock('../../middleware/validateInput', () => ({
  handleValidationErrors: (req, res, next) => next(),
}));

// Mock rate limiters — pass-through
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

const mockPrisma = {
  supportTicket: {
    findMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  supportMessage: {
    create: jest.fn(),
  },
};

jest.mock('../../config/db', () => mockPrisma);

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn(() => ({ skip: 0, take: 20 })),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn(() => []),
}));

const mockTicket = {
  id: 'ticket-1',
  userId: 'client-1',
  category: 'BILLING',
  subject: 'Problème de facturation',
  status: 'OPEN',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messages: [],
};

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api/support', require('../../routes/support'));
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe('Auth guard', () => {
  it('GET /tickets — 401 sans token', async () => {
    const res = await request(app).get('/api/support/tickets');
    expect(res.status).toBe(401);
  });
});

// ─── GET /tickets ─────────────────────────────────────────────────────────────

describe('GET /tickets', () => {
  it('200 retourne les tickets de l\'utilisateur', async () => {
    mockPrisma.supportTicket.findMany.mockResolvedValue([mockTicket]);

    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('200 liste vide', async () => {
    mockPrisma.supportTicket.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/support/tickets')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── POST /tickets ────────────────────────────────────────────────────────────

describe('POST /tickets', () => {
  it('400 sans champs obligatoires', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('400 sans message', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ category: 'BILLING', subject: 'Test sujet' });

    expect(res.status).toBe(400);
  });

  it('201 ticket créé avec succès', async () => {
    mockPrisma.supportTicket.create.mockResolvedValue({
      ...mockTicket,
      messages: [{ id: 'msg-1', content: 'Mon message', senderId: 'client-1' }],
    });

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({
        category: 'BILLING',
        subject: 'Problème de facturation',
        message: 'Je n\'arrive pas à voir ma facture.',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('ticket-1');
  });
});

// ─── GET /tickets/:id ─────────────────────────────────────────────────────────

describe('GET /tickets/:id', () => {
  it('404 ticket inexistant', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/support/tickets/nonexistent')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Ticket non trouvé');
  });

  it('200 retourne le ticket avec ses messages', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue({
      ...mockTicket,
      messages: [{ id: 'msg-1', content: 'Bonjour', senderId: 'client-1', createdAt: new Date() }],
    });

    const res = await request(app)
      .get('/api/support/tickets/ticket-1')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('ticket-1');
  });
});

// ─── POST /tickets/:id/messages ───────────────────────────────────────────────

describe('POST /tickets/:id/messages', () => {
  it('404 ticket inexistant', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/support/tickets/nonexistent/messages')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ message: 'Mon message' });

    expect(res.status).toBe(404);
  });

  it('400 ticket fermé', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue({
      ...mockTicket,
      status: 'CLOSED',
    });

    const res = await request(app)
      .post('/api/support/tickets/ticket-1/messages')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ message: 'Mon message' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Ce ticket est fermé');
  });

  it('400 message manquant', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);

    const res = await request(app)
      .post('/api/support/tickets/ticket-1/messages')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('400 message trop long', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);

    const res = await request(app)
      .post('/api/support/tickets/ticket-1/messages')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ message: 'x'.repeat(5001) });

    expect(res.status).toBe(400);
  });

  it('400 contenu XSS détecté', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);

    const res = await request(app)
      .post('/api/support/tickets/ticket-1/messages')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ message: '<script>alert("xss")</script>' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/XSS/i);
  });

  it('400 injection SQL détectée', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);

    const res = await request(app)
      .post('/api/support/tickets/ticket-1/messages')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ message: "'; DROP TABLE users;" });

    expect(res.status).toBe(400);
  });

  it('201 message créé avec succès', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);
    mockPrisma.supportMessage.create.mockResolvedValue({
      id: 'msg-2',
      ticketId: 'ticket-1',
      content: 'Voici ma réponse.',
      senderId: 'client-1',
    });
    mockPrisma.supportTicket.update.mockResolvedValue({ ...mockTicket, status: 'OPEN' });

    const res = await request(app)
      .post('/api/support/tickets/ticket-1/messages')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ message: 'Voici ma réponse.' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('msg-2');
  });
});

// ─── PATCH /tickets/:id ───────────────────────────────────────────────────────

describe('PATCH /tickets/:id', () => {
  it('404 ticket inexistant', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/support/tickets/nonexistent')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'CLOSED' });

    expect(res.status).toBe(404);
  });

  it('400 statut invalide', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);

    const res = await request(app)
      .patch('/api/support/tickets/ticket-1')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'INVALID_STATUS' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Statut invalide');
  });

  it('400 statut manquant', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);

    const res = await request(app)
      .patch('/api/support/tickets/ticket-1')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('200 statut mis à jour', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);
    mockPrisma.supportTicket.update.mockResolvedValue({
      ...mockTicket,
      status: 'CLOSED',
    });

    const res = await request(app)
      .patch('/api/support/tickets/ticket-1')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'CLOSED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CLOSED');
  });

  it('200 statut RESOLVED', async () => {
    mockPrisma.supportTicket.findFirst.mockResolvedValue(mockTicket);
    mockPrisma.supportTicket.update.mockResolvedValue({
      ...mockTicket,
      status: 'RESOLVED',
    });

    const res = await request(app)
      .patch('/api/support/tickets/ticket-1')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(200);
  });
});
