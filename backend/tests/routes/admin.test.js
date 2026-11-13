/**
 * Tests unitaires — routes/admin.js
 * Couvre : dashboard, professionals, users, finances, support, messaging
 */

const request = require('supertest');
const express = require('express');
const { adminToken, proToken, clientToken } = require('../helpers');

// ── Mock bulk-operations (sub-router qui requiert Redis) ──────────────────────
jest.mock('../../routes/bulk-operations', () => {
  const router = require('express').Router();
  router.get('/', (req, res) => res.json({ bulkOk: true }));
  return router;
});

// ── Mock Prisma ───────────────────────────────────────────────────────────────
jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    findMany:   jest.fn().mockResolvedValue([]),
    count:      jest.fn().mockResolvedValue(0),
    update:     jest.fn(),
  },
  professional: {
    findUnique: jest.fn(),
    findMany:   jest.fn().mockResolvedValue([]),
    count:      jest.fn().mockResolvedValue(0),
    update:     jest.fn(),
  },
  project: {
    count:    jest.fn().mockResolvedValue(0),
  },
  quote: {
    count:    jest.fn().mockResolvedValue(0),
  },
  payment: {
    count:     jest.fn().mockResolvedValue(0),
    findMany:  jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    update:    jest.fn(),
  },
  subscription: {
    count: jest.fn().mockResolvedValue(0),
  },
  promoCode: {
    count: jest.fn().mockResolvedValue(0),
  },
  portfolioProject: {
    count: jest.fn().mockResolvedValue(0),
  },
  message: {
    findMany:  jest.fn().mockResolvedValue([]),
    count:     jest.fn().mockResolvedValue(0),
    groupBy:   jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    delete:    jest.fn(),
  },
  supportTicket: {
    count:    jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
    groupBy:  jest.fn().mockResolvedValue([]),
    update:   jest.fn(),
  },
}));

// ── Mock appConfig ────────────────────────────────────────────────────────────
jest.mock('../../utils/appConfig', () => ({
  getConfig:   jest.fn().mockResolvedValue(null),
  getAllConfig: jest.fn().mockResolvedValue({}),
}));

// ── Mock middleware/auth ──────────────────────────────────────────────────────
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

