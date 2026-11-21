/**
 * Tests for search-global routes
 * Module: routes/search-global.js
 * Endpoints: GET /, GET /professionals, GET /packages, GET /portfolio, GET /projects, GET /reviews
 * Uses PostgreSQL via SearchModule
 */

const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifié' });
    const jwt = require('jsonwebtoken');
    try { req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); next(); }
    catch { return res.status(401).json({ error: 'Token invalide' }); }
  },
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  },
  optionalAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      try { req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET); } catch {}
    }
    next();
  },
}));

jest.mock('../../middleware/validateInput', () => ({
  handleValidationErrors: (req, res, next) => next(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 10 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt', 'averageRating']),
}));

jest.mock('../../utils/filter-helper', () => ({
  validateFilters: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  applyFilters: jest.fn().mockImplementation((type, where) => where),
}));

jest.mock('../../utils/search-cache', () => ({
  getOrExecute: jest.fn().mockImplementation((type, q, opts, fn) => fn()),
}));

const mockProfessionals = [
  { id: 'pro-1', trade: 'Plomberie', averageRating: 4.5 },
  { id: 'pro-2', trade: 'Électricité', averageRating: 4.2 },
];
const mockProjects = [{ id: 'proj-1', title: 'Plomberie maison' }];
const mockPortfolio = [{ id: 'port-1', title: 'Rénovation salle de bain' }];
const mockPackages = [{ id: 'pkg-1', title: 'Forfait plomberie' }];
const mockReviews = [{ id: 'rev-1', comment: 'Excellent plombier' }];

let mockSearchInstance;

jest.mock('../../modules/search', () => {
  return jest.fn().mockImplementation(() => {
    mockSearchInstance = {
      searchProfessionals: jest.fn().mockResolvedValue(mockProfessionals),
      searchProjects: jest.fn().mockResolvedValue(mockProjects),
      searchPortfolio: jest.fn().mockResolvedValue(mockPortfolio),
      searchPackages: jest.fn().mockResolvedValue(mockPackages),
      searchReviews: jest.fn().mockResolvedValue(mockReviews),
      parseFiltersFromQuery: jest.fn().mockReturnValue({}),
    };
    return mockSearchInstance;
  });
});

jest.mock('../../config/db', () => ({}));

const searchGlobalRouter = require('../../routes/search-global');

const app = express();
app.use(express.json());
app.use('/search/global', searchGlobalRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── Helper reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  if (mockSearchInstance) {
    mockSearchInstance.searchProfessionals.mockResolvedValue(mockProfessionals);
    mockSearchInstance.searchProjects.mockResolvedValue(mockProjects);
    mockSearchInstance.searchPortfolio.mockResolvedValue(mockPortfolio);
    mockSearchInstance.searchPackages.mockResolvedValue(mockPackages);
    mockSearchInstance.searchReviews.mockResolvedValue(mockReviews);
  }
});

// ── GET /search/global ────────────────────────────────────────────────────────

