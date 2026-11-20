const express = require('express');
const rawBody = require('raw-body');
const prisma = require('../config/db');
const { logPaymentStatus } = require('../utils/paymentAudit');
const geniuspay = require('../utils/geniuspay');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const subMailer = require('../utils/subscriptionMailer');
const { computeExpiresAt, isPeriodAlreadyPaid } = require('../utils/subscriptionBilling');

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

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

    // Verify signature against the raw body bytes — re-serializing the parsed
    // object is not safe (key order, number formatting, unicode escapes may differ).
    const bodyForSig = req.rawBody || JSON.stringify(req.body);
    const isValidSignature = geniuspay.verifyWebhookSignature(signature, timestamp, bodyForSig);
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

    // 3. Route by reference: look up SubscriptionPaymentAttempt first (new path),
    //    then fall back to Subscription.geniuspayRef (legacy compatibility),
    //    then fall through to quote payment.
    const attempt = eventData.reference
      ? await prisma.subscriptionPaymentAttempt.findUnique({
          where: { geniuspayRef: eventData.reference },
          include: {
            subscription: {
              include: {
                professional: {
                  include: {
                    user: { select: { id: true, email: true, firstName: true, lastName: true, expoPushToken: true } },
                  },
                },
              },
            },
          },
        })
      : null;

    if (attempt) {
      // ── Subscription payment path (via attempt) ─────────────────────────────
      await handleSubscriptionWebhookViaAttempt({ eventType, eventData, attempt });
      logger.info('[Webhook GeniusPay] Subscription event processed via attempt', {
        eventType,
        attemptId: attempt.id,
        subscriptionId: attempt.subscriptionId,
        reference: eventData.reference,
      });
      return res.status(200).json({ received: true, processed: true });
    }

    // Legacy fallback: subscription row still carries geniuspayRef for older checkout flows
    const subscription = eventData.reference
      ? await prisma.subscription.findFirst({
          where: { geniuspayRef: eventData.reference },
          include: {
            professional: {
              include: {
                user: { select: { id: true, email: true, firstName: true, lastName: true, expoPushToken: true } },
              },
            },
          },
        })
      : null;

    if (subscription) {
      // ── Subscription payment path (legacy) ──────────────────────────────────
      await handleSubscriptionWebhook({ eventType, eventData, subscription });
      logger.info('[Webhook GeniusPay] Subscription event processed (legacy path)', {
        eventType,
        subscriptionId: subscription.id,
        reference: eventData.reference,
      });
      return res.status(200).json({ received: true, processed: true });
    }

    // ── Quote payment path (original logic) ────────────────────────────────
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

// ── Subscription webhook handler (new path via SubscriptionPaymentAttempt) ─────
/**
 * Process a GeniusPay event when the reference matches a SubscriptionPaymentAttempt row.
 *
 * Key invariants:
 * - Each attempt is independent. A late webhook for attempt A is processed correctly
 *   even when attempt B is already PENDING or SUCCEEDED.
 * - Double-activation guard: if the attempt is already SUCCEEDED, the event is a no-op.
 * - Subscription.expiresAt is only extended when the attempt is for a renewal of an already
 *   ACTIVE subscription — prevents double-prolongation if two attempts both succeed.
 * - Duplicate payment detection: if a second attempt SUCCEEDS after the subscription was
 *   already activated by a previous attempt, the second is flagged REVIEW_REQUIRED and
 *   an admin notification is created.
 * - Amount must be present and within ±1 XOF; absent/mismatched amounts → REVIEW_REQUIRED.
 */
