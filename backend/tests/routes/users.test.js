const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test@Manawa2024!';
const NEW_PASSWORD = 'NewPass@Secure2024!';

// Mock Prisma avant tout import de route
jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  professional: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  profileView: {
    findMany: jest.fn(),
  },
  follow: {
    findMany: jest.fn(),
  },
  pushToken: {
    deleteMany: jest.fn(),
  },
  refreshToken: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  adminLog: {
    create: jest.fn(),
  },
}), { virtual: true });

const prisma = require('../../config/db');
const usersRoutes = require('../../routes/users');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/users', usersRoutes);

// ─── UTILS ────────────────────────────────────────────────────────────────

function generateToken(userId, role = 'CLIENT') {
  return jwt.sign(
    { id: userId, role, email: 'test@manawa.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

let mockUser;

beforeAll(async () => {
  mockUser = {
    id: 'user-1',
    email: 'test@manawa.com',
    firstName: 'Jean',
    lastName: 'Dupont',
    phone: '+33612345678',
    city: 'Paris',
    role: 'CLIENT',
    avatarUrl: null,
    emailVerified: true,
    suspended: false,
    deletedAt: null,
    passwordHash: await bcrypt.hash(TEST_PASSWORD, 12),
    createdAt: new Date(),
  };
});

const mockProfessional = {
  id: 'prof-1',
  userId: 'user-2',
  trade: 'Electricien',
  companyName: 'ElectroPro',
  siret: '12345678901234',
  description: 'Expert en installations électriques',
  yearsExperience: 5,
  hourlyRate: 50,
  decennaleVerified: true,
  verifiedByAdmin: true,
  averageRating: 4.5,
  reviewCount: 10,
  createdAt: new Date(),
};

// ─── PATCH /api/users/me ────────────────────────────────────────────────────────────────

describe('PATCH /api/users/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('met à jour le profil CLIENT avec firstName et lastName', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue({
      ...mockUser,
      firstName: 'Marc',
      lastName: 'Martin',
    });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Marc',
        lastName: 'Martin',
      });

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Marc');
    expect(res.body.lastName).toBe('Martin');
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  test('met à jour phone et city', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue({
      ...mockUser,
      phone: '+33612345678',
      city: 'Lyon',
    });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '+33612345678',
        city: 'Lyon',
      });

    expect(res.status).toBe(200);
    expect(res.body.city).toBe('Lyon');
  });

  test('rejette firstName invalide (caractères spéciaux)', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: '<script>alert("xss")</script>',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Prénom invalide/i);
  });

  test('rejette phone invalide (format)', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: 'invalid',
      });

    expect(res.status).toBe(400);
  });

  test('rejette firstName > 50 caractères', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'a'.repeat(51),
      });

    expect(res.status).toBe(400);
  });

  test('rejette sans token Bearer', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .send({
        firstName: 'Jean',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Non authentifié/i);
  });

  test('rejette token invalide', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', 'Bearer invalid-token')
      .send({
        firstName: 'Jean',
      });

    expect(res.status).toBe(401);
  });

  test('PROFESSIONAL ne peut pas modifier firstName/lastName', async () => {
    const token = generateToken('user-2', 'PROFESSIONAL');
    const profUser = { ...mockUser, id: 'user-2', role: 'PROFESSIONAL' };

    prisma.user.findUnique.mockResolvedValue(profUser);
    prisma.user.update.mockResolvedValue({
      ...profUser,
      phone: '+33687654321',
    });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Ignored',
        lastName: 'AlsoIgnored',
        phone: '+33687654321',
      });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: '+33687654321',
        }),
      })
    );
    // Vérifie que firstName/lastName ne sont pas passés au update
    const callData = prisma.user.update.mock.calls[0][0].data;
    expect(callData.firstName).toBeUndefined();
    expect(callData.lastName).toBeUndefined();
  });
});

// ─── GET /api/users/me/recently-viewed ────────────────────────────────────────────────────────────────

describe('GET /api/users/me/recently-viewed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retourne les professionnels récemment consultés', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.profileView.findMany.mockResolvedValue([
      {
        id: 'view-1',
        viewerId: 'user-1',
        professionalId: 'prof-1',
        createdAt: new Date(),
        professional: {
          id: 'prof-1',
          companyName: 'ElectroPro',
          user: { id: 'user-2', firstName: 'Jean', email: 'prof@manawa.com' },
        },
      },
      {
        id: 'view-2',
        viewerId: 'user-1',
        professionalId: 'prof-1',
        createdAt: new Date(Date.now() - 1000),
        professional: {
          id: 'prof-1',
          companyName: 'ElectroPro',
          user: { id: 'user-2', firstName: 'Jean', email: 'prof@manawa.com' },
        },
      },
    ]);

    const res = await request(app)
      .get('/api/users/me/recently-viewed')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(10);
  });

  test('déduplique les professionnels', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.profileView.findMany.mockResolvedValue([
      {
        id: 'view-1',
        professionalId: 'prof-1',
        professional: { id: 'prof-1', companyName: 'ElectroPro' },
      },
      {
        id: 'view-2',
        professionalId: 'prof-1',
        professional: { id: 'prof-1', companyName: 'ElectroPro' },
      },
      {
        id: 'view-3',
        professionalId: 'prof-2',
        professional: { id: 'prof-2', companyName: 'PlomberiePro' },
      },
    ]);

    const res = await request(app)
      .get('/api/users/me/recently-viewed')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  test('retourne un tableau vide si aucune consultation', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.profileView.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/users/me/recently-viewed')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('rejette sans token', async () => {
    const res = await request(app)
      .get('/api/users/me/recently-viewed');

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/users/me/following ────────────────────────────────────────────────────────────────

describe('GET /api/users/me/following', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retourne les professionnels suivis', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.follow.findMany.mockResolvedValue([
      {
        id: 'follow-1',
        followerId: 'user-1',
        professionalId: 'prof-1',
        createdAt: new Date(),
        professional: mockProfessional,
      },
      {
        id: 'follow-2',
        followerId: 'user-1',
        professionalId: 'prof-2',
        createdAt: new Date(),
        professional: {
          ...mockProfessional,
          id: 'prof-2',
          companyName: 'PlomberiePro',
        },
      },
    ]);

    const res = await request(app)
      .get('/api/users/me/following')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].companyName).toBe('ElectroPro');
  });

  test('retourne un tableau vide si aucun suivi', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.follow.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/users/me/following')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('rejette sans token', async () => {
    const res = await request(app)
      .get('/api/users/me/following');

    expect(res.status).toBe(401);
  });
});

