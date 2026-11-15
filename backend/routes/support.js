const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const SupportModule = require('../modules/support');
const prisma = require('../config/db');

const router = express.Router();
const support = new SupportModule(prisma);

router.use(requireAuth);

const createTicketLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tickets créés, réessayez dans une heure' } });
const ticketMessageLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de messages envoyés, réessayez dans une heure' } });
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' } });

// GET /api/support/tickets
router.get('/tickets', readLimiter, handleValidationErrors, async (req, res, next) => {
  try {
    const tickets = await support.listTickets(req.user.id);
    res.json(tickets);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/support/tickets
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
    const ticket = await support.createTicket(req.user.id, { category, subject, message });
    res.status(201).json(ticket);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/support/tickets/:id
router.get('/tickets/:id', readLimiter, async (req, res, next) => {
  try {
    const ticket = await support.getTicket(req.params.id, req.user.id);
    res.json(ticket);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/support/tickets/:id/messages
router.post('/tickets/:id/messages', ticketMessageLimiter,
  [body('message').trim().notEmpty().isLength({ min: 1, max: 5000 }).withMessage('message required, max 5000 chars')],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const msg = await support.addMessage(req.params.id, req.user.id, req.body.message);
    res.status(201).json(msg);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/support/tickets/:id
router.patch('/tickets/:id', async (req, res, next) => {
  try {
    const updated = await support.updateStatus(req.params.id, req.user.id, req.body.status);
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
