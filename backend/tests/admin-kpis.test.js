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
    findMany:   jest.fn().mockResolvedValue([]),
    count:      jest.fn().mockResolvedValue(0),
  },
  project: {
    count:    jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
  },
  quote: {
    count:    jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
  },
  payment: {
    count:     jest.fn().mockResolvedValue(0),
    findMany:  jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
  },
  subscription: {
    count:    jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
  },
  promoCode: {
    count: jest.fn().mockResolvedValue(0),
  },
  portfolioProject: {
    count: jest.fn().mockResolvedValue(0),
  },
  professional: {
    count: jest.fn().mockResolvedValue(0),
  },
  message: {
    findMany: jest.fn().mockResolvedValue([]),
  },
}));

// ── Mock appConfig ─────────────────────────────────────────────────────────────
jest.mock('../utils/appConfig', () => ({
  getConfig:    jest.fn().mockResolvedValue(null),
  getAllConfig:  jest.fn().mockResolvedValue({}),
  setConfig:    jest.fn().mockResolvedValue({}),
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
const mockAdminUser = { id: ADMIN_ID, role: 'ADMIN', email: 'admin@test.com', suspended: false, adminLevel: 'SUPER', adminPermissions: null };

function useAdmin() {
  prisma.user.findUnique.mockResolvedValue(mockAdminUser);
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD KPIs
// ══════════════════════════════════════════════════════════════════════════════

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
    prisma.user.findMany.mockResolvedValue([]);
    prisma.message.findMany.mockResolvedValue([]);
  });

  test('retourne 200 avec toutes les clés attendues', async () => {
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
  });

  test('agrège correctement users.total et projects.total', async () => {
    prisma.user.count
      .mockResolvedValueOnce(100)  // total
      .mockResolvedValueOnce(30)   // professionals
      .mockResolvedValueOnce(70);  // clients
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
    expect(res.body.projects.total).toBe(10);
    expect(res.body.projects.open).toBe(4);
  });

  test('revenue est 0 quand aggregate retourne null', async () => {
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.payments.revenue).toBe(0);
  });

  test('inclut promos.active et portfolio.total', async () => {
    prisma.promoCode.count.mockResolvedValue(5);
    prisma.portfolioProject.count.mockResolvedValue(12);

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.body.promos.active).toBe(5);
    expect(res.body.portfolio.total).toBe(12);
  });
});
