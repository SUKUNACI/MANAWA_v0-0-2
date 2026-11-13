const express = require('express');
const rawBody = require('raw-body');
const prisma = require('../config/db');
const { logPaymentStatus } = require('../utils/paymentAudit');
const geniuspay = require('../utils/geniuspay');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

const router = express.Router();

/**
 * Q51: GeniusPay Webhook Route
 * POST /api/v1/webhooks/geniuspay
 *
 * Receives payment events from GeniusPay:
 * - payment.succeeded
 * - payment.failed
 * - payment.cancelled
 *
 * Verifies HMAC-SHA256 signature and updates payment status
 */

// Middleware to capture raw body for webhook signature verification.
// When express.json() runs first (e.g., in tests), the stream is already consumed
// and req.body is populated; skip rawBody in that case.
router.use((req, res, next) => {
  if (req.originalUrl.endsWith('/webhooks/geniuspay') && req.readable) {
    rawBody(req, { encoding: 'utf-8' }, (err, body) => {
      if (err) {
        logger.error('[Webhook GeniusPay] Raw body parse error', { error: err.message });
        return res.status(400).json({ error: 'Invalid request body' });
      }
      req.rawBody = body;
      next();
    });
  } else {
    next();
  }
});

/**
 * POST /api/v1/webhooks/geniuspay
 * Receive and process GeniusPay payment events
 */
