const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { detectTokenType } = require('../config/pushNotifications');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { validatePageBasedPaginationQuery, applyPageBasedPagination, buildPaginatedResponse } = require('../utils/pagination-helper');

const router = express.Router();

// Rate limiters
const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// POST /api/notifications/register-token — Register push token (FCM, APNs, or Expo)
router.post('/register-token', writeLimiter, requireAuth,
  [
    body('token').trim().notEmpty().isLength({ min: 10 }).withMessage('token required and min 10 chars'),
    body('type').optional().trim().isIn(['EXPO', 'FCM', 'APNs']).withMessage('invalid type'),
    body('deviceId').optional().trim().isLength({ max: 500 }).withMessage('deviceId too long'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { token, type, deviceId } = req.body;

    if (!token || token.trim() === '') {
      return res.status(400).json({ error: 'Token requis' });
    }

    // Auto-detect token type if not provided
    const detectedType = type || detectTokenType(token);

    if (!detectedType) {
      return res.status(400).json({ error: 'Format de token invalide' });
    }

    // Validate token format
    if (detectedType === 'EXPO' && !token.startsWith('ExponentPushToken[')) {
      return res.status(400).json({ error: 'Token Expo invalide' });
    }

    if (detectedType === 'FCM' && token.length < 100) {
      return res.status(400).json({ error: 'Token FCM invalide' });
    }

    if (detectedType === 'APNs' && !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: 'Token APNs invalide' });
    }

    // Create or update push token
    const pushToken = await prisma.pushToken.upsert({
      where: { token },
      update: {
        userId: req.user.id,
        isActive: true,
        deviceId: deviceId || null,
        lastUsed: new Date(),
      },
      create: {
        userId: req.user.id,
        token,
        platform: detectedType === 'APNs' ? 'iOS' : 'Android',
        type: detectedType,
        deviceId: deviceId || null,
        isActive: true,
      },
    });

    // For backward compatibility, also store in user.expoPushToken if Expo token
    if (detectedType === 'EXPO') {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { expoPushToken: token },
      });
    }

    res.json({
      registered: true,
      token: pushToken.id,
      type: detectedType,
      message: `Token ${detectedType} enregistré avec succès`,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/notifications/unregister-token — Unregister all tokens (logout)
router.delete('/unregister-token', writeLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    // Mark all tokens as inactive (don't delete, keep history)
    await prisma.pushToken.updateMany({
      where: { userId: req.user.id },
      data: { isActive: false },
    });

    // Also clear legacy expoPushToken
    await prisma.user.update({
      where: { id: req.user.id },
      data: { expoPushToken: null },
    });

    res.json({
      unregistered: true,
      message: 'Tous les tokens ont été désactivés',
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/tokens — List user's registered tokens (admin/debug)
router.get('/tokens', readLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const tokens = await prisma.pushToken.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        platform: true,
        type: true,
        isActive: true,
        deviceId: true,
        lastUsed: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      tokens,
      total: tokens.length,
      active: tokens.filter(t => t.isActive).length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/history — List user's notifications
router.get('/history', readLimiter, requireAuth,
  [
    ...validatePageBasedPaginationQuery(),
    query('archived').optional().isIn(['true', 'false']).withMessage('archived must be true/false'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { limit, skip, offset } = applyPageBasedPagination(req.query, 'notifications');
    const archived = req.query.archived === 'true' ? true : false;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId: req.user.id,
          isArchived: archived,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.notification.count({
        where: {
          userId: req.user.id,
          isArchived: archived,
        },
      }),
    ]);

    res.json(buildPaginatedResponse(notifications, limit, offset, total));
  } catch (err) {
    next(err);
  }
});

router.patch('/read-all', writeLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', writeLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.id },
      select: { userId: true },
    });
    if (!notification || notification.userId !== req.user.id) {
      return res.status(404).json({ error: 'Notification introuvable' });
    }
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { read: true },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/archive — Archive single notification
router.post('/:id/archive', writeLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.id },
      select: { userId: true },
    });
    if (!notification || notification.userId !== req.user.id) {
      return res.status(404).json({ error: 'Notification introuvable' });
    }
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { isArchived: true },
    });
    res.json({ archived: true, message: 'Notification archivée' });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/archive-all — Archive all notifications for user
router.post('/archive-all', writeLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
        isArchived: false,
      },
      data: { isArchived: true },
    });
    res.json({
      archived: result.count,
      message: `${result.count} notifications archivées`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/unarchive/:id — Restore archived notification
router.post('/:id/unarchive', writeLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.id },
      select: { userId: true },
    });
    if (!notification || notification.userId !== req.user.id) {
      return res.status(404).json({ error: 'Notification introuvable' });
    }
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { isArchived: false },
    });
    res.json({ archived: false, message: 'Notification restaurée' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
