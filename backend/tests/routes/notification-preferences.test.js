const request = require('supertest');
const express = require('express');
const { clientToken, adminToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  notificationPreference: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt']),
}));

jest.mock('../../utils/pagination-helper', () => ({
  validatePageBasedPaginationQuery: jest.fn().mockReturnValue([]),
  applyPageBasedPagination: jest.fn().mockReturnValue({ limit: 20, skip: 0, offset: 0 }),
  buildPaginatedResponse: jest.fn().mockReturnValue({ data: [], total: 0 }),
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

const prisma = require('../../config/db');
const prefsRouter = require('../../routes/notification-preferences');

const app = express();
app.use(express.json());
app.use('/api/notification-preferences', prefsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ FIXTURES ============

const USER_ID = 'user-pref-1';

const DEFAULT_PREFS = {
  ORDER_CONFIRMED: { email: true, push: true, sms: false },
  ORDER_SHIPPED: { email: true, push: true, sms: false },
  ORDER_DELIVERED: { email: true, push: true, sms: false },
  ORDER_CANCELLED: { email: true, push: true, sms: false },
  PAYMENT_RECEIVED: { email: true, push: true, sms: false },
  PAYMENT_FAILED: { email: true, push: true, sms: true },
  MESSAGE_RECEIVED: { email: true, push: true, sms: false },
  REVIEW_RECEIVED: { email: true, push: true, sms: false },
  BOOKING_CONFIRMED: { email: true, push: true, sms: false },
  BOOKING_CANCELLED: { email: true, push: true, sms: false },
  DISPUTE_CREATED: { email: true, push: true, sms: true },
  DISPUTE_RESOLVED: { email: true, push: true, sms: false },
  PROMOTIONAL: { email: true, push: false, sms: false },
  SYSTEM_ALERT: { email: true, push: true, sms: true },
};

const mockPrefRecord = {
  id: 'pref-1',
  userId: USER_ID,
  preferences: DEFAULT_PREFS,
  updatedAt: new Date().toISOString(),
};

// ============ GET /me ============

describe('GET /api/notification-preferences/me', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/notification-preferences/me');
    expect(res.status).toBe(401);
  });

  test('401 — token invalide', async () => {
    const res = await request(app)
      .get('/api/notification-preferences/me')
      .set('Authorization', 'Bearer token-bidon');
    expect(res.status).toBe(401);
  });

  test('200 — retourne les préférences existantes', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(mockPrefRecord);

    const res = await request(app)
      .get('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('preferences');
    expect(res.body.preferences).toHaveProperty('ORDER_CONFIRMED');
    expect(prisma.notificationPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
  });

  test('200 — crée des préférences par défaut si absentes', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notificationPreference.create.mockResolvedValue(mockPrefRecord);

    const res = await request(app)
      .get('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notificationPreference.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: USER_ID }),
      })
    );
  });

  test('500 — erreur DB', async () => {
    prisma.notificationPreference.findUnique.mockRejectedValue(new Error('DB failure'));

    const res = await request(app)
      .get('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ PATCH /me ============

describe('PATCH /api/notification-preferences/me', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .send({ preferences: { ORDER_CONFIRMED: { email: false, push: true, sms: false } } });
    expect(res.status).toBe(401);
  });

  test('400 — body vide (preferences absent)', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('400 — preferences est un objet vide', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ preferences: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/At least one preference/i);
  });

  test('400 — type de notification invalide', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ preferences: { INVALID_TYPE: { email: true, push: false, sms: false } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid notification type/i);
  });

  test('400 — canal invalide', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ preferences: { ORDER_CONFIRMED: { email: true, whatsapp: false } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid channel/i);
  });

  test('400 — valeur booléenne manquante (string au lieu de bool)', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ preferences: { ORDER_CONFIRMED: { email: 'yes', push: true, sms: false } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be boolean/i);
  });

  test('400 — channels n\'est pas un objet', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ preferences: { ORDER_CONFIRMED: 'active' } });
    expect(res.status).toBe(400);
  });

  test('200 — met à jour les préférences existantes', async () => {
    const updatedRecord = {
      ...mockPrefRecord,
      preferences: { ...DEFAULT_PREFS, ORDER_CONFIRMED: { email: false, push: true, sms: false } },
    };
    prisma.notificationPreference.findUnique.mockResolvedValue(mockPrefRecord);
    prisma.notificationPreference.update.mockResolvedValue(updatedRecord);

    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ preferences: { ORDER_CONFIRMED: { email: false, push: true, sms: false } } });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('preferences');
    expect(res.body.message).toMatch(/updated/i);
    expect(prisma.notificationPreference.update).toHaveBeenCalled();
  });

  test('200 — crée les préférences si absentes avec merge', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notificationPreference.create.mockResolvedValue(mockPrefRecord);

    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ preferences: { PROMOTIONAL: { email: false, push: false, sms: false } } });

    expect(res.status).toBe(200);
    expect(prisma.notificationPreference.create).toHaveBeenCalled();
  });

  test('500 — erreur DB lors du update', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(mockPrefRecord);
    prisma.notificationPreference.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/notification-preferences/me')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ preferences: { ORDER_CONFIRMED: { email: false, push: true, sms: false } } });

    expect(res.status).toBe(500);
  });
});

