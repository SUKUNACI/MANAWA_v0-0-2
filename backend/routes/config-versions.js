/**
 * Q77: Configuration Versioning API
 * Endpoints for managing configuration versions and history
 */

const express = require('express');
const { body, validationResult, param } = require('express-validator');
const router = express.Router();
const { prisma } = require('../config/db');
const rollbackManager = require('../utils/rollback-manager');
const logger = require('../utils/logger');
const Sentry = require('@sentry/node');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Middleware
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'ADMIN role required' });
  }
  next();
};

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Q77: Get configuration versions history
// GET /api/v1/admin/config/versions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get(
  '/',
  requireAdmin,
  [
    body('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .toInt(),
    body('offset')
      .optional()
      .isInt({ min: 0 })
      .toInt(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset) : 0;

      // Fetch versions
      const [versions, total] = await Promise.all([
        prisma.configVersion.findMany({
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            version: true,
            createdAt: true,
            createdBy: true,
            tag: true,
            changelog: true,
            isStable: true,
          },
        }),
        prisma.configVersion.count(),
      ]);

      res.json({
        data: versions,
        pagination: { limit, offset, total },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[CONFIG-VERSION] Failed to fetch versions', { error: error.message });
      Sentry.captureException(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Q77: Get specific version details
// GET /api/v1/admin/config/versions/:version
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get(
  '/:version',
  requireAdmin,
  [param('version').isString().trim()],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { version } = req.params;

      const configVersion = await prisma.configVersion.findUnique({
        where: { version },
      });

      if (!configVersion) {
        return res.status(404).json({ error: `Version ${version} not found` });
      }

      res.json({
        data: configVersion,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[CONFIG-VERSION] Failed to fetch version', { error: error.message });
      Sentry.captureException(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Q77: Save current configuration as new version
// POST /api/v1/admin/config/versions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post(
  '/',
  requireAdmin,
  [
    body('version')
      .matches(/^\d+\.\d+\.\d+$/)
      .withMessage('Version must be semantic (e.g., 1.0.0)'),
    body('changelog')
      .isString()
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Changelog required, 10-1000 characters'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { version, changelog } = req.body;
      const adminId = req.user.id;

      // Check if version already exists
      const existing = await prisma.configVersion.findUnique({
        where: { version },
      });

      if (existing) {
        return res.status(409).json({ error: `Version ${version} already exists` });
      }

      // Save new version
      const configVersion = await rollbackManager.saveConfigVersion(
        version,
        adminId,
        changelog
      );

      res.status(201).json({
        data: configVersion,
        message: `Configuration version ${version} created successfully`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[CONFIG-VERSION] Failed to save version', { error: error.message });
      Sentry.captureException(error);
      res.status(500).json({ error: 'Failed to save configuration version' });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Q77: Restore configuration from version
// POST /api/v1/admin/config/versions/:version/restore
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post(
  '/:version/restore',
  requireAdmin,
  [
    param('version').isString().trim(),
    body('reason')
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage('Reason required, 5-500 characters'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { version } = req.params;
      const { reason } = req.body;
      const adminId = req.user.id;

      // Perform rollback
      const result = await rollbackManager.rollbackConfiguration(
        version,
        adminId,
        reason
      );

      res.json({
        data: result,
        message: `Configuration restored to version ${version}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[CONFIG-RESTORE] Rollback failed', {
        error: error.message,
        version: req.params.version,
      });
      Sentry.captureException(error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Q77: Mark version as stable
// PATCH /api/v1/admin/config/versions/:version/mark-stable
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.patch(
  '/:version/mark-stable',
  requireAdmin,
  [param('version').isString().trim()],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { version } = req.params;

      const updated = await rollbackManager.markVersionAsStable(version);

      res.json({
        data: updated,
        message: `Version ${version} marked as stable for production`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[CONFIG-VERSION] Failed to mark stable', {
        error: error.message,
      });
      Sentry.captureException(error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Q77 + Q78: Get rollback history
// GET /api/v1/admin/config/rollback-history
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get(
  '/history',
  requireAdmin,
  [
    body('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .toInt(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit) : 50;

      const history = await rollbackManager.getRollbackHistory(limit);

      res.json({
        data: history,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[ROLLBACK-HISTORY] Failed to fetch', { error: error.message });
      Sentry.captureException(error);
      res.status(500).json({ error: 'Failed to fetch rollback history' });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Q78: Get current system health metrics
// GET /api/v1/admin/config/health-metrics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get(
  '/health-metrics',
  requireAdmin,
  async (req, res) => {
    try {
      const recentMetrics = await prisma.systemHealthMetric.findMany({
        orderBy: { timestamp: 'desc' },
        take: 1,
      });

      const latest = recentMetrics[0] || null;

      res.json({
        data: latest,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[HEALTH-METRICS] Failed to fetch', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch health metrics' });
    }
  }
);

module.exports = router;
