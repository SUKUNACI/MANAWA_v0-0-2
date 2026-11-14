const request = require('supertest');
const express = require('express');
const { adminToken, proToken, clientToken } = require('./helpers');

// ── Mock bulk-operations ────────────────────────────────────────────────────────
jest.mock('../routes/bulk-operations', () => {
  const router = require('express').Router();
  return router;
});

// ── Mock auth ─────────────────────────────────────────────────────────────────────
jest.mock('../middleware/auth', () => ({
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

// ── Mock Prisma ────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    findMany:   jest.fn().mockResolvedValue([]),
    count:      jest.fn().mockResolvedValue(0),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
  professional: {
    findUnique: jest.fn(),
    findMany:   jest.fn().mockResolvedValue([]),
    count:      jest.fn().mockResolvedValue(0),
    update:     jest.fn(),
  },
  $transaction: jest.fn(fn => fn({
    user:         { update: jest.fn(), delete: jest.fn() },
    professional: { update: jest.fn() },
  })),
}));

// ── Mock appConfig ─────────────────────────────────────────────────────────────
jest.mock('../utils/appConfig', () => ({
  getConfig:    jest.fn().mockResolvedValue(null),
  getAllConfig:  jest.fn().mockResolvedValue({}),
  setConfig:    jest.fn().mockResolvedValue({}),
}));

const prisma = require('../config/db');
const appConfig = require('../utils/appConfig');
const adminRoutes = require('../routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ── Fixtures ───────────────────────────────────────────────────────────────────
const ADMIN_ID  = 'admin-1';
const USER_ID   = 'user-pro-1';
const PRO_ID    = 'pro-1';

const mockAdminUser = { id: ADMIN_ID, role: 'ADMIN', email: 'admin@test.com', suspended: false, adminLevel: 'SUPER', adminPermissions: null };
const mockProUser   = { id: USER_ID,  role: 'PROFESSIONAL', email: 'pro@test.com', suspended: false, adminLevel: null, adminPermissions: null };

function useAdmin() {
  prisma.user.findUnique.mockResolvedValue(mockAdminUser);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. AUTHENTIFICATION & AUTORISATION
// ══════════════════════════════════════════════════════════════════════════════

describe('Admin — auth guards', () => {
  test('401 sans token', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
  });

  test('403 avec token CLIENT', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'client-1', role: 'CLIENT', suspended: false });
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${clientToken('client-1')}`);
    expect(res.status).toBe(403);
  });

  test('403 avec token PROFESSIONAL', async () => {
    prisma.user.findUnique.mockResolvedValue(mockProUser);
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${proToken(USER_ID)}`);
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. RESET MOT DE PASSE
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/users/:id/reset-password', () => {
  const mockUser = { id: USER_ID, role: 'PROFESSIONAL', email: 'pro@test.com' };

  beforeEach(() => {
    prisma.user.findUnique.mockImplementation(({ where } = {}) => {
      if (where?.id === ADMIN_ID) return Promise.resolve(mockAdminUser);
      if (where?.id === USER_ID)  return Promise.resolve(mockUser);
      return Promise.resolve(null);
    });
    prisma.user.update.mockResolvedValue(mockUser);
  });

  test('génère un mot de passe temporaire', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('temporaryPassword');
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThan(0);
  });

  test('le mot de passe temporaire est différent à chaque appel', async () => {
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/admin/users/${USER_ID}/reset-password`).set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`),
      request(app).post(`/api/admin/users/${USER_ID}/reset-password`).set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`),
    ]);

    expect(r1.body.temporaryPassword).not.toBe(r2.body.temporaryPassword);
  });

  test('appelle prisma.user.update avec un hash bcrypt', async () => {
    await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ passwordHash: expect.any(String) }) })
    );
    const hash = prisma.user.update.mock.calls[0][0].data.passwordHash;
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  test('retourne 404 si user introuvable', async () => {
    const res = await request(app)
      .post('/api/admin/users/inexistant/reset-password')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PROFESSIONNEL - LIST & GET
// ══════════════════════════════════════════════════════════════════════════════

describe('Admin EXTENDED: Professional Management - List & Get', () => {
  const mockProfessional = {
    id: PRO_ID, userId: USER_ID, trade: 'Maçon', identityStatus: 'PENDING',
    verifiedByAdmin: false, decennaleVerified: false, trialEndsAt: null,
    averageRating: 0, reviewCount: 0, complaintsCount: 0,
    completedMissionsCount: 0, cancelledMissionsCount: 0, accountType: 'INDEPENDENT',
    user: { id: USER_ID, firstName: 'Marie', lastName: 'Martin', email: 'pro@test.com' },
  };

  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
  });

  test('GET /api/admin/professionals/:id - get professional details', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);

    const res = await request(app)
      .get(`/api/admin/professionals/${PRO_ID}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/admin/professionals - list professionals', async () => {
    prisma.professional.findMany.mockResolvedValue([mockProfessional]);

    const res = await request(app)
      .get('/api/admin/professionals')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data || res.body)).toBe(true);
  });
});
