/**
 * Analytics Funnels & Cohorts Routes — Q82, Q83
 * Funnel analysis, cohort analysis
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');
const AnalyticsFunnelsModule = require('../modules/analyticsFunnels');

const router = express.Router();
const analyticsFunnels = new AnalyticsFunnelsModule(prisma);

// ─── Q82: Funnel Analysis ─────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/funnel
 * Conversion funnel: register → search → profile_view → quote_sent → payment
 * Returns count and drop-off % at each step
 */
router.get(
  '/funnel',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('role').optional().isIn(['CLIENT', 'PROFESSIONAL']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { from, to, role } = req.query;
      const result = await analyticsFunnels.getFunnelAnalysis(from, to, role);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      logger.error('[Funnel] Failed to compute funnel', { error: err.message });
      res.status(500).json({ error: 'Failed to compute funnel analysis' });
    }
  }
);

// ─── Q83: Cohort Analysis ─────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/cohorts
 * Cohort retention: users grouped by registration month, tracked over time
 */
router.get(
  '/cohorts',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('months').optional().isInt({ min: 1, max: 24 }).withMessage('1-24 months'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const monthsBack = parseInt(req.query.months || '6');
      const result = await analyticsFunnels.getCohortAnalysis(monthsBack);

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[Cohort] Failed to compute cohorts', { error: err.message });
      res.status(500).json({ error: 'Failed to compute cohort analysis' });
    }
  }
);

/**
 * POST /api/v1/analytics/cohorts/snapshot (admin only)
 * Save cohort snapshot for faster future queries
 */
router.post(
  '/cohorts/snapshot',
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const result = await analyticsFunnels.createCohortSnapshot();
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[Cohort] Failed to snapshot', { error: err.message });
      res.status(500).json({ error: 'Failed to create cohort snapshot' });
    }
  }
);

module.exports = router;
