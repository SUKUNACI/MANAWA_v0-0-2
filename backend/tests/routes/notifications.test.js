const request = require('supertest');
const express = require('express');
const { clientToken, proToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  pushToken: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
  notification: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
}));

jest.mock('../../config/pushNotifications', () => ({
  detectTokenType: jest.fn(),
  sendPushNotification: jest.fn().mockResolvedValue({ sent: false }),
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
  applyPageBasedPagination: jest.fn().mockImplementation((query) => {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(50, parseInt(query.limit) || 30);
    const skip = (page - 1) * limit;
    return { limit, skip, offset: skip };
  }),
  buildPaginatedResponse: jest.fn().mockReturnValue({}),
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
  requireEmailVerified: (req, res, next) => next(),
}));

const prisma = require('../../config/db');
const { detectTokenType } = require('../../config/pushNotifications');
const notificationsRouter = require('../../routes/notifications');

const app = express();
app.use(express.json());
app.use('/api/notifications', notificationsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ TEST DATA FIXTURES ============

const USER_ID = 'user-1';
const NOTIF_ID = 'notif-1';

const EXPO_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const FCM_TOKEN = 'x'.repeat(152);
const APNS_TOKEN = 'a'.repeat(64);

// ============ POST /register-token ============

describe('POST /api/notifications/register-token', () => {
  beforeEach(() => {
    prisma.pushToken.upsert.mockResolvedValue({ id: 'pt-1', token: EXPO_TOKEN, type: 'EXPO' });
    prisma.user.update.mockResolvedValue({ id: USER_ID });
    detectTokenType.mockReturnValue('EXPO');
  });

  test('200 — enregistre un token Expo avec registered:true', async () => {
    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: EXPO_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(true);
    expect(res.body.type).toBe('EXPO');
    expect(prisma.pushToken.upsert).toHaveBeenCalled();
  });

  test('200 — enregistre un token FCM', async () => {
    detectTokenType.mockReturnValue('FCM');
    prisma.pushToken.upsert.mockResolvedValue({ id: 'pt-2', token: FCM_TOKEN, type: 'FCM' });

    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: FCM_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('FCM');
  });

  test('200 — enregistre un token APNs', async () => {
    detectTokenType.mockReturnValue('APNs');
    prisma.pushToken.upsert.mockResolvedValue({ id: 'pt-3', token: APNS_TOKEN, type: 'APNs' });

    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: APNS_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('APNs');
  });

  test('200 — type explicite fourni (EXPO)', async () => {
    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: EXPO_TOKEN, type: 'EXPO' });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('EXPO');
  });

  test('200 — enregistre avec deviceId optionnel', async () => {
    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: EXPO_TOKEN, deviceId: 'device-abc123' });

    expect(res.status).toBe(200);
    expect(prisma.pushToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ deviceId: 'device-abc123' }),
      })
    );
  });

  test('400 — token absent', async () => {
    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('400 — token vide (string vide)', async () => {
    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: '' });

    expect(res.status).toBe(400);
  });

  test('400 — detectTokenType retourne null (format inconnu)', async () => {
    detectTokenType.mockReturnValue(null);

    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: 'token-invalide' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Format de token invalide/i);
  });

  test('400 — token Expo mal formaté (ne commence pas par ExponentPushToken[)', async () => {
    detectTokenType.mockReturnValue('EXPO');

    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: 'pas-un-expo-token' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Expo invalide/i);
  });

  test('400 — token FCM trop court (< 100 chars)', async () => {
    detectTokenType.mockReturnValue('FCM');

    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: 'court' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/FCM invalide/i);
  });

  test('400 — token APNs non hexadécimal 64 chars', async () => {
    detectTokenType.mockReturnValue('APNs');

    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: 'pas-hex-valide' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/APNs invalide/i);
  });

  test('400 — type explicite invalide', async () => {
    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: EXPO_TOKEN, type: 'INVALID_TYPE' });

    expect(res.status).toBe(400);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .post('/api/notifications/register-token')
      .send({ token: EXPO_TOKEN });

    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du upsert', async () => {
    prisma.pushToken.upsert.mockRejectedValue(new Error('DB failure'));

    const res = await request(app)
      .post('/api/notifications/register-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ token: EXPO_TOKEN });

    expect(res.status).toBe(500);
  });
});

// ============ DELETE /unregister-token ============

