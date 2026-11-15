'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, query } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { detectTokenType } = require('../config/pushNotifications');
const { handleValidationErrors } = require('../middleware/validateInput');
const { validatePageBasedPaginationQuery, applyPageBasedPagination } = require('../utils/pagination-helper');
const NotificationsModule = require('../modules/notifications');

const router = express.Router();
const notificationsModule = new NotificationsModule(prisma);

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// POST /register-token
router.post('/register-token', writeLimiter, requireAuth,
  [
    body('token').trim().notEmpty().withMessage('token required'),
    body('type').optional().trim().isIn(['EXPO', 'FCM', 'APNs']).withMessage('invalid type'),
    body('deviceId').optional().trim().isLength({ max: 500 }).withMessage('deviceId too long'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { token, type, deviceId } = req.body;
      const detectedType = type || detectTokenType(token);

      if (!detectedType) return res.status(400).json({ error: 'Format de token invalide' });
      if (detectedType === 'EXPO' && !token.startsWith('ExponentPushToken[')) return res.status(400).json({ error: 'Token Expo invalide' });
      if (detectedType === 'FCM' && token.length < 100) return res.status(400).json({ error: 'Token FCM invalide' });
      if (detectedType === 'APNs' && !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Token APNs invalide' });

      const pushToken = await notificationsModule.registerToken(req.user.id, token, detectedType, deviceId);
      res.json({ registered: true, token: pushToken.id, type: detectedType, message: `Token ${detectedType} enregistré avec succès` });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /unregister-token
router.delete('/unregister-token', writeLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    await notificationsModule.unregisterAllTokens(req.user.id);
    res.json({ unregistered: true, message: 'Tous les tokens ont été désactivés' });
  } catch (err) {
    next(err);
  }
});

// GET /tokens
router.get('/tokens', readLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const result = await notificationsModule.getTokens(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /history
router.get('/history', readLimiter, requireAuth,
  [
    ...validatePageBasedPaginationQuery(),
    query('archived').optional().isIn(['true', 'false']).withMessage('archived must be true/false'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { limit, skip } = applyPageBasedPagination(req.query, 'notifications');
      const where = { userId: req.user.id };
      if (req.query.archived !== undefined) where.isArchived = req.query.archived === 'true';

      const notifications = await notificationsModule.getRecent(req.user.id, limit, skip, where);
      res.json(notifications);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /read-all
router.patch('/read-all', writeLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    await notificationsModule.markAllAsRead(req.user.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /:id/read
router.patch('/:id/read', writeLimiter, requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const notification = await prisma.notification.findUnique({ where: { id: req.params.id }, select: { userId: true } });
      if (!notification || notification.userId !== req.user.id) return res.status(404).json({ error: 'Notification introuvable' });
      await notificationsModule.markAsRead(req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// POST /:id/archive
router.post('/:id/archive', writeLimiter, requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const notification = await prisma.notification.findUnique({ where: { id: req.params.id }, select: { userId: true } });
      if (!notification || notification.userId !== req.user.id) return res.status(404).json({ error: 'Notification introuvable' });
      await notificationsModule.archive(req.params.id);
      res.json({ archived: true, message: 'Notification archivée' });
    } catch (err) {
      next(err);
    }
  }
);

// POST /archive-all
router.post('/archive-all', writeLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const count = await notificationsModule.archiveAll(req.user.id);
    res.json({ archived: count, message: `${count} notifications archivées` });
  } catch (err) {
    next(err);
  }
});

// POST /:id/unarchive
router.post('/:id/unarchive', writeLimiter, requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const notification = await prisma.notification.findUnique({ where: { id: req.params.id }, select: { userId: true } });
      if (!notification || notification.userId !== req.user.id) return res.status(404).json({ error: 'Notification introuvable' });
      await notificationsModule.unarchive(req.params.id);
      res.json({ archived: false, message: 'Notification restaurée' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
