const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiters
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin-only middleware
function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * GET /api/admin/notification-templates
 * List all notification templates (admin only)
 */
router.get(
  '/',
  readLimiter,
  requireAuth,
  requireAdmin,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
    query('language').optional().isIn(['fr', 'en', 'es', 'de']).withMessage('Invalid language'),
    query('type').optional().trim().isLength({ min: 1 }).withMessage('Invalid type'),
    query('isActive').optional().isIn(['true', 'false']).withMessage('Invalid isActive'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, parseInt(req.query.limit) || 20);
      const language = req.query.language || undefined;
      const type = req.query.type || undefined;
      const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

      // Build filter
      const where = {};
      if (language) where.language = language;
      if (type) where.type = type;
      if (isActive !== undefined) where.isActive = isActive;

      // Get total count
      const total = await prisma.notificationTemplate.count({ where });

      // Get templates
      const templates = await prisma.notificationTemplate.findMany({
        where,
        orderBy: [{ name: 'asc' }, { version: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      });

      res.json({
        templates,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/notification-templates/:id
 * Get specific template with all versions
 */
router.get(
  '/:id',
  readLimiter,
  requireAuth,
  requireAdmin,
  [param('id').trim().notEmpty().withMessage('ID required')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const templates = await prisma.notificationTemplate.findMany({
        where: { name: req.params.id },
        orderBy: { version: 'desc' },
      });

      if (templates.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json({
        templates,
        current: templates.find(t => t.isActive) || templates[0],
        totalVersions: templates.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/notification-templates
 * Create new notification template (admin only)
 */
router.post(
  '/',
  writeLimiter,
  requireAuth,
  requireAdmin,
  [
    body('name').trim().notEmpty().isLength({ min: 3, max: 100 }).withMessage('Name must be 3-100 chars'),
    body('type').trim().notEmpty().isLength({ min: 3, max: 50 }).withMessage('Type must be 3-50 chars'),
    body('language').isIn(['fr', 'en', 'es', 'de']).withMessage('Invalid language'),
    body('title').trim().notEmpty().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 chars'),
    body('body').trim().notEmpty().isLength({ min: 1, max: 4000 }).withMessage('Body must be 1-4000 chars'),
    body('variables').optional().isArray().withMessage('Variables must be array'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { name, type, language, title, body, variables = [] } = req.body;

      // Get current version
      const latest = await prisma.notificationTemplate.findFirst({
        where: { name },
        orderBy: { version: 'desc' },
      });

      const newVersion = (latest?.version || 0) + 1;

      // Deactivate previous version if this is v1
      if (newVersion === 1) {
        await prisma.notificationTemplate.updateMany({
          where: { name },
          data: { isActive: false },
        });
      }

      // Create new template
      const template = await prisma.notificationTemplate.create({
        data: {
          name,
          type,
          language,
          title,
          body,
          variables: variables,
          version: newVersion,
          isActive: true,
          createdAt: new Date(),
        },
      });

      logger.info(`[Templates] Created template ${name} v${newVersion}`);

      res.status(201).json({
        template,
        message: `Template ${name} v${newVersion} created successfully`,
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Template with this name already exists' });
      }
      next(err);
    }
  }
);

/**
 * PATCH /api/admin/notification-templates/:id
 * Update template (creates new version, keeps history)
 */
router.patch(
  '/:id',
  writeLimiter,
  requireAuth,
  requireAdmin,
  [
    param('id').trim().notEmpty().withMessage('ID required'),
    body('title').optional().trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 chars'),
    body('body').optional().trim().isLength({ min: 1, max: 4000 }).withMessage('Body must be 1-4000 chars'),
    body('variables').optional().isArray().withMessage('Variables must be array'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const templateName = req.params.id;
      const { title, body, variables } = req.body;

      // Get current version
      const current = await prisma.notificationTemplate.findFirst({
        where: { name: templateName },
        orderBy: { version: 'desc' },
      });

      if (!current) {
        return res.status(404).json({ error: 'Template not found' });
      }

      // Deactivate old version
      await prisma.notificationTemplate.update({
        where: { id: current.id },
        data: { isActive: false },
      });

      // Create new version
      const newVersion = current.version + 1;
      const updated = await prisma.notificationTemplate.create({
        data: {
          name: current.name,
          type: current.type,
          language: current.language,
          title: title || current.title,
          body: body || current.body,
          variables: variables || current.variables,
          version: newVersion,
          isActive: true,
          createdAt: new Date(),
        },
      });

      logger.info(`[Templates] Updated template ${templateName} to v${newVersion}`);

      res.json({
        template: updated,
        message: `Template ${templateName} updated to v${newVersion}`,
        previousVersion: current.version,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/admin/notification-templates/:id
 * Soft-delete template (disable all versions)
 */
router.delete(
  '/:id',
  writeLimiter,
  requireAuth,
  requireAdmin,
  [param('id').trim().notEmpty().withMessage('ID required')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const templateName = req.params.id;

      const result = await prisma.notificationTemplate.updateMany({
        where: { name: templateName },
        data: { isActive: false },
      });

      if (result.count === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      logger.info(`[Templates] Disabled template ${templateName} (${result.count} versions)`);

      res.json({
        message: `Template ${templateName} and all versions disabled`,
        versionsAffected: result.count,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/notification-templates/:id/versions
 * Get all versions of a template
 */
router.get(
  '/:id/versions',
  readLimiter,
  requireAuth,
  requireAdmin,
  [
    param('id').trim().notEmpty().withMessage('ID required'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const limit = Math.min(50, parseInt(req.query.limit) || 20);

      const versions = await prisma.notificationTemplate.findMany({
        where: { name: req.params.id },
        orderBy: { version: 'desc' },
        take: limit,
      });

      if (versions.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json({
        name: req.params.id,
        versions,
        total: versions.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/notification-templates/:id/revert/:version
 * Revert to specific version
 */
router.post(
  '/:id/revert/:version',
  writeLimiter,
  requireAuth,
  requireAdmin,
  [
    param('id').trim().notEmpty().withMessage('ID required'),
    param('version').isInt({ min: 1 }).withMessage('Invalid version'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const templateName = req.params.id;
      const revertVersion = parseInt(req.params.version);

      // Find the version to revert to
      const versionToRevert = await prisma.notificationTemplate.findFirst({
        where: {
          name: templateName,
          version: revertVersion,
        },
      });

      if (!versionToRevert) {
        return res.status(404).json({ error: 'Version not found' });
      }

      // Deactivate all versions
      await prisma.notificationTemplate.updateMany({
        where: { name: templateName },
        data: { isActive: false },
      });

      // Create copy as new version
      const newVersion = (await prisma.notificationTemplate.findFirst({
        where: { name: templateName },
        orderBy: { version: 'desc' },
      })).version + 1;

      const reverted = await prisma.notificationTemplate.create({
        data: {
          name: templateName,
          type: versionToRevert.type,
          language: versionToRevert.language,
          title: versionToRevert.title,
          body: versionToRevert.body,
          variables: versionToRevert.variables,
          version: newVersion,
          isActive: true,
          createdAt: new Date(),
        },
      });

      logger.info(`[Templates] Reverted ${templateName} to v${revertVersion}, now v${newVersion}`);

      res.json({
        template: reverted,
        message: `Template reverted from v${revertVersion} to v${newVersion}`,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
