'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const PaymentsModule = require('../modules/payments');

const router = express.Router();
const paymentsModule = new PaymentsModule(prisma);

// POST /api/v1/payments/create — create a new payment
router.post(
  '/create',
  requireAuth,
  [
    body('quoteId').isUUID().withMessage('quoteId must be a valid UUID'),
    body('amount').isFloat({ min: 0.01 }).withMessage('amount must be a positive number'),
    body('isDeposit').optional().isBoolean().withMessage('isDeposit must be a boolean'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await paymentsModule.createPaymentIntent(req.body, req.user);
      return res.status(201).json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      logger.error('[Payments] Create payment error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la création du paiement' });
    }
  }
);

// GET /api/v1/payments/stats/overview — payment statistics (admin only)
router.get(
  '/stats/overview',
  requireAuth,
  async (req, res) => {
    try {
      if (req.user.role !== 'ADMIN' && !req.user.adminLevel) {
        return res.status(403).json({ error: 'Administrateurs uniquement' });
      }
      const data = await paymentsModule.getMetrics(req.query);
      res.json({ success: true, data });
    } catch (err) {
      logger.error('[Payments] Stats error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
  }
);

// GET /api/v1/payments — list payments for authenticated user
router.get(
  '/',
  requireAuth,
  [
    query('quoteId').optional().isUUID().withMessage('quoteId must be a valid UUID'),
    query('status').optional().isIn(['pending', 'succeeded', 'failed']).withMessage('status must be pending, succeeded, or failed'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await paymentsModule.listPaymentsForUser(req.user.id, req.query);
      res.json(result);
    } catch (err) {
      logger.error('[Payments] List payments error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération des paiements' });
    }
  }
);

// GET /api/v1/payments/:paymentId — get payment details
router.get(
  '/:paymentId',
  requireAuth,
  [param('paymentId').isUUID().withMessage('paymentId must be a valid UUID')],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await paymentsModule.getDetails(req.params.paymentId, req.user);
      if (!result) return res.status(404).json({ error: 'Paiement non trouvé' });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      logger.error('[Payments] Get payment error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération du paiement' });
    }
  }
);

module.exports = router;
