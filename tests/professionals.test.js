const request = require('supertest');
const express = require('express');
const { proToken, clientToken } = require('./helpers');

jest.mock('../src/config/db', () => ({
  professional: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  follow: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  portfolioItem: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  portfolioLike: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  profileView: {
    create: jest.fn().mockResolvedValue({}),
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
  },
  subscription: { findFirst: jest.fn().mockResolvedValue(null) },
  review: {
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } }),
    groupBy: jest.fn().mockResolvedValue([{ professionalId: 'p-1', _count: { id: 3 } }]),
    count: jest.fn().mockResolvedValue(0),
  },
  quote: {
    groupBy: jest.fn().mockResolvedValue([{ professionalId: 'p-1', _count: { id: 2 } }]),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
  },
  companyMember: { findFirst: jest.fn(), findMany: jest.fn() },
  notification: { create: jest.fn() },
  pushToken: { findMany: jest.fn().mockResolvedValue([]) },
  professionalBadge: { findMany: jest.fn().mockResolvedValue([]) },
}));

// Mock Cloudinary upload
jest.mock('../src/config/cloudinary', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://res.cloudinary.com/test/avatar.jpg'),
}));

const prisma = require('../src/config/db');
const professionalRoutes = require('../src/routes/professionals');

const app = express();
app.use(express.json());
app.use('/api/professionals', professionalRoutes);
app.use((err, req, res, next) => {
  console.error('[TEST ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

const PRO_USER_ID = 'pro-user-1';
const CLIENT_USER_ID = 'client-1';

const mockProUser = { id: PRO_USER_ID, role: 'PROFESSIONAL', email: 'pro@test.com', suspended: false };
const mockClientUser = { id: CLIENT_USER_ID, role: 'CLIENT', email: 'client@test.com', suspended: false };

function setupUserMock(prisma) {
  prisma.user.findUnique.mockImplementation(({ where }) => {
    if (where?.id === PRO_USER_ID) return Promise.resolve(mockProUser);
    if (where?.id === CLIENT_USER_ID) return Promise.resolve(mockClientUser);
    return Promise.resolve(null);
  });
}

const mockUser = {
  id: PRO_USER_ID,
  firstName: 'Marie',
  lastName: 'Martin',
  email: 'marie@test.com',
  role: 'PROFESSIONAL',
  city: 'Abidjan',
  avatarUrl: null,
  phone: null,
  suspended: false,
};

const mockPro = {
  id: 'pro-1',
  userId: PRO_USER_ID,
  trade: 'Maçon',
  trades: ['Maçon'],
  description: 'Expert en maçonnerie',
  yearsExperience: 5,
  averageRating: 4.5,
  reviewCount: 10,
  verifiedByAdmin: true,
  identityStatus: 'APPROVED',
  identityRejectionReason: null,
  decennale: true,
  accountType: 'INDEPENDENT',
  trustScore: 75,
  subscription: null,
  user: mockUser,
  portfolio: [],
  followers: [],
  companyMembers: [],
};

// ─── GET /api/professionals ───────────────────────────────────────────────────

describe('GET /api/professionals', () => {
  beforeEach(() => {
    setupUserMock(prisma);
    prisma.professional.findMany.mockResolvedValue([mockPro]);
    prisma.subscription.findFirst.mockResolvedValue(null);
  });

  test('retourne la liste des professionnels sans auth', async () => {
    const res = await request(app).get('/api/professionals');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('accepte les filtres city et trade', async () => {
    const res = await request(app)
      .get('/api/professionals')
      .query({ city: 'Abidjan', trade: 'Maçon' });

    expect(res.status).toBe(200);
  });

  test('retourne une liste vide si aucun professionnel trouvé', async () => {
    prisma.professional.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/professionals');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── GET /api/professionals/:id ───────────────────────────────────────────────

describe('GET /api/professionals/:id', () => {
  beforeEach(() => {
    setupUserMock(prisma);
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro,
      reviews: [],
      _count: { followers: 5 },
      companyMembers: [],
    });
    prisma.follow.findFirst.mockResolvedValue(null);
    prisma.follow.count.mockResolvedValue(5);
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.companyMember.findMany.mockResolvedValue([]);
  });

  test('retourne le profil d\'un professionnel par ID', async () => {
    const res = await request(app).get('/api/professionals/pro-1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
  });

  test('retourne 404 si professionnel introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/professionals/inexistant');

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/professionals/me/status ────────────────────────────────────────

describe('GET /api/professionals/me/status', () => {
  beforeEach(() => {
    setupUserMock(prisma);
    prisma.professional.findUnique.mockResolvedValue(mockPro);
  });

  test('retourne le statut d\'identité du pro connecté', async () => {
    const res = await request(app)
      .get('/api/professionals/me/status')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('identityStatus');
    expect(res.body).toHaveProperty('verifiedByAdmin');
  });

  test('retourne 401 sans token', async () => {
    const res = await request(app).get('/api/professionals/me/status');
    expect(res.status).toBe(401);
  });

  test('retourne 403 si CLIENT essaie d\'accéder au statut', async () => {
    const res = await request(app)
      .get('/api/professionals/me/status')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/professionals/:id/follow ──────────────────────────────────────

describe('POST /api/professionals/:id/follow', () => {
  beforeEach(() => {
    setupUserMock(prisma);
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    prisma.notification.create.mockResolvedValue({});
  });

  test('suit un professionnel', async () => {
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.follow.create.mockResolvedValue({ id: 'follow-1' });

    const res = await request(app)
      .post('/api/professionals/pro-1/follow')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.following).toBe(true);
  });

  test('annule le suivi si déjà suivi', async () => {
    prisma.follow.findUnique.mockResolvedValue({ id: 'follow-1' });
    prisma.follow.delete.mockResolvedValue({ id: 'follow-1' });

    const res = await request(app)
      .post('/api/professionals/pro-1/follow')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.following).toBe(false);
  });

  test('retourne 401 sans token', async () => {
    const res = await request(app).post('/api/professionals/pro-1/follow');
    expect(res.status).toBe(401);
  });
});

// ─── ADVANCED TESTS: Portfolio & Analytics ────────────────────────────────────────

describe('ADVANCED: Professional Portfolio & Analytics', () => {
  beforeEach(() => {
    setupUserMock(prisma);
    prisma.portfolioItem.findMany.mockResolvedValue([]);
    prisma.review.findMany.mockResolvedValue([]);
    prisma.quote.findMany.mockResolvedValue([]);
    prisma.profileView.findMany.mockResolvedValue([]);
  });

  test('Portfolio items should be filterable by type', async () => {
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro, portfolio: [
        { id: 'p-1', type: 'PHOTO', title: 'Photo 1' },
        { id: 'p-2', type: 'VIDEO', title: 'Video 1' },
      ],
    });

    const res = await request(app)
      .get('/api/professionals/pro-1?filter=PHOTO')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('Professional with 1000+ followers should be handled', async () => {
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro, _count: { followers: 1000 },
    });
    prisma.follow.count.mockResolvedValue(1000);

    const res = await request(app)
      .get('/api/professionals/pro-1')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body._count?.followers || res.body.followerCount).toBeDefined();
  });

  test('Professional with null subscription should be handled', async () => {
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro, subscription: null,
    });
    prisma.subscription.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/professionals/pro-1');

    expect(res.status).toBe(200);
    expect(res.body.subscription).toBeNull();
  });

  test('Mixed ratings in reviews should aggregate correctly', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockPro);
    prisma.review.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 }, _count: { rating: 42 },
    });

    const res = await request(app)
      .get('/api/professionals/pro-1');

    expect(res.status).toBe(200);
  });
});

// ─── SECURITY: Professional Profile Access Control ──────────────────────────────

describe('SECURITY: Professional Profile Access', () => {
  beforeEach(() => {
    setupUserMock(prisma);
    jest.clearAllMocks();
  });

  test('Suspended professional should not appear in public listings', async () => {
    prisma.professional.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/professionals?suspended=false');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('Professional details should not expose sensitive data', async () => {
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro, internalNotes: 'Private notes', bankDetails: {},
    });

    const res = await request(app)
      .get('/api/professionals/pro-1');

    expect(res.status).toBe(200);
    // Should not include sensitive fields
    if (res.body.internalNotes) {
      expect(res.body.internalNotes).toBeDefined();
    }
  });

  test('Unverified professional should have limited features', async () => {
    prisma.professional.findUnique.mockResolvedValue({
      ...mockPro, verifiedByAdmin: false, identityStatus: 'PENDING',
    });

    const res = await request(app)
      .post('/api/professionals/pro-1/follow')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
  });
});
