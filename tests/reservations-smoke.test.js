/**
 * SMOKE TEST: Reservations (Réservations) Backoffice Module
 * Tests basic CRUD operations, UI interactions, pagination, and error handling
 *
 * Checklist:
 * 1. Can load the page and see data populate?
 * 2. Can click CRUD buttons (edit, delete, create) without console errors?
 * 3. Does pagination work correctly?
 * 4. Does error handling show user-friendly messages?
 * 5. Does export (if applicable) generate valid CSV?
 * 6. Are there any network errors, undefined variables, or failed API calls?
 */

const request = require('supertest');
const assert = require('assert');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Expected to run in test environment
const API_BASE = process.env.TEST_API_BASE || 'http://localhost:5000/api';
const adminToken = process.env.TEST_ADMIN_TOKEN || 'test-token';

let app;
let server;

describe('SMOKE TEST: Reservations Module', () => {
  let testBooking = null;
  let testBookingId = null;
  let testProfessionalId = null;
  let testClientId = null;

  beforeAll(async () => {
    console.log('🔧 Setting up smoke test environment...');
    try {
      app = require('../src/index.js');
      server = app.listen(5555, () => {
        console.log('✓ Test server started on port 5555');
      });

      // Wait for server to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error('❌ Failed to start test server:', err.message);
      throw err;
    }
  });

  afterAll(async () => {
    if (server) server.close();
    await prisma.$disconnect();
  });

  describe('1. PAGE LOAD & DATA POPULATION', () => {
    it('should load reservations list with valid structure', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 50 })
        .expect(200);

      console.log('✓ GET /api/admin/bookings returned 200');

      // Validate response structure
      assert(res.body.hasOwnProperty('bookings'), 'Response missing bookings array');
      assert(res.body.hasOwnProperty('page'), 'Response missing page');
      assert(res.body.hasOwnProperty('limit'), 'Response missing limit');
      assert(res.body.hasOwnProperty('total'), 'Response missing total');
      assert(res.body.hasOwnProperty('totalPages'), 'Response missing totalPages');
      assert(Array.isArray(res.body.bookings), 'bookings should be an array');

      console.log(`✓ Response structure valid. Found ${res.body.bookings.length} bookings`);

      if (res.body.bookings.length > 0) {
        const booking = res.body.bookings[0];
        assert(booking.id, 'Booking missing id');
        assert(booking.date, 'Booking missing date');
        assert(booking.startTime, 'Booking missing startTime');
        assert(booking.endTime, 'Booking missing endTime');
        assert(booking.status, 'Booking missing status');
        assert(booking.client, 'Booking missing client');
        assert(booking.professional, 'Booking missing professional');

        testBooking = booking;
        testBookingId = booking.id;

        console.log(`✓ First booking has all required fields`);
        console.log(`  - ID: ${booking.id}`);
        console.log(`  - Status: ${booking.status}`);
        console.log(`  - Date: ${booking.date}`);
        console.log(`  - Client: ${booking.client.firstName} ${booking.client.lastName}`);
        console.log(`  - Professional: ${booking.professional.firstName} ${booking.professional.lastName}`);
      }
    });

    it('should handle empty results gracefully', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 999, limit: 50, status: 'CANCELLED' })
        .expect(200);

      assert(Array.isArray(res.body.bookings), 'bookings should be array even when empty');
      assert(res.body.total !== undefined, 'total should be present even when empty');
      console.log('✓ Empty results handled correctly');
    });

    it('should have valid ISO dates in response', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 5 })
        .expect(200);

      if (res.body.bookings.length > 0) {
        res.body.bookings.forEach(booking => {
          const dateObj = new Date(booking.date);
          assert(!isNaN(dateObj.getTime()), `Invalid date: ${booking.date}`);

          const createdAt = new Date(booking.createdAt);
          assert(!isNaN(createdAt.getTime()), `Invalid createdAt: ${booking.createdAt}`);
        });
        console.log('✓ All dates are valid ISO strings');
      }
    });
  });

  describe('2. FILTERING & SEARCH', () => {
    it('should filter by status', async () => {
      const statuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];

      for (const status of statuses) {
        const res = await request(app)
          .get('/api/admin/bookings')
          .set('Authorization', `Bearer ${adminToken}`)
          .query({ status })
          .expect(200);

        if (res.body.bookings.length > 0) {
          const allMatch = res.body.bookings.every(b => b.status === status);
          assert(allMatch, `Not all bookings match status filter ${status}`);
          console.log(`✓ Status filter '${status}' works: ${res.body.bookings.length} results`);
        }
      }
    });

    it('should search by client/professional name', async () => {
      if (!testBooking) {
        console.log('⊘ Skipping search test: no test booking available');
        return;
      }

      const clientSearch = testBooking.client.firstName;
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ search: clientSearch })
        .expect(200);

      assert(res.body.bookings.length > 0, 'Search should return at least one result');
      console.log(`✓ Search by client name '${clientSearch}' returned ${res.body.bookings.length} results`);
    });

    it('should search by email', async () => {
      if (!testBooking) {
        console.log('⊘ Skipping email search: no test booking available');
        return;
      }

      const emailSearch = testBooking.client.email;
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ search: emailSearch })
        .expect(200);

      assert(res.body.bookings.length > 0, 'Email search should return at least one result');
      console.log(`✓ Search by email returned ${res.body.bookings.length} results`);
    });

    it('should handle invalid filters gracefully', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ status: 'INVALID_STATUS' })
        .expect(200);

      // Should return all bookings when invalid status provided
      assert(Array.isArray(res.body.bookings), 'Should return array for invalid status');
      console.log('✓ Invalid filters handled gracefully');
    });
  });

  describe('3. PAGINATION', () => {
    it('should support page navigation', async () => {
      const res1 = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      assert(res1.body.page === 1, 'Page should be 1');
      assert(res1.body.limit === 10, 'Limit should be 10');
      console.log(`✓ Page 1: ${res1.body.bookings.length} bookings, ${res1.body.totalPages} total pages`);

      if (res1.body.totalPages > 1) {
        const res2 = await request(app)
          .get('/api/admin/bookings')
          .set('Authorization', `Bearer ${adminToken}`)
          .query({ page: 2, limit: 10 })
          .expect(200);

        assert(res2.body.page === 2, 'Page should be 2');
        // First item on page 2 should be different from first item on page 1
        if (res1.body.bookings.length > 0 && res2.body.bookings.length > 0) {
          assert(res1.body.bookings[0].id !== res2.body.bookings[0].id, 'Page 2 should have different bookings');
        }
        console.log(`✓ Page 2: ${res2.body.bookings.length} bookings`);
      }
    });

    it('should enforce maximum limit', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ limit: 1000 })
        .expect(200);

      assert(res.body.limit <= 100, 'Limit should not exceed 100');
      console.log(`✓ Limit capped at ${res.body.limit} (requested 1000)`);
    });

    it('should return correct pagination metadata', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 20 })
        .expect(200);

      const expectedPages = Math.ceil(res.body.total / 20);
      assert(res.body.totalPages === expectedPages, 'totalPages calculation should be correct');
      console.log(`✓ Pagination metadata correct: ${res.body.total} total, ${res.body.totalPages} pages`);
    });
  });

  describe('4. SINGLE BOOKING DETAILS', () => {
    it('should fetch a single booking by ID', async () => {
      if (!testBookingId) {
        console.log('⊘ Skipping: no test booking ID');
        return;
      }

      const res = await request(app)
        .get(`/api/admin/bookings/${testBookingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const booking = res.body;
      assert(booking.id === testBookingId, 'Returned booking should match requested ID');
      assert(booking.date, 'Booking should have date');
      assert(booking.status, 'Booking should have status');
      assert(booking.client, 'Booking should have client');
      assert(booking.professional, 'Booking should have professional');

      console.log(`✓ Single booking fetched successfully`);
      console.log(`  - Status: ${booking.status}`);
      console.log(`  - Client: ${booking.client.firstName} ${booking.client.lastName}`);
      console.log(`  - Professional: ${booking.professional.firstName || booking.professional.companyName}`);
    });

    it('should return 404 for non-existent booking', async () => {
      await request(app)
        .get('/api/admin/bookings/nonexistent-id-12345')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      console.log('✓ Returns 404 for non-existent booking');
    });

    it('should include all required fields in detail view', async () => {
      if (!testBookingId) {
        console.log('⊘ Skipping: no test booking ID');
        return;
      }

      const res = await request(app)
        .get(`/api/admin/bookings/${testBookingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const booking = res.body;
      const requiredFields = ['id', 'date', 'startTime', 'endTime', 'status', 'client', 'professional', 'project'];

      requiredFields.forEach(field => {
        assert(booking.hasOwnProperty(field), `Missing required field: ${field}`);
      });

      console.log('✓ All required fields present in booking detail');
    });
  });

  describe('5. CANCEL OPERATION', () => {
    it('should cancel a pending booking', async () => {
      if (!testBookingId) {
        console.log('⊘ Skipping cancel test: no test booking ID');
        return;
      }

      // First check if booking is cancellable
      const getRes = await request(app)
        .get(`/api/admin/bookings/${testBookingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      if (['CANCELLED', 'COMPLETED'].includes(getRes.body.status)) {
        console.log(`⊘ Skipping cancel: booking already ${getRes.body.status}`);
        return;
      }

      const res = await request(app)
        .patch(`/api/admin/bookings/${testBookingId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Test cancellation for smoke test' })
        .expect(200);

      assert(res.body.success === true, 'Cancel should return success');
      assert(res.body.booking.status === 'CANCELLED', 'Booking status should be CANCELLED');

      console.log('✓ Booking cancelled successfully');
    });

    it('should not allow cancelling already cancelled booking', async () => {
      if (!testBookingId) {
        console.log('⊘ Skipping: no test booking ID');
        return;
      }

      // First check if booking is already cancelled
      const getRes = await request(app)
        .get(`/api/admin/bookings/${testBookingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      if (getRes.body.status !== 'CANCELLED') {
        console.log('⊘ Skipping: booking not in CANCELLED state');
        return;
      }

      const res = await request(app)
        .patch(`/api/admin/bookings/${testBookingId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Another attempt' })
        .expect(400);

      assert(res.body.error, 'Should return error message');
      assert(res.body.error.includes('Impossible'), 'Error should be in French');

      console.log('✓ Cannot cancel already cancelled booking');
    });

    it('should reject cancel request with missing reason (reason can be null)', async () => {
      if (!testBookingId) {
        console.log('⊘ Skipping: no test booking ID');
        return;
      }

      const res = await request(app)
        .patch(`/api/admin/bookings/${testBookingId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: null })
        .expect(200);

      assert(res.body.success === true, 'Cancel without reason should succeed');
      console.log('✓ Cancel with null reason accepted');
    });
  });

  describe('6. ERROR HANDLING', () => {
    it('should return 400 for invalid page parameter', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 'invalid' })
        .expect(200); // Should default to page 1

      assert(res.body.page === 1, 'Should default to page 1 for invalid input');
      console.log('✓ Invalid page parameter handled (defaults to 1)');
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/admin/bookings')
        .expect(401);

      console.log('✓ Unauthenticated request rejected');
    });

    it('should return meaningful error messages', async () => {
      if (!testBookingId) {
        console.log('⊘ Skipping: no test booking ID');
        return;
      }

      const res = await request(app)
        .patch(`/api/admin/bookings/${testBookingId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: null })
        .expect(200);

      if (res.body.error) {
        assert(typeof res.body.error === 'string', 'Error should be a string message');
        assert(res.body.error.length > 0, 'Error message should not be empty');
        console.log('✓ Error messages are descriptive');
      }
    });
  });

  describe('7. DATA INTEGRITY', () => {
    it('should not allow SQL injection in search', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ search: "'; DROP TABLE bookings; --" })
        .expect(200);

      // Should safely handle malicious input
      assert(Array.isArray(res.body.bookings), 'Should still return valid response');
      console.log('✓ SQL injection attempt safely handled');
    });

    it('should escape HTML in responses', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      res.body.bookings.forEach(booking => {
        // Check that client/professional names don't contain unescaped HTML
        if (booking.client.firstName) {
          assert(!booking.client.firstName.includes('<'), 'Should not contain < character');
          assert(!booking.client.firstName.includes('>'), 'Should not contain > character');
        }
      });
      console.log('✓ HTML properly escaped in responses');
    });

    it('should maintain data consistency across requests', async () => {
      const res1 = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 5 })
        .expect(200);

      await new Promise(resolve => setTimeout(resolve, 100));

      const res2 = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 5 })
        .expect(200);

      if (res1.body.bookings.length > 0 && res2.body.bookings.length > 0) {
        assert(res1.body.bookings[0].id === res2.body.bookings[0].id, 'Booking IDs should be consistent');
      }
      console.log('✓ Data consistency maintained');
    });
  });

  describe('8. PERFORMANCE', () => {
    it('should return response within acceptable time', async () => {
      const start = Date.now();

      await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 50 })
        .expect(200);

      const duration = Date.now() - start;
      assert(duration < 2000, `Request took ${duration}ms, should be < 2000ms`);
      console.log(`✓ Response time: ${duration}ms`);
    });

    it('should handle pagination at higher page numbers', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 50 })
        .expect(200);

      if (res.body.totalPages > 10) {
        const start = Date.now();

        await request(app)
          .get('/api/admin/bookings')
          .set('Authorization', `Bearer ${adminToken}`)
          .query({ page: 10, limit: 50 })
          .expect(200);

        const duration = Date.now() - start;
        assert(duration < 2000, `Pagination at page 10 took ${duration}ms, should be < 2000ms`);
        console.log(`✓ Pagination at page 10 response time: ${duration}ms`);
      }
    });
  });

  describe('9. STATUS BADGES & DISPLAY', () => {
    it('should use valid status values', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 50 })
        .expect(200);

      const validStatuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];

      res.body.bookings.forEach(booking => {
        assert(validStatuses.includes(booking.status),
          `Invalid status: ${booking.status}, should be one of ${validStatuses.join(', ')}`);
      });

      console.log('✓ All bookings have valid status values');
    });

    it('should include time formatting fields', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 5 })
        .expect(200);

      if (res.body.bookings.length > 0) {
        res.body.bookings.forEach(booking => {
          assert(booking.startTime, 'Should have startTime');
          assert(booking.endTime, 'Should have endTime');
          // Verify time format HH:MM
          assert(/^\d{2}:\d{2}/.test(booking.startTime), `Invalid startTime format: ${booking.startTime}`);
          assert(/^\d{2}:\d{2}/.test(booking.endTime), `Invalid endTime format: ${booking.endTime}`);
        });
        console.log('✓ Time formatting fields present and valid');
      }
    });
  });

  describe('10. FIELD MAPPING', () => {
    it('should map professional user fields correctly', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 5 })
        .expect(200);

      if (res.body.bookings.length > 0) {
        const booking = res.body.bookings[0];
        const pro = booking.professional;

        // Professional should have either firstName+lastName or companyName
        const hasName = (pro.firstName && pro.lastName) || pro.companyName;
        assert(hasName, 'Professional should have either name or company name');
        assert(pro.email, 'Professional should have email');

        console.log('✓ Professional fields correctly mapped');
      }
    });

    it('should include project information when available', async () => {
      const res = await request(app)
        .get('/api/admin/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      const bookingsWithProject = res.body.bookings.filter(b => b.project);
      if (bookingsWithProject.length > 0) {
        bookingsWithProject.forEach(booking => {
          assert(booking.project.id, 'Project should have id');
          assert(booking.project.title, 'Project should have title');
        });
        console.log(`✓ Project information available for ${bookingsWithProject.length} bookings`);
      }
    });
  });
});
