const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { requireAuth } = require('../middleware/auth');
const { sendPushNotification } = require('../config/pushNotifications');
const { handleValidationErrors } = require('../middleware/validateInput');

const router = express.Router();

router.use(requireAuth);

// Rate limiters
// 5 tickets max par heure, 20 messages par heure
const createTicketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tickets créés, réessayez dans une heure' },
});

const ticketMessageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de messages envoyés, réessayez dans une heure' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// GET /api/support/tickets — mes tickets
router.get('/tickets', handleValidationErrors, async (req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    res.json(tickets);
  } catch (err) {
    next(err);
  }
});

// POST /api/support/tickets — créer un ticket
router.post('/tickets', createTicketLimiter,
  [
    body('category').trim().notEmpty().isLength({ max: 100 }).withMessage('category required'),
    body('subject').trim().notEmpty().isLength({ min: 5, max: 200 }).withMessage('subject required, 5-200 chars'),
    body('message').trim().notEmpty().isLength({ min: 1, max: 2000 }).withMessage('message required, max 2000 chars'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { category, subject, message } = req.body;
    if (!category || !subject || !message) {
      return res.status(400).json({ error: 'Catégorie, sujet et message sont requis' });
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.user.id,
        category,
        subject,
        messages: {
          create: { senderId: req.user.id, content: message, isAdmin: false },
        },
      },
      include: { messages: true },
    });

    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
});

// GET /api/support/tickets/:id — détail d'un ticket avec messages
router.get('/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });
    res.json(ticket);
  } catch (err) {
    next(err);
  }
});

// POST /api/support/tickets/:id/messages — répondre à un ticket
router.post('/tickets/:id/messages', ticketMessageLimiter, async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });
    if (ticket.status === 'CLOSED') return res.status(400).json({ error: 'Ce ticket est fermé' });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message requis' });

    // Validate message length
    if (message && message.length > 5000) {
      return res.status(400).json({ error: 'Message trop long' });
    }

    // Security: XSS detection
    const xssPatterns = /<script|<img|<iframe|onerror|onload|onclick/i;
    if (message && xssPatterns.test(message)) {
      return res.status(400).json({ error: 'Contenu invalide (XSS detected)' });
    }

    // Security: SQL injection detection
    const sqlPatterns = /'; DROP|DELETE FROM|INSERT INTO|UNION SELECT/i;
    if (message && sqlPatterns.test(message)) {
      return res.status(400).json({ error: 'Contenu invalide' });
    }

    // Security: null bytes
    if (message && (message.includes('\x00') || message.includes('\0'))) {
      return res.status(400).json({ error: 'Contenu invalide' });
    }

    const msg = await prisma.supportMessage.create({
      data: { ticketId: ticket.id, senderId: req.user.id, content: message, isAdmin: false },
    });

    await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'OPEN' } });

    res.status(201).json(msg);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/support/tickets/:id — mettre à jour le statut d'un ticket
router.patch('/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });

    const { status } = req.body;
    if (!status || !['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
