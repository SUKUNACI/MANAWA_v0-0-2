const express = require('express');
const { body, param, validationResult, query } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { createPayment } = require('../utils/geniuspay');
const { logPaymentStatus } = require('../utils/paymentAudit');
const crypto = require('crypto');

const router = express.Router();

/**
 * Payment Routes
 * Handles payment creation, status retrieval, and management
 */

/**
 * POST /api/v1/payments/create
 * Create a new payment
 */
router.post(
  '/create',
  requireAuth,
  [
    body('quoteId')
      .isUUID()
      .withMessage('quoteId must be a valid UUID'),
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('amount must be a positive number'),
    body('isDeposit')
      .optional()
      .isBoolean()
      .withMessage('isDeposit must be a boolean'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { quoteId, amount, isDeposit = true } = req.body;

      // Verify quote exists and user is authorized
      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: { client: true, professional: true },
      });

      if (!quote) {
        return res.status(404).json({ error: 'Devis non trouvé' });
      }

      if (quote.clientId !== req.user.id) {
        return res.status(403).json({ error: 'Non autorisé à payer ce devis' });
      }

      // Check if payment already exists
      const existingPayment = await prisma.payment.findUnique({
        where: { quoteId_isDeposit: { quoteId, isDeposit } },
      });

      if (existingPayment && existingPayment.status === 'pending') {
        return res.status(400).json({ error: 'Un paiement est déjà en cours pour ce devis' });
      }

      // Create idempotency key
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`${quoteId}-${isDeposit}-${Date.now()}`)
        .digest('hex');

      // Create payment in database
      const payment = await prisma.payment.create({
        data: {
          quoteId,
          amount,
          isDeposit,
          status: 'pending',
          idempotencyKey,
        },
      });

      // Log payment creation
      await logPaymentStatus({
        paymentId: payment.id,
        fromStatus: 'created',
        toStatus: 'pending',
        reason: 'payment_created',
      });

      // Initiate payment with GeniusPay
      try {
        const gpPayment = await createPayment({
          amount,
          description: `${isDeposit ? 'Acompte' : 'Solde'} - Devis #${quote.id.substring(0, 8)}`,
          customerName: quote.client.firstName + ' ' + quote.client.lastName,
          customerEmail: quote.client.email,
          customerPhone: quote.client.phone,
          quoteId,
          projectId: quote.projectId,
          isDeposit,
          userId: quote.clientId,
          idempotencyKey,
          successUrl: `${process.env.APP_URL}/payments/${payment.id}/success`,
          errorUrl: `${process.env.APP_URL}/payments/${payment.id}/error`,
        });

        // Update payment with GeniusPay reference
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            geniuspayRef: gpPayment.reference || gpPayment.id,
            metadata: JSON.stringify(gpPayment),
          },
        });

        return res.status(201).json({
          success: true,
          data: {
            paymentId: payment.id,
            amount,
            status: 'pending',
            paymentUrl: gpPayment.payment_url || gpPayment.checkout_url,
          },
        });
      } catch (gpErr) {
        logger.error('[Payments] GeniusPay creation error', {
          paymentId: payment.id,
          error: gpErr.message,
        });

        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'failed' },
        });

        return res.status(500).json({ error: 'Erreur lors de l\'initialisation du paiement' });
      }
    } catch (err) {
      logger.error('[Payments] Create payment error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la création du paiement' });
    }
  }
);

/**
 * GET /api/v1/payments/:paymentId
 * Get payment details
 */
router.get(
  '/:paymentId',
  requireAuth,
  [
    param('paymentId')
      .isUUID()
      .withMessage('paymentId must be a valid UUID'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { paymentId } = req.params;

      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          quote: { include: { client: true } },
          auditLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
        },
      });

      if (!payment) {
        return res.status(404).json({ error: 'Paiement non trouvé' });
      }

      // Verify authorization
      if (payment.quote.clientId !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Non autorisé à accéder ce paiement' });
      }

      res.json({
        success: true,
        data: {
          id: payment.id,
          quoteId: payment.quoteId,
          amount: payment.amount,
          status: payment.status,
          isDeposit: payment.isDeposit,
          createdAt: payment.createdAt,
          completedAt: payment.completedAt,
          metadata: payment.metadata ? JSON.parse(payment.metadata) : null,
          auditLogs: payment.auditLogs,
        },
      });
    } catch (err) {
      logger.error('[Payments] Get payment error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération du paiement' });
    }
  }
);

/**
 * GET /api/v1/payments?quoteId=...&status=...
 * List payments for authenticated user
 */
router.get(
  '/',
  requireAuth,
  [
    query('quoteId')
      .optional()
      .isUUID()
      .withMessage('quoteId must be a valid UUID'),
    query('status')
      .optional()
      .isIn(['pending', 'succeeded', 'failed'])
      .withMessage('status must be pending, succeeded, or failed'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { quoteId, status } = req.query;

      const where = {
        quote: {
          clientId: req.user.id,
        },
      };

      if (quoteId) where.quoteId = quoteId;
      if (status) where.status = status;

      const payments = await prisma.payment.findMany({
        where,
        include: { quote: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      res.json({
        success: true,
        data: payments.map(p => ({
          id: p.id,
          quoteId: p.quoteId,
          amount: p.amount,
          status: p.status,
          isDeposit: p.isDeposit,
          createdAt: p.createdAt,
          completedAt: p.completedAt,
        })),
      });
    } catch (err) {
      logger.error('[Payments] List payments error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération des paiements' });
    }
  }
);

/**
 * GET /api/v1/payment-stats
 * Get payment statistics (admin only)
 */
router.get(
  '/stats/overview',
  requireAuth,
  async (req, res) => {
    try {
      // Check admin authorization
      if (req.user.role !== 'ADMIN' && !req.user.adminLevel) {
        return res.status(403).json({ error: 'Administrateurs uniquement' });
      }

      const stats = await prisma.payment.groupBy({
        by: ['status'],
        _count: true,
        _sum: { amount: true },
      });

      const total = await prisma.payment.count();
      const totalAmount = await prisma.payment.aggregate({
        _sum: { amount: true },
      });

      res.json({
        success: true,
        data: {
          total,
          totalAmount: totalAmount._sum.amount || 0,
          byStatus: stats.reduce((acc, s) => {
            acc[s.status] = { count: s._count, amount: s._sum.amount || 0 };
            return acc;
          }, {}),
        },
      });
    } catch (err) {
      logger.error('[Payments] Stats error', { error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
  }
);

module.exports = router;
