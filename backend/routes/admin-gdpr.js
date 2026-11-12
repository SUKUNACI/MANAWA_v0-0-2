/**
 * Q93: GDPR Right to Deletion (hard delete)
 * Q94: Soft deletes vs hard deletes management
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN', 'SUPER_ADMIN']));

// ─── GDPR Deletion Requests ───────────────────────────────────────────────────

/**
 * GET /admin/gdpr/requests
 * List GDPR deletion requests
 */
router.get('/requests', [
  query('status').optional().isIn(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { status, page = 1, limit = 20 } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (status) where.status = status;

    const [requests, total] = await Promise.all([
      prisma.gdprDeletionRequest.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.gdprDeletionRequest.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        requests,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    logger.error('[GDPR] Failed to list requests', { error: err.message });
    res.status(500).json({ error: 'Failed to list GDPR requests' });
  }
});

/**
 * POST /admin/gdpr/requests
 * Submit a GDPR deletion request (admin on behalf of user, or by user themselves)
 */
router.post('/requests', [
  body('userId').isString().notEmpty(),
  body('reason').optional().isString().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { userId, reason } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existing = await prisma.gdprDeletionRequest.findFirst({
      where: { userId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
    if (existing) return res.status(409).json({ error: 'An active deletion request already exists for this user' });

    const request = await prisma.gdprDeletionRequest.create({
      data: { userId, requestedBy: req.user.id, reason: reason || null, status: 'PENDING' },
    });

    logger.info('[GDPR] Deletion request created', { userId, adminId: req.user.id });
    res.status(201).json({ success: true, data: { request } });
  } catch (err) {
    logger.error('[GDPR] Failed to create request', { error: err.message });
    res.status(500).json({ error: 'Failed to create GDPR request' });
  }
});

/**
 * POST /admin/gdpr/requests/:id/execute
 * Execute a GDPR hard delete: wipe all PII, then delete account
 * This is irreversible. Requires SUPER_ADMIN.
 */
router.post('/requests/:id/execute', requireRole(['SUPER_ADMIN']), async (req, res) => {
  try {
    const request = await prisma.gdprDeletionRequest.findUnique({ where: { id: req.params.id } });
    if (!request)              return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING' && request.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: `Cannot execute request with status ${request.status}` });
    }

    const { userId } = request;

    await prisma.gdprDeletionRequest.update({
      where: { id: req.params.id },
      data: { status: 'IN_PROGRESS' },
    });

    // Hard delete cascade (Prisma onDelete: Cascade handles related records)
    // 1. Wipe PII fields first (audit-safe anonymization before deletion)
    await prisma.user.update({
      where: { id: userId },
      data: {
        email:            `deleted_${userId}@gdpr.invalid`,
        firstName:        'DELETED',
        lastName:         'USER',
        phone:            null,
        avatarUrl:        null,
        city:             null,
        latitude:         null,
        longitude:        null,
        passwordHash:     'GDPR_DELETED',
        twoFASecret:      null,
        twoFABackupCodes: null,
        securityQuestion: null,
        securityAnswerHash: null,
        expoPushToken:    null,
        deletedAt:        new Date(),
      },
    });

    // 2. Delete dependent records not covered by cascade
    await Promise.all([
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.loginAttempt.deleteMany({ where: { userId } }),
      prisma.pushToken.deleteMany({ where: { userId } }),
      prisma.notification.deleteMany({ where: { userId } }),
    ]);

    // 3. Hard delete the user record
    await prisma.user.delete({ where: { id: userId } });

    // 4. Log the action
    await prisma.dataRetentionLog.create({
      data: {
        entityType:  'User',
        entityId:    userId,
        action:      'deleted',
        reason:      'gdpr_request',
        triggeredBy: req.user.id,
      },
    });

    await prisma.gdprDeletionRequest.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    logger.warn('[GDPR] Hard delete executed', { userId, adminId: req.user.id, requestId: req.params.id });
    res.json({ success: true, data: { message: `User ${userId} permanently deleted`, requestId: req.params.id } });
  } catch (err) {
    logger.error('[GDPR] Hard delete failed', { error: err.message });
    res.status(500).json({ error: 'GDPR deletion failed' });
  }
});

/**
 * PATCH /admin/gdpr/requests/:id/reject
 * Reject a GDPR request (legal obligation fulfilled, e.g. ongoing dispute)
 */
router.patch('/requests/:id/reject', [
  body('rejectionNote').isString().trim().notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const request = await prisma.gdprDeletionRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') return res.status(400).json({ error: 'Only PENDING requests can be rejected' });

    const updated = await prisma.gdprDeletionRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectedAt: new Date(), rejectionNote: req.body.rejectionNote },
    });

    logger.info('[GDPR] Request rejected', { requestId: req.params.id, adminId: req.user.id });
    res.json({ success: true, data: { request: updated } });
  } catch (err) {
    logger.error('[GDPR] Reject failed', { error: err.message });
    res.status(500).json({ error: 'Failed to reject GDPR request' });
  }
});

// ─── Soft Delete Management ───────────────────────────────────────────────────

/**
 * GET /admin/gdpr/soft-deleted
 * List soft-deleted users (deletedAt != null)
 */
router.get('/soft-deleted', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: { deletedAt: { not: null } },
        skip,
        take: parseInt(limit),
        orderBy: { deletedAt: 'desc' },
        select: { id: true, email: true, firstName: true, lastName: true, deletedAt: true, createdAt: true },
      }),
      prisma.user.count({ where: { deletedAt: { not: null } } }),
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    logger.error('[GDPR] Soft-deleted list failed', { error: err.message });
    res.status(500).json({ error: 'Failed to list soft-deleted users' });
  }
});

/**
 * POST /admin/gdpr/restore/:userId
 * Restore a soft-deleted user (undo soft delete)
 */
router.post('/restore/:userId', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user)         return res.status(404).json({ error: 'User not found' });
    if (!user.deletedAt) return res.status(400).json({ error: 'User is not soft-deleted' });

    await prisma.user.update({ where: { id: req.params.userId }, data: { deletedAt: null } });

    logger.info('[GDPR] User restored', { userId: req.params.userId, adminId: req.user.id });
    res.json({ success: true, data: { message: `User ${req.params.userId} restored` } });
  } catch (err) {
    logger.error('[GDPR] Restore failed', { error: err.message });
    res.status(500).json({ error: 'Failed to restore user' });
  }
});

module.exports = router;
