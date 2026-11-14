'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const AnalyticsModule = require('../modules/analytics');

const router = express.Router();
const analyticsModule = new AnalyticsModule(prisma);

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// GET /api/analytics/overview — basic metrics for all professionals
router.get(
  '/overview',
  analyticsLimiter,
  requireAuth,
  requireRole('PROFESSIONAL'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const data = await analyticsModule.getOverview(req.user.id);
      if (!data) return res.status(404).json({ error: 'Profil pro introuvable' });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/analytics/views — profile views timeline [PREMIUM]
router.get(
  '/views',
  requireAuth,
  requireRole('PROFESSIONAL'),
  async (req, res, next) => {
    try {
      const data = await analyticsModule.getViewsTimeline(req.user.id);
      res.json(data);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, ...(err.upgrade && { upgrade: true }) });
      next(err);
    }
  }
);

// GET /api/analytics/revenue — monthly revenue over 12 months [PREMIUM]
router.get(
  '/revenue',
  requireAuth,
  requireRole('PROFESSIONAL'),
  async (req, res, next) => {
    try {
      const data = await analyticsModule.getRevenueTimeline(req.user.id);
      res.json(data);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, ...(err.upgrade && { upgrade: true }) });
      next(err);
    }
  }
);

// GET /api/analytics/quotes — quote funnel analysis [PREMIUM]
router.get(
  '/quotes',
  requireAuth,
  requireRole('PROFESSIONAL'),
  async (req, res, next) => {
    try {
      const data = await analyticsModule.getQuoteAnalysis(req.user.id);
      res.json(data);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, ...(err.upgrade && { upgrade: true }) });
      next(err);
    }
  }
);

// GET /api/analytics/competitors — anonymised peer comparison [ELITE only]
router.get(
  '/competitors',
  requireAuth,
  requireRole('PROFESSIONAL'),
  async (req, res, next) => {
    try {
      const data = await analyticsModule.getCompetitorComparison(req.user.id);
      res.json(data);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, ...(err.upgrade && { upgrade: true }) });
      next(err);
    }
  }
);

module.exports = router;
