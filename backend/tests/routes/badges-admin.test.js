/**
 * Tests for badges-admin routes
 * Stub endpoints for badge management
 */

const request = require('supertest');
const express = require('express');
const { adminToken } = require('../helpers');

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
}));

const badgesAdminRouter = require('../../routes/badges-admin');

const app = express();
app.use(express.json());
app.use('/badges-admin', badgesAdminRouter);

describe('Badges Admin Routes', () => {
  describe('GET /badges-admin/', () => {
    it('should return 200 with message', async () => {
      const res = await request(app).get('/badges-admin/');
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });
  });
});