async function handleSubscriptionWebhookViaAttempt({ eventType, eventData, attempt }) {
  const subscription = attempt.subscription;
  const proUser = subscription?.professional?.user;
  const now = new Date();

  switch (eventType) {
    case 'payment.succeeded':
    case 'payment.completed': {
      // Idempotency: attempt already processed
      if (attempt.status === 'SUCCEEDED') {
        logger.info('[Webhook Sub] Attempt already SUCCEEDED — duplicate event ignored', { attemptId: attempt.id });
        break;
      }

      // Amount verification — mandatory; absent or mismatched → REVIEW_REQUIRED
      const received = eventData.amount || eventData.paid_amount;
      if (received === undefined || received === null) {
        logger.warn('[Webhook Sub] Amount absent — REVIEW_REQUIRED', { attemptId: attempt.id });
        await prisma.subscriptionPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'REVIEW_REQUIRED',
            providerData: JSON.stringify({ reason: 'amount_absent', eventData, receivedAt: now.toISOString() }),
          },
        });
        break;
      }

      if (Math.abs(received - attempt.expectedAmount) > 1) {
        logger.warn('[Webhook Sub] Amount mismatch — REVIEW_REQUIRED', {
          attemptId: attempt.id, expected: attempt.expectedAmount, received,
        });
        await prisma.subscriptionPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'REVIEW_REQUIRED',
            confirmedAmount: received,
            providerData: JSON.stringify({ reason: 'amount_mismatch', expected: attempt.expectedAmount, received, eventData, receivedAt: now.toISOString() }),
          },
        });
        break;
      }

      // Normal activation — atomic transaction with optimistic concurrency guard.
      // updateMany with status filter ensures we only transition CREATED/PENDING → SUCCEEDED once
      // even if two processes receive the same webhook simultaneously.
      // isPeriodAlreadyPaid runs INSIDE the transaction (using tx) to close the race window
      // where two distinct attempts for the same period both pass the check before either commits.
      // We use a txResult signal (return from callback) instead of throwing DUPLICATE_PAYMENT
      // so the REVIEW_REQUIRED update is committed — throw inside a Prisma transaction triggers rollback.
      const activationBase = (attempt.scheduledStartAt && attempt.scheduledStartAt > now)
        ? attempt.scheduledStartAt
        : now;

      const expiresAt = computeExpiresAt(activationBase, attempt.billingCycle || 'MONTHLY');

      let txResult = 'pending';
      try {
        await prisma.$transaction(async (tx) => {
          // 1. Conditionally mark attempt SUCCEEDED (concurrent guard for same-attempt duplicates)
          const result = await tx.subscriptionPaymentAttempt.updateMany({
            where: { id: attempt.id, status: { in: ['CREATED', 'PENDING'] } },
            data: {
              status: 'SUCCEEDED',
              confirmedAmount: received,
              confirmedAt: now,
              providerData: JSON.stringify({ eventData, receivedAt: now.toISOString() }),
            },
          });

          if (result.count === 0) {
            txResult = 'already_processed';
            return; // commit empty transaction — another handler beat us
          }

          // 2. Duplicate-payment check inside the transaction (tx client = serialized read)
          // Detects concurrent attempts for the same billing period that both passed amount checks.
          const duplicate = await isPeriodAlreadyPaid(tx, attempt);
          if (duplicate) {
            await tx.subscriptionPaymentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'REVIEW_REQUIRED',
                confirmedAmount: received,
                confirmedAt: now,
                duplicateOfId: null,
                providerData: JSON.stringify({
                  reason: 'duplicate_payment',
                  note: 'Another attempt already paid for this billing period. Manual review required.',
                  eventData,
                  receivedAt: now.toISOString(),
                }),
              },
            });
            txResult = 'duplicate';
            return; // commit REVIEW_REQUIRED — no rollback needed
          }

          // 3. Activate subscription (same transaction — atomic)
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'ACTIVE',
              tier: attempt.tier,
              billingCycle: attempt.billingCycle,
              amount: attempt.expectedAmount,
              startedAt: activationBase,
              expiresAt,
              lastPaymentAt: now,
              gracePeriodEndsAt: null,
              geniuspayRef: attempt.geniuspayRef,
            },
          });
          txResult = 'activated';
        });
      } catch (txErr) {
        if (txErr.code === 'P2002') {
          // PostgreSQL unique constraint violation — concurrent attempt beat us to the index
          await prisma.subscriptionPaymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: 'REVIEW_REQUIRED',
              confirmedAmount: received,
              confirmedAt: now,
              providerData: JSON.stringify({
                reason: 'concurrent_duplicate_payment',
                note: 'Unique index violation: another attempt was committed concurrently for the same billing period.',
                eventData,
                receivedAt: now.toISOString(),
              }),
            },
          });
          try {
            await prisma.notification.create({
              data: {
                userId: proUser?.id || 'system',
                type: 'SUBSCRIPTION_DUPLICATE_PAYMENT',
                title: 'Double paiement détecté (concurrent)',
                message: `Double paiement concurrent détecté pour l'abonnement ${subscription.tier}. Référence : ${attempt.geniuspayRef}. Revue administrative requise.`,
                data: { subscriptionId: subscription.id, attemptId: attempt.id, reference: attempt.geniuspayRef },
              },
            });
          } catch (notifErr) {
            logger.error('[Webhook Sub] Failed to create concurrent duplicate payment admin notification', { error: notifErr.message });
          }
          logger.warn('[Webhook Sub] Concurrent duplicate payment (P2002) — marked REVIEW_REQUIRED', {
            attemptId: attempt.id, subscriptionId: subscription.id,
          });
          txResult = 'duplicate';
        } else {
          throw txErr;
        }
      }

      if (txResult === 'already_processed') {
        logger.info('[Webhook Sub] Attempt already processed by concurrent handler — skipping', { attemptId: attempt.id });
        break;
      }

      if (txResult === 'duplicate') {
        // Admin notification for duplicate payment (outside transaction — notification is non-atomic)
        try {
          await prisma.notification.create({
            data: {
              userId: proUser?.id || 'system',
              type: 'SUBSCRIPTION_DUPLICATE_PAYMENT',
              title: 'Double paiement détecté',
              message: `Double paiement détecté pour l'abonnement ${subscription.tier}. Référence : ${attempt.geniuspayRef}. Revue administrative requise.`,
              data: { subscriptionId: subscription.id, attemptId: attempt.id, reference: attempt.geniuspayRef },
            },
          });
        } catch (notifErr) {
          logger.error('[Webhook Sub] Failed to create duplicate payment admin notification', { error: notifErr.message });
        }
        logger.warn('[Webhook Sub] Duplicate payment detected — marked REVIEW_REQUIRED', {
          attemptId: attempt.id, subscriptionId: subscription.id,
        });
        break;
      }

      logger.info('[Webhook Sub] Subscription activated via attempt', {
        attemptId: attempt.id, subscriptionId: subscription.id,
        tier: attempt.tier, activationBase, expiresAt,
      });

      await notifySubscription(proUser, 'SUBSCRIPTION_ACTIVATED', subscription, {
        tier: attempt.tier,
        startedAt: activationBase,
        expiresAt,
        reference: attempt.geniuspayRef,
        professionalName: proUser ? `${proUser.firstName || ''} ${proUser.lastName || ''}`.trim() : null,
      });
      break;
    }

    case 'payment.failed': {
      if (attempt.status === 'FAILED') {
        logger.info('[Webhook Sub] Attempt already FAILED — duplicate event ignored', { attemptId: attempt.id });
        break;
      }

      await prisma.subscriptionPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          providerData: JSON.stringify({ reason: eventData.failure_reason || 'payment_failed', eventData, receivedAt: now.toISOString() }),
        },
      });

      // If the subscription is currently ACTIVE (renewal failure), preserve benefits — do not downgrade.
      const currentSub = await prisma.subscription.findUnique({
        where: { id: subscription.id },
        select: { status: true },
      });

      if (currentSub?.status === 'ACTIVE') {
        logger.info('[Webhook Sub] Renewal payment failed — subscription stays ACTIVE until expiry', {
          attemptId: attempt.id, subscriptionId: subscription.id,
        });
        // No subscription state change — the professional keeps access until expiresAt
        await notifySubscription(proUser, 'SUBSCRIPTION_PAYMENT_FAILED', subscription, {
          gracePeriodEndsAt: null,
          reason: eventData.failure_reason || 'renewal_payment_failed',
        });
        break;
      }

      // For non-active subscriptions: start 3-day grace period
      const gracePeriodEndsAt = new Date(now.getTime() + THREE_DAYS_MS);
      await prisma.subscription.updateMany({
        where: { id: subscription.id, status: { not: 'ACTIVE' } },
        data: { status: 'GRACE_PERIOD', gracePeriodEndsAt },
      });

      logger.info('[Webhook Sub] Payment failed — grace period started', {
        attemptId: attempt.id, subscriptionId: subscription.id,
      });
      await notifySubscription(proUser, 'SUBSCRIPTION_PAYMENT_FAILED', subscription, {
        gracePeriodEndsAt,
        reason: eventData.failure_reason || 'payment_failed',
      });
      break;
    }

    case 'payment.cancelled': {
      if (attempt.status !== 'CANCELLED') {
        await prisma.subscriptionPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'CANCELLED',
            providerData: JSON.stringify({ reason: eventData.cancellation_reason || 'cancelled_by_user', eventData, receivedAt: now.toISOString() }),
          },
        });
      }
      // No subscription state change — the subscription stays in its current status.
      // If PENDING_PAYMENT, the professional can start a new checkout.
      await notifySubscription(proUser, 'SUBSCRIPTION_PAYMENT_CANCELLED', subscription, {
        reason: 'cancelled_by_user',
      });
      break;
    }

    case 'payment.expired': {
      if (attempt.status !== 'EXPIRED') {
        await prisma.subscriptionPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'EXPIRED',
            providerData: JSON.stringify({ reason: 'link_expired', eventData, receivedAt: now.toISOString() }),
          },
        });
      }
      await notifySubscription(proUser, 'SUBSCRIPTION_PAYMENT_EXPIRED', subscription, {
        reason: 'link_expired',
      });
      break;
    }

    default:
      logger.warn('[Webhook Sub] Unknown event type for attempt', { eventType, attemptId: attempt.id });
  }
}

