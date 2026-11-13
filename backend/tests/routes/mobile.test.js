const request = require('supertest');
const express = require('express');
const { clientToken, proToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  notification: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  project: {
    findMany: jest.fn(),
  },
  message: {
    count: jest.fn(),
  },
}));

jest.mock('../../config/mobile-images', () => ({
  optimizeImagesForMobile: jest.fn((obj) => obj),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
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
const { optimizeImagesForMobile } = require('../../config/mobile-images');
const mobileRouter = require('../../routes/mobile');

const app = express();
app.use(express.json());
app.use('/api/v1/mobile', mobileRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// App secondaire qui simule req.mobileOptimized=true (mode slim)
const appSlim = express();
appSlim.use(express.json());
appSlim.use((req, res, next) => { req.mobileOptimized = true; next(); });
appSlim.use('/api/v1/mobile', mobileRouter);
appSlim.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ TEST DATA FIXTURES ============

const USER_ID = 'user-1';

const mockUser = {
  id: USER_ID,
  firstName: 'Alice',
  lastName: 'Dupont',
  avatarUrl: null,
  role: 'CLIENT',
  emailVerified: true,
  city: 'Antananarivo',
  professional: null,
};

const mockNotifications = [
  { id: 'n-1', type: 'PROJECT_UPDATE', title: 'Projet mis à jour', body: 'Corps', createdAt: new Date().toISOString() },
];

const mockProjects = [
  { id: 'p-1', title: 'Rénovation cuisine', status: 'IN_PROGRESS', city: 'Antananarivo', updatedAt: new Date().toISOString() },
];

// ============ GET /dashboard ============

describe('GET /api/v1/mobile/dashboard', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.notification.findMany.mockResolvedValue(mockNotifications);
    prisma.project.findMany.mockResolvedValue(mockProjects);
    prisma.message.count.mockResolvedValue(2);
  });

  test('200 — retourne le dashboard avec toutes les données', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/dashboard')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data).toHaveProperty('unreadNotifications');
    expect(res.body.data).toHaveProperty('recentNotifications');
    expect(res.body.data).toHaveProperty('activeProjects');
    expect(res.body.data).toHaveProperty('unreadMessages');
    expect(res.body.data).toHaveProperty('fetchedAt');
  });

  test('200 — calcule correctement unreadNotifications', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { id: 'n-1', type: 'NEW_MESSAGE', title: 'Msg', body: 'B', createdAt: new Date().toISOString() },
      { id: 'n-2', type: 'PROJECT_UPDATE', title: 'Proj', body: 'B', createdAt: new Date().toISOString() },
    ]);

    const res = await request(app)
      .get('/api/v1/mobile/dashboard')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unreadNotifications).toBe(2);
    expect(res.body.data.unreadMessages).toBe(2);
  });

  test('200 — aucune notification ni message', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);
    prisma.message.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/mobile/dashboard')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unreadNotifications).toBe(0);
    expect(res.body.data.activeProjects).toHaveLength(0);
    expect(res.body.data.unreadMessages).toBe(0);
  });

  test('200 — applique l\'optimisation des images sur le user', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/dashboard')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(optimizeImagesForMobile).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), 'avatar');
  });

  test('200 — ETag et Cache-Control présents dans les headers', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/dashboard')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('etag');
    expect(res.headers['cache-control']).toMatch(/private/);
  });

  test('304 — Not Modified si ETag correspond (temps figé)', async () => {
    // On fige le temps pour que les deux appels produisent le même ETag
    const fixedDate = new Date('2026-11-01T12:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(fixedDate);

    try {
      const first = await request(app)
        .get('/api/v1/mobile/dashboard')
        .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

      const etag = first.headers['etag'];
      expect(etag).toBeTruthy();

      const res = await request(app)
        .get('/api/v1/mobile/dashboard')
        .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
        .set('If-None-Match', etag);

      expect(res.status).toBe(304);
    } finally {
      jest.useRealTimers();
    }
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/v1/mobile/dashboard');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors des requêtes parallèles', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/v1/mobile/dashboard')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('200 — mode slim (mobileOptimized=true) applique take:3 pour les projets', async () => {
    const res = await request(appSlim)
      .get('/api/v1/mobile/dashboard')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // En mode slim, project.findMany est appelé avec take:3
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 })
    );
  });
});

