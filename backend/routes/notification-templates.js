const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const prisma = require('../config/db');
const NotificationTemplateModule = require('../modules/notification-template');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');

const router = express.Router();
const notificationTemplateModule = new NotificationTemplateModule(prisma);

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
    ...validatePageBasedPaginationQuery(),
    query('language').optional().isIn(['fr', 'en', 'es', 'de']).withMessage('Invalid language'),
    query('type').optional().trim().isLength({ min: 1 }).withMessage('Invalid type'),
    query('isActive').optional().isIn(['true', 'false']).withMessage('Invalid isActive'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { limit, skip, offset } = applyPageBasedPagination(req.query, 'notification-templates');
      const language = req.query.language || undefined;
      const type = req.query.type || undefined;
      const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

      // Build filter
      const filters = {};
      if (language) filters.language = language;
      if (type) filters.type = type;
      if (isActive !== undefined) filters.isActive = isActive;

      // Use module to list templates with pagination
      const result = await notificationTemplateModule.list(filters, { limit, skip, offset });

      res.json(buildPaginatedResponse(result.templates, limit, offset, result.total));
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
      const result = await notificationTemplateModule.getById(req.params.id);
      res.json(result);
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
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

      const template = await notificationTemplateModule.create({
        name,
        type,
        language,
        title,
        body,
        variables,
      });

      res.status(201).json({
        template,
        message: `Template ${name} v${template.version} created successfully`,
      });
    } catch (err) {
      if (err.status === 409) {
        return res.status(409).json({ error: err.message });
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

      const result = await notificationTemplateModule.update(templateName, {
        title,
        body,
        variables,
      });

      res.json({
        template: result.template,
        message: `Template ${templateName} updated to v${result.template.version}`,
        previousVersion: result.previousVersion,
      });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
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

      const result = await notificationTemplateModule.delete(templateName);

      res.json({
        message: result.message,
        versionsAffected: result.versionsAffected,
      });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
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
      const limit = req.query.limit || 20;

      const result = await notificationTemplateModule.getVersions(req.params.id, limit);

      res.json(result);
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
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
      const version = req.params.version;

      const result = await notificationTemplateModule.revert(templateName, version);

      res.json({
        template: result.template,
        message: result.message,
      });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  }
);

module.exports = router;
