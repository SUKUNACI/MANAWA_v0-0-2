/**
 * Tests for analytics-distribution routes
 * Module: routes/analytics-distribution.js
 * Endpoints: /distribution, /distribution/by-trade, /distribution/by-location,
 *            /distribution/by-status, /price-distribution, /review-distribution,
 *            /quotes-bookings, /health-check
 */

const request = require('supertest');
const express = require('express');
const { adminToken, proToken, clientToken } = require('../helpers');

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

const mockDistributionStats = {
  byTrade: [
    { trade: 'Plomberie', count: '25' },
    { trade: 'Électricité', count: '18' },
  ],
  byLocation: [
    { location: 'Dakar', count: '30' },
    { location: 'Abidjan', count: '13' },
  ],
  byVerification: [
    { status: 'VERIFIED', count: '20' },
    { status: 'PENDING', count: '23' },
  ],
  bySubscription: [
    { tier: 'PRO', count: '15' },
    { tier: 'FREE', count: '28' },
  ],
};

const mockPriceStats = {
  summary: {
    total_professionals: '43',
    professionals_with_rate: '30',
    min_price: '5000',
    max_price: '150000',
    mean_price: '45000',
    median_price: '40000',
    percentile_25: '20000',
    percentile_75: '60000',
    percentile_90: '90000',
    percentile_95: '120000',
    std_dev: '25000',
  },
  distribution: [
    { price_range: '0-10000', count: '5', avg_in_range: '8000' },
    { price_range: '10000-50000', count: '20', avg_in_range: '30000' },
  ],
};

const mockReviewStats = {
  ratingDistribution: [
    { rating: '5', count: '50', percentage: '45.50' },
    { rating: '4', count: '30', percentage: '27.30' },
  ],
  ratingByTrade: [
    { trade: 'Plomberie', total_reviews: '20', avg_rating: '4.2', min_rating: '2', max_rating: '5', median_rating: '4.5' },
  ],
  topRated: [
    { id: 'pro-1', user_id: 'u-1', trade: 'Plomberie', rating: '4.9', review_count: '15', first_name: 'Jean', last_name: 'Dupont', city: 'Dakar' },
  ],
};

const mockQuoteBookingStats = {
  quotes: [
    { status: 'PENDING', count: '10', avg_amount: '50000', min_amount: '10000', max_amount: '150000' },
    { status: 'ACCEPTED', count: '5', avg_amount: '75000', min_amount: '25000', max_amount: '200000' },
  ],
  bookings: [
    { status: 'CONFIRMED', count: '4' },
    { status: 'COMPLETED', count: '3' },
  ],
  conversion: {
    total_quotes: '15',
    total_bookings: '7',
    conversion_rate: '46.67',
  },
};

jest.mock('../../utils/aggregation-helper', () => ({
  getDistributionStats: jest.fn(),
  getPriceDistributionStats: jest.fn(),
  getReviewDistributionStats: jest.fn(),
  getQuoteBookingStats: jest.fn(),
}));

const {
  getDistributionStats,
  getPriceDistributionStats,
  getReviewDistributionStats,
  getQuoteBookingStats,
} = require('../../utils/aggregation-helper');

const analyticsDistributionRouter = require('../../routes/analytics-distribution');

const app = express();
app.use(express.json());
app.use('/analytics', analyticsDistributionRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── Helper reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  getDistributionStats.mockResolvedValue(mockDistributionStats);
  getPriceDistributionStats.mockResolvedValue(mockPriceStats);
  getReviewDistributionStats.mockResolvedValue(mockReviewStats);
  getQuoteBookingStats.mockResolvedValue(mockQuoteBookingStats);
});

// ── GET /analytics/distribution ───────────────────────────────────────────────

