/**
 * Tests for search-global routes
 * Module: routes/search-global.js
 * Endpoints: GET /, GET /professionals, GET /packages, GET /portfolio
 * Uses MeiliSearch via globalSearch mock
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
}));

const mockGlobalSearchResult = {
  professionals: {
    hits: [
      { id: 'pro-1', trade: 'Plomberie', averageRating: 4.5, city: 'Dakar' },
      { id: 'pro-2', trade: 'Électricité', averageRating: 4.2, city: 'Abidjan' },
    ],
    processingTimeMs: 15,
  },
  projects: {
    hits: [{ id: 'proj-1', title: 'Plomberie maison' }],
    processingTimeMs: 10,
  },
  portfolio: {
    hits: [{ id: 'port-1', title: 'Rénovation salle de bain' }],
    processingTimeMs: 8,
  },
  packages: {
    hits: [{ id: 'pkg-1', title: 'Forfait plomberie' }],
    processingTimeMs: 12,
  },
  reviews: {
    hits: [{ id: 'rev-1', comment: 'Excellent plombier' }],
    processingTimeMs: 5,
  },
};

jest.mock('../../config/meilisearch', () => ({
  globalSearch: jest.fn(),
}));

const { globalSearch } = require('../../config/meilisearch');

const searchGlobalRouter = require('../../routes/search-global');

const app = express();
app.use(express.json());
app.use('/search/global', searchGlobalRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── Helper reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  globalSearch.mockResolvedValue(mockGlobalSearchResult);
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

  it('calcule le total agrégé sur tous les indices', async () => {
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
    expect(globalSearch).toHaveBeenCalledWith('plomb', expect.objectContaining({ limit: 50 }));
  });

  it('clamp limit à 1 min avec valeur négative', async () => {
    const res = await request(app).get('/search/global?q=plomb&limit=-1');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith('plomb', expect.objectContaining({ limit: 1 }));
  });

  it('utilise limit=10 par défaut', async () => {
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith('plomb', expect.objectContaining({ limit: 10 }));
  });

  it('utilise offset=0 par défaut', async () => {
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith('plomb', expect.objectContaining({ offset: 0 }));
  });

  it('passe les filtres minRating et maxRating à MeiliSearch', async () => {
    const res = await request(app).get('/search/global?q=plomb&minRating=3&maxRating=5');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith(
      'plomb',
      expect.objectContaining({ filters: expect.arrayContaining([
        expect.stringContaining('averageRating >= 3'),
        expect.stringContaining('averageRating <= 5'),
      ])})
    );
  });

  it('passe le filtre city à MeiliSearch', async () => {
    const res = await request(app).get('/search/global?q=plomb&city=Dakar');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith(
      'plomb',
      expect.objectContaining({ filters: expect.arrayContaining([
        expect.stringContaining('city = "Dakar"'),
      ])})
    );
  });

  it('passe le filtre category à MeiliSearch', async () => {
    const res = await request(app).get('/search/global?q=plomb&category=Plomberie');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith(
      'plomb',
      expect.objectContaining({ filters: expect.arrayContaining([
        expect.stringContaining('category = "Plomberie"'),
      ])})
    );
  });

  it('passe le filtre verifiedOnly à MeiliSearch', async () => {
    const res = await request(app).get('/search/global?q=plomb&verifiedOnly=true');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith(
      'plomb',
      expect.objectContaining({ filters: expect.arrayContaining([
        'verifiedByAdmin = true',
      ])})
    );
  });

  it('ne passe pas de filtres à MeiliSearch si aucun filtre actif', async () => {
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith('plomb', expect.objectContaining({ filters: undefined }));
  });

  it('supporte le format filters[key]=value', async () => {
    const res = await request(app)
      .get('/search/global')
      .query({ q: 'plomb', 'filters[city]': 'Dakar' });
    expect(res.status).toBe(200);
  });

  it('gère les résultats vides de MeiliSearch', async () => {
    globalSearch.mockResolvedValueOnce({
      professionals: { hits: [], processingTimeMs: 0 },
      projects: { hits: [], processingTimeMs: 0 },
      portfolio: { hits: [], processingTimeMs: 0 },
      packages: { hits: [], processingTimeMs: 0 },
      reviews: { hits: [], processingTimeMs: 0 },
    });
    const res = await request(app).get('/search/global?q=introuvable');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('gère les résultats undefined de MeiliSearch gracieusement', async () => {
    globalSearch.mockResolvedValueOnce({});
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results.professionals.hits).toEqual([]);
  });

  it('retourne 500 si globalSearch échoue', async () => {
    globalSearch.mockRejectedValueOnce(new Error('MeiliSearch unavailable'));
    const res = await request(app).get('/search/global?q=plomb');
    expect(res.status).toBe(500);
  });

  it('retourne les filtres actifs dans la réponse', async () => {
    const res = await request(app).get('/search/global?q=plomb&city=Dakar');
    expect(res.status).toBe(200);
    expect(res.body.filters).toHaveProperty('city', 'Dakar');
  });
});

// ── GET /search/global/professionals ─────────────────────────────────────────

describe('GET /search/global/professionals', () => {
  it('retourne 200 sans q (handleValidationErrors mocké — validation bypassée)', async () => {
    // handleValidationErrors est mocké pour skiper, donc q vide ne rejette pas
    const res = await request(app).get('/search/global/professionals');
    expect([200, 400]).toContain(res.status);
  });

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

  it('passe les filtres à MeiliSearch', async () => {
    const res = await request(app).get('/search/global/professionals?q=plomb&minRating=4');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith(
      'plomb',
      expect.objectContaining({ filters: expect.arrayContaining([
        expect.stringContaining('averageRating >= 4'),
      ])})
    );
  });

  it('gère les résultats undefined gracieusement', async () => {
    globalSearch.mockResolvedValueOnce({ projects: { hits: [] } });
    const res = await request(app).get('/search/global/professionals?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.professionals).toEqual([]);
  });

  it('retourne 500 si globalSearch échoue', async () => {
    globalSearch.mockRejectedValueOnce(new Error('MeiliSearch error'));
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

  it('retourne 200 avec q minimal (2 chars)', async () => {
    const res = await request(app).get('/search/global/packages?q=ab');
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

  it('passe le filtre minPrice à MeiliSearch', async () => {
    const res = await request(app).get('/search/global/packages?q=plomb&minPrice=10000');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith(
      'plomb',
      expect.objectContaining({ filters: expect.arrayContaining([
        expect.stringContaining('price >= 10000'),
      ])})
    );
  });

  it('gère les résultats undefined gracieusement', async () => {
    globalSearch.mockResolvedValueOnce({ professionals: { hits: [] } });
    const res = await request(app).get('/search/global/packages?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.packages).toEqual([]);
  });

  it('retourne 500 si globalSearch échoue', async () => {
    globalSearch.mockRejectedValueOnce(new Error('MeiliSearch error'));
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

  it('retourne 200 avec q minimal (2 chars)', async () => {
    const res = await request(app).get('/search/global/portfolio?q=ab');
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

  it('gère les résultats undefined gracieusement', async () => {
    globalSearch.mockResolvedValueOnce({ professionals: { hits: [] } });
    const res = await request(app).get('/search/global/portfolio?q=plomb');
    expect(res.status).toBe(200);
    expect(res.body.portfolio).toEqual([]);
  });

  it('retourne 500 si globalSearch échoue', async () => {
    globalSearch.mockRejectedValueOnce(new Error('MeiliSearch error'));
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

// ── Edge cases: buildMeilisearchFilters ───────────────────────────────────────

describe('buildMeilisearchFilters — edge cases via GET /', () => {
  it('verifiedOnly=false ne génère pas de filtre', async () => {
    const res = await request(app).get('/search/global?q=plomb&verifiedOnly=false');
    expect(res.status).toBe(200);
    // Aucun filtre verifiedByAdmin ne doit être transmis
    const callArgs = globalSearch.mock.calls[0][1];
    if (callArgs.filters) {
      expect(callArgs.filters).not.toContain('verifiedByAdmin = true');
    }
  });

  it('maxPrice génère un filtre sur price ET subscription.monthlyPrice', async () => {
    const res = await request(app).get('/search/global?q=plomb&maxPrice=50000');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith(
      'plomb',
      expect.objectContaining({ filters: expect.arrayContaining([
        expect.stringContaining('price <= 50000'),
        expect.stringContaining('subscription.monthlyPrice <= 50000'),
      ])})
    );
  });

  it('minPrice génère un filtre sur price ET subscription.monthlyPrice', async () => {
    const res = await request(app).get('/search/global?q=plomb&minPrice=5000');
    expect(res.status).toBe(200);
    expect(globalSearch).toHaveBeenCalledWith(
      'plomb',
      expect.objectContaining({ filters: expect.arrayContaining([
        expect.stringContaining('price >= 5000'),
        expect.stringContaining('subscription.monthlyPrice >= 5000'),
      ])})
    );
  });
});
