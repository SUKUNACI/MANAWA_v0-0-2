const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireEmailVerified } = require('../middleware/auth');
const { sendPushNotification } = require('../config/pushNotifications');
const upload = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');

const router = express.Router();

// Rate limiters
// 60 messages max par heure par utilisateur
const messageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de messages envoyés, réessayez dans une heure' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 uploads per minute
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
    const { receiverId, content } = req.body;
    if (!receiverId || !content || !content.trim()) {
      return res.status(400).json({ error: 'receiverId et content sont requis' });
    }

    // Validate message length
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    if (content.length > 5000) {
      return res.status(400).json({ error: 'Message too long (max 5000 chars)' });
    }

    // Security: reject null bytes
    if (content.includes('\x00') || content.includes('\0')) {
      return res.status(400).json({ error: 'Invalid content' });
    }

    // Vérifier que le destinataire existe et n'est pas suspendu
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, suspended: true, role: true },
    });
    if (!receiver) return res.status(404).json({ error: 'Destinataire introuvable' });
    if (receiver.suspended) return res.status(403).json({ error: 'Ce compte est suspendu' });

    // Un utilisateur ne peut envoyer un message qu'à quelqu'un avec qui il a une relation :
    // CLIENT → PROFESSIONAL : doit avoir un projet en commun (devis soumis ou accepté)
    // PROFESSIONAL → CLIENT : idem
    // Tout autre combinaison (CLIENT→CLIENT, etc.) est refusée
    const senderId = req.user.id;
    const senderRole = req.user.role;
    const receiverRole = receiver.role;

    if (senderRole !== 'ADMIN' && receiverRole !== 'ADMIN') {
      // Vérifier une relation via devis ou projet
      const clientId   = senderRole === 'CLIENT' ? senderId : receiverId;
      const proUserId  = senderRole === 'PROFESSIONAL' ? senderId : receiverId;

      if ((senderRole === 'CLIENT' && receiverRole !== 'PROFESSIONAL') ||
          (senderRole === 'PROFESSIONAL' && receiverRole !== 'CLIENT')) {
        return res.status(403).json({ error: 'Messagerie réservée aux échanges client-professionnel' });
      }

      const pro = await prisma.professional.findUnique({ where: { userId: proUserId }, select: { id: true } });
      if (!pro) return res.status(403).json({ error: 'Aucune relation avec ce professionnel' });

      const hasRelation = await prisma.quote.findFirst({
        where: {
          professionalId: pro.id,
          project: { clientId },
        },
        select: { id: true },
      });

      // Autoriser aussi si une conversation existe déjà (pour les suites d'échanges)
      const existingConversation = await prisma.message.findFirst({
        where: {
          OR: [
            { senderId, receiverId },
            { senderId: receiverId, receiverId: senderId },
          ],
        },
        select: { id: true },
      });

      if (!hasRelation && !existingConversation) {
        return res.status(403).json({ error: 'Vous ne pouvez contacter ce professionnel qu\'après avoir soumis un projet' });
      }
    }

    const { attachmentUrl, attachmentType } = req.body;
    const message = await prisma.message.create({
      data: {
        senderId: req.user.id,
        receiverId,
        content: content.trim(),
        ...(attachmentUrl ? { attachmentUrl, attachmentType: attachmentType || null } : {}),
      },
    });

    // Notifier le destinataire
    const sender = await prisma.user.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } });
    const senderName = sender ? sender.firstName + ' ' + sender.lastName : 'Quelqu\'un';
    await sendPushNotification(receiverId, 'Nouveau message', `${senderName} : ${content.trim().substring(0, 80)}`, { type: 'new_message', senderId: req.user.id });

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/conversations
router.get('/conversations', readLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: req.user.id }, { receiverId: req.user.id }] },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        receiver: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const conversations = new Map();
    for (const m of messages) {
      const otherUser = m.senderId === req.user.id ? m.receiver : m.sender;
      if (!conversations.has(otherUser.id)) {
        conversations.set(otherUser.id, { otherUser, lastMessage: m });
      }
    }
    res.json(Array.from(conversations.values()));
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/unread-count
router.get('/unread-count', readLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const count = await prisma.message.count({ where: { receiverId: req.user.id, read: false } });
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
    const { limit, skip, offset } = applyPageBasedPagination(req.query, 'messages');

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: {
          OR: [
            { senderId: req.user.id, receiverId: req.params.userId },
            { senderId: req.params.userId, receiverId: req.user.id },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.message.count({
        where: {
          OR: [
            { senderId: req.user.id, receiverId: req.params.userId },
            { senderId: req.params.userId, receiverId: req.user.id },
          ],
        },
      }),
      prisma.message.updateMany({
        where: { senderId: req.params.userId, receiverId: req.user.id, read: false },
        data: { read: true },
      }),
    ]);

    res.json(buildPaginatedResponse(messages.reverse(), limit, offset, total));
  } catch (err) {
    next(err);
  }
});

const ATTACHMENT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

router.post('/upload-attachment', uploadLimiter, requireAuth, upload.single('file'), handleValidationErrors, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
    if (!ATTACHMENT_MIMES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Type de fichier non autorisé. Formats acceptés : JPEG, PNG, WebP, PDF' });
    }
    const url = await uploadBuffer(req.file.buffer, 'manawa_attachments');
    const type = req.file.mimetype === 'application/pdf' ? 'pdf' : 'image';
    res.json({ url, type, name: req.file.originalname });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
