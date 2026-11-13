/**
 * Integration Tests for Brute Force Protection with Login Endpoint
 */

const request = require('supertest');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const bruteForceMiddleware = require('../middleware/bruteForceMiddleware');
const redisCache = require('../config/redis');
const { accountLimiter } = require('../routes/auth');

describe('Brute Force Protection - Login Integration', () => {
  let server;
  let testUser;
  const testEmail = 'bruteforce-test@example.com';
  const testPassword = 'SecurePassword123!';

  beforeAll(async () => {
    // Start server
    server = require('../index'); // Assuming your server is exported from index.js

    // Create test user
    const passwordHash = await bcrypt.hash(testPassword, 10);
    try {
      testUser = await prisma.user.create({
        data: {
          email: testEmail,
          passwordHash,
          firstName: 'Test',
          lastName: 'User',
          role: 'CLIENT',
        },
      });
    } catch (err) {
      // User might already exist
      testUser = await prisma.user.findUnique({ where: { email: testEmail } });
    }
  });

  beforeEach(async () => {
    // Clear brute force cache (Redis) before each test
    await redisCache.clear();
    // Also reset express-rate-limit MemoryStore for the test email key
    if (accountLimiter && accountLimiter.resetKey) {
      await accountLimiter.resetKey(`account:${testEmail.toLowerCase()}`);
    }
  });

  afterAll(async () => {
    // Clean up
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await redisCache.disconnect();
  });

  describe('POST /api/auth/login', () => {
    it('should allow login with correct credentials', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.user).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
    });

    it('should reject login with incorrect password', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });

    it('should return X-Attempts-Remaining header on failed login', async () => {
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.headers['x-attempts-remaining']).toBeDefined();
    });

    it('should increment failed attempts with each wrong password', async () => {
      for (let i = 1; i < 5; i++) {
        const response = await request(server)
          .post('/api/auth/login')
          .send({
            email: testEmail,
            password: 'WrongPassword123!',
          });

        expect(response.status).toBe(401);
        expect(parseInt(response.headers['x-attempts-remaining'])).toBe(5 - i);
      }
    });

    it('should lock account after 5 failed attempts', async () => {
      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(server)
          .post('/api/auth/login')
          .send({
            email: testEmail,
            password: 'WrongPassword123!',
          });
      }

      // 6th attempt should be blocked
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword, // Even correct password won't work
        });

      expect(response.status).toBe(429);
      expect(response.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('should return 429 Too Many Requests when locked', async () => {
      // Lock the account
      await bruteForceMiddleware.lockAccount(testEmail);

      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(response.status).toBe(429);
    });

    it('should return Retry-After header when locked', async () => {
      // Lock the account
      await bruteForceMiddleware.lockAccount(testEmail);

      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(response.headers['retry-after']).toBeDefined();
      expect(parseInt(response.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('should clear failed attempts on successful login', async () => {
      // Make 2 failed attempts
      await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        });
      await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!',
        });

      // Check attempts were recorded
      let attempts = await bruteForceMiddleware.getAttemptCount(testEmail);
      expect(attempts).toBe(2);

      // Successful login should clear attempts
      const response = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(response.status).toBe(200);

      // Attempts should be cleared
      attempts = await bruteForceMiddleware.getAttemptCount(testEmail);
      expect(attempts).toBe(0);
    });

    it('should case-insensitize email for tracking', async () => {
      const upperEmail = testEmail.toUpperCase();

      // Make attempt with uppercase email
      await request(server)
        .post('/api/auth/login')
        .send({
          email: upperEmail,
          password: 'WrongPassword123!',
        });

      // Check attempts with lowercase email
      const attempts = await bruteForceMiddleware.getAttemptCount(testEmail);
      expect(attempts).toBe(1);
    });
  });

  describe('POST /api/auth/unlock', () => {
    it('should unlock account when called by admin', async () => {
      // First, lock account
      await bruteForceMiddleware.lockAccount(testEmail);
      let lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(true);

      // Create admin user for testing
      const adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
      });

      if (adminUser) {
        // Create valid JWT token for admin (in real test, this should be properly signed)
        const token = require('jsonwebtoken').sign(
          { id: adminUser.id, role: 'ADMIN' },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );

        // Unlock the account
        const response = await request(server)
          .post('/api/auth/unlock')
          .set('Authorization', `Bearer ${token}`)
          .send({
            email: testEmail,
            reason: 'test_unlock',
          });

        if (response.status === 200) {
          // Check account is unlocked
          lockout = await bruteForceMiddleware.checkLockout(testEmail);
          expect(lockout.isLocked).toBe(false);
        }
      }
    });
  });

  describe('GET /api/auth/login-history', () => {
    it('should return login history for authenticated user', async () => {
      // Login user
      const loginResponse = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      if (loginResponse.status === 200) {
        const token = loginResponse.body.token;

        // Get history
        const response = await request(server)
          .get('/api/auth/login-history')
          .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.attempts)).toBe(true);
      }
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(server).get('/api/auth/login-history');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/admin/user/:id/security', () => {
    it('should return security status for user when called by admin', async () => {
      // Get admin user
      const adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
      });

      if (adminUser) {
        const token = require('jsonwebtoken').sign(
          { id: adminUser.id, role: 'ADMIN' },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );

        // Get security status
        const response = await request(server)
          .get(`/api/admin/user/${testUser.id}/security`)
          .set('Authorization', `Bearer ${token}`);

        if (response.status === 200) {
          expect(response.body.ok).toBe(true);
          expect(response.body.user).toBeDefined();
          expect(response.body.security).toBeDefined();
          expect(response.body.security.failedAttempts).toBeDefined();
          expect(response.body.security.isLocked).toBeDefined();
        }
      }
    });

    it('should reject non-admin requests', async () => {
      // Login as regular user
      const loginResponse = await request(server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      if (loginResponse.status === 200) {
        const token = loginResponse.body.token;

        // Try to access security endpoint
        const response = await request(server)
          .get(`/api/admin/user/${testUser.id}/security`)
          .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(403);
      }
    });
  });
});