describe('GET /search/global', () => {
  it('retourne 400 si q est absent', async () => {
    const res = await request(app).get('/search/global');
    expect(res.status).toBe(400);
  });

  it('retourne 400 si q est trop court (< 2 chars)', async () => {
    const res = await request(app).get('/search/global?q=a');
    expect(res.status).toBe(400);
  });

  it('retourne 400 si q ne contient que des espaces (< 2 chars utiles)', async () => {
    const res = await request(app).get('/search/global?q= ');
    expect(res.status).toBe(400);
  });

  it('retourne 200 sans auth (optionalAuth)', async () => {
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('plomb');
    expect(res.body.results).toBeDefined();
    expect(res.body.results.professionals).toBeDefined();
    expect(res.body.results.projects).toBeDefined();
    expect(res.body.results.portfolio).toBeDefined();
    expect(res.body.results.packages).toBeDefined();
    expect(res.body.results.reviews).toBeDefined();
  });

  it('retourne 200 avec token CLIENT', async () => {
    const res = await request(app)
      .get('/search/global?q=plomb')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne 200 avec token ADMIN', async () => {
    const res = await request(app)
      .get('/search/global?q=plomb')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  it('token invalide n\'empêche pas l\'accès (optionalAuth)', async () => {
    const res = await request(app)
      .get('/search/global?q=plomb')
      .set('Authorization', 'Bearer token-invalide');
    expect(res.status).toBe(200);
  });

  it('calcule le total agrégé sur tous les types', async () => {
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    // 2 pros + 1 project + 1 portfolio + 1 package + 1 review = 6
    expect(res.body.total).toBe(6);
  });

  it('retourne la pagination dans la réponse', async () => {
    const res = await request(app).get('/search/global?q=plomb&limit=5&offset=10');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(5);
    expect(res.body.pagination.offset).toBe(10);
  });

  it('clamp limit à 50 max', async () => {
    const res = await request(app).get('/search/global?q=plomb&limit=100');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(50);
  });

  it('clamp limit à 1 min avec valeur négative', async () => {
    const res = await request(app).get('/search/global?q=plomb&limit=-1');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(1);
  });

  it('utilise limit=10 par défaut', async () => {
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(10);
  });

  it('utilise offset=0 par défaut', async () => {
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.pagination.offset).toBe(0);
  });

  it('retourne les filtres actifs dans la réponse', async () => {
    const res = await request(app).get('/search/global?q=plomb&city=Dakar');
    expect(res.status).toBe(200);
    expect(res.body.filters).toBeDefined();
  });

  it('supporte le format filters[key]=value', async () => {
    const res = await request(app)
      .get('/search/global')
      .query({ q: 'plomb', 'filters[city]': 'Dakar' });
    expect(res.status).toBe(200);
  });

  it('gère les résultats vides de PostgreSQL', async () => {
    const instance = mockSearchInstance;
    instance.searchProfessionals.mockResolvedValueOnce([]);
    instance.searchProjects.mockResolvedValueOnce([]);
    instance.searchPortfolio.mockResolvedValueOnce([]);
    instance.searchPackages.mockResolvedValueOnce([]);
    instance.searchReviews.mockResolvedValueOnce([]);

    const res = await request(app).get('/search/global?q=introuvable');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('retourne 500 si PostgreSQL échoue', async () => {
    const instance = mockSearchInstance;
    instance.searchProfessionals.mockRejectedValueOnce(new Error('DB unavailable'));

    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(500);
  });

  it('processingTimeMs est 0 (PostgreSQL natif)', async () => {
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.results.professionals.processingTimeMs).toBe(0);
  });
});

// ── GET /search/global/professionals ─────────────────────────────────────────

describe('GET /search/global/professionals', () => {
  it('retourne 200 avec q minimal', async () => {
    const res = await request(app).get('/search/global/professionals?q=ab');
    expect(res.status).toBe(200);
  });

  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/search/global/professionals?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('plomb');
    expect(Array.isArray(res.body.professionals)).toBe(true);
    expect(res.body.professionals).toHaveLength(2);
  });

  it('retourne 200 avec token CLIENT', async () => {
    const res = await request(app)
      .get('/search/global/professionals?q=plomb')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne la pagination dans la réponse', async () => {
    const res = await request(app).get('/search/global/professionals?q=plomb&limit=5&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.limit).toBe(5);
    expect(res.body.pagination.offset).toBe(0);
  });

  it('gère les résultats vides gracieusement', async () => {
    const instance = mockSearchInstance;
    instance.searchProfessionals.mockResolvedValueOnce([]);

    const res = await request(app).get('/search/global/professionals?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.professionals).toEqual([]);
  });

  it('retourne 500 si PostgreSQL échoue', async () => {
    const instance = mockSearchInstance;
    instance.searchProfessionals.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app).get('/search/global/professionals?q=plomb');
    expect(res.status).toBe(500);
  });
});

// ── GET /search/global/packages ───────────────────────────────────────────────

describe('GET /search/global/packages', () => {
  it('retourne 200 avec q valide sans auth', async () => {
    const res = await request(app).get('/search/global/packages?q=forfait');
    expect(res.status).toBe(200);
  });

  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/search/global/packages?q=forfait');
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('forfait');
    expect(Array.isArray(res.body.packages)).toBe(true);
    expect(res.body.packages).toHaveLength(1);
  });

  it('retourne 200 avec token PROFESSIONAL', async () => {
    const res = await request(app)
      .get('/search/global/packages?q=forfait')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne la pagination dans la réponse', async () => {
    const res = await request(app).get('/search/global/packages?q=plomb&limit=20&offset=5');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(20);
    expect(res.body.pagination.offset).toBe(5);
  });

  it('gère les résultats vides gracieusement', async () => {
    const instance = mockSearchInstance;
    instance.searchPackages.mockResolvedValueOnce([]);

    const res = await request(app).get('/search/global/packages?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.packages).toEqual([]);
  });

  it('retourne 500 si PostgreSQL échoue', async () => {
    const instance = mockSearchInstance;
    instance.searchPackages.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app).get('/search/global/packages?q=forfait');
    expect(res.status).toBe(500);
  });
});

// ── GET /search/global/portfolio ──────────────────────────────────────────────

describe('GET /search/global/portfolio', () => {
  it('retourne 200 avec q valide sans auth', async () => {
    const res = await request(app).get('/search/global/portfolio?q=renovation');
    expect(res.status).toBe(200);
  });

  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/search/global/portfolio?q=renovation');
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('renovation');
    expect(Array.isArray(res.body.portfolio)).toBe(true);
    expect(res.body.portfolio).toHaveLength(1);
  });

  it('retourne 200 avec token CLIENT', async () => {
    const res = await request(app)
      .get('/search/global/portfolio?q=renovation')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne la pagination dans la réponse', async () => {
    const res = await request(app).get('/search/global/portfolio?q=salle&limit=5&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.limit).toBe(5);
  });

  it('gère les résultats vides gracieusement', async () => {
    const instance = mockSearchInstance;
    instance.searchPortfolio.mockResolvedValueOnce([]);

    const res = await request(app).get('/search/global/portfolio?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.portfolio).toEqual([]);
  });

  it('retourne 500 si PostgreSQL échoue', async () => {
    const instance = mockSearchInstance;
    instance.searchPortfolio.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app).get('/search/global/portfolio?q=renovation');
    expect(res.status).toBe(500);
  });

  it('retourne processingTimeMs dans la réponse', async () => {
    const res = await request(app).get('/search/global/portfolio?q=renovation');
    expect(res.status).toBe(200);
    expect(res.body.processingTimeMs).toBeDefined();
    expect(typeof res.body.processingTimeMs).toBe('number');
  });
});
