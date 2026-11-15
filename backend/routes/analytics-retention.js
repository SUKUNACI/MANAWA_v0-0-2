/**
 * Analytics Retention & Revenue Routes — Q84, Q85, Q86
 * Retention metrics, churn prediction, revenue tracking (MRR/ARR/LTV)
 */

const express = require('express');
const { query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');
const AnalyticsAdvancedModule = require('../modules/analyticsAdvanced');

const router = express.Router();
const analyticsAdv = new AnalyticsAdvancedModule(prisma);

// ─── Q84: Retention Metrics ───────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/retention
 * DAU / WAU / MAU + D7 / D30 retention rates
 */
router.get(
  '/retention',
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const metrics = await analyticsAdv.getRetentionMetrics();
      res.json({ success: true, data: metrics });
    } catch (err) {
      logger.error('[Retention] Failed to compute', { error: err.message });
      res.status(500).json({ error: 'Failed to compute retention metrics' });
    }
  }
);

/**
 * GET /api/v1/analytics/retention/history
 * Past daily retention snapshots
 */
router.get(
  '/retention/history',
  requireAuth,
  requireRole(['ADMIN']),
  [query('days').optional().isInt({ min: 7, max: 90 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const days = parseInt(req.query.days || '30');
      const history = await analyticsAdv.getRetentionHistory(days);
      res.json({ success: true, data: history });
    } catch (err) {
      logger.error('[Retention] Failed to get history', { error: err.message });
      res.status(500).json({ error: 'Failed to get retention history' });
    }
  }
);

// ─── Q85: Churn Prediction ────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/churn
 * Users at risk of churning based on inactivity signals
 */
router.get(
  '/churn',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('riskLevel').optional().isIn(['high', 'medium', 'low']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { riskLevel, page = 1, limit = 50 } = req.query;
      const result = await analyticsAdv.getChurnPrediction(riskLevel, parseInt(page), parseInt(limit));

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[Churn] Failed to compute', { error: err.message });
      res.status(500).json({ error: 'Failed to compute churn prediction' });
    }
  }
);

/**
 * GET /api/v1/analytics/churn/subscriptions
 * Subscription churn: expired without renewal
 */
router.get(
  '/churn/subscriptions',
  requireAuth,
  requireRole(['ADMIN']),
  [query('days').optional().isInt({ min: 1, max: 90 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const days = parseInt(req.query.days || '30');
      const result = await analyticsAdv.getSubscriptionChurn(days);

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[Churn] Subscription churn failed', { error: err.message });
      res.status(500).json({ error: 'Failed to compute subscription churn' });
    }
  }
);

// ─── Q86: Revenue Tracking ────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/revenue/saas
 * MRR, ARR, ARPU, LTV — SaaS revenue metrics
 */
router.get(
  '/revenue/saas',
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const result = await analyticsAdv.getRevenueMetrics();
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[Revenue] Failed to compute SaaS metrics', { error: err.message });
      res.status(500).json({ error: 'Failed to compute revenue metrics' });
    }
  }
);

/**
 * GET /api/v1/analytics/revenue/transactions
 * Raw transaction revenue breakdown by period
 */
router.get(
  '/revenue/transactions',
  requireAuth,
  requireRole(['ADMIN']),
  [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('groupBy').optional().isIn(['day', 'week', 'month']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { from, to, groupBy = 'day' } = req.query;
      const result = await analyticsAdv.getRevenueTransactions(from, to, groupBy);

      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[Revenue] Failed to compute transactions', { error: err.message });
      res.status(500).json({ error: 'Failed to compute transaction revenue' });
    }
  }
);

module.exports = router;
