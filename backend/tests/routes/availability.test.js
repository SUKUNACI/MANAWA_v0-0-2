/**
 * Tests for availability routes
 * Stub endpoints for availability management
 */

const request = require('supertest');
const express = require('express');

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

const availabilityRouter = require('../../routes/availability');

const app = express();
app.use(express.json());
app.use('/availability', availabilityRouter);

describe('Availability Routes', () => {
  describe('GET /availability/', () => {
    it('should return 200 with message', async () => {
      const res = await request(app).get('/availability/');
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });
  });
});