const prisma     = require('../../config/db');
const appConfig  = require('../../utils/appConfig');
const adminRoutes = require('../../routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ADMIN_ID  = 'admin-1';
const PRO_ID    = 'pro-1';
const USER_ID   = 'user-pro-1';
const CLIENT_ID = 'client-1';

const mockAdminUser = {
  id: ADMIN_ID, role: 'ADMIN', email: 'admin@test.com',
  suspended: false, adminLevel: 'SUPER',
};

const mockProUser = {
  id: USER_ID, role: 'PROFESSIONAL', email: 'pro@test.com', suspended: false,
};

const mockProfessional = {
  id: PRO_ID, userId: USER_ID, trade: 'Maçon',
  identityStatus: 'PENDING', verifiedByAdmin: false,
  decennaleVerified: false, trialEndsAt: null,
  complaintsCount: 0, suspendedAt: null,
  user: { id: USER_ID, firstName: 'Marie', lastName: 'Martin', email: 'pro@test.com' },
};

function useAdmin() {
  prisma.user.findUnique.mockResolvedValue(mockAdminUser);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. AUTH GUARDS
// ═════════════════════════════════════════════════════════════════════════════

describe('Admin — guards d\'authentification et de rôle', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
  });

  it('retourne 403 avec token CLIENT', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);
    expect(res.status).toBe(403);
  });

  it('retourne 403 avec token PROFESSIONAL', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${proToken(USER_ID)}`);
    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET / — placeholder
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/', () => {
  it('retourne 200 avec le message Admin API', async () => {
    useAdmin();
    const res = await request(app)
      .get('/api/admin/')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Admin API');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. GET /dashboard
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/dashboard', () => {
  beforeEach(() => {
    useAdmin();
    prisma.user.count.mockResolvedValue(42);
    prisma.project.count.mockResolvedValue(10);
    prisma.quote.count.mockResolvedValue(5);
    prisma.payment.count.mockResolvedValue(3);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 150000 } });
    prisma.subscription.count.mockResolvedValue(7);
    prisma.professional.count.mockResolvedValue(2);
    prisma.promoCode.count.mockResolvedValue(1);
    prisma.portfolioProject.count.mockResolvedValue(8);
    prisma.message.findMany.mockResolvedValue([]);
  });

  it('retourne 200 avec toutes les clés KPI', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('projects');
    expect(res.body).toHaveProperty('quotes');
    expect(res.body).toHaveProperty('payments');
    expect(res.body).toHaveProperty('subscriptions');
    expect(res.body).toHaveProperty('promos');
    expect(res.body).toHaveProperty('portfolio');
    expect(res.body).toHaveProperty('pendingVerifications');
    expect(res.body).toHaveProperty('recentMessages');
  });

  it('calcule correctement users.total, professionals et clients', async () => {
    prisma.user.count
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(70);
    prisma.project.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.users.total).toBe(100);
    expect(res.body.users.professionals).toBe(30);
    expect(res.body.users.clients).toBe(70);
    expect(res.body.projects.total).toBe(10); // 4+3+2+1
    expect(res.body.projects.open).toBe(4);
  });

  it('renvoie revenue = 0 quand aggregate retourne amount null', async () => {
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.payments.revenue).toBe(0);
  });

  it('inclut promos.active et portfolio.total', async () => {
    prisma.promoCode.count.mockResolvedValue(5);
    prisma.portfolioProject.count.mockResolvedValue(12);

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.promos.active).toBe(5);
    expect(res.body.portfolio.total).toBe(12);
  });

  it('retourne 500 si une requête DB échoue', async () => {
    prisma.user.count.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. PROFESSIONALS — liste et détail
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/professionals', () => {
  it('retourne 200 avec la liste des professionnels', async () => {
    useAdmin();
    prisma.professional.findMany.mockResolvedValue([mockProfessional]);

    const res = await request(app)
      .get('/api/admin/professionals')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('retourne liste vide si aucun professionnel', async () => {
    useAdmin();
    prisma.professional.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/professionals')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('retourne 500 si DB échoue', async () => {
    useAdmin();
    prisma.professional.findMany.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/admin/professionals')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/admin/professionals/:id', () => {
  it('retourne 200 avec le détail du professionnel', async () => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);

    const res = await request(app)
      .get(`/api/admin/professionals/${PRO_ID}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('professional');
    expect(res.body.professional.id).toBe(PRO_ID);
  });

  it('retourne 404 si professionnel introuvable', async () => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/admin/professionals/inexistant')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  it('retourne 500 si DB échoue', async () => {
    useAdmin();
    prisma.professional.findUnique.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get(`/api/admin/professionals/${PRO_ID}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. PROFESSIONALS — vérification identité
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/professionals/:id/verify', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.professional.update.mockResolvedValue({
      ...mockProfessional,
      identityStatus: 'APPROVED',
      verifiedByAdmin: true,
    });
  });

  it('approuve l\'identité d\'un pro PENDING et retourne 200', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.professional.identityStatus).toBe('APPROVED');
    expect(res.body.professional.verifiedByAdmin).toBe(true);
  });

  it('définit trialEndsAt lorsqu\'il n\'est pas encore fixé', async () => {
    await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const updateCall = prisma.professional.update.mock.calls[0][0];
    expect(updateCall.data.trialEndsAt).toBeDefined();
  });

  it('ne redéfinit pas trialEndsAt s\'il est déjà fixé', async () => {
    prisma.professional.findUnique.mockResolvedValue({
      ...mockProfessional,
      trialEndsAt: new Date('2099-01-01'),
    });

    await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const updateCall = prisma.professional.update.mock.calls[0][0];
    expect(updateCall.data.trialEndsAt).toBeUndefined();
  });

  it('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/professionals/inexistant/verify')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.professional.update.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. PROFESSIONALS — rejet identité
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/professionals/:id/reject', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.professional.update.mockResolvedValue({
      ...mockProfessional,
      identityStatus: 'REJECTED',
      identityRejectionReason: 'Document non conforme',
    });
  });

  it('rejette l\'identité avec le motif par défaut', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/reject`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.professional.identityStatus).toBe('REJECTED');
    const updateCall = prisma.professional.update.mock.calls[0][0];
    expect(updateCall.data.identityRejectionReason).toBe('Document non conforme');
  });

  it('utilise le motif fourni dans le body', async () => {
    await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/reject`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: 'Photo illisible' });

    const updateCall = prisma.professional.update.mock.calls[0][0];
    expect(updateCall.data.identityRejectionReason).toBe('Photo illisible');
  });

  it('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/professionals/inexistant/reject')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.professional.update.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/reject`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. PROFESSIONALS — décennale
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/professionals/:id/verify-decennale', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.professional.update.mockResolvedValue({ ...mockProfessional, decennaleVerified: true });
  });

  it('valide la décennale et retourne 200', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify-decennale`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { decennaleVerified: true } })
    );
  });

  it('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/professionals/inexistant/verify-decennale')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/professionals/:id/revoke-decennale', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue({ ...mockProfessional, decennaleVerified: true });
    prisma.professional.update.mockResolvedValue({ ...mockProfessional, decennaleVerified: false });
  });

  it('révoque la décennale et retourne 200', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/revoke-decennale`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { decennaleVerified: false } })
    );
  });

  it('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/professionals/inexistant/revoke-decennale')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. PROFESSIONALS — suspension / réactivation
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/professionals/:id/suspend', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.professional.update.mockResolvedValue({ ...mockProfessional, suspendedAt: new Date() });
    prisma.user.update.mockResolvedValue({ ...mockProUser, suspended: true });
  });

  it('suspend le professionnel et l\'utilisateur associé', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/suspend`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ suspendedAt: expect.any(Date) }) })
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { suspended: true } })
    );
  });

  it('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/professionals/inexistant/suspend')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.professional.update.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/suspend`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/admin/professionals/:id/reactivate', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue({ ...mockProfessional, suspendedAt: new Date() });
    prisma.professional.update.mockResolvedValue({ ...mockProfessional, suspendedAt: null });
    prisma.user.update.mockResolvedValue({ ...mockProUser, suspended: false });
  });

  it('réactive le professionnel et l\'utilisateur associé', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/reactivate`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { suspendedAt: null } })
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { suspended: false } })
    );
  });

  it('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/professionals/inexistant/reactivate')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. PROFESSIONALS — signalements (complaints)
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/professionals/:id/complaint', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.professional.update.mockResolvedValue({ ...mockProfessional, complaintsCount: 1 });
  });

  it('incrémente le compteur de plaintes et retourne 201', async () => {
    const res = await request(app)
      .post(`/api/admin/professionals/${PRO_ID}/complaint`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { complaintsCount: { increment: 1 } },
      })
    );
  });

  it('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/admin/professionals/inexistant/complaint')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.professional.update.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .post(`/api/admin/professionals/${PRO_ID}/complaint`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/admin/professionals/:id/complaint', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue({ ...mockProfessional, complaintsCount: 1 });
    prisma.professional.update.mockResolvedValue({ ...mockProfessional, complaintsCount: 0 });
  });

  it('décrémente le compteur de plaintes et retourne 200', async () => {
    const res = await request(app)
      .delete(`/api/admin/professionals/${PRO_ID}/complaint`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { complaintsCount: { decrement: 1 } },
      })
    );
  });

  it('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/admin/professionals/inexistant/complaint')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. USERS — reset de mot de passe
// ═════════════════════════════════════════════════════════════════════════════

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

  it('génère et retourne un mot de passe temporaire', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('temporaryPassword');
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThan(0);
  });

  it('génère un mot de passe différent à chaque appel', async () => {
    const r1 = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);
    const r2 = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(r1.body.temporaryPassword).not.toBe(r2.body.temporaryPassword);
  });

  it('stocke un hash bcrypt valide', async () => {
    await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const hash = prisma.user.update.mock.calls[0][0].data.passwordHash;
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it('retourne 404 si utilisateur introuvable', async () => {
    const res = await request(app)
      .post('/api/admin/users/inexistant/reset-password')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.user.findUnique.mockImplementation(({ where } = {}) => {
      if (where?.id === ADMIN_ID) return Promise.resolve(mockAdminUser);
      if (where?.id === USER_ID)  return Promise.reject(new Error('DB crash'));
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/reset-password`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. FINANCES — résumé
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/finances/summary', () => {
  const makePayment = (amount, commissionPaid = false) => ({
    id: `pay-${amount}`,
    amount,
    commissionPaid,
    createdAt: new Date(),
  });

  beforeEach(() => {
    useAdmin();
  });

  it('calcule totalTransactions, totalCommissions et commissions (taux 8% par défaut)', async () => {
    appConfig.getConfig.mockResolvedValue(null);
    prisma.payment.findMany.mockResolvedValue([
      makePayment(100000, false),
      makePayment(50000,  true),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalTransactions).toBe(150000);
    expect(res.body.totalCommissions).toBeCloseTo(12000);
    expect(res.body.commissionsDues).toBeCloseTo(8000);
    expect(res.body.commissionsPercues).toBeCloseTo(4000);
  });

  it('respecte un taux de commission personnalisé (10%)', async () => {
    appConfig.getConfig.mockResolvedValue(0.10);
    prisma.payment.findMany.mockResolvedValue([makePayment(200000, false)]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.commissionRate).toBe(0.10);
    expect(res.body.totalCommissions).toBeCloseTo(20000);
  });

  it('retourne tout à 0 sans paiements', async () => {
    appConfig.getConfig.mockResolvedValue(null);
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalTransactions).toBe(0);
    expect(res.body.totalCommissions).toBe(0);
  });

  it('retourne revenueByMonth avec 12 entrées', async () => {
    appConfig.getConfig.mockResolvedValue(null);
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.revenueByMonth)).toHaveLength(12);
  });

  it('ventile correctement les revenus par mois', async () => {
    appConfig.getConfig.mockResolvedValue(null);
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    prisma.payment.findMany.mockResolvedValue([
      { id: 'p1', amount: 50000, commissionPaid: false, createdAt: now },
    ]);

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.revenueByMonth[thisMonth]).toBe(50000);
  });

  it('retourne 500 si DB échoue', async () => {
    appConfig.getConfig.mockResolvedValue(null);
    prisma.payment.findMany.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/admin/finances/summary')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. FINANCES — commissions par professionnel
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/finances/commissions', () => {
  const makeFullPayment = (proId, amount, commissionPaid = false) => ({
    id: `pay-${proId}-${amount}`,
    amount,
    commissionPaid,
    createdAt: new Date(),
    status: 'succeeded',
    isDeposit: false,
    quote: {
      professional: {
        id: proId,
        trade: 'Maçon',
        user: { id: `user-${proId}`, firstName: 'Pro', lastName: proId, email: `${proId}@test.com` },
      },
      project: { title: 'Projet test', id: 'proj-1' },
    },
  });

  beforeEach(() => {
    useAdmin();
    appConfig.getConfig.mockResolvedValue(null);
  });

  it('retourne 200 avec la liste des professionnels groupés', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makeFullPayment('pro-a', 100000, false),
      makeFullPayment('pro-b', 50000,  true),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('professionals');
    expect(res.body.professionals).toHaveLength(2);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('totalPages');
  });

  it('filtre par status=due (commissionDue > 0)', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makeFullPayment('pro-a', 100000, false),
      makeFullPayment('pro-b', 50000,  true),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions?status=due')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.professionals.every(p => p.commissionDue > 0)).toBe(true);
  });

  it('filtre par status=paid (commissionDue = 0)', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makeFullPayment('pro-a', 100000, false),
      makeFullPayment('pro-b', 50000,  true),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions?status=paid')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.professionals.every(p => p.commissionDue === 0)).toBe(true);
  });

  it('pagine correctement avec page=1&limit=1', async () => {
    prisma.payment.findMany.mockResolvedValue([
      makeFullPayment('pro-a', 100000, false),
      makeFullPayment('pro-b', 50000,  false),
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions?page=1&limit=1')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.professionals).toHaveLength(1);
    expect(res.body.total).toBe(2);
    expect(res.body.totalPages).toBe(2);
  });

  it('ignore les paiements sans quote.professional', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-no-pro', amount: 10000, commissionPaid: false, createdAt: new Date(), quote: null },
    ]);

    const res = await request(app)
      .get('/api/admin/finances/commissions')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.professionals).toHaveLength(0);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.payment.findMany.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/admin/finances/commissions')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. FINANCES — marquer commissions comme payées
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/finances/commissions/:professionalId/mark-paid', () => {
  beforeEach(() => {
    useAdmin();
  });

  it('marque les paiements non payés comme payés', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', commissionPaid: false },
      { id: 'pay-2', commissionPaid: false },
    ]);
    prisma.payment.update.mockResolvedValue({ commissionPaid: true });

    const res = await request(app)
      .patch('/api/admin/finances/commissions/pro-a/mark-paid')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updated).toBe(2);
  });

  it('retourne updated=0 s\'il n\'y a pas de paiements non payés', async () => {
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .patch('/api/admin/finances/commissions/pro-a/mark-paid')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.payment.findMany.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .patch('/api/admin/finances/commissions/pro-a/mark-paid')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. FINANCES — liste paiements et stats
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/finances/payments', () => {
  it('retourne 200 avec la liste des paiements', async () => {
    useAdmin();
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', amount: 50000, status: 'succeeded' },
    ]);

    const res = await request(app)
      .get('/api/admin/finances/payments')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('payments');
    expect(Array.isArray(res.body.payments)).toBe(true);
  });

  it('retourne 500 si DB échoue', async () => {
    useAdmin();
    prisma.payment.findMany.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/admin/finances/payments')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/admin/finances/payments/stats', () => {
  it('retourne totalAmount et totalCount', async () => {
    useAdmin();
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: 300000 },
      _count: { id: 5 },
    });

    const res = await request(app)
      .get('/api/admin/finances/payments/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalAmount).toBe(300000);
    expect(res.body.totalCount).toBe(5);
  });

  it('renvoie 0 si aggregate retourne null', async () => {
    useAdmin();
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: null },
      _count: { id: null },
    });

    const res = await request(app)
      .get('/api/admin/finances/payments/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalAmount).toBe(0);
    expect(res.body.totalCount).toBe(0);
  });

  it('retourne 500 si DB échoue', async () => {
    useAdmin();
    prisma.payment.aggregate.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/admin/finances/payments/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. SUPPORT — statistiques
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/support/stats', () => {
  beforeEach(() => {
    useAdmin();
    prisma.supportTicket.count.mockResolvedValue(10);
    prisma.supportTicket.groupBy.mockResolvedValue([]);
    prisma.supportTicket.findMany.mockResolvedValue([]);
  });

  it('retourne 200 avec les statistiques de tickets', async () => {
    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('open');
    expect(res.body).toHaveProperty('inProgress');
    expect(res.body).toHaveProperty('resolved');
    expect(res.body).toHaveProperty('closed');
    expect(res.body).toHaveProperty('byCategory');
  });

  it('calcule avgResolutionHours à partir des tickets résolus', async () => {
    const now = new Date();
    const before = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 heures avant
    prisma.supportTicket.findMany.mockResolvedValue([
      { createdAt: before, updatedAt: now },
    ]);

    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.avgResolutionHours).toBe(2);
  });

  it('retourne avgResolutionHours null s\'il n\'y a pas de tickets résolus', async () => {
    prisma.supportTicket.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.avgResolutionHours).toBeNull();
  });

  it('ventile byCategory depuis groupBy', async () => {
    prisma.supportTicket.groupBy.mockResolvedValue([
      { category: 'BILLING',   _count: { _all: 3 } },
      { category: 'TECHNICAL', _count: { _all: 7 } },
    ]);

    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.byCategory.BILLING).toBe(3);
    expect(res.body.byCategory.TECHNICAL).toBe(7);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.supportTicket.count.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/admin/support/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. SUPPORT — liste des tickets
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/support/tickets', () => {
  beforeEach(() => {
    useAdmin();
  });

  it('retourne 200 avec la liste des tickets', async () => {
    prisma.supportTicket.findMany.mockResolvedValue([
      { id: 'ticket-1', subject: 'Problème', status: 'OPEN', category: 'BILLING' },
    ]);

    const res = await request(app)
      .get('/api/admin/support/tickets')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tickets');
    expect(res.body.tickets).toHaveLength(1);
  });

  it('filtre par category et status', async () => {
    prisma.supportTicket.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/support/tickets?category=BILLING&status=OPEN')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    const whereArg = prisma.supportTicket.findMany.mock.calls[0][0].where;
    expect(whereArg.category).toBe('BILLING');
    expect(whereArg.status).toBe('OPEN');
  });

  it('ajoute une condition OR pour la recherche textuelle', async () => {
    prisma.supportTicket.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/admin/support/tickets?search=test')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const whereArg = prisma.supportTicket.findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
    expect(whereArg.OR).toHaveLength(2);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.supportTicket.findMany.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/admin/support/tickets')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 17. SUPPORT — priorité et assignation
// ═════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/support/tickets/:id/priority', () => {
  it('met à jour la priorité et retourne 200', async () => {
    useAdmin();
    prisma.supportTicket.update.mockResolvedValue({
      id: 'ticket-1', priority: 'HIGH',
    });

    const res = await request(app)
      .patch('/api/admin/support/tickets/ticket-1/priority')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ priority: 'HIGH' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ticket');
    expect(prisma.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { priority: 'HIGH' } })
    );
  });

  it('retourne 500 si DB échoue', async () => {
    useAdmin();
    prisma.supportTicket.update.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .patch('/api/admin/support/tickets/ticket-1/priority')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ priority: 'LOW' });

    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/admin/support/tickets/:id/assign', () => {
  it('assigne le ticket à un admin et retourne 200', async () => {
    useAdmin();
    prisma.supportTicket.update.mockResolvedValue({
      id: 'ticket-1', assignedToAdminId: ADMIN_ID,
    });

    const res = await request(app)
      .patch('/api/admin/support/tickets/ticket-1/assign')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ assignedToAdminId: ADMIN_ID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ticket');
    expect(prisma.supportTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedToAdminId: ADMIN_ID } })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 18. MESSAGING — statistiques
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/messaging/stats', () => {
  beforeEach(() => {
    useAdmin();
    prisma.message.count.mockResolvedValue(100);
    prisma.message.groupBy.mockResolvedValue([
      { senderId: 'u1', _count: { _all: 50 } },
      { senderId: 'u2', _count: { _all: 30 } },
    ]);
  });

  it('retourne 200 avec total, unread et topSenders', async () => {
    const res = await request(app)
      .get('/api/admin/messaging/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('unread');
    expect(res.body).toHaveProperty('topSenders');
    expect(Array.isArray(res.body.topSenders)).toBe(true);
  });

  it('topSenders contient au plus 5 entrées', async () => {
    prisma.message.groupBy.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        senderId: `u${i}`, _count: { _all: 10 },
      }))
    );

    const res = await request(app)
      .get('/api/admin/messaging/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.topSenders.length).toBeLessThanOrEqual(5);
  });

  it('retourne 500 si DB échoue', async () => {
    prisma.message.count.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .get('/api/admin/messaging/stats')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 19. MESSAGING — suppression de message
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/admin/messaging/messages/:id', () => {
  beforeEach(() => {
    useAdmin();
  });

  it('supprime le message et retourne 200', async () => {
    prisma.message.findUnique.mockResolvedValue({ id: 'msg-1', content: 'Bonjour' });
    prisma.message.delete.mockResolvedValue({ id: 'msg-1' });

    const res = await request(app)
      .delete('/api/admin/messaging/messages/msg-1')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retourne 404 si message introuvable', async () => {
    prisma.message.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/admin/messaging/messages/inexistant')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/introuvable/i);
  });

  it('retourne 500 si DB échoue lors de la suppression', async () => {
    prisma.message.findUnique.mockResolvedValue({ id: 'msg-1' });
    prisma.message.delete.mockRejectedValue(new Error('DB crash'));

    const res = await request(app)
      .delete('/api/admin/messaging/messages/msg-1')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});