// ============ PATCH /me/:type ============

describe('PATCH /api/notification-preferences/me/:type', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me/ORDER_CONFIRMED')
      .send({ enabled: false });
    expect(res.status).toBe(401);
  });

  test('400 — type invalide dans l\'URL', async () => {
    const res = await request(app)
      .patch('/api/notification-preferences/me/INVALID_TYPE')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ enabled: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid notification type/i);
  });

  test('200 — désactive un type via enabled=false (tous les canaux)', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(mockPrefRecord);
    prisma.notificationPreference.update.mockResolvedValue({
      ...mockPrefRecord,
      preferences: {
        ...DEFAULT_PREFS,
        ORDER_CONFIRMED: { email: false, push: false, sms: false },
      },
    });

    const res = await request(app)
      .patch('/api/notification-preferences/me/ORDER_CONFIRMED')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/ORDER_CONFIRMED/);
    expect(prisma.notificationPreference.update).toHaveBeenCalled();
  });

  test('200 — active un type via enabled=true', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(mockPrefRecord);
    prisma.notificationPreference.update.mockResolvedValue(mockPrefRecord);

    const res = await request(app)
      .patch('/api/notification-preferences/me/PROMOTIONAL')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
  });

  test('200 — configure les canaux spécifiques via channels array', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(mockPrefRecord);
    prisma.notificationPreference.update.mockResolvedValue(mockPrefRecord);

    const res = await request(app)
      .patch('/api/notification-preferences/me/MESSAGE_RECEIVED')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ channels: ['email', 'push'] });

    expect(res.status).toBe(200);
    expect(prisma.notificationPreference.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferences: expect.objectContaining({
            MESSAGE_RECEIVED: { email: true, push: true, sms: false },
          }),
        }),
      })
    );
  });

  test('200 — crée les prefs par défaut si absentes puis met à jour', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notificationPreference.create.mockResolvedValue(mockPrefRecord);
    prisma.notificationPreference.update.mockResolvedValue(mockPrefRecord);

    const res = await request(app)
      .patch('/api/notification-preferences/me/SYSTEM_ALERT')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(prisma.notificationPreference.create).toHaveBeenCalled();
  });

  test('500 — erreur DB', async () => {
    prisma.notificationPreference.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/notification-preferences/me/ORDER_CONFIRMED')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ enabled: false });

    expect(res.status).toBe(500);
  });
});

// ============ POST /reset ============

describe('POST /api/notification-preferences/reset', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).post('/api/notification-preferences/reset');
    expect(res.status).toBe(401);
  });

  test('200 — réinitialise les préférences existantes aux valeurs par défaut', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(mockPrefRecord);
    prisma.notificationPreference.update.mockResolvedValue(mockPrefRecord);

    const res = await request(app)
      .post('/api/notification-preferences/reset')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset/i);
    expect(res.body).toHaveProperty('preferences');
    expect(prisma.notificationPreference.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        data: expect.objectContaining({ preferences: expect.any(Object) }),
      })
    );
  });

  test('200 — crée les préférences par défaut si aucune entrée existante', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notificationPreference.create.mockResolvedValue(mockPrefRecord);

    const res = await request(app)
      .post('/api/notification-preferences/reset')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notificationPreference.create).toHaveBeenCalled();
  });

  test('500 — erreur DB lors du update', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(mockPrefRecord);
    prisma.notificationPreference.update.mockRejectedValue(new Error('DB reset error'));

    const res = await request(app)
      .post('/api/notification-preferences/reset')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});
