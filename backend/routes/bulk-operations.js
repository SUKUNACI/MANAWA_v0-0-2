/**
 * Bulk Operations Routes (Q70)
 * Handles bulk create/update/delete for admin operations
 * Implements rate limiting (5 calls/hour per user)
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const redis = require('../config/redis');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const bulkConfig = require('../config/bulk-config');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

const router = express.Router();

// ============ HELPER FUNCTIONS ============

/**
 * Check rate limit for bulk operations (5 per hour per user)
 */
async function checkBulkRateLimit(userId) {
  const redisClient = redis.getRedisClient();
  const key = bulkConfig.REDIS_KEYS.bulk_rate_limit + userId;

  try {
    const currentCount = await redisClient.get(key);
    const count = parseInt(currentCount || '0', 10);

    if (count >= bulkConfig.RATE_LIMIT.calls_per_hour) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: await redisClient.ttl(key),
      };
    }

    // Increment and set expiry
    await redisClient.incr(key);
    if (count === 0) {
      await redisClient.expire(key, bulkConfig.RATE_LIMIT.window_ms / 1000);
    }

    return {
      allowed: true,
      remaining: bulkConfig.RATE_LIMIT.calls_per_hour - (count + 1),
      resetIn: await redisClient.ttl(key),
    };
  } catch (err) {
    logger.error('[Bulk] Rate limit check error', { userId, error: err.message });
    // Allow on error to not block users
    return { allowed: true, remaining: -1, resetIn: -1 };
  }
}

/**
 * Log bulk operation to audit
 */
async function logBulkOperation(userId, operation, count, status, durationMs, metadata = {}) {
  try {
    const redisClient = redis.getRedisClient();
    const logKey = bulkConfig.REDIS_KEYS.bulk_operation_log + userId;

    const logEntry = {
      timestamp: new Date().toISOString(),
      operation,
      count,
      status,
      durationMs,
      ...metadata,
    };

    // Store in Redis (rotate after 1000 entries)
    await redisClient.lpush(logKey, JSON.stringify(logEntry));
    await redisClient.ltrim(logKey, 0, 999);
    await redisClient.expire(logKey, 24 * 60 * 60); // 24 hours
  } catch (err) {
    logger.warn('[Bulk] Failed to log operation', { userId, error: err.message });
  }
}

/**
 * Validate bulk project data
 */
function validateProjectBulkData(items, operation) {
  const errors = [];

  if (!Array.isArray(items)) {
    return [{ error: 'Payload doit être un tableau' }];
  }

  if (items.length === 0) {
    return [{ error: bulkConfig.ERRORS.EMPTY_BATCH }];
  }

  if (items.length > bulkConfig.MAX_ITEMS_PER_BULK_OP) {
    return [{
      error: bulkConfig.ERRORS.TOO_MANY_ITEMS.replace('{max}', bulkConfig.MAX_ITEMS_PER_BULK_OP),
    }];
  }

  // Check for duplicate IDs (for update/delete)
  if (operation !== 'create') {
    const ids = items.map(item => item.id).filter(Boolean);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      errors.push({
        error: bulkConfig.ERRORS.DUPLICATE_IDS,
      });
    }
  }

  // Validate individual items
  items.forEach((item, index) => {
    const requiredFields = bulkConfig.PROJECT_FIELDS[operation.toUpperCase()] || [];

    for (const field of requiredFields) {
      if (!item[field]) {
        errors.push({
          index,
          error: bulkConfig.ERRORS.MISSING_FIELD.replace('{field}', field),
        });
        break;
      }
    }

    // Validate data types
    if (operation === 'create' || operation === 'update') {
      if (item.budget !== undefined && typeof item.budget !== 'number') {
        errors.push({
          index,
          error: 'budget doit être un nombre',
        });
      }

      if (item.title && typeof item.title !== 'string') {
        errors.push({
          index,
          error: 'title doit être une chaîne',
        });
      }
    }
  });

  return errors;
}

// ============ RATE LIMIT MIDDLEWARE ============

