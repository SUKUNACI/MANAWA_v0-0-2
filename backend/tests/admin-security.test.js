const request = require('supertest');
const express = require('express');
const { adminToken } = require('./helpers');

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
    update: jest.fn(),
  },
  professional: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(fn => fn({
    professional: { update: jest.fn() },
  })),
}));

// ── Mock appConfig ─────────────────────────────────────────────────────────────
jest.mock('../utils/appConfig', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
}));

// ── Mock trustScore ────────────────────────────────────────────────────────────
jest.mock('../utils/trustScore', () => ({
  computeTrustScore:      jest.fn().mockReturnValue(75),
  getTrustScoreBreakdown: jest.fn().mockReturnValue({ total: 75, bonus: [], penalties: [] }),
}));

const prisma = require('../config/db');
const adminRoutes = require('../routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ── Fixtures ───────────────────────────────────────────────────────────────────
const ADMIN_ID  = 'admin-1';
const PRO_ID    = 'pro-1';
const USER_ID   = 'user-pro-1';

const mockAdminUser = { id: ADMIN_ID, role: 'ADMIN', email: 'admin@test.com', suspended: false, adminLevel: 'SUPER', adminPermissions: null };
const mockProfessional = {
  id: PRO_ID, userId: USER_ID, trade: 'Maçon', identityStatus: 'PENDING',
  verifiedByAdmin: false, decennaleVerified: false, trialEndsAt: null,
  averageRating: 0, reviewCount: 0, complaintsCount: 0,
  completedMissionsCount: 0, cancelledMissionsCount: 0, accountType: 'INDEPENDENT',
  user: { id: USER_ID, firstName: 'Marie', lastName: 'Martin', email: 'pro@test.com' },
};

function useAdmin() {
  prisma.user.findUnique.mockResolvedValue(mockAdminUser);
}

// ══════════════════════════════════════════════════════════════════════════════
// IDENTITY VERIFICATION & DECENNALE
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/professionals/:id/verify', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.professional.update.mockResolvedValue({
      ...mockProfessional, identityStatus: 'APPROVED', verifiedByAdmin: true,
    });
  });

  test('approuve l\'identité d\'un pro PENDING', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.professional.identityStatus).toBe('APPROVED');
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ identityStatus: 'APPROVED', verifiedByAdmin: true }) })
    );
  });

  test('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/professionals/inexistant/verify')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });

  test('définit trialEndsAt si pas encore défini', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    const updateCall = prisma.professional.update.mock.calls[0][0];
    expect(updateCall.data.trialEndsAt).toBeDefined();
  });

  test('ne redéfinit pas trialEndsAt si déjà fixé', async () => {
    prisma.professional.findUnique.mockResolvedValue({
      ...mockProfessional, trialEndsAt: new Date('2099-01-01'),
    });

    await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    const updateCall = prisma.professional.update.mock.calls[0][0];
    expect(updateCall.data.trialEndsAt).toBeUndefined();
  });
});

describe('PATCH /api/admin/professionals/:id/reject', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.professional.update.mockResolvedValue({
      ...mockProfessional,
      identityStatus: 'REJECTED',
      identityRejectionReason: 'Document flou',
      user: { id: USER_ID, firstName: 'Marie', lastName: 'Martin', email: 'pro@test.com' },
    });
  });

  test('rejette l\'identité avec motif', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/reject`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.professional.identityStatus).toBe('REJECTED');
  });

  test('utilise le motif par défaut si reason absent', async () => {
    await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/reject`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({});

    const updateCall = prisma.professional.update.mock.calls[0][0];
    expect(updateCall.data.identityRejectionReason).toBe('Document non conforme');
  });

  test('utilise le motif fourni', async () => {
    await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/reject`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: 'Photo illisible' });

    const updateCall = prisma.professional.update.mock.calls[0][0];
    expect(updateCall.data.identityRejectionReason).toBe('Photo illisible');
  });

  test('retourne 404 si pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/professionals/inexistant/reject')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/professionals/:id/verify-decennale', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.professional.update.mockResolvedValue({ ...mockProfessional, decennaleVerified: true });
  });

  test('valide la décennale', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/verify-decennale`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { decennaleVerified: true } })
    );
  });

  test('retourne 404 si pro introuvable', async () => {
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

  test('révoque la décennale', async () => {
    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/revoke-decennale`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { decennaleVerified: false } })
    );
  });
});

describe('Admin EXTENDED: Professional Management - Suspend & Reactivate', () => {
  beforeEach(() => {
    useAdmin();
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
  });

  test('PATCH /api/admin/professionals/:id/suspend - suspend professional', async () => {
    prisma.professional.update.mockResolvedValue(mockProfessional);
    prisma.user.update.mockResolvedValue({ suspended: true });

    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/suspend`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ suspended: true, reason: 'Violation of terms' });

    expect(res.status).toBe(200);
  });

  test('PATCH /api/admin/professionals/:id/reactivate - reactivate professional', async () => {
    prisma.professional.update.mockResolvedValue({
      ...mockProfessional, suspendedAt: null,
    });
    prisma.user.update.mockResolvedValue({ suspended: false });

    const res = await request(app)
      .patch(`/api/admin/professionals/${PRO_ID}/reactivate`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: 'Account appeal approved' });

    expect(res.status).toBe(200);
  });

  test('POST /api/admin/professionals/:id/complaint - file complaint', async () => {
    prisma.professional.update.mockResolvedValue(mockProfessional);

    const res = await request(app)
      .post(`/api/admin/professionals/${PRO_ID}/complaint`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: 'Quality issue', description: 'Poor work quality' });

    expect(res.status).toBe(201);
  });

  test('DELETE /api/admin/professionals/:id/complaint - remove complaint', async () => {
    prisma.professional.update.mockResolvedValue(mockProfessional);

    const res = await request(app)
      .delete(`/api/admin/professionals/${PRO_ID}/complaint`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: 'Complaint withdrawn' });

    expect(res.status).toBe(200);
  });
});