// ── Subscription webhook handler (legacy — Subscription.geniuspayRef path) ─────
/**
 * Process a GeniusPay event for a subscription payment.
 *
 * Rules:
 * - Idempotent: if already ACTIVE, skip succeeded events silently.
 * - Amount verified against subscription.amount (±1 XOF tolerance).
 * - On success: activate immediately if no scheduledStartAt, otherwise activate
 *   at scheduledStartAt (the day after trial ends).
 * - On confirmed failure: start 3-day grace period, do NOT downgrade immediately.
 * - Uncertain payments (unknown status): leave PENDING_PAYMENT, let cron reconcile.
 * - No auto-renewal: GeniusPay/Orange Money/MTN/Wave do not support recurring charges.
 */
async function handleSubscriptionWebhook({ eventType, eventData, subscription }) {
  const { id: subscriptionId, status: currentStatus, amount: expectedAmount } = subscription;
  const proUser = subscription.professional?.user;

  switch (eventType) {
    case 'payment.succeeded':
    case 'payment.completed': {
      // Idempotency guard: already active = no-op
      if (currentStatus === 'ACTIVE') {
        logger.info('[Webhook Sub] Already ACTIVE — duplicate event ignored', { subscriptionId });
        break;
      }

      // Amount verification (±1 XOF)
      // An amount mismatch means payment is NOT confirmed — leave PENDING_PAYMENT for admin review.
      // Do NOT grant paid benefits (no GRACE_PERIOD transition) on an unconfirmed payment.
      const received = eventData.amount || eventData.paid_amount;
      if (received !== undefined && expectedAmount !== null && Math.abs(received - expectedAmount) > 1) {
        logger.warn('[Webhook Sub] Amount mismatch — leaving PENDING_PAYMENT for admin review', {
          subscriptionId,
          expected: expectedAmount,
          received,
        });
        // No subscription state change — payment is not confirmed
        break;
      }

      // Activation: if scheduledStartAt is in the future, the subscription becomes
      // ACTIVE now but startedAt / expiresAt are computed from scheduledStartAt.
      const now = new Date();
      const activationBase = (subscription.scheduledStartAt && subscription.scheduledStartAt > now)
        ? subscription.scheduledStartAt
        : now;

      const expiresAt = computeExpiresAt(activationBase, subscription.billingCycle || 'MONTHLY');

      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: 'ACTIVE',
          startedAt: activationBase,
          expiresAt,
          lastPaymentAt: now,
          gracePeriodEndsAt: null,
        },
      });

      logger.info('[Webhook Sub] Subscription activated', {
        subscriptionId,
        tier: subscription.tier,
        activationBase,
        expiresAt,
      });

      await notifySubscription(proUser, 'SUBSCRIPTION_ACTIVATED', subscription, {
        tier: subscription.tier,
        startedAt: activationBase,
        expiresAt,
        reference: subscription.geniuspayRef,
        professionalName: proUser ? `${proUser.firstName || ''} ${proUser.lastName || ''}`.trim() : null,
      });
      break;
    }

    case 'payment.failed': {
      // Guard: already in GRACE_PERIOD (duplicate) or ACTIVE (re-delivered failure after confirmed success).
      // An ACTIVE subscription must not be downgraded by a late/out-of-order failure event.
      if (currentStatus === 'GRACE_PERIOD' || currentStatus === 'ACTIVE') {
        logger.info('[Webhook Sub] payment.failed ignored — subscription is already ' + currentStatus, { subscriptionId });
        break;
      }

      const gracePeriodEndsAt = new Date(Date.now() + THREE_DAYS_MS);

      // Conditional write: only transition if still not ACTIVE (guards against a concurrent succeeded event)
      await prisma.subscription.updateMany({
        where: { id: subscriptionId, status: { not: 'ACTIVE' } },
        data: {
          status: 'GRACE_PERIOD',
          gracePeriodEndsAt,
        },
      });

      logger.info('[Webhook Sub] Payment failed — grace period started', { subscriptionId });
      await notifySubscription(proUser, 'SUBSCRIPTION_PAYMENT_FAILED', subscription, {
        gracePeriodEndsAt,
        reason: eventData.failure_reason || 'payment_failed',
      });
      break;
    }

    case 'payment.cancelled':
    case 'payment.expired': {
      // Cancelled / expired before payment = leave PENDING_PAYMENT.
      // If the subscription was already in GRACE_PERIOD, don't reset it.
      if (currentStatus === 'PENDING_PAYMENT') {
        logger.info('[Webhook Sub] Payment cancelled/expired — returning to PENDING_PAYMENT', {
          subscriptionId,
          eventType,
        });
        const notifType = eventType === 'payment.expired'
          ? 'SUBSCRIPTION_PAYMENT_EXPIRED'
          : 'SUBSCRIPTION_PAYMENT_CANCELLED';
        await notifySubscription(proUser, notifType, subscription, {
          reason: eventType === 'payment.cancelled' ? 'cancelled_by_user' : 'link_expired',
        });
      }
      break;
    }

    default:
      logger.warn('[Webhook Sub] Unknown event type', { eventType, subscriptionId });
  }
}