router.post('/', async (req, res) => {
  try {
    // 1. Verify webhook signature
    const signature = req.headers['x-geniuspay-signature'];
    const timestamp = req.headers['x-geniuspay-timestamp'];

    if (!signature || !timestamp) {
      logger.warn('[Webhook GeniusPay] Missing signature or timestamp headers');
      return res.status(400).json({ error: 'Missing signature or timestamp' });
    }

    // Parse payload — raw body for signature verification, fallback to req.body
    let payload;
    try {
      payload = req.rawBody ? JSON.parse(req.rawBody) : req.body;
      if (!payload || typeof payload !== 'object') {
        payload = {};
      }
    } catch (err) {
      logger.error('[Webhook GeniusPay] JSON parse error', { error: err.message });
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    // Verify signature
    const isValidSignature = geniuspay.verifyWebhookSignature(signature, timestamp, payload);
    if (!isValidSignature) {
      logger.warn('[Webhook GeniusPay] Invalid signature', { signature, timestamp });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Verify timestamp (prevent replay attacks)
    const isValidTimestamp = geniuspay.verifyWebhookTimestamp(timestamp);
    if (!isValidTimestamp) {
      logger.warn('[Webhook GeniusPay] Timestamp too old', { timestamp });
      return res.status(401).json({ error: 'Request timestamp too old' });
    }

    // 2. Parse event type and data
    const eventType = payload.event?.type;
    const eventData = payload.data;

    logger.info('[Webhook GeniusPay] Received event', { eventType, reference: eventData?.reference });

    if (!eventType || !eventData) {
      logger.warn('[Webhook GeniusPay] Missing event type or data');
      return res.status(200).json({ received: true }); // Still return 200
    }

    // 3. Find payment by GeniusPay reference
    const payment = await prisma.payment.findFirst({
      where: { geniuspayRef: eventData.reference },
      include: { quote: { include: { project: { include: { client: true } }, professional: true } } },
    });

    if (!payment) {
      logger.warn('[Webhook GeniusPay] Payment not found', { reference: eventData.reference });
      return res.status(200).json({ received: true }); // Still return 200 to acknowledge
    }

    const oldStatus = payment.status;
    let newStatus = oldStatus;
    let shouldNotify = false;

    // 4. Update payment status based on event type
    switch (eventType) {
      case 'payment.succeeded':
      case 'payment.completed':
        if (oldStatus !== 'succeeded') {
          newStatus = 'succeeded';
          shouldNotify = true;

          // Verify amount tolerance (±1 XOF)
          const receivedAmount = eventData.amount || eventData.paid_amount;
          if (receivedAmount && Math.abs(receivedAmount - payment.amount) > 1) {
            logger.warn('[Webhook GeniusPay] Amount mismatch detected', {
              expected: payment.amount,
              received: receivedAmount,
              paymentId: payment.id,
            });
            newStatus = 'failed';
            shouldNotify = true;

            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: newStatus,
                metadata: JSON.stringify({
                  failureReason: 'amount_mismatch',
                  expected: payment.amount,
                  received: receivedAmount,
                  geniuspayData: eventData,
                  webhookReceivedAt: new Date().toISOString(),
                }),
              },
            });

            await logPaymentStatus({
              paymentId: payment.id,
              fromStatus: oldStatus,
              toStatus: newStatus,
              reason: 'amount_mismatch',
              metadata: { expected: payment.amount, received: receivedAmount },
            });
          } else {
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: newStatus,
                completedAt: new Date(),
                metadata: JSON.stringify({
                  geniuspayData: eventData,
                  webhookReceivedAt: new Date().toISOString(),
                }),
              },
            });

            await logPaymentStatus({
              paymentId: payment.id,
              fromStatus: oldStatus,
              toStatus: newStatus,
              reason: 'webhook',
              metadata: eventData,
            });
          }
        }
        break;

      case 'payment.failed':
        if (oldStatus !== 'failed') {
          newStatus = 'failed';
          shouldNotify = true;

          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: newStatus,
              metadata: JSON.stringify({
                failureReason: eventData.failure_reason || eventData.reason || 'Payment failed',
                geniuspayData: eventData,
                webhookReceivedAt: new Date().toISOString(),
              }),
            },
          });

          await logPaymentStatus({
            paymentId: payment.id,
            fromStatus: oldStatus,
            toStatus: newStatus,
            reason: 'webhook',
            metadata: { failureReason: eventData.failure_reason, ...eventData },
          });
        }
        break;

      case 'payment.cancelled':
        if (oldStatus !== 'failed') {
          newStatus = 'failed';
          shouldNotify = true;

          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: newStatus,
              metadata: JSON.stringify({
                cancelledReason: eventData.cancellation_reason || 'Payment cancelled',
                geniuspayData: eventData,
                webhookReceivedAt: new Date().toISOString(),
              }),
            },
          });

          await logPaymentStatus({
            paymentId: payment.id,
            fromStatus: oldStatus,
            toStatus: newStatus,
            reason: 'webhook',
            metadata: { cancelledReason: eventData.cancellation_reason, ...eventData },
          });
        }
        break;

      case 'payment.expired':
        if (oldStatus !== 'failed') {
          newStatus = 'failed';
          shouldNotify = true;

          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: newStatus,
              metadata: JSON.stringify({
                expiredReason: 'Payment link expired',
                geniuspayData: eventData,
                webhookReceivedAt: new Date().toISOString(),
              }),
            },
          });

          await logPaymentStatus({
            paymentId: payment.id,
            fromStatus: oldStatus,
            toStatus: newStatus,
            reason: 'webhook',
            metadata: { expiredReason: 'Payment link expired', ...eventData },
          });
        }
        break;

      default:
        logger.warn('[Webhook GeniusPay] Unknown event type', { eventType });
    }

    // 5. Trigger user notification if status changed
    const client = payment.quote?.project?.client;
    if (shouldNotify && client) {
      try {
        const notificationData = {
          userId: client.id,
          type: newStatus === 'succeeded' ? 'PAYMENT_RECEIVED' : 'PAYMENT_FAILED',
          title: newStatus === 'succeeded' ? 'Paiement confirmé' : 'Paiement échoué',
          message: newStatus === 'succeeded'
            ? `Votre paiement de ${payment.amount} XOF a été confirmé.`
            : `Votre paiement de ${payment.amount} XOF a échoué. Veuillez réessayer.`,
          data: {
            paymentId: payment.id,
            quoteId: payment.quoteId,
            amount: payment.amount,
            status: newStatus,
          },
        };

        // Create notification in database
        await prisma.notification.create({
          data: notificationData,
        });

        logger.info('[Webhook GeniusPay] Notification created', {
          userId: client.id,
          type: notificationData.type,
          paymentId: payment.id,
        });
      } catch (err) {
        logger.error('[Webhook GeniusPay] Failed to create notification', {
          error: err.message,
          paymentId: payment.id,
        });
        // Don't fail the webhook if notification fails — still return 200
      }
    }

    logger.info('[Webhook GeniusPay] Event processed successfully', {
      eventType,
      paymentId: payment.id,
      statusChange: `${oldStatus} → ${newStatus}`,
    });

    // 6. Return 200 OK to acknowledge receipt
    return res.status(200).json({ received: true, processed: true });
  } catch (err) {
    logger.error('[Webhook GeniusPay] Unexpected error', {
      error: err.message,
      stack: err.stack,
    });
    // Always return 200 to prevent GeniusPay retries for server errors
    return res.status(200).json({ received: true, error: 'Processing failed but acknowledged' });
  }
});

module.exports = router;
