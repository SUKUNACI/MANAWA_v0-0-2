const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { createPayment } = require('../utils/geniuspay');
const { emailQueue } = require('../config/queue');
const { sendNotification } = require('../utils/notification-triggers');

const router = express.Router();

/**
 * Q53: POST /api/v1/payments/:paymentId/retry
 * Retry a failed payment with promo code reapplication
 *
 * Request body:
 * {
 *   paymentMethod?: string (optional, allow user to change payment method)
 * }
 *
 * Success response:
 * {
 *   success: true,
 *   data: {
 *     paymentId: string,
 *     status: 'pending' | 'succeeded',
 *     amount: number,
 *     appliedPromoCode?: string,
 *     discountAmount?: number,
 *     geniuspayRef?: string,
 *     retryAttempt: number,
 *     message: string
 *   }
 * }
 *
 * Error responses:
 * - 400: Invalid payment state or validation error
 * - 401: Not authenticated
 * - 403: Not payment owner
 * - 404: Payment not found
 * - 500: GeniusPay error or processing error
 */
router.post(
  '/:paymentId/retry',
  requireAuth,
  [
    param('paymentId')
      .isUUID()
      .withMessage('paymentId must be a valid UUID'),
    body('paymentMethod')
      .optional()
      .isString()
      .withMessage('paymentMethod must be a string'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    const { paymentId } = req.params;
    const { paymentMethod } = req.body;
    const userId = req.user.id;

    try {
      logger.info('[PaymentRetry] Starting retry process', {
        paymentId,
        userId,
        paymentMethod,
      });

      // 1. Fetch payment with related data
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          quote: {
            include: {
              project: {
                include: {
                  client: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                  },
                },
              },
              professional: {
                include: {
                  user: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                  },
                },
              },
            },
          },
          auditLogs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      // 2. Validate payment exists
      if (!payment) {
        logger.warn('[PaymentRetry] Payment not found', { paymentId, userId });
        return res.status(404).json({
          success: false,
          error: 'Paiement introuvable',
        });
      }

      // 3. Verify user is payment owner (through quote's project client or professional)
      const clientId = payment.quote?.project?.clientId;
      const professionalId = payment.quote?.professionalId;
      const isOwner = userId === clientId ||
                     (professionalId && userId === payment.quote.professional.userId);

      if (!isOwner) {
        logger.warn('[PaymentRetry] Unauthorized access attempt', {
          paymentId,
          userId,
          clientId,
          professionalId,
        });
        return res.status(403).json({
          success: false,
          error: 'Non autorisé à réessayer ce paiement',
        });
      }

      // 4. Check payment status must be 'failed'
      if (payment.status !== 'failed') {
        logger.warn('[PaymentRetry] Invalid payment status for retry', {
          paymentId,
          currentStatus: payment.status,
        });
        return res.status(400).json({
          success: false,
          error: `Le paiement ne peut pas être réessayé (statut: ${payment.status})`,
        });
      }

      // 5. Count retry attempts (check audit logs)
      const retryAttempts = payment.auditLogs.filter(
        log => log.reason === 'retry'
      ).length;

      const MAX_RETRY_ATTEMPTS = 3;
      if (retryAttempts >= MAX_RETRY_ATTEMPTS) {
        logger.warn('[PaymentRetry] Max retry attempts exceeded', {
          paymentId,
          retryAttempts,
        });
        return res.status(400).json({
          success: false,
          error: `Maximum ${MAX_RETRY_ATTEMPTS} tentatives atteint. Veuillez contacter le support.`,
        });
      }

      // 6. Reapply promo code if used before
      let promoUsage = null;
      let finalAmount = payment.amount;
      let appliedPromoCode = null;
      let discountAmount = 0;

      // Check if there was a promo usage linked to this payment
      // (assuming metadata contains promoCodeId)
      let metadata = {};
      if (payment.metadata) {
        try {
          metadata = JSON.parse(payment.metadata);
        } catch (e) {
          metadata = {};
        }
      }

      if (metadata.promoCodeId) {
        const promoCode = await prisma.promoCode.findUnique({
          where: { id: metadata.promoCodeId },
        });

        if (promoCode && promoCode.active && (!promoCode.validUntil || new Date(promoCode.validUntil) > new Date())) {
          // Calculate discount again
          if (promoCode.discountType === 'PERCENT') {
            discountAmount = payment.amount * (promoCode.discountValue / 100);
          } else if (promoCode.discountType === 'FIXED') {
            discountAmount = Math.min(promoCode.discountValue, payment.amount);
          }

          finalAmount = Math.max(0, payment.amount - discountAmount);
          appliedPromoCode = promoCode.code;

          logger.info('[PaymentRetry] Promo code reapplied', {
            paymentId,
            promoCode: promoCode.code,
            originalAmount: payment.amount,
            discountAmount,
            finalAmount,
          });
        }
      }

      // 7. Prepare GeniusPay payload
      const idempotencyKey = `retry-${paymentId}-${retryAttempts + 1}`;
      const clientData = payment.quote.project.client;
      const successUrl = `${process.env.APP_URL}/payments/success?paymentId=${paymentId}`;
      const errorUrl = `${process.env.APP_URL}/payments/error?paymentId=${paymentId}`;

      const geniuspayPayload = {
        amount: finalAmount,
        description: `Réessai: Paiement pour projet ${payment.quote.project.title}`,
        customerName: `${clientData.firstName} ${clientData.lastName}`,
        customerEmail: clientData.email,
        customerPhone: payment.quote.project.client.phone || '',
        quoteId: payment.quote.id,
        projectId: payment.quote.project.id,
        isDeposit: payment.isDeposit,
        userId: clientData.id,
        successUrl,
        errorUrl,
        idempotencyKey,
      };

      // 8. Call GeniusPay to initiate retry payment
      let geniuspayResponse;
      try {
        geniuspayResponse = await createPayment(geniuspayPayload);

        if (!geniuspayResponse.reference) {
          throw new Error('GeniusPay did not return payment reference');
        }

        logger.info('[PaymentRetry] GeniusPay payment initiated', {
          paymentId,
          geniuspayRef: geniuspayResponse.reference,
          amount: finalAmount,
        });
      } catch (err) {
        logger.error('[PaymentRetry] GeniusPay error', {
          paymentId,
          error: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });

        // Log the retry attempt failure
        await prisma.paymentAuditLog.create({
          data: {
            paymentId,
            fromStatus: payment.status,
            toStatus: payment.status,
            reason: 'retry_failed',
            triggeredBy: userId,
            ipAddress: req.ip,
            metadata: JSON.stringify({
              attempt: retryAttempts + 1,
              error: err.message,
              geniuspayStatus: err.response?.status,
            }),
          },
        });

        return res.status(500).json({
          success: false,
          error: 'Impossible de réessayer le paiement. Veuillez réessayer plus tard.',
          details: process.env.NODE_ENV === 'development' ? err.message : undefined,
        });
      }

      // 9. Update payment with retry info
      const updatedPayment = await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'pending',
          geniuspayRef: geniuspayResponse.reference,
          amount: finalAmount,
          metadata: JSON.stringify({
            ...metadata,
            retryAttempt: retryAttempts + 1,
            retriedAt: new Date().toISOString(),
            previousStatus: 'failed',
            appliedPromoCode: appliedPromoCode || null,
            discountAmount: discountAmount || 0,
          }),
          updatedAt: new Date(),
        },
      });

      // 10. Log the retry attempt
      await prisma.paymentAuditLog.create({
        data: {
          paymentId,
          fromStatus: payment.status,
          toStatus: 'pending',
          reason: 'retry',
          triggeredBy: userId,
          ipAddress: req.ip,
          metadata: JSON.stringify({
            attempt: retryAttempts + 1,
            geniuspayRef: geniuspayResponse.reference,
            appliedPromoCode,
            discountAmount,
            finalAmount,
          }),
        },
      });

      // 11. Send notification to user about retry
      await sendNotification('PAYMENT_RETRY_INITIATED', {
        userId: clientData.id,
        data: {
          paymentId,
          amount: finalAmount,
          appliedPromoCode,
          discountAmount,
        },
      }).catch(err => logger.error('[PaymentRetry] Notification error', { error: err.message }));

      // 12. Queue confirmation email
      await emailQueue.add(
        {
          type: 'paymentRetry',
          email: clientData.email,
          variables: {
            firstName: clientData.firstName,
            amount: finalAmount,
            appliedPromoCode,
            discountAmount,
            paymentId,
            geniuspayUrl: geniuspayResponse.payment_link || geniuspayResponse.redirect_url,
          },
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
        }
      );

      logger.info('[PaymentRetry] Retry successful', {
        paymentId,
        userId,
        retryAttempt: retryAttempts + 1,
        geniuspayRef: geniuspayResponse.reference,
        finalAmount,
      });

      res.json({
        success: true,
        data: {
          paymentId: updatedPayment.id,
          status: updatedPayment.status,
          amount: updatedPayment.amount,
          appliedPromoCode: appliedPromoCode || null,
          discountAmount: discountAmount || 0,
          geniuspayRef: geniuspayResponse.reference,
          retryAttempt: retryAttempts + 1,
          message: `Paiement réessayé avec succès. Tentative ${retryAttempts + 1}/${MAX_RETRY_ATTEMPTS}`,
          paymentLink: geniuspayResponse.payment_link || geniuspayResponse.redirect_url,
        },
      });
    } catch (err) {
      logger.error('[PaymentRetry] Unexpected error', {
        paymentId,
        userId,
        error: err.message,
        stack: err.stack,
      });
      next(err);
    }
  }
);

module.exports = router;
