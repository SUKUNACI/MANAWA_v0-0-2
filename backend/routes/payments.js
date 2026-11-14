'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { createPayment: gpCreatePayment } = require('../utils/geniuspay');
const { logPaymentStatus } = require('../utils/paymentAudit');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

const router = express.Router();

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
      const { quoteId, amount, isDeposit = false } = req.body;

      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: { client: true, professional: true },
      });

      if (!quote) {
        return res.status(404).json({ error: 'Devis non trouvé' });
      }

      if (quote.clientId !== req.user.id) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const existingPayment = await prisma.payment.findUnique({ where: { quoteId } });
      if (existingPayment && existingPayment.status === 'pending') {
        return res.status(400).json({ error: 'Paiement déjà en cours pour ce devis' });
      }

      const payment = await prisma.payment.create({
        data: {
          quoteId,
          amount,
          isDeposit,
          status: 'pending',
          idempotencyKey: `${quoteId}-${Date.now()}`,
        },
      });

      await logPaymentStatus({
        paymentId: payment.id,
        fromStatus: 'created',
        toStatus: 'pending',
        reason: 'payment_created',
      });

      try {
        const gpResult = await gpCreatePayment({ quoteId, amount, isDeposit });
        const paymentUrl = gpResult.payment_url || gpResult.checkout_url;
        const geniuspayRef = gpResult.reference || gpResult.id || null;

        await prisma.payment.update({
          where: { id: payment.id },
          data: { geniuspayRef },
        });

        return res.status(201).json({
          success: true,
          data: { paymentId: payment.id, amount, status: 'pending', paymentUrl },
        });
      } catch (gpErr) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'failed' },
        });
        logger.error('[Payments] GeniusPay error', { error: gpErr.message });
        return res.status(500).json({ error: "Erreur lors de l'initialisation du paiement" });
      }
    } catch (err) {
      logger.error('[Payments] Create payment error', { error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la création du paiement' });
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

      const [groupByResult, total, aggregate] = await Promise.all([
        prisma.payment.groupBy({
          by: ['status'],
          _count: true,
          _sum: { amount: true },
        }),
        prisma.payment.count(),
        prisma.payment.aggregate({ _sum: { amount: true } }),
      ]);

      const byStatus = {};
      for (const row of groupByResult) {
        byStatus[row.status] = {
          count: row._count,
          amount: row._sum.amount ?? 0,
        };
      }

      return res.json({
        success: true,
        data: {
          total,
          totalAmount: aggregate._sum.amount ?? 0,
          byStatus,
        },
      });
    } catch (err) {
      logger.error('[Payments] Stats error', { error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
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
      const { quoteId, status } = req.query;
      const sortableFields = getSortableFields('payment');
      const pagination = buildPaginationQuery(req.query, sortableFields);

      const where = { quote: { clientId: req.user.id } };
      if (quoteId) where.quoteId = quoteId;
      if (status) where.status = status;

      const payments = await prisma.payment.findMany({
        where,
        include: { quote: { select: { id: true, title: true } } },
        ...pagination,
      });

      return res.json({ success: true, data: payments });
    } catch (err) {
      logger.error('[Payments] List payments error', { error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la récupération des paiements' });
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
      const payment = await prisma.payment.findUnique({
        where: { id: req.params.paymentId },
        include: {
          quote: { include: { client: true } },
          auditLogs: true,
        },
      });

      if (!payment) {
        return res.status(404).json({ error: 'Paiement non trouvé' });
      }

      const isAdmin = req.user.role === 'ADMIN' || Boolean(req.user.adminLevel);
      const isOwner = payment.quote?.clientId === req.user.id;

      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const metadata = typeof payment.metadata === 'string'
        ? JSON.parse(payment.metadata)
        : payment.metadata ?? null;

      return res.json({
        success: true,
        data: { ...payment, metadata },
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      logger.error('[Payments] Get payment error', { error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la récupération du paiement' });
    }
  }
);

module.exports = router;
