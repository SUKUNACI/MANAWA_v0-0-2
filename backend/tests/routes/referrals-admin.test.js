/**
 * Tests for referrals-admin routes
 * Stub endpoints for referral admin management
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

const referralsAdminRouter = require('../../routes/referrals-admin');

const app = express();
app.use(express.json());
app.use('/referrals-admin', referralsAdminRouter);

describe('Referrals Admin Routes', () => {
  describe('GET /referrals-admin/', () => {
    it('should return 200 with message', async () => {
      const res = await request(app).get('/referrals-admin/');
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });
  });
});