describe('GET /analytics/distribution', () => {
  it('retourne 200 sans auth (optionalAuth)', async () => {
    const res = await request(app).get('/analytics/distribution');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.distribution).toBeDefined();
    expect(res.body.data.distribution.byTrade).toHaveLength(2);
    expect(res.body.data.distribution.byLocation).toHaveLength(2);
  });

  it('retourne 200 avec token CLIENT', async () => {
    const res = await request(app)
      .get('/analytics/distribution')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retourne 200 avec token ADMIN', async () => {
    const res = await request(app)
      .get('/analytics/distribution')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.appliedFilters).toBeDefined();
  });

  it('retourne 200 avec startDate et endDate valides', async () => {
    const res = await request(app)
      .get('/analytics/distribution?startDate=2026-01-01T00:00:00Z&endDate=2026-12-31T23:59:59Z');
    expect(res.status).toBe(200);
    expect(res.body.data.appliedFilters.startDate).toBeTruthy();
    expect(res.body.data.appliedFilters.endDate).toBeTruthy();
  });

  it('retourne 400 si startDate >= endDate', async () => {
    const res = await request(app)
      .get('/analytics/distribution?startDate=2026-12-31T00:00:00Z&endDate=2026-01-01T00:00:00Z');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/startDate must be before endDate/i);
  });

  it('retourne 400 si les deux dates sont égales', async () => {
    const res = await request(app)
      .get('/analytics/distribution?startDate=2026-06-01T00:00:00Z&endDate=2026-06-01T00:00:00Z');
    expect(res.status).toBe(400);
  });

  it('retourne 500 si getDistributionStats échoue', async () => {
    getDistributionStats.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/analytics/distribution');
    expect(res.status).toBe(500);
  });

  it('retourne timestamp dans la réponse', async () => {
    const res = await request(app).get('/analytics/distribution');
    expect(res.body.data.timestamp).toBeTruthy();
  });
});

// ── GET /analytics/distribution/by-trade ─────────────────────────────────────

describe('GET /analytics/distribution/by-trade', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/analytics/distribution/by-trade');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.byTrade)).toBe(true);
  });

  it('retourne le total calculé correctement', async () => {
    const res = await request(app).get('/analytics/distribution/by-trade');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(43); // 25 + 18
  });

  it('cast les counts en Number', async () => {
    const res = await request(app).get('/analytics/distribution/by-trade');
    expect(res.status).toBe(200);
    res.body.data.byTrade.forEach(item => {
      expect(typeof item.count).toBe('number');
    });
  });

  it('fonctionne avec token PROFESSIONAL', async () => {
    const res = await request(app)
      .get('/analytics/distribution/by-trade')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne 500 si getDistributionStats échoue', async () => {
    getDistributionStats.mockRejectedValueOnce(new Error('Aggregation failure'));
    const res = await request(app).get('/analytics/distribution/by-trade');
    expect(res.status).toBe(500);
  });
});

// ── GET /analytics/distribution/by-location ──────────────────────────────────

describe('GET /analytics/distribution/by-location', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/analytics/distribution/by-location');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.byLocation)).toBe(true);
  });

  it('retourne le total calculé correctement', async () => {
    const res = await request(app).get('/analytics/distribution/by-location');
    expect(res.body.data.total).toBe(43); // 30 + 13
  });

  it('cast les counts en Number', async () => {
    const res = await request(app).get('/analytics/distribution/by-location');
    res.body.data.byLocation.forEach(item => {
      expect(typeof item.count).toBe('number');
    });
  });

  it('retourne 500 si getDistributionStats échoue', async () => {
    getDistributionStats.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app).get('/analytics/distribution/by-location');
    expect(res.status).toBe(500);
  });
});

// ── GET /analytics/distribution/by-status ────────────────────────────────────

