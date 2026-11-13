/**
 * Tests for search-facets routes
 * Module: routes/search-facets.js
 * Endpoints: GET /facets, POST /facets/combined, GET /facets/locations,
 *            GET /facets/trades, GET /facets/ratings, GET /facets/prices
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

const mockFacets = {
  total: 43,
  locations: [
    { city: 'Dakar', count: 25 },
    { city: 'Abidjan', count: 18 },
  ],
  trades: [
    { trade: 'Plomberie', count: 20 },
    { trade: 'Électricité', count: 23 },
  ],
  ratings: [
    { rating: 5, count: 15 },
    { rating: 4, count: 20 },
    { rating: 3, count: 8 },
  ],
  priceRanges: [
    { range: '0-10000', count: 5 },
    { range: '10000-50000', count: 25 },
    { range: '50000+', count: 13 },
  ],
};

jest.mock('../../utils/aggregation-helper', () => ({
  getFacetedCounts: jest.fn(),
}));

const { getFacetedCounts } = require('../../utils/aggregation-helper');

const searchFacetsRouter = require('../../routes/search-facets');

const app = express();
app.use(express.json());
app.use('/search', searchFacetsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── Helper reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  getFacetedCounts.mockResolvedValue(mockFacets);
});

// ── GET /search/facets ────────────────────────────────────────────────────────

describe('GET /search/facets', () => {
  it('retourne 200 sans auth (optionalAuth)', async () => {
    const res = await request(app).get('/search/facets');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.facets).toBeDefined();
    expect(res.body.data.appliedFilters).toBeDefined();
  });

  it('retourne 200 avec token CLIENT', async () => {
    const res = await request(app)
      .get('/search/facets')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne 200 avec token ADMIN', async () => {
    const res = await request(app)
      .get('/search/facets')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  it('token invalide n\'empêche pas l\'accès (optionalAuth)', async () => {
    const res = await request(app)
      .get('/search/facets')
      .set('Authorization', 'Bearer token-invalide');
    expect(res.status).toBe(200);
  });

  it('retourne 200 avec le paramètre q', async () => {
    const res = await request(app).get('/search/facets?q=plomb');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith(expect.objectContaining({ q: 'plomb' }));
  });

  it('retourne 200 avec filtre city', async () => {
    const res = await request(app).get('/search/facets?city=Dakar');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith(expect.objectContaining({ city: 'Dakar' }));
  });

  it('retourne 200 avec filtre trade', async () => {
    const res = await request(app).get('/search/facets?trade=Plomberie');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith(expect.objectContaining({ trade: 'Plomberie' }));
  });

  it('retourne 200 avec filtres de rating valides', async () => {
    const res = await request(app).get('/search/facets?minRating=2&maxRating=5');
    expect(res.status).toBe(200);
  });

  it('retourne 400 si minRating > maxRating', async () => {
    const res = await request(app).get('/search/facets?minRating=4&maxRating=2');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/minRating must be <= maxRating/i);
  });

  it('retourne 400 si minPrice > maxPrice', async () => {
    const res = await request(app).get('/search/facets?minPrice=50000&maxPrice=1000');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/minPrice must be <= maxPrice/i);
  });

  it('retourne 200 avec tous les filtres combinés', async () => {
    const res = await request(app)
      .get('/search/facets?q=elec&city=Dakar&trade=Électricité&minRating=3&maxRating=5&minPrice=5000&maxPrice=100000');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'elec',
        city: 'Dakar',
        trade: 'Électricité',
        minRating: 3,
        maxRating: 5,
        minPrice: 5000,
        maxPrice: 100000,
      })
    );
  });

  it('retourne les filtres appliqués dans la réponse', async () => {
    const res = await request(app).get('/search/facets?q=test&city=Abidjan');
    expect(res.status).toBe(200);
    expect(res.body.data.appliedFilters.query).toBe('test');
    expect(res.body.data.appliedFilters.city).toBe('Abidjan');
  });

  it('retourne timestamp dans la réponse', async () => {
    const res = await request(app).get('/search/facets');
    expect(res.body.data.timestamp).toBeTruthy();
  });

  it('retourne 500 si getFacetedCounts échoue', async () => {
    getFacetedCounts.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app).get('/search/facets');
    expect(res.status).toBe(500);
  });
});

// ── POST /search/facets/combined ──────────────────────────────────────────────

describe('POST /search/facets/combined', () => {
  it('retourne 200 avec filters valides', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: { city: 'Dakar', trade: 'Plomberie' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.facets).toBeDefined();
    expect(res.body.data.totalResults).toBe(43);
  });

  it('retourne 400 si body est absent', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/filters object required/i);
  });

  it('retourne 400 si filters n\'est pas un objet', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: 'not-an-object' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/filters object required/i);
  });

  it('retourne 400 si filters est null', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: null });
    expect(res.status).toBe(400);
  });

  it('retourne 200 avec filters vide (utilise les défauts)', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: {} });
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith(
      expect.objectContaining({ minRating: 0, maxRating: 5, minPrice: 0, maxPrice: 100000 })
    );
  });

  it('normalise minRating hors plage (clamp entre 0 et 5)', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: { minRating: -1, maxRating: 10 } });
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith(
      expect.objectContaining({ minRating: 0, maxRating: 5 })
    );
  });

  it('normalise minPrice négatif à 0', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: { minPrice: -500 } });
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith(
      expect.objectContaining({ minPrice: 0 })
    );
  });

  it('fonctionne avec q en query param', async () => {
    const res = await request(app)
      .post('/search/facets/combined?q=elec')
      .send({ filters: { city: 'Dakar' } });
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'elec', city: 'Dakar' })
    );
  });

  it('fonctionne sans token (optionalAuth)', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: { trade: 'Plomberie' } });
    expect(res.status).toBe(200);
  });

  it('fonctionne avec token CLIENT', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ filters: { city: 'Abidjan' } });
    expect(res.status).toBe(200);
  });

  it('retourne les filtres appliqués dans la réponse', async () => {
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: { city: 'Dakar', minRating: 3 } });
    expect(res.status).toBe(200);
    expect(res.body.data.appliedFilters.city).toBe('Dakar');
    expect(res.body.data.appliedFilters.ratingRange[0]).toBe(3);
  });

  it('retourne 500 si getFacetedCounts échoue', async () => {
    getFacetedCounts.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app)
      .post('/search/facets/combined')
      .send({ filters: {} });
    expect(res.status).toBe(500);
  });
});

// ── GET /search/facets/locations ──────────────────────────────────────────────

describe('GET /search/facets/locations', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/search/facets/locations');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.locations).toBeDefined();
    expect(res.body.data.total).toBe(43);
  });

  it('fonctionne avec q en query param', async () => {
    const res = await request(app).get('/search/facets/locations?q=plomb');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith({ q: 'plomb' });
  });

  it('utilise q vide par défaut', async () => {
    const res = await request(app).get('/search/facets/locations');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith({ q: '' });
  });

  it('retourne timestamp', async () => {
    const res = await request(app).get('/search/facets/locations');
    expect(res.body.data.timestamp).toBeTruthy();
  });

  it('retourne 500 si getFacetedCounts échoue', async () => {
    getFacetedCounts.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app).get('/search/facets/locations');
    expect(res.status).toBe(500);
  });
});

// ── GET /search/facets/trades ─────────────────────────────────────────────────

describe('GET /search/facets/trades', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/search/facets/trades');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.trades).toBeDefined();
    expect(res.body.data.total).toBe(43);
  });

  it('fonctionne avec q en query param', async () => {
    const res = await request(app).get('/search/facets/trades?q=elec');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith({ q: 'elec' });
  });

  it('fonctionne avec token PROFESSIONAL', async () => {
    const res = await request(app)
      .get('/search/facets/trades')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne 500 si getFacetedCounts échoue', async () => {
    getFacetedCounts.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app).get('/search/facets/trades');
    expect(res.status).toBe(500);
  });
});

// ── GET /search/facets/ratings ────────────────────────────────────────────────

describe('GET /search/facets/ratings', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/search/facets/ratings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ratings).toBeDefined();
    expect(res.body.data.total).toBe(43);
  });

  it('fonctionne avec q en query param', async () => {
    const res = await request(app).get('/search/facets/ratings?q=test');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith({ q: 'test' });
  });

  it('fonctionne avec token CLIENT', async () => {
    const res = await request(app)
      .get('/search/facets/ratings')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne 500 si getFacetedCounts échoue', async () => {
    getFacetedCounts.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app).get('/search/facets/ratings');
    expect(res.status).toBe(500);
  });
});

// ── GET /search/facets/prices ─────────────────────────────────────────────────

describe('GET /search/facets/prices', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/search/facets/prices');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.priceRanges).toBeDefined();
    expect(res.body.data.total).toBe(43);
  });

  it('fonctionne avec q en query param', async () => {
    const res = await request(app).get('/search/facets/prices?q=plomb');
    expect(res.status).toBe(200);
    expect(getFacetedCounts).toHaveBeenCalledWith({ q: 'plomb' });
  });

  it('fonctionne avec token ADMIN', async () => {
    const res = await request(app)
      .get('/search/facets/prices')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne timestamp', async () => {
    const res = await request(app).get('/search/facets/prices');
    expect(res.body.data.timestamp).toBeTruthy();
  });

  it('retourne 500 si getFacetedCounts échoue', async () => {
    getFacetedCounts.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app).get('/search/facets/prices');
    expect(res.status).toBe(500);
  });
});