/**
 * Create a push/in-app notification AND send an email for a subscription event.
 * Never throws — notification/email failure must not block webhook 200 response.
 *
 * proUser must have: { id, email, firstName }
 */
async function notifySubscription(proUser, type, subscription, extra = {}) {
  if (!proUser) return;

  const tier = subscription.tier;

  const templates = {
    SUBSCRIPTION_ACTIVATED: {
      title: 'Abonnement activé',
      message: `Votre abonnement ${tier} est maintenant actif.`,
    },
    SUBSCRIPTION_PAYMENT_FAILED: {
      title: 'Paiement échoué',
      message: `Votre paiement d'abonnement ${tier} a échoué. Vous avez 3 jours pour réessayer.`,
    },
    SUBSCRIPTION_PAYMENT_CANCELLED: {
      title: 'Paiement annulé',
      message: `Votre paiement d'abonnement ${tier} a été annulé.`,
    },
    SUBSCRIPTION_PAYMENT_EXPIRED: {
      title: 'Lien expiré',
      message: `Le lien de paiement pour votre abonnement ${tier} a expiré.`,
    },
  };

  const tmpl = templates[type] || { title: type, message: '' };

  // 1. In-app / push notification
  try {
    await prisma.notification.create({
      data: {
        userId: proUser.id,
        type,
        title: tmpl.title,
        message: tmpl.message,
        data: {
          subscriptionId: subscription.id,
          tier,
          ...extra,
        },
      },
    });
  } catch (err) {
    logger.error('[Webhook Sub] Failed to create in-app notification', {
      userId: proUser.id,
      type,
      error: err.message,
    });
  }

  // 2. Email — never blocks, errors are logged inside subMailer
  if (proUser.email) {
    const emailCtx = { email: proUser.email, firstName: proUser.firstName, tier, ...extra };
    switch (type) {
      case 'SUBSCRIPTION_ACTIVATED':
        await subMailer.sendSubscriptionActivated({
          email: proUser.email,
          firstName: proUser.firstName,
          tier,
          billingCycle: subscription.billingCycle,
          amount: subscription.amount,
          startedAt: extra.startedAt,
          expiresAt: extra.expiresAt,
          reference: extra.reference || subscription.geniuspayRef,
          professionalName: extra.professionalName,
        });
        break;
      case 'SUBSCRIPTION_PAYMENT_FAILED':
        await subMailer.sendPaymentFailed({
          ...emailCtx,
          gracePeriodEndsAt: extra.gracePeriodEndsAt,
          reason: extra.reason,
        });
        break;
      case 'SUBSCRIPTION_PAYMENT_CANCELLED':
        await subMailer.sendPaymentCancelled(emailCtx);
        break;
      case 'SUBSCRIPTION_PAYMENT_EXPIRED':
        await subMailer.sendPaymentExpired(emailCtx);
        break;
      default:
        // No email template for this notification type
        break;
    }
  }
}

module.exports = router;
