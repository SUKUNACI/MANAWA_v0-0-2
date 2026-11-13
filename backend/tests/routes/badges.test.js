/**
 * Tests for badges routes
 * Module: routes/badges.js — GET /:proId (public), POST /compute (PROFESSIONAL only)
 */

const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

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
  optionalAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      try {
        req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      } catch {
        // ignore invalid token for optional auth
      }
    }
    next();
  },
}));

jest.mock('../../middleware/validateInput', () => ({
  handleValidationErrors: (req, res, next) => next(),
}));

jest.mock('express-rate-limit', () => () => (req, res, next) => next());

const mockPrisma = {
  professional: {
    findUnique: jest.fn(),
  },
  professionalBadge: {
    findMany: jest.fn(),
  },
};

jest.mock('../../config/db', () => mockPrisma);

const mockComputeBadges = jest.fn();

jest.mock('../../utils/badges', () => ({
  BADGES: {
    FIRST_PROJECT: { label: 'Premier projet', description: 'Complété son premier projet' },
    TOP_RATED: { label: 'Très bien noté', description: 'Moyenne de 4.5+' },
  },
  computeBadges: mockComputeBadges,
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn(() => ({ skip: 0, take: 20 })),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn(() => []),
}));

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api/badges', require('../../routes/badges'));
});

// ─── GET /:proId ──────────────────────────────────────────────────────────────

describe('GET /:proId', () => {
  it('404 professionnel inexistant', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/badges/nonexistent-pro');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Professionnel introuvable');
  });

  it('200 retourne les badges (sans auth)', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({ id: 'pro-1' });
    mockComputeBadges.mockResolvedValue([]);
    mockPrisma.professionalBadge.findMany.mockResolvedValue([
      { badgeKey: 'FIRST_PROJECT', professionalId: 'pro-1', earnedAt: new Date() },
    ]);

    const res = await request(app).get('/api/badges/pro-1');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].label).toBe('Premier projet');
  });

  it('200 retourne les badges (avec auth client)', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({ id: 'pro-1' });
    mockComputeBadges.mockResolvedValue([]);
    mockPrisma.professionalBadge.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/badges/pro-1')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('200 filtre les badges sans label (badgeKey inconnu)', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({ id: 'pro-1' });
    mockComputeBadges.mockResolvedValue([]);
    mockPrisma.professionalBadge.findMany.mockResolvedValue([
      { badgeKey: 'UNKNOWN_BADGE', professionalId: 'pro-1', earnedAt: new Date() },
    ]);

    const res = await request(app).get('/api/badges/pro-1');

    expect(res.status).toBe(200);
    // badge sans label doit être filtré
    expect(res.body.length).toBe(0);
  });

  it('500 si findUnique échoue', async () => {
    mockPrisma.professional.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/api/badges/pro-1');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('BADGE_FETCH_ERROR');
  });
});

// ─── POST /compute ────────────────────────────────────────────────────────────

describe('POST /compute', () => {
  it('401 sans token', async () => {
    const res = await request(app).post('/api/badges/compute');
    expect(res.status).toBe(401);
  });

  it('403 avec token client', async () => {
    const res = await request(app)
      .post('/api/badges/compute')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('404 profil professionnel introuvable', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/badges/compute')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PRO_PROFILE_NOT_FOUND');
  });

  it('200 recalcul réussi avec nouveaux badges', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({ id: 'pro-1' });
    mockPrisma.professionalBadge.findMany.mockResolvedValue([
      { badgeKey: 'FIRST_PROJECT' },
    ]);
    mockComputeBadges.mockResolvedValue([
      { badgeKey: 'FIRST_PROJECT', earnedAt: new Date() },
      { badgeKey: 'TOP_RATED', earnedAt: new Date() },
    ]);

    const res = await request(app)
      .post('/api/badges/compute')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.badges).toHaveLength(2);
    expect(res.body.newBadges).toHaveLength(1);
    expect(res.body.newBadges[0].badgeKey).toBe('TOP_RATED');
  });

  it('200 recalcul sans nouveaux badges', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({ id: 'pro-1' });
    mockPrisma.professionalBadge.findMany.mockResolvedValue([
      { badgeKey: 'FIRST_PROJECT' },
    ]);
    mockComputeBadges.mockResolvedValue([
      { badgeKey: 'FIRST_PROJECT', earnedAt: new Date() },
    ]);

    const res = await request(app)
      .post('/api/badges/compute')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.newBadges).toHaveLength(0);
  });

  it('500 si computeBadges échoue', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({ id: 'pro-1' });
    mockPrisma.professionalBadge.findMany.mockResolvedValue([]);
    mockComputeBadges.mockRejectedValue(new Error('Compute failed'));

    const res = await request(app)
      .post('/api/badges/compute')
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('BADGE_COMPUTE_ERROR');
  });
});
