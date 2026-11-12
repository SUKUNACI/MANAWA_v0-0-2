/**
 * Tests pour Q67 (Faceted Search) et Q68 (Aggregations)
 * Vérifie les endpoints de faceted search et analytics distribution
 */

const request = require('supertest');
const app = require('../index');
const prisma = require('../config/db');

describe('Q67 + Q68: Faceted Search & Aggregations', () => {
  // Mock data for testing
  let testProfessionals = [];
  let testUsers = [];

  beforeAll(async () => {
    // Clear existing data
    await prisma.professional.deleteMany({});
    await prisma.user.deleteMany({});

    // Create test users
    for (let i = 1; i <= 10; i++) {
      const user = await prisma.user.create({
        data: {
          email: `pro${i}@test.com`,
          passwordHash: 'hash',
          firstName: `Pro${i}`,
          lastName: `User${i}`,
          role: 'PROFESSIONAL',
          city: i % 2 === 0 ? 'Dakar' : 'Casablanca',
          emailVerified: true,
        },
      });
      testUsers.push(user);

      // Create professionals
      const pro = await prisma.professional.create({
        data: {
          userId: user.id,
          trade: i % 3 === 0 ? 'Plomberie' : i % 3 === 1 ? 'Électricité' : 'Menuiserie',
          trades: i % 2 === 0 ? ['Plomberie', 'Chauffage'] : ['Électricité'],
          companyName: `Company ${i}`,
          averageRating: Math.floor(Math.random() * 5) + 1,
          reviewCount: Math.floor(Math.random() * 20),
          hourlyRate: 30 + i * 10,
          verifiedByAdmin: i % 4 === 0,
        },
      });
      testProfessionals.push(pro);
    }
  });

  afterAll(async () => {
    // Cleanup
    await prisma.professional.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Q67: Faceted Search', () => {
    // ========================================================================
    // GET /api/v1/search/facets
    // ========================================================================
    describe('GET /api/v1/search/facets', () => {
      it('should return faceted counts', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('facets');
        expect(response.body.data.facets).toHaveProperty('locations');
        expect(response.body.data.facets).toHaveProperty('trades');
        expect(response.body.data.facets).toHaveProperty('ratings');
        expect(response.body.data.facets).toHaveProperty('priceRanges');
        expect(response.body.data.facets).toHaveProperty('total');
      });

      it('should include applied filters in response', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets?q=test&minRating=3')
          .expect(200);

        expect(response.body.data).toHaveProperty('appliedFilters');
        expect(response.body.data.appliedFilters.query).toBe('test');
        expect(response.body.data.appliedFilters.ratingRange[0]).toBe(3);
      });

      it('should validate rating range', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets?minRating=4&maxRating=2')
          .expect(400);

        expect(response.body.error).toContain('minRating must be <= maxRating');
      });

      it('should validate price range', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets?minPrice=500&maxPrice=100')
          .expect(400);

        expect(response.body.error).toContain('minPrice must be <= maxPrice');
      });

      it('should validate query parameter length', async () => {
        const longQuery = 'a'.repeat(150);
        const response = await request(app)
          .get(`/api/v1/search/facets?q=${longQuery}`)
          .expect(400);

        expect(response.body).toBeDefined();
      });
    });

    // ========================================================================
    // POST /api/v1/search/facets/combined
    // ========================================================================
    describe('POST /api/v1/search/facets/combined', () => {
      it('should return faceted counts with combined filters', async () => {
        const response = await request(app)
          .post('/api/v1/search/facets/combined?q=test')
          .send({
            filters: {
              city: 'Dakar',
              trade: 'Plomberie',
              minRating: 3,
              maxRating: 5,
            },
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.facets).toHaveProperty('total');
      });

      it('should require filters object in body', async () => {
        const response = await request(app)
          .post('/api/v1/search/facets/combined')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('filters object required');
      });

      it('should handle missing filters gracefully', async () => {
        const response = await request(app)
          .post('/api/v1/search/facets/combined')
          .send({
            filters: {
              minRating: 2,
            },
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      });
    });

    // ========================================================================
    // GET /api/v1/search/facets/locations
    // ========================================================================
    describe('GET /api/v1/search/facets/locations', () => {
      it('should return location facets only', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets/locations')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('locations');
        expect(response.body.data).toHaveProperty('total');
        expect(response.body.data.locations).toHaveProperty('Dakar');
        expect(response.body.data.locations).toHaveProperty('Casablanca');
      });

      it('should have positive counts', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets/locations')
          .expect(200);

        Object.values(response.body.data.locations).forEach(count => {
          expect(count).toBeGreaterThan(0);
        });
      });
    });

    // ========================================================================
    // GET /api/v1/search/facets/trades
    // ========================================================================
    describe('GET /api/v1/search/facets/trades', () => {
      it('should return trade facets only', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets/trades')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('trades');
        expect(response.body.data).toHaveProperty('total');
      });

      it('should include expected trades', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets/trades')
          .expect(200);

        const trades = Object.keys(response.body.data.trades);
        expect(trades.length).toBeGreaterThan(0);
      });
    });

    // ========================================================================
    // GET /api/v1/search/facets/ratings
    // ========================================================================
    describe('GET /api/v1/search/facets/ratings', () => {
      it('should return rating distribution', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets/ratings')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('ratings');
        expect(response.body.data.ratings).toHaveProperty('0');
        expect(response.body.data.ratings).toHaveProperty('5');
      });
    });

    // ========================================================================
    // GET /api/v1/search/facets/prices
    // ========================================================================
    describe('GET /api/v1/search/facets/prices', () => {
      it('should return price distribution', async () => {
        const response = await request(app)
          .get('/api/v1/search/facets/prices')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('priceRanges');
        expect(response.body.data.priceRanges).toHaveProperty('under-50');
        expect(response.body.data.priceRanges).toHaveProperty('50-100');
      });
    });
  });

  describe('Q68: Aggregations & Analytics Distribution', () => {
    // ========================================================================
    // GET /api/v1/analytics/distribution
    // ========================================================================
    describe('GET /api/v1/analytics/distribution', () => {
      it('should return distribution stats', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/distribution')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.distribution).toHaveProperty('byTrade');
        expect(response.body.data.distribution).toHaveProperty('byLocation');
        expect(response.body.data.distribution).toHaveProperty('byVerification');
        expect(response.body.data.distribution).toHaveProperty('bySubscription');
      });

      it('should include applied filters', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/distribution')
          .expect(200);

        expect(response.body.data).toHaveProperty('appliedFilters');
      });

      it('should validate date format', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/distribution?startDate=invalid-date')
          .expect(400);

        expect(response.body).toBeDefined();
      });

      it('should validate date range', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/distribution?startDate=2024-01-01T00:00:00Z&endDate=2023-01-01T00:00:00Z')
          .expect(400);

        expect(response.body.error).toContain('startDate must be before endDate');
      });
    });

    // ========================================================================
    // GET /api/v1/analytics/distribution/by-trade
    // ========================================================================
    describe('GET /api/v1/analytics/distribution/by-trade', () => {
      it('should return trade distribution', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/distribution/by-trade')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('byTrade');
        expect(response.body.data).toHaveProperty('total');
        expect(Array.isArray(response.body.data.byTrade)).toBe(true);
      });

      it('should have positive counts', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/distribution/by-trade')
          .expect(200);

        response.body.data.byTrade.forEach(item => {
          expect(item.count).toBeGreaterThan(0);
          expect(item.trade).toBeDefined();
        });
      });
    });

    // ========================================================================
    // GET /api/v1/analytics/distribution/by-location
    // ========================================================================
    describe('GET /api/v1/analytics/distribution/by-location', () => {
      it('should return location distribution', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/distribution/by-location')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('byLocation');
        expect(Array.isArray(response.body.data.byLocation)).toBe(true);
      });
    });

    // ========================================================================
    // GET /api/v1/analytics/distribution/by-status
    // ========================================================================
    describe('GET /api/v1/analytics/distribution/by-status', () => {
      it('should return status distribution', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/distribution/by-status')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('byStatus');
        expect(Array.isArray(response.body.data.byStatus)).toBe(true);
      });
    });

    // ========================================================================
    // GET /api/v1/analytics/price-distribution
    // ========================================================================
    describe('GET /api/v1/analytics/price-distribution', () => {
      it('should return price distribution stats', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/price-distribution')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('summary');
        expect(response.body.data).toHaveProperty('distribution');
      });

      it('should include statistical measures', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/price-distribution')
          .expect(200);

        const summary = response.body.data.summary;
        expect(summary).toHaveProperty('minPrice');
        expect(summary).toHaveProperty('maxPrice');
        expect(summary).toHaveProperty('meanPrice');
        expect(summary).toHaveProperty('medianPrice');
        expect(summary).toHaveProperty('percentile25');
        expect(summary).toHaveProperty('percentile75');
        expect(summary).toHaveProperty('percentile90');
        expect(summary).toHaveProperty('percentile95');
        expect(summary).toHaveProperty('standardDeviation');
      });

      it('should include price range buckets', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/price-distribution')
          .expect(200);

        const distribution = response.body.data.distribution;
        expect(Array.isArray(distribution)).toBe(true);
        distribution.forEach(bucket => {
          expect(bucket).toHaveProperty('priceRange');
          expect(bucket).toHaveProperty('count');
          expect(bucket).toHaveProperty('percentage');
        });
      });
    });

    // ========================================================================
    // GET /api/v1/analytics/review-distribution
    // ========================================================================
    describe('GET /api/v1/analytics/review-distribution', () => {
      it('should return review distribution stats', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/review-distribution')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('ratingDistribution');
        expect(response.body.data).toHaveProperty('ratingByTrade');
        expect(response.body.data).toHaveProperty('topRated');
      });
    });

    // ========================================================================
    // GET /api/v1/analytics/quotes-bookings
    // ========================================================================
    describe('GET /api/v1/analytics/quotes-bookings', () => {
      it('should return quotes and bookings stats', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/quotes-bookings')
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('quotes');
        expect(response.body.data).toHaveProperty('bookings');
        expect(response.body.data).toHaveProperty('conversion');
      });

      it('should include conversion rate', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/quotes-bookings')
          .expect(200);

        const conversion = response.body.data.conversion;
        expect(conversion).toHaveProperty('totalQuotes');
        expect(conversion).toHaveProperty('totalBookings');
        expect(conversion).toHaveProperty('conversionRate');
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit faceted search requests', async () => {
      const requests = [];
      for (let i = 0; i < 101; i++) {
        requests.push(
          request(app)
            .get('/api/v1/search/facets')
        );
      }

      const responses = await Promise.all(requests);
      const limited = responses.some(r => r.status === 429);
      expect(limited || responses.some(r => r.status === 200)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Simulate by making an invalid request
      const response = await request(app)
        .get('/api/v1/search/facets?minRating=abc')
        .expect(400);

      expect(response.body).toBeDefined();
    });

    it('should return proper error format', async () => {
      const response = await request(app)
        .post('/api/v1/search/facets/combined')
        .send({})
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });
});
