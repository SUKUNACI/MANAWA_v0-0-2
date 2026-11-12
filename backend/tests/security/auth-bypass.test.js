const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { requireAuth, requireAdminAuth, requireSuperAdmin, requirePermission } = require('../../middleware/auth');

jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
  },
}));

const prisma = require('../../config/db');

const app = express();
app.use(express.json());

app.get('/api/protected', requireAuth, (req, res) => {
  res.json({ message: 'Protected resource', user: req.user });
});

app.get('/api/admin', requireAdminAuth, (req, res) => {
  res.json({ message: 'Admin resource', user: req.user });
});

app.get('/api/super-admin', requireSuperAdmin, (req, res) => {
  res.json({ message: 'Super admin resource' });
});

describe('Security: Authentication Bypass Vulnerabilities (A02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Missing Token Validation', () => {
    test('should reject request without Authorization header', async () => {
      const res = await request(app).get('/api/protected');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/authentifi/i);
    });

    test('should reject invalid Authorization format', async () => {
      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', 'InvalidFormat token123');
      expect(res.status).toBe(401);
    });
  });

  describe('Token Manipulation', () => {
    test('should reject tampered JWT token', async () => {
      const validToken = jwt.sign(
        { id: 'user-1' },
        process.env.JWT_SECRET
      );
      const tamperedToken = validToken.slice(0, -5) + 'XXXXX';

      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalide|expir/i);
    });

    test('should reject token signed with wrong secret', async () => {
      const wrongToken = jwt.sign(
        { id: 'user-1' },
        'wrong-secret-key'
      );

      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${wrongToken}`);

      expect(res.status).toBe(401);
    });

    test('should reject expired JWT token', async () => {
      const expiredToken = jwt.sign(
        { id: 'user-1', exp: Math.floor(Date.now() / 1000) - 3600 },
        process.env.JWT_SECRET
      );

      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
    });
  });

  describe('Deleted/Suspended User Access', () => {
    test('should reject deleted user access', async () => {
      const validToken = jwt.sign(
        { id: 'deleted-user' },
        process.env.JWT_SECRET
      );

      prisma.user.findUnique.mockResolvedValue({
        id: 'deleted-user',
        deletedAt: new Date('2024-01-01'),
        role: 'CLIENT',
        email: 'deleted@test.com',
      });

      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(401);
    });

    test('should reject suspended user access', async () => {
      const validToken = jwt.sign(
        { id: 'suspended-user' },
        process.env.JWT_SECRET
      );

      prisma.user.findUnique.mockResolvedValue({
        id: 'suspended-user',
        deletedAt: null,
        suspended: true,
        role: 'CLIENT',
        email: 'suspended@test.com',
      });

      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Admin Cookie Security', () => {
    test('should reject request without adminToken cookie', async () => {
      const res = await request(app).get('/api/admin');
      expect(res.status).toBe(401);
    });

    test('should reject invalid adminToken', async () => {
      const res = await request(app)
        .get('/api/admin')
        .set('Cookie', 'adminToken=invalid_token');

      expect(res.status).toBe(401);
    });
  });

  describe('Super Admin Access Control', () => {
    test('should reject non-super-admin from super-admin endpoint', async () => {
      const token = jwt.sign(
        { id: 'user-1' },
        process.env.JWT_SECRET
      );

      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        adminLevel: 'STANDARD',
        role: 'ADMIN',
        email: 'admin@test.com',
      });

      const res = await request(app)
        .get('/api/super-admin')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });
});