async function bulkRateLimitMiddleware(req, res, next) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const rateLimit = await checkBulkRateLimit(userId);

  res.setHeader('X-Bulk-RateLimit-Remaining', rateLimit.remaining);
  res.setHeader('X-Bulk-RateLimit-Reset', rateLimit.resetIn);

  if (!rateLimit.allowed) {
    logger.warn('[Bulk] Rate limit exceeded', {
      userId,
      operation: req.method,
      path: req.path,
    });

    return res.status(bulkConfig.STATUS_CODES.RATE_LIMITED).json({
      error: bulkConfig.ERRORS.RATE_LIMIT_EXCEEDED.replace(
        '{limit}',
        bulkConfig.RATE_LIMIT.calls_per_hour
      ),
      resetIn: rateLimit.resetIn,
      code: 'BULK_RATE_LIMIT_EXCEEDED',
    });
  }

  next();
}

// ============ BULK CREATE PROJECTS ============

/**
 * POST /api/v1/admin/projects/bulk
 * Create up to 50 projects in a single request
 * Rate limited: 5 calls per hour per user
 */
router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  bulkRateLimitMiddleware,
  body('*.title').notEmpty().withMessage('title requis'),
  body('*.description').optional().isString(),
  body('*.budget').notEmpty().isNumeric().withMessage('budget doit être numérique'),
  body('*.city').notEmpty().withMessage('city requis'),
  body('*.category').optional().isString(),
  async (req, res) => {
    const startTime = Date.now();

    try {
      const items = req.body;
      const userId = req.user.id;

      // Validate input
      const validationErrors = validateProjectBulkData(items, 'create');
      if (validationErrors.length > 0) {
        logger.warn('[Bulk] Validation failed for CREATE', {
          userId,
          itemCount: items.length,
          errorCount: validationErrors.length,
        });

        return res.status(bulkConfig.STATUS_CODES.BAD_REQUEST).json({
          error: 'Validation échouée pour certains éléments',
          code: 'VALIDATION_FAILED',
          errors: validationErrors,
        });
      }

      // Process creates in parallel
      const results = await Promise.allSettled(
        items.map(async (item) => {
          return prisma.project.create({
            data: {
              title: item.title,
              description: item.description || '',
              budget: parseFloat(item.budget),
              city: item.city,
              category: item.category || 'OTHER',
              status: 'OPEN',
              clientId: userId, // Associate with admin user for now
              createdAt: new Date(),
            },
          });
        })
      );

      // Analyze results
      const created = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      const failed = results.filter(r => r.status === 'rejected').map((r, i) => ({
        index: i,
        error: r.reason?.message || 'Unknown error',
      }));

      const durationMs = Date.now() - startTime;

      // Log operation
      await logBulkOperation(userId, 'CREATE', items.length, 'completed', durationMs, {
        created: created.length,
        failed: failed.length,
      });

      logger.info('[Bulk] CREATE operation completed', {
        userId,
        itemCount: items.length,
        created: created.length,
        failed: failed.length,
        durationMs,
      });

      // Return results
      res.status(201).json({
        operation: 'bulk_create',
        totalItems: items.length,
        created: created.length,
        failed: failed.length,
        durationMs,
        data: created,
        errors: bulkConfig.VALIDATION.detailed_errors ? failed : undefined,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('[Bulk] CREATE operation failed', {
        userId: req.user?.id,
        error: error.message,
        durationMs,
      });

      return res.status(500).json({
        error: 'Erreur lors de la création en masse',
        code: 'BULK_CREATE_ERROR',
      });
    }
  }
);

// ============ BULK UPDATE PROJECTS ============

/**
 * PATCH /api/v1/admin/projects/bulk
 * Update up to 50 projects in a single request
 * Rate limited: 5 calls per hour per user
 */
router.patch(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  bulkRateLimitMiddleware,
  body('*.id').notEmpty().withMessage('id requis'),
  body('*.title').optional().isString(),
  body('*.description').optional().isString(),
  body('*.budget').optional().isNumeric(),
  body('*.status').optional().isIn(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  async (req, res) => {
    const startTime = Date.now();

    try {
      const items = req.body;
      const userId = req.user.id;

      // Validate input
      const validationErrors = validateProjectBulkData(items, 'update');
      if (validationErrors.length > 0) {
        logger.warn('[Bulk] Validation failed for UPDATE', {
          userId,
          itemCount: items.length,
          errorCount: validationErrors.length,
        });

        return res.status(bulkConfig.STATUS_CODES.BAD_REQUEST).json({
          error: 'Validation échouée pour certains éléments',
          code: 'VALIDATION_FAILED',
          errors: validationErrors,
        });
      }

      // Process updates in parallel
      const results = await Promise.allSettled(
        items.map(async (item) => {
          const updateData = {};
          if (item.title) updateData.title = item.title;
          if (item.description) updateData.description = item.description;
          if (item.budget) updateData.budget = parseFloat(item.budget);
          if (item.status) updateData.status = item.status;
          if (item.city) updateData.city = item.city;
          if (item.category) updateData.category = item.category;

          return prisma.project.update({
            where: { id: item.id },
            data: updateData,
          });
        })
      );

      // Analyze results
      const updated = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      const failed = results.filter(r => r.status === 'rejected').map((r, i) => ({
        index: i,
        error: r.reason?.message || 'Unknown error',
      }));

      const durationMs = Date.now() - startTime;

      // Log operation
      await logBulkOperation(userId, 'UPDATE', items.length, 'completed', durationMs, {
        updated: updated.length,
        failed: failed.length,
      });

      logger.info('[Bulk] UPDATE operation completed', {
        userId,
        itemCount: items.length,
        updated: updated.length,
        failed: failed.length,
        durationMs,
      });

      // Return results
      res.status(200).json({
        operation: 'bulk_update',
        totalItems: items.length,
        updated: updated.length,
        failed: failed.length,
        durationMs,
        data: updated,
        errors: bulkConfig.VALIDATION.detailed_errors ? failed : undefined,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('[Bulk] UPDATE operation failed', {
        userId: req.user?.id,
        error: error.message,
        durationMs,
      });

      return res.status(500).json({
        error: 'Erreur lors de la mise à jour en masse',
        code: 'BULK_UPDATE_ERROR',
      });
    }
  }
);

// ============ BULK DELETE PROJECTS ============

/**
 * DELETE /api/v1/admin/projects/bulk
 * Delete up to 50 projects in a single request via IDs
 * Rate limited: 5 calls per hour per user
 */
router.delete(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  bulkRateLimitMiddleware,
  body('ids').isArray({ min: 1 }).withMessage('ids doit être un tableau non vide'),
  body('ids.*').isString().withMessage('Chaque id doit être une chaîne'),
  async (req, res) => {
    const startTime = Date.now();

    try {
      const { ids } = req.body;
      const userId = req.user.id;

      // Validate count
      if (ids.length > bulkConfig.MAX_ITEMS_PER_BULK_OP) {
        return res.status(bulkConfig.STATUS_CODES.BAD_REQUEST).json({
          error: bulkConfig.ERRORS.TOO_MANY_ITEMS.replace('{max}', bulkConfig.MAX_ITEMS_PER_BULK_OP),
          code: 'TOO_MANY_ITEMS',
        });
      }

      // Check for duplicates
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== ids.length) {
        return res.status(bulkConfig.STATUS_CODES.BAD_REQUEST).json({
          error: bulkConfig.ERRORS.DUPLICATE_IDS,
          code: 'DUPLICATE_IDS',
        });
      }

      // Process deletes in parallel
      const results = await Promise.allSettled(
        ids.map(id =>
          prisma.project.delete({
            where: { id },
          })
        )
      );

      // Analyze results
      const deleted = results.filter(r => r.status === 'fulfilled').map(r => r.value.id);
      const failed = results.filter(r => r.status === 'rejected').map((r, i) => ({
        index: i,
        id: ids[i],
        error: r.reason?.message || 'Unknown error',
      }));

      const durationMs = Date.now() - startTime;

      // Log operation
      await logBulkOperation(userId, 'DELETE', ids.length, 'completed', durationMs, {
        deleted: deleted.length,
        failed: failed.length,
      });

      logger.info('[Bulk] DELETE operation completed', {
        userId,
        itemCount: ids.length,
        deleted: deleted.length,
        failed: failed.length,
        durationMs,
      });

      // Return results
      res.status(200).json({
        operation: 'bulk_delete',
        totalItems: ids.length,
        deleted: deleted.length,
        failed: failed.length,
        durationMs,
        deletedIds: deleted,
        errors: bulkConfig.VALIDATION.detailed_errors ? failed : undefined,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('[Bulk] DELETE operation failed', {
        userId: req.user?.id,
        error: error.message,
        durationMs,
      });

      return res.status(500).json({
        error: 'Erreur lors de la suppression en masse',
        code: 'BULK_DELETE_ERROR',
      });
    }
  }
);

module.exports = router;