describe('GET /analytics/distribution/by-status', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/analytics/distribution/by-status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.byStatus)).toBe(true);
  });

  it('retourne le total calculé correctement', async () => {
    const res = await request(app).get('/analytics/distribution/by-status');
    expect(res.body.data.total).toBe(43); // 20 + 23
  });

  it('contient les statuts de vérification', async () => {
    const res = await request(app).get('/analytics/distribution/by-status');
    const statuses = res.body.data.byStatus.map(i => i.status);
    expect(statuses).toContain('VERIFIED');
  });

  it('retourne 500 si getDistributionStats échoue', async () => {
    getDistributionStats.mockRejectedValueOnce(new Error('DB crash'));
    const res = await request(app).get('/analytics/distribution/by-status');
    expect(res.status).toBe(500);
  });
});

// ── GET /analytics/price-distribution ────────────────────────────────────────

describe('GET /analytics/price-distribution', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/analytics/price-distribution');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary).toBeDefined();
    expect(res.body.data.distribution).toBeDefined();
  });

  it('cast correctement les valeurs numériques du summary', async () => {
    const res = await request(app).get('/analytics/price-distribution');
    const { summary } = res.body.data;
    expect(typeof summary.totalProfessionals).toBe('number');
    expect(typeof summary.minPrice).toBe('number');
    expect(typeof summary.maxPrice).toBe('number');
    expect(typeof summary.medianPrice).toBe('number');
  });

  it('retourne null pour les valeurs manquantes du summary', async () => {
    getPriceDistributionStats.mockResolvedValueOnce({
      ...mockPriceStats,
      summary: {
        ...mockPriceStats.summary,
        min_price: null,
        max_price: null,
        mean_price: null,
        median_price: null,
        percentile_25: null,
        percentile_75: null,
        percentile_90: null,
        percentile_95: null,
        std_dev: null,
      },
    });
    const res = await request(app).get('/analytics/price-distribution');
    expect(res.status).toBe(200);
    const { summary } = res.body.data;
    expect(summary.minPrice).toBeNull();
    expect(summary.maxPrice).toBeNull();
  });

  it('calcule le pourcentage de distribution', async () => {
    const res = await request(app).get('/analytics/price-distribution');
    expect(res.status).toBe(200);
    res.body.data.distribution.forEach(bucket => {
      expect(bucket.percentage).toBeDefined();
    });
  });

  it('retourne 500 si getPriceDistributionStats échoue', async () => {
    getPriceDistributionStats.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/analytics/price-distribution');
    expect(res.status).toBe(500);
  });
});

// ── GET /analytics/review-distribution ───────────────────────────────────────

describe('GET /analytics/review-distribution', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/analytics/review-distribution');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.ratingDistribution)).toBe(true);
    expect(Array.isArray(res.body.data.ratingByTrade)).toBe(true);
    expect(Array.isArray(res.body.data.topRated)).toBe(true);
  });

  it('cast les ratings en number', async () => {
    const res = await request(app).get('/analytics/review-distribution');
    res.body.data.ratingDistribution.forEach(item => {
      expect(typeof item.rating).toBe('number');
      expect(typeof item.count).toBe('number');
    });
  });

  it('contient les informations des professionnels top rated', async () => {
    const res = await request(app).get('/analytics/review-distribution');
    const [top] = res.body.data.topRated;
    expect(top.name).toBe('Jean Dupont');
    expect(top.city).toBe('Dakar');
    expect(top.trade).toBe('Plomberie');
  });

  it('fonctionne avec token ADMIN', async () => {
    const res = await request(app)
      .get('/analytics/review-distribution')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  it('retourne null pour avgRating manquant dans ratingByTrade', async () => {
    getReviewDistributionStats.mockResolvedValueOnce({
      ...mockReviewStats,
      ratingByTrade: [
        { trade: 'Plomberie', total_reviews: '5', avg_rating: null, min_rating: '3', max_rating: '5', median_rating: null },
      ],
    });
    const res = await request(app).get('/analytics/review-distribution');
    expect(res.status).toBe(200);
    expect(res.body.data.ratingByTrade[0].avgRating).toBeNull();
  });

  it('retourne 500 si getReviewDistributionStats échoue', async () => {
    getReviewDistributionStats.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/analytics/review-distribution');
    expect(res.status).toBe(500);
  });
});