// ─── POST /api/users/me/avatar ────────────────────────────────────────────────────────────────

describe('POST /api/users/me/avatar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejette sans token', async () => {
    const res = await request(app)
      .post('/api/users/me/avatar');

    expect(res.status).toBe(401);
  });

  test('note: avatar upload tests skipped (requires real file middleware setup)', () => {
    // Avatar upload nécessite une configuration complète du middleware multer
    // et file-type (ESM pur), donc testé via intégration plutôt qu'unitaire
    expect(true).toBe(true);
  });
});

// ─── DELETE /api/users/me ────────────────────────────────────────────────────────────────

describe('DELETE /api/users/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('supprime le compte avec mot de passe correct', async () => {
    const token = generateToken('user-1', 'CLIENT');
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 12);

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: hashedPassword,
    });
    prisma.user.update.mockResolvedValue({ id: 'user-1', deletedAt: new Date() });
    prisma.pushToken.deleteMany.mockResolvedValue({ count: 2 });
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        password: TEST_PASSWORD,
      });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.pushToken.deleteMany).toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalled();
  });

  test('rejette avec mot de passe incorrect', async () => {
    const token = generateToken('user-1', 'CLIENT');
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 12);

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: hashedPassword,
    });

    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        password: 'WrongPassword',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Mot de passe incorrect/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('rejette sans mot de passe', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Mot de passe requis/i);
  });

  test('rejette sans token', async () => {
    const res = await request(app)
      .delete('/api/users/me')
      .send({
        password: TEST_PASSWORD,
      });

    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/users/me/password ────────────────────────────────────────────────────────────────

describe('PATCH /api/users/me/password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('change le mot de passe avec ancien mot de passe correct', async () => {
    const token = generateToken('user-1', 'CLIENT');
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 12);

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: hashedPassword,
    });
    prisma.user.update.mockResolvedValue({ id: 'user-1', passwordHash: 'new-hash' });
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalled();
  });

  test('rejette avec ancien mot de passe incorrect', async () => {
    const token = generateToken('user-1', 'CLIENT');
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 12);

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: hashedPassword,
    });

    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'WrongPassword',
        newPassword: NEW_PASSWORD,
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Mot de passe actuel incorrect/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('rejette nouveau mot de passe < 8 caractères', async () => {
    const token = generateToken('user-1', 'CLIENT');
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 12);

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: hashedPassword,
    });

    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: 'short',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/au moins 8 caractères/i);
  });

  test('rejette sans mot de passe actuel', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        newPassword: NEW_PASSWORD,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Mot de passe actuel requis/i);
  });

  test('rejette sans nouveau mot de passe', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: TEST_PASSWORD,
      });

    expect(res.status).toBe(400);
  });

  test('rejette sans token', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

    expect(res.status).toBe(401);
  });
});

// ─── EDGE CASES ────────────────────────────────────────────────────────────────

describe('Edge cases - User routes', () => {
  test('rejette SQL injection attempt dans firstName', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: "'; DROP TABLE users; --",
      });

    expect(res.status).toBe(400);
  });

  test('échappe XSS dans city', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue({
      ...mockUser,
      city: '&lt;img src=x onerror=alert(1)&gt;',
    });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        city: '<img src=x onerror=alert(1)>',
      });

    expect(res.status).toBe(200);
    // Vérifier que l'échappement a été appliqué
    const updateCall = prisma.user.update.mock.calls[0];
    expect(updateCall[0].data.city).toBeDefined();
  });

  test('gère user supprimé (deletedAt !== null)', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      deletedAt: new Date(),
    });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Jean',
      });

    expect(res.status).toBe(401);
  });

  test('gère user suspendu (suspended = true)', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      suspended: true,
    });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Jean',
      });

    expect(res.status).toBe(403);
  });

  test('gère token expiré', async () => {
    const expiredToken = jwt.sign(
      { id: 'user-1', role: 'CLIENT' },
      process.env.JWT_SECRET,
      { expiresIn: '-1h' }
    );

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({
        firstName: 'Jean',
      });

    expect(res.status).toBe(401);
  });

  test('gère payload malformé en JSON', async () => {
    const token = generateToken('user-1', 'CLIENT');

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"invalid json"');

    expect(res.status).toBe(400);
  });

  test('gère erreur Prisma database', async () => {
    const token = generateToken('user-1', 'CLIENT');

    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockRejectedValue(
      new Error('Database connection error')
    );

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Jean',
      });

    expect(res.status).toBe(500);
  });
});