// ============ GET /notifications ============

describe('GET /api/v1/mobile/notifications', () => {
  beforeEach(() => {
    prisma.notification.findMany.mockResolvedValue(mockNotifications);
    prisma.notification.count.mockResolvedValue(1);
  });

  test('200 — retourne les notifications avec meta', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/notifications')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('limit');
  });

  test('200 — filtre unread=true', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/mobile/notifications?unread=true')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID, read: false }),
      })
    );
  });

  test('200 — sans filtre unread (toutes les notifications)', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/notifications')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID }),
      })
    );
  });

  test('200 — pagination par page', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(100);

    const res = await request(app)
      .get('/api/v1/mobile/notifications?page=3&limit=10')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(3);
    expect(res.body.meta.limit).toBe(10);
  });

  test('200 — limite maximale de 50 appliquée', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    await request(app)
      .get('/api/v1/mobile/notifications?limit=200')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  test('200 — Cache-Control présent dans les headers', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/notifications')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeTruthy();
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/v1/mobile/notifications');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB', async () => {
    prisma.notification.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/v1/mobile/notifications')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('200 — mode slim (mobileOptimized=true) n\'inclut pas le champ data', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    const res = await request(appSlim)
      .get('/api/v1/mobile/notifications')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    // En mode slim, select n'inclut pas { data: true }
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ data: true }),
      })
    );
  });

  test('200 — meta.unreadCount présent quand unread=true', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(5);

    const res = await request(app)
      .get('/api/v1/mobile/notifications?unread=true')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.unreadCount).toBe(5);
  });

  test('200 — meta.unreadCount absent quand pas de filtre unread', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/mobile/notifications')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.unreadCount).toBeUndefined();
  });
});

// ============ GET /profile-summary ============

