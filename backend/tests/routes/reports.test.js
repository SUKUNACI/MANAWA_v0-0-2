/**
 * Tests for reports routes
 * Stub endpoints for report management
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

const reportsRouter = require('../../routes/reports');

const app = express();
app.use(express.json());
app.use('/reports', reportsRouter);

describe('Reports Routes', () => {
  describe('GET /reports/', () => {
    it('should return 200 with message', async () => {
      const res = await request(app).get('/reports/');
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });
  });
});
