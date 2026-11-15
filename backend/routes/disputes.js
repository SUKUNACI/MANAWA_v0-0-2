const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendPushNotification } = require('../config/pushNotifications');
const { handleValidationErrors } = require('../middleware/validateInput');
const DisputeModule = require('../modules/dispute');

const router = express.Router();
const dispute = new DisputeModule(prisma, sendPushNotification);

const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' } });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' } });

// POST /api/disputes
router.post('/', writeLimiter, requireAuth, requireRole('CLIENT'),
  [
    body('paymentId').trim().notEmpty().withMessage('paymentId requis'),
    body('reason').trim().notEmpty().isLength({ max: 100 }).withMessage('reason required and max 100 chars'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('description max 1000 chars'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { paymentId, reason, description } = req.body;
    const result = await dispute.open({ paymentId, reason, description, clientId: req.user.id });
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/disputes/mine
router.get('/mine', readLimiter, requireAuth, requireRole('CLIENT'), handleValidationErrors, async (req, res, next) => {
  try {
    const disputes = await dispute.listForClient(req.user.id);
    res.json(disputes);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/disputes/:id
router.get('/:id', readLimiter, requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const result = await dispute.getDetail(req.params.id, req.user.id, req.user.role);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