describe('GET /api/v1/mobile/profile-summary', () => {
  test('200 — retourne le profil de l\'utilisateur', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      email: 'alice@test.com',
      phone: '+261123456789',
      phoneVerified: false,
      twoFAEnabled: false,
      locale: 'fr',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get('/api/v1/mobile/profile-summary')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id', USER_ID);
    expect(res.body.data).toHaveProperty('firstName', 'Alice');
  });

  test('200 — applique l\'optimisation des images', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      email: 'alice@test.com',
      phone: null,
      phoneVerified: false,
      twoFAEnabled: false,
      locale: 'fr',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get('/api/v1/mobile/profile-summary')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(optimizeImagesForMobile).toHaveBeenCalled();
  });

  test('200 — ETag et Cache-Control dans les headers', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      email: 'alice@test.com',
      phone: null,
      phoneVerified: false,
      twoFAEnabled: false,
      locale: 'fr',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get('/api/v1/mobile/profile-summary')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('etag');
    expect(res.headers['cache-control']).toMatch(/private/);
  });

  test('200 — profil d\'un professionnel (avec données pro)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      role: 'PROFESSIONAL',
      email: 'pro@test.com',
      phone: '+261987654321',
      phoneVerified: true,
      twoFAEnabled: false,
      locale: 'fr',
      createdAt: new Date().toISOString(),
      professional: {
        id: 'pro-1',
        verified: true,
        rating: 4.8,
        reviewCount: 12,
        city: 'Antananarivo',
        photoUrl: null,
      },
    });

    const res = await request(app)
      .get('/api/v1/mobile/profile-summary')
      .set('Authorization', `Bearer ${proToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('professional');
  });

  test('404 — utilisateur introuvable en base', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/mobile/profile-summary')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/v1/mobile/profile-summary');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du findUnique', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/v1/mobile/profile-summary')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ============ GET /sync ============

describe('GET /api/v1/mobile/sync', () => {
  const SINCE = '2026-11-01T00:00:00.000Z';

  beforeEach(() => {
    prisma.notification.findMany.mockResolvedValue(mockNotifications);
    prisma.project.findMany.mockResolvedValue(mockProjects);
    prisma.message.findMany
      ? prisma.message.findMany.mockResolvedValue([])
      : null;

    // Remplacer par message mock si absent du mock global
    if (!prisma.message) {
      prisma.message = { findMany: jest.fn().mockResolvedValue([]) };
    } else if (!prisma.message.findMany) {
      prisma.message.findMany = jest.fn().mockResolvedValue([]);
    } else {
      prisma.message.findMany.mockResolvedValue([]);
    }

    prisma.user.findFirst.mockResolvedValue(null); // pas de mise à jour profil
  });

  test('200 — retourne le delta avec toutes les entités', async () => {
    const res = await request(app)
      .get(`/api/v1/mobile/sync?since=${SINCE}`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('notifications');
    expect(res.body.data).toHaveProperty('projects');
    expect(res.body.data).toHaveProperty('messages');
    expect(res.body.data).toHaveProperty('syncedAt');
    expect(res.body.data).toHaveProperty('sinceUsed');
    expect(res.body.data).toHaveProperty('conflictPolicy');
    expect(res.body.data).toHaveProperty('counts');
  });

  test('200 — counts reflètent les données récupérées', async () => {
    prisma.notification.findMany.mockResolvedValue(mockNotifications);
    prisma.project.findMany.mockResolvedValue(mockProjects);
    prisma.message.findMany.mockResolvedValue([]);
    prisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/mobile/sync?since=${SINCE}`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.counts.notifications).toBe(1);
    expect(res.body.data.counts.projects).toBe(1);
    expect(res.body.data.counts.messages).toBe(0);
    expect(res.body.data.counts.profileUpdated).toBe(false);
  });

  test('200 — profil retourné si mis à jour depuis `since`', async () => {
    const updatedProfile = { id: USER_ID, firstName: 'Alice', lastName: 'Dupont', avatarUrl: null, updatedAt: new Date().toISOString() };
    prisma.user.findFirst.mockResolvedValue(updatedProfile);

    const res = await request(app)
      .get(`/api/v1/mobile/sync?since=${SINCE}`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.profile).not.toBeNull();
    expect(res.body.data.counts.profileUpdated).toBe(true);
  });

  test('200 — conflictPolicy contient les bonnes règles', async () => {
    const res = await request(app)
      .get(`/api/v1/mobile/sync?since=${SINCE}`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.conflictPolicy.profile).toBe('last-write-wins');
    expect(res.body.data.conflictPolicy.projects).toBe('server-wins');
    expect(res.body.data.conflictPolicy.payments).toBe('server-wins');
  });

  test('200 — sinceUsed correspond au timestamp parsé', async () => {
    const res = await request(app)
      .get(`/api/v1/mobile/sync?since=${SINCE}`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sinceUsed).toBe(SINCE);
  });

  test('200 — headers X-Sync-Timestamp et Cache-Control présents', async () => {
    const res = await request(app)
      .get(`/api/v1/mobile/sync?since=${SINCE}`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-sync-timestamp']).toBeTruthy();
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  test('400 — paramètre since manquant', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/sync')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/since/i);
  });

  test('400 — paramètre since invalide (pas ISO 8601)', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/sync?since=pas-une-date')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/ISO 8601/i);
  });

  test('400 — paramètre since invalide (nombre aléatoire)', async () => {
    const res = await request(app)
      .get('/api/v1/mobile/sync?since=99999999999999999')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    // new Date(99999999999999999) est NaN → 400
    expect(res.status).toBe(400);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get(`/api/v1/mobile/sync?since=${SINCE}`);
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors des requêtes parallèles', async () => {
    prisma.notification.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get(`/api/v1/mobile/sync?since=${SINCE}`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('200 — mode slim applique take:20 pour notifications et take:5 pour projets', async () => {
    const res = await request(appSlim)
      .get(`/api/v1/mobile/sync?since=${SINCE}`)
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // En mode slim : notification.take=20, project.take=5, message.take=10
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 })
    );
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });
});
