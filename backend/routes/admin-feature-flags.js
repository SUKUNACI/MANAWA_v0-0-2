/**
 * Admin Feature Flags Routes
 * GET/POST/PATCH/DELETE endpoints for managing feature flags
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { invalidateCache } = require('../utils/feature-flag-manager');
const featureFlagConfig = require('../config/feature-flags');

const router = express.Router();

// Middleware: require admin access
router.use(requireAuth);
router.use(requireRole(['ADMIN']));

/**
 * Helper: Log admin action
 */
async function writeAdminLog(adminId, action, targetType, targetId, metadata) {
  try {
    await prisma.adminLog.create({
      data: {
        adminId,
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (err) {
    logger.error('Failed to write admin log', { action, error: err.message });
  }
}

/**
 * GET /admin/feature-flags
 * List all feature flags with pagination
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, enabled } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (enabled !== undefined) {
      where.enabled = enabled === 'true';
    }

    const [flags, total] = await Promise.all([
      prisma.featureFlag.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.featureFlag.count({ where }),
    ]);

    logger.info('[FeatureFlags] Listed', { adminId: req.user.id, count: flags.length });

    res.json({
      success: true,
      data: {
        flags,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    logger.error('[FeatureFlags] Failed to list', { error: err.message });
    res.status(500).json({ error: 'Failed to list feature flags' });
  }
});

/**
 * GET /admin/feature-flags/:name
 * Get single feature flag
 */
router.get('/:name', async (req, res) => {
  try {
    const flag = await prisma.featureFlag.findUnique({
      where: { name: req.params.name },
    });

    if (!flag) {
      return res.status(404).json({ error: 'Feature flag not found' });
    }

    res.json({
      success: true,
      data: { flag },
    });
  } catch (err) {
    logger.error('[FeatureFlags] Failed to get flag', { error: err.message });
    res.status(500).json({ error: 'Failed to get feature flag' });
  }
});

/**
 * POST /admin/feature-flags
 * Create new feature flag
 */
router.post(
  '/',
  [
    body('name').isString().trim().notEmpty().withMessage('Name is required'),
    body('description').optional().isString().trim(),
    body('enabled').isBoolean().withMessage('Enabled must be boolean'),
    body('rolloutPercentage')
      .isInt({ min: 0, max: 100 })
      .withMessage('Rollout percentage must be 0-100'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, enabled, rolloutPercentage } = req.body;

      // Check if already exists
      const existing = await prisma.featureFlag.findUnique({
        where: { name },
      });

      if (existing) {
        return res.status(409).json({ error: 'Feature flag already exists' });
      }

      const flag = await prisma.featureFlag.create({
        data: {
          name,
          description: description || null,
          enabled,
          rolloutPercentage,
        },
      });

      // Invalidate cache
      await invalidateCache();

      // Log action
      await writeAdminLog(req.user.id, 'feature_flag_created', 'FeatureFlag', flag.id, {
        name,
        enabled,
        rolloutPercentage,
      });

      logger.info('[FeatureFlags] Created', { adminId: req.user.id, flagName: name });

      res.status(201).json({
        success: true,
        data: { flag },
      });
    } catch (err) {
      logger.error('[FeatureFlags] Failed to create', { error: err.message });
      res.status(500).json({ error: 'Failed to create feature flag' });
    }
  }
);

/**
 * PATCH /admin/feature-flags/:name
 * Update feature flag
 */
router.patch(
  '/:name',
  [
    body('enabled').optional().isBoolean(),
    body('rolloutPercentage')
      .optional()
      .isInt({ min: 0, max: 100 })
      .withMessage('Rollout percentage must be 0-100'),
    body('description').optional().isString().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name } = req.params;
      const { enabled, rolloutPercentage, description } = req.body;

      const flag = await prisma.featureFlag.findUnique({
        where: { name },
      });

      if (!flag) {
        return res.status(404).json({ error: 'Feature flag not found' });
      }

      const updated = await prisma.featureFlag.update({
        where: { name },
        data: {
          ...(enabled !== undefined && { enabled }),
          ...(rolloutPercentage !== undefined && { rolloutPercentage }),
          ...(description !== undefined && { description }),
          updatedAt: new Date(),
        },
      });

      // Invalidate cache
      await invalidateCache();

      // Log action
      await writeAdminLog(req.user.id, 'feature_flag_updated', 'FeatureFlag', updated.id, {
        name,
        changes: {
          enabled,
          rolloutPercentage,
          description,
        },
      });

      logger.info('[FeatureFlags] Updated', { adminId: req.user.id, flagName: name });

      res.json({
        success: true,
        data: { flag: updated },
      });
    } catch (err) {
      logger.error('[FeatureFlags] Failed to update', { error: err.message });
      res.status(500).json({ error: 'Failed to update feature flag' });
    }
  }
);

/**
 * DELETE /admin/feature-flags/:name
 * Delete feature flag
 */
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;

    const flag = await prisma.featureFlag.findUnique({
      where: { name },
    });

    if (!flag) {
      return res.status(404).json({ error: 'Feature flag not found' });
    }

    await prisma.featureFlag.delete({
      where: { name },
    });

    // Invalidate cache
    await invalidateCache();

    // Log action
    await writeAdminLog(req.user.id, 'feature_flag_deleted', 'FeatureFlag', flag.id, {
      name,
    });

    logger.info('[FeatureFlags] Deleted', { adminId: req.user.id, flagName: name });

    res.json({
      success: true,
      message: 'Feature flag deleted',
    });
  } catch (err) {
    logger.error('[FeatureFlags] Failed to delete', { error: err.message });
    res.status(500).json({ error: 'Failed to delete feature flag' });
  }
});

/**
 * POST /admin/feature-flags/:name/rollout
 * Update rollout percentage (quick endpoint)
 */
router.post(
  '/:name/rollout',
  [
    body('rolloutPercentage')
      .isInt({ min: 0, max: 100 })
      .withMessage('Rollout percentage must be 0-100'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name } = req.params;
      const { rolloutPercentage } = req.body;

      const flag = await prisma.featureFlag.findUnique({
        where: { name },
      });

      if (!flag) {
        return res.status(404).json({ error: 'Feature flag not found' });
      }

      const updated = await prisma.featureFlag.update({
        where: { name },
        data: {
          rolloutPercentage,
          updatedAt: new Date(),
        },
      });

      // Invalidate cache
      await invalidateCache();

      logger.info('[FeatureFlags] Rollout updated', {
        adminId: req.user.id,
        flagName: name,
        rolloutPercentage,
      });

      res.json({
        success: true,
        data: { flag: updated },
      });
    } catch (err) {
      logger.error('[FeatureFlags] Failed to update rollout', { error: err.message });
      res.status(500).json({ error: 'Failed to update rollout' });
    }
  }
);

module.exports = router;
