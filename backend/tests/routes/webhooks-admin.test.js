/**
 * Tests for webhooks-admin routes
 * Module: routes/webhooks-admin.js — list, events, create, get, update, delete, activate, test, logs
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

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

const mockPrisma = {
  webhook: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  adminLog: {
    create: jest.fn(),
  },
};

jest.mock('../../config/db', () => mockPrisma);

const mockWebhookUtils = {
  WEBHOOK_EVENTS: {
    BOOKING_CREATED: 'booking.created',
    BOOKING_UPDATED: 'booking.updated',
    PAYMENT_COMPLETED: 'payment.completed',
  },
  registerWebhook: jest.fn(),
  unregisterWebhook: jest.fn(),
  setWebhookActive: jest.fn(),
  getWebhooks: jest.fn(),
  getWebhookLogs: jest.fn(),
  sendTestWebhook: jest.fn(),
};

jest.mock('../../utils/webhooks', () => mockWebhookUtils);

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn(() => ({ skip: 0, take: 20 })),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn(() => []),
}));

const mockWebhook = {
  id: 'wh-1',
  url: 'https://example.com/webhook',
  events: ['booking.created'],
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  logs: [],
};

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/admin/webhooks', require('../../routes/webhooks-admin'));
});

// ─── Auth & Role guards ───────────────────────────────────────────────────────

describe('Auth & Role guards', () => {
  it('GET / — 401 sans token', async () => {
    const res = await request(app).get('/admin/webhooks');
    expect(res.status).toBe(401);
  });

  it('GET / — 403 avec token client', async () => {
    mockWebhookUtils.getWebhooks.mockResolvedValue([]);
    const res = await request(app)
      .get('/admin/webhooks')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });
});

// ─── GET / ────────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('200 retourne la liste des webhooks', async () => {
    mockWebhookUtils.getWebhooks.mockResolvedValue([mockWebhook]);

    const res = await request(app)
      .get('/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(1);
  });

  it('200 filtre par isActive=true', async () => {
    mockWebhookUtils.getWebhooks.mockResolvedValue([mockWebhook]);

    const res = await request(app)
      .get('/admin/webhooks?isActive=true')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(mockWebhookUtils.getWebhooks).toHaveBeenCalledWith({ isActive: true });
  });

  it('500 si getWebhooks échoue', async () => {
    mockWebhookUtils.getWebhooks.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });
});

// ─── GET /events ──────────────────────────────────────────────────────────────

describe('GET /events', () => {
  it('200 retourne les événements disponibles', async () => {
    const res = await request(app)
      .get('/admin/webhooks/events')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.availableEvents)).toBe(true);
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────

describe('POST /', () => {
  it('400 URL invalide', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ url: 'not-a-url', secret: 'a'.repeat(16) });

    expect(res.status).toBe(400);
  });

  it('400 secret trop court', async () => {
    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ url: 'https://example.com/wh', secret: 'short' });

    expect(res.status).toBe(400);
  });

  it('400 événements invalides', async () => {
    mockWebhookUtils.registerWebhook.mockResolvedValue({ ...mockWebhook, id: 'new-wh' });

    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        url: 'https://example.com/webhook',
        secret: 'a'.repeat(16),
        events: ['invalid.event'],
      });

    expect(res.status).toBe(400);
  });

  it('201 création réussie', async () => {
    mockWebhookUtils.registerWebhook.mockResolvedValue({ ...mockWebhook, id: 'new-wh' });
    mockPrisma.adminLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        url: 'https://example.com/webhook',
        secret: 'supersecretkey123',
        events: ['booking.created'],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('201 sans événements (tous par défaut)', async () => {
    mockWebhookUtils.registerWebhook.mockResolvedValue({ ...mockWebhook, events: [] });
    mockPrisma.adminLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        url: 'https://example.com/webhook',
        secret: 'supersecretkey123',
      });

    expect(res.status).toBe(201);
  });

  it('500 si registerWebhook échoue', async () => {
    mockWebhookUtils.registerWebhook.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/admin/webhooks')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        url: 'https://example.com/webhook',
        secret: 'supersecretkey123',
      });

    expect(res.status).toBe(500);
  });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

describe('GET /:id', () => {
  it('404 webhook inexistant', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/admin/webhooks/nonexistent')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
  });

  it('200 retourne les détails du webhook', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockWebhookUtils.getWebhookLogs.mockResolvedValue({
      logs: [],
      total: 0,
    });

    const res = await request(app)
      .get('/admin/webhooks/wh-1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.webhook.id).toBe('wh-1');
  });

  it('500 si getWebhookLogs échoue', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockWebhookUtils.getWebhookLogs.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/admin/webhooks/wh-1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

describe('PUT /:id', () => {
  it('404 webhook inexistant', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/admin/webhooks/nonexistent')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ url: 'https://example.com/wh2' });

    expect(res.status).toBe(404);
  });

  it('400 URL invalide', async () => {
    const res = await request(app)
      .put('/admin/webhooks/wh-1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
  });

  it('400 événements invalides', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);

    const res = await request(app)
      .put('/admin/webhooks/wh-1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ events: ['invalid.event'] });

    expect(res.status).toBe(400);
  });

  it('200 mise à jour réussie', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockPrisma.webhook.update.mockResolvedValue({
      ...mockWebhook,
      url: 'https://updated.com/wh',
    });
    mockPrisma.adminLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/admin/webhooks/wh-1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ url: 'https://updated.com/wh' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

describe('DELETE /:id', () => {
  it('404 webhook inexistant', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/admin/webhooks/nonexistent')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
  });

  it('200 suppression réussie', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockWebhookUtils.unregisterWebhook.mockResolvedValue({});
    mockPrisma.adminLog.create.mockResolvedValue({});

    const res = await request(app)
      .delete('/admin/webhooks/wh-1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Webhook deleted');
  });

  it('500 si unregisterWebhook échoue', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockWebhookUtils.unregisterWebhook.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/admin/webhooks/wh-1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });
});

// ─── PATCH /:id/activate ──────────────────────────────────────────────────────

describe('PATCH /:id/activate', () => {
  it('400 isActive manquant', async () => {
    const res = await request(app)
      .patch('/admin/webhooks/wh-1/activate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('400 isActive pas un booléen', async () => {
    const res = await request(app)
      .patch('/admin/webhooks/wh-1/activate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ isActive: 'yes' });

    expect(res.status).toBe(400);
  });

  it('200 activation réussie', async () => {
    mockWebhookUtils.setWebhookActive.mockResolvedValue({ ...mockWebhook, isActive: true });
    mockPrisma.adminLog.create.mockResolvedValue({});

    const res = await request(app)
      .patch('/admin/webhooks/wh-1/activate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ isActive: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('200 désactivation réussie', async () => {
    mockWebhookUtils.setWebhookActive.mockResolvedValue({ ...mockWebhook, isActive: false });
    mockPrisma.adminLog.create.mockResolvedValue({});

    const res = await request(app)
      .patch('/admin/webhooks/wh-1/activate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
  });

  it('404 si setWebhookActive renvoie "not found"', async () => {
    mockWebhookUtils.setWebhookActive.mockRejectedValue(new Error('Webhook not found'));

    const res = await request(app)
      .patch('/admin/webhooks/wh-1/activate')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ isActive: true });

    expect(res.status).toBe(404);
  });
});

// ─── POST /:id/test ───────────────────────────────────────────────────────────

describe('POST /:id/test', () => {
  it('404 webhook inexistant', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/admin/webhooks/nonexistent/test')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
  });

  it('200 test envoyé avec succès', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockWebhookUtils.sendTestWebhook.mockResolvedValue({
      success: true,
      statusCode: 200,
    });
    mockPrisma.adminLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/admin/webhooks/wh-1/test')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
  });

  it('500 si sendTestWebhook échoue', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockWebhookUtils.sendTestWebhook.mockRejectedValue(new Error('Send failed'));

    const res = await request(app)
      .post('/admin/webhooks/wh-1/test')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });
});

// ─── GET /:id/logs ────────────────────────────────────────────────────────────

describe('GET /:id/logs', () => {
  it('404 webhook inexistant', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/admin/webhooks/nonexistent/logs')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(404);
  });

  it('200 retourne les logs paginés', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockWebhookUtils.getWebhookLogs.mockResolvedValue({
      logs: [
        {
          id: 'log-1',
          event: 'booking.created',
          status: 'SUCCESS',
          attempt: 1,
          nextRetryAt: null,
          createdAt: new Date().toISOString(),
          response: JSON.stringify({ status: 200 }),
        },
      ],
      total: 1,
    });

    const res = await request(app)
      .get('/admin/webhooks/wh-1/logs')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('200 filtre par statut', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(mockWebhook);
    mockWebhookUtils.getWebhookLogs.mockResolvedValue({ logs: [], total: 0 });

    const res = await request(app)
      .get('/admin/webhooks/wh-1/logs?status=FAILED')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(mockWebhookUtils.getWebhookLogs).toHaveBeenCalledWith(
      'wh-1',
      expect.objectContaining({ status: 'FAILED' })
    );
  });
});
