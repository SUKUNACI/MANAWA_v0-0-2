/**
 * Message Routes
 * HTTP layer only — business logic delegated to MessageModule.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireEmailVerified } = require('../middleware/auth');
const { sendPushNotification } = require('../config/pushNotifications');
const upload = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery } = require('../utils/pagination-helper');
const MessageModule = require('../modules/message');

const router = express.Router();
const messageModule = new MessageModule(prisma);

// Rate limiters
const messageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de messages envoyés, réessayez dans une heure' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de téléchargements, réessayez dans une minute' },
});

// POST /api/messages
router.post('/', requireAuth, requireEmailVerified, messageLimiter,
  [
    body('receiverId').trim().notEmpty().withMessage('receiverId requis'),
    body('content').trim().notEmpty().isLength({ min: 1, max: 5000 }).withMessage('content required, max 5000 chars'),
    body('attachmentUrl').optional().trim().isLength({ max: 2000 }).withMessage('attachmentUrl too long'),
    body('attachmentType').optional().trim().isIn(['image', 'pdf']).withMessage('invalid attachmentType'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { receiverId, content, attachmentUrl, attachmentType } = req.body;

      const message = await messageModule.send({
        senderId: req.user.id,
        senderRole: req.user.role,
        receiverId,
        content,
        attachmentUrl,
        attachmentType,
      });

      const senderName = await messageModule.getSenderName(req.user.id);
      await sendPushNotification(receiverId, 'Nouveau message', `${senderName} : ${content.trim().substring(0, 80)}`, { type: 'new_message', senderId: req.user.id });

      res.status(201).json(message);
    } catch (err) {
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

// GET /api/messages/conversations
router.get('/conversations', readLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const conversations = await messageModule.listConversations(req.user.id);
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/unread-count
router.get('/unread-count', readLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const count = await messageModule.getUnreadCount(req.user.id);
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/:userId
router.get('/:userId', readLimiter, requireAuth,
  [
    param('userId').trim().notEmpty().withMessage('userId requis'),
    ...validatePageBasedPaginationQuery(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { limit, skip } = applyPageBasedPagination(req.query, 'messages');
      const messages = await messageModule.getThread(req.user.id, req.params.userId, { limit, skip });
      res.json(messages);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/messages/upload-attachment
router.post('/upload-attachment', uploadLimiter, requireAuth, upload.single('file'), handleValidationErrors, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
    if (!messageModule.isAllowedMime(req.file.mimetype)) {
      return res.status(400).json({ error: 'Type de fichier non autorisé. Formats acceptés : JPEG, PNG, WebP, PDF' });
    }
    const url = await uploadBuffer(req.file.buffer, 'manawa_attachments');
    const type = messageModule.resolveAttachmentType(req.file.mimetype);
    res.json({ url, type, name: req.file.originalname });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