// ── GET /analytics/quotes-bookings ───────────────────────────────────────────

describe('GET /analytics/quotes-bookings', () => {
  it('retourne 200 sans auth', async () => {
    const res = await request(app).get('/analytics/quotes-bookings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.quotes)).toBe(true);
    expect(Array.isArray(res.body.data.bookings)).toBe(true);
    expect(res.body.data.conversion).toBeDefined();
  });

  it('cast les montants en float', async () => {
    const res = await request(app).get('/analytics/quotes-bookings');
    const [firstQuote] = res.body.data.quotes;
    expect(typeof firstQuote.avgAmount).toBe('number');
    expect(typeof firstQuote.minAmount).toBe('number');
    expect(typeof firstQuote.maxAmount).toBe('number');
  });

  it('retourne null pour les montants manquants', async () => {
    getQuoteBookingStats.mockResolvedValueOnce({
      ...mockQuoteBookingStats,
      quotes: [
        { status: 'PENDING', count: '5', avg_amount: null, min_amount: null, max_amount: null },
      ],
    });
    const res = await request(app).get('/analytics/quotes-bookings');
    expect(res.status).toBe(200);
    expect(res.body.data.quotes[0].avgAmount).toBeNull();
  });

  it('calcule le taux de conversion', async () => {
    const res = await request(app).get('/analytics/quotes-bookings');
    expect(res.body.data.conversion.conversionRate).toBe(46.67);
    expect(res.body.data.conversion.totalQuotes).toBe(15);
    expect(res.body.data.conversion.totalBookings).toBe(7);
  });

  it('retourne conversionRate = 0 si valeur NaN', async () => {
    getQuoteBookingStats.mockResolvedValueOnce({
      ...mockQuoteBookingStats,
      conversion: { total_quotes: '0', total_bookings: '0', conversion_rate: 'NaN' },
    });
    const res = await request(app).get('/analytics/quotes-bookings');
    expect(res.status).toBe(200);
    expect(res.body.data.conversion.conversionRate).toBe(0);
  });

  it('retourne 500 si getQuoteBookingStats échoue', async () => {
    getQuoteBookingStats.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/analytics/quotes-bookings');
    expect(res.status).toBe(500);
  });
});

// ── GET /analytics/health-check ──────────────────────────────────────────────

describe('GET /analytics/health-check', () => {
  it('retourne 401 sans auth', async () => {
    const res = await request(app).get('/analytics/health-check');
    expect(res.status).toBe(401);
  });

  it('retourne 403 pour un CLIENT', async () => {
    const res = await request(app)
      .get('/analytics/health-check')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 403 pour un PROFESSIONAL', async () => {
    const res = await request(app)
      .get('/analytics/health-check')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 200 pour un ADMIN avec statut healthy', async () => {
    const res = await request(app)
      .get('/analytics/health-check')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.aggregationQueries).toBeDefined();
    expect(res.body.data.duration).toMatch(/ms$/);
  });

  it('retourne les counts de chaque agrégation', async () => {
    const res = await request(app)
      .get('/analytics/health-check')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    const { aggregationQueries } = res.body.data;
    expect(aggregationQueries.distribution.trades).toBe(2);
    expect(aggregationQueries.distribution.locations).toBe(2);
    expect(aggregationQueries.priceDistribution.bucketsCount).toBe(2);
    expect(aggregationQueries.reviewDistribution.topRatedCount).toBe(1);
    expect(aggregationQueries.quotesBookings.quoteStatuses).toBe(2);
  });

  it('retourne 500 avec statut unhealthy si une agrégation échoue', async () => {
    getDistributionStats.mockRejectedValueOnce(new Error('Aggregation failed'));
    const res = await request(app)
      .get('/analytics/health-check')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.success).toBe(false);
  });
});