describe('DELETE /api/notifications/unregister-token', () => {
  beforeEach(() => {
    prisma.pushToken.updateMany.mockResolvedValue({ count: 2 });
    prisma.user.update.mockResolvedValue({ id: USER_ID });
  });

  test('200 — désactive tous les tokens et retourne unregistered:true', async () => {
    const res = await request(app)
      .delete('/api/notifications/unregister-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.unregistered).toBe(true);
    expect(prisma.pushToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID }, data: { isActive: false } })
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expoPushToken: null } })
    );
  });

  test('200 — aucun token existant (count=0)', async () => {
    prisma.pushToken.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .delete('/api/notifications/unregister-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.unregistered).toBe(true);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).delete('/api/notifications/unregister-token');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du updateMany tokens', async () => {
    prisma.pushToken.updateMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/notifications/unregister-token')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /tokens ============

describe('GET /api/notifications/tokens', () => {
  test('200 — retourne la liste avec total et active', async () => {
    prisma.pushToken.findMany.mockResolvedValue([
      { id: 'pt-1', platform: 'Android', type: 'FCM', isActive: true, deviceId: null, lastUsed: new Date(), createdAt: new Date() },
      { id: 'pt-2', platform: 'iOS', type: 'APNs', isActive: false, deviceId: null, lastUsed: new Date(), createdAt: new Date() },
    ]);

    const res = await request(app)
      .get('/api/notifications/tokens')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.active).toBe(1);
    expect(Array.isArray(res.body.tokens)).toBe(true);
  });

  test('200 — liste vide (total=0, active=0)', async () => {
    prisma.pushToken.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/notifications/tokens')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.active).toBe(0);
  });

  test('200 — tous les tokens sont actifs', async () => {
    prisma.pushToken.findMany.mockResolvedValue([
      { id: 'pt-1', platform: 'Android', type: 'FCM', isActive: true, deviceId: 'd1', lastUsed: new Date(), createdAt: new Date() },
      { id: 'pt-2', platform: 'Android', type: 'FCM', isActive: true, deviceId: 'd2', lastUsed: new Date(), createdAt: new Date() },
    ]);

    const res = await request(app)
      .get('/api/notifications/tokens')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(2);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/notifications/tokens');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du findMany', async () => {
    prisma.pushToken.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/notifications/tokens')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /history ============

describe('GET /api/notifications/history', () => {
  test('200 — retourne la liste des notifications', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { id: 'n-1', title: 'Projet accepté', body: 'Corps', read: false, createdAt: new Date() },
    ]);
    prisma.notification.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/notifications/history')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
  });

  test('200 — filtre archived=true', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/notifications/history?archived=true')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, isArchived: true } })
    );
  });

  test('200 — filtre archived=false', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/notifications/history?archived=false')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, isArchived: false } })
    );
  });

  test('200 — page 2 applique le bon skip', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    await request(app)
      .get('/api/notifications/history?page=2')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 30 })
    );
  });

  test('400 — paramètre archived invalide', async () => {
    const res = await request(app)
      .get('/api/notifications/history?archived=invalid')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(400);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/notifications/history');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du findMany', async () => {
    prisma.notification.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/notifications/history')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ PATCH /read-all ============

describe('PATCH /api/notifications/read-all', () => {
  test('200 — marque toutes les notifications comme lues', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 5 });

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, read: false },
        data: { read: true },
      })
    );
  });

  test('200 — aucune notification à marquer (count=0)', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).patch('/api/notifications/read-all');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB', async () => {
    prisma.notification.updateMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ PATCH /:id/read ============

describe('PATCH /api/notifications/:id/read', () => {
  test('200 — marque une notification comme lue', async () => {
    prisma.notification.findUnique.mockResolvedValue({ userId: USER_ID });
    prisma.notification.update.mockResolvedValue({ id: NOTIF_ID, read: true });

    const res = await request(app)
      .patch(`/api/notifications/${NOTIF_ID}/read`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NOTIF_ID },
        data: { read: true },
      })
    );
  });

  test('404 — notification introuvable (null)', async () => {
    prisma.notification.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/notifications/${NOTIF_ID}/read`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('404 — notification appartient à un autre utilisateur', async () => {
    prisma.notification.findUnique.mockResolvedValue({ userId: 'other-user-999' });

    const res = await request(app)
      .patch(`/api/notifications/${NOTIF_ID}/read`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(404);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).patch(`/api/notifications/${NOTIF_ID}/read`);
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du findUnique', async () => {
    prisma.notification.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch(`/api/notifications/${NOTIF_ID}/read`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /:id/archive ============

describe('POST /api/notifications/:id/archive', () => {
  test('200 — archive une notification', async () => {
    prisma.notification.findUnique.mockResolvedValue({ userId: USER_ID });
    prisma.notification.update.mockResolvedValue({ id: NOTIF_ID, isArchived: true });

    const res = await request(app)
      .post(`/api/notifications/${NOTIF_ID}/archive`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NOTIF_ID },
        data: { isArchived: true },
      })
    );
  });

  test('404 — notification introuvable', async () => {
    prisma.notification.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/notifications/${NOTIF_ID}/archive`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('404 — notification appartient à un autre utilisateur', async () => {
    prisma.notification.findUnique.mockResolvedValue({ userId: 'other-user-999' });

    const res = await request(app)
      .post(`/api/notifications/${NOTIF_ID}/archive`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(404);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).post(`/api/notifications/${NOTIF_ID}/archive`);
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB', async () => {
    prisma.notification.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post(`/api/notifications/${NOTIF_ID}/archive`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /archive-all ============

describe('POST /api/notifications/archive-all', () => {
  test('200 — archive toutes les notifications non archivées', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 7 });

    const res = await request(app)
      .post('/api/notifications/archive-all')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(7);
    expect(res.body.message).toContain('7');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, isArchived: false },
        data: { isArchived: true },
      })
    );
  });

  test('200 — aucune notification à archiver (count=0)', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .post('/api/notifications/archive-all')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(0);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).post('/api/notifications/archive-all');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB', async () => {
    prisma.notification.updateMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/notifications/archive-all')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /:id/unarchive ============

describe('POST /api/notifications/:id/unarchive', () => {
  test('200 — restaure une notification archivée', async () => {
    prisma.notification.findUnique.mockResolvedValue({ userId: USER_ID });
    prisma.notification.update.mockResolvedValue({ id: NOTIF_ID, isArchived: false });

    const res = await request(app)
      .post(`/api/notifications/${NOTIF_ID}/unarchive`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(false);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NOTIF_ID },
        data: { isArchived: false },
      })
    );
  });

  test('404 — notification introuvable', async () => {
    prisma.notification.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/notifications/${NOTIF_ID}/unarchive`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(404);
  });

  test('404 — notification appartient à un autre utilisateur', async () => {
    prisma.notification.findUnique.mockResolvedValue({ userId: 'other-user-999' });

    const res = await request(app)
      .post(`/api/notifications/${NOTIF_ID}/unarchive`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(404);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).post(`/api/notifications/${NOTIF_ID}/unarchive`);
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB', async () => {
    prisma.notification.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post(`/api/notifications/${NOTIF_ID}/unarchive`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});
