const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCKS ============

jest.mock('../../config/db', () => ({
  professional: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  follow: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  notification: {
    create: jest.fn().mockResolvedValue({}),
  },
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
const professionalsRoutes = require('../../routes/professionals');

const app = express();
app.use(express.json());
app.use('/api/professionals', professionalsRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ Fixtures ============

const PRO_USER_ID = 'pro-user-1';
const CLIENT_ID = 'client-1';
const PRO_ID = 'pro-id-1';

const mockProUser = {
  id: PRO_USER_ID,
  firstName: 'Pierre',
  lastName: 'Dupont',
  email: 'pierre@example.com',
  city: 'Paris',
  avatarUrl: null,
  suspended: false,
};

const mockProfessional = {
  id: PRO_ID,
  userId: PRO_USER_ID,
  trade: 'Plomberie',
  bio: 'Plombier expérimenté',
  averageRating: 4.5,
  reviewCount: 12,
  identityStatus: 'VERIFIED',
  identityRejectionReason: null,
  verifiedByAdmin: true,
  decennale: true,
  accountType: 'INDIVIDUAL',
  subscription: null,
  user: mockProUser,
  _count: { followers: 10 },
  companyMembers: [],
};

// ============ GET /api/professionals ============

describe('GET /api/professionals', () => {
  beforeEach(() => {
    prisma.professional.findMany.mockResolvedValue([mockProfessional]);
  });

  test('200 — retourne la liste publique des professionnels (sans auth)', async () => {
    const res = await request(app).get('/api/professionals');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('id', PRO_ID);
  });

  test('200 — filtre par ville', async () => {
    prisma.professional.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/professionals?city=Lyon');

    expect(res.status).toBe(200);
    expect(prisma.professional.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user: expect.objectContaining({ city: 'Lyon' }) }),
      })
    );
  });

  test('200 — filtre par métier', async () => {
    const res = await request(app).get('/api/professionals?trade=Plomberie');

    expect(res.status).toBe(200);
    expect(prisma.professional.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ trade: 'Plomberie' }),
      })
    );
  });

  test('200 — pagine correctement avec page et limit', async () => {
    await request(app).get('/api/professionals?page=2&limit=10');

    expect(prisma.professional.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  test('200 — plafonne limit à 100', async () => {
    await request(app).get('/api/professionals?limit=500');

    expect(prisma.professional.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });

  test('200 — retourne liste vide si aucun pro', async () => {
    prisma.professional.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/professionals');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('200 — un client peut aussi appeler la liste', async () => {
    const res = await request(app)
      .get('/api/professionals')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.professional.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/api/professionals');

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/professionals/me/status ============

describe('GET /api/professionals/me/status', () => {
  beforeEach(() => {
    prisma.professional.findUnique.mockResolvedValue({
      id: PRO_ID,
      identityStatus: 'VERIFIED',
      identityRejectionReason: null,
      verifiedByAdmin: true,
      decennale: true,
      accountType: 'INDIVIDUAL',
    });
  });

  test('200 — retourne le statut identité du pro', async () => {
    const res = await request(app)
      .get('/api/professionals/me/status')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('identityStatus', 'VERIFIED');
    expect(res.body).toHaveProperty('verifiedByAdmin', true);
  });

  test('401 — sans token', async () => {
    const res = await request(app).get('/api/professionals/me/status');
    expect(res.status).toBe(401);
  });

  test('403 — un client ne peut pas accéder au statut', async () => {
    const res = await request(app)
      .get('/api/professionals/me/status')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(403);
  });

  test('403 — un admin ne peut pas accéder à /me/status', async () => {
    const res = await request(app)
      .get('/api/professionals/me/status')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(403);
  });

  test('404 — profil professionnel introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/professionals/me/status')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.professional.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/professionals/me/status')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/professionals/:id ============

describe('GET /api/professionals/:id', () => {
  beforeEach(() => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.follow.count.mockResolvedValue(10);
  });

  test('200 — retourne le profil public (sans auth)', async () => {
    const res = await request(app).get(`/api/professionals/${PRO_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', PRO_ID);
    expect(res.body).toHaveProperty('followerCount', 10);
    expect(res.body).toHaveProperty('subscription', null);
  });

  test('200 — retourne le followerCount depuis _count.followers (optimized, no N+1)', async () => {
    // Optimized: now uses _count.followers from include, eliminating prisma.follow.count() call
    const res = await request(app).get(`/api/professionals/${PRO_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.followerCount).toBe(10); // from mockProfessional._count.followers
    // Verify follow.count was NOT called (optimization working)
    expect(prisma.follow.count).not.toHaveBeenCalled();
  });

  test('200 — un client peut voir le profil d\'un pro', async () => {
    const res = await request(app)
      .get(`/api/professionals/${PRO_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
  });

  test('404 — professionnel introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/professionals/not-found');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.professional.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get(`/api/professionals/${PRO_ID}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /api/professionals/:id/follow ============

describe('POST /api/professionals/:id/follow', () => {
  beforeEach(() => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.follow.create.mockResolvedValue({ id: 'follow-1' });
    prisma.follow.delete.mockResolvedValue({});
    prisma.notification.create.mockResolvedValue({});
  });

  test('200 — follow (following: true) si pas encore suivi', async () => {
    const res = await request(app)
      .post(`/api/professionals/${PRO_ID}/follow`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.following).toBe(true);
    expect(prisma.follow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { followerId: CLIENT_ID, professionalId: PRO_ID },
      })
    );
  });

  test('200 — unfollow (following: false) si déjà suivi', async () => {
    prisma.follow.findUnique.mockResolvedValue({ id: 'follow-1' });

    const res = await request(app)
      .post(`/api/professionals/${PRO_ID}/follow`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.following).toBe(false);
    expect(prisma.follow.delete).toHaveBeenCalled();
  });

  test('crée une notification lors d\'un follow', async () => {
    await request(app)
      .post(`/api/professionals/${PRO_ID}/follow`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: PRO_USER_ID,
          type: 'NEW_FOLLOWER',
        }),
      })
    );
  });

  test('200 — un pro peut suivre un autre pro', async () => {
    const res = await request(app)
      .post(`/api/professionals/${PRO_ID}/follow`)
      .set('Authorization', `Bearer ${proToken('another-pro')}`);

    expect(res.status).toBe(200);
  });

  test('401 — sans token', async () => {
    const res = await request(app).post(`/api/professionals/${PRO_ID}/follow`);
    expect(res.status).toBe(401);
  });

  test('404 — professionnel introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/professionals/not-found/follow')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.professional.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post(`/api/professionals/${PRO_ID}/follow`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});
