/**
 * Inline cron jobs for MANAWA
 * Extracted from index.js to keep the entry point under 800 lines.
 *
 * Jobs managed here:
 *   - expireQuotes          — hourly, marks PENDING quotes past expiresAt as EXPIRED
 *   - cleanExpiredRefreshTokens — daily, removes refresh tokens past expiresAt
 *   - expirePendingPayments — hourly, marks payments pending > 1h as failed
 *   - reconcilePendingPayments — hourly (offset +30min), syncs pending payments with GeniusPay
 */

const prisma = require('../config/db');
const logger = require('../utils/logger');
const { logPaymentStatus } = require('../utils/paymentAudit');
const geniuspay = require('../utils/geniuspay');
const subMailer = require('../utils/subscriptionMailer');
const { computeExpiresAt, isPeriodAlreadyPaid } = require('../utils/subscriptionBilling');

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const THREE_DAYS_MS = 3 * ONE_DAY_MS;

async function expireQuotes() {
  try {
    const { count } = await prisma.quote.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
    if (count > 0) logger.info('[CRON] Quotes expired', { count });
  } catch (err) {
    logger.error('[CRON] Error expiring quotes', { error: err.message });
  }
}

async function cleanExpiredRefreshTokens() {
  try {
    const { count } = await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) logger.info('[CRON] Expired refresh tokens deleted', { count });
  } catch (err) {
    logger.error('[CRON] Error cleaning refresh tokens', { error: err.message });
  }
}

async function expirePendingPayments() {
  try {
    const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);
    const expiredPayments = await prisma.payment.findMany({
      where: { status: 'pending', createdAt: { lt: oneHourAgo } },
      select: { id: true, status: true },
    });
    if (expiredPayments.length === 0) return;

    await prisma.payment.updateMany({
      where: { id: { in: expiredPayments.map(p => p.id) } },
      data: { status: 'failed' },
    });

    for (const p of expiredPayments) {
      await logPaymentStatus({ paymentId: p.id, fromStatus: 'pending', toStatus: 'failed', reason: 'cron_expiry' });
    }

    logger.info('[CRON] Pending payments expired', { count: expiredPayments.length });
  } catch (err) {
    logger.error('[CRON] Error expiring pending payments', { error: err.message });
  }
}

// Reconciliation covers: missed webhook + client did not retry + payment < 1h old.
// Payments older than 1h are handled by expirePendingPayments.
async function reconcilePendingPayments() {
  try {
    const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);
    const pendingPayments = await prisma.payment.findMany({
      where: {
        status: 'pending',
        geniuspayRef: { not: null },
        createdAt: { gte: oneHourAgo },
      },
      select: { id: true, status: true, geniuspayRef: true, amount: true },
    });

    if (pendingPayments.length === 0) return;
    logger.info('[CRON] Reconciliation started', { count: pendingPayments.length });

    let synced = 0;
    let failed = 0;

    for (const payment of pendingPayments) {
      try {
        const gpResponse = await geniuspay.getPayment(payment.geniuspayRef);
        const gpData = gpResponse?.data || gpResponse;
        const realStatus = gpData?.status;

        if (realStatus === 'completed' || realStatus === 'success') {
          const receivedAmount = gpData?.amount || gpData?.paid_amount;
          if (receivedAmount !== undefined && Math.abs(receivedAmount - payment.amount) > 1) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: 'failed',
                metadata: JSON.stringify({ reason: 'amount_mismatch', expected: payment.amount, received: receivedAmount }),
              },
            });
            await logPaymentStatus({
              paymentId: payment.id, fromStatus: 'pending', toStatus: 'failed',
              reason: 'amount_mismatch', metadata: { expected: payment.amount, received: receivedAmount },
            });
            failed++;
          } else {
            await prisma.payment.update({ where: { id: payment.id }, data: { status: 'succeeded', completedAt: new Date() } });
            await logPaymentStatus({ paymentId: payment.id, fromStatus: 'pending', toStatus: 'succeeded', reason: 'reconciliation' });
            synced++;
          }
        } else if (realStatus === 'failed' || realStatus === 'cancelled' || realStatus === 'expired') {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
          await logPaymentStatus({
            paymentId: payment.id, fromStatus: 'pending', toStatus: 'failed',
            reason: 'reconciliation', metadata: { geniuspayStatus: realStatus },
          });
          failed++;
        }
        // If GeniusPay still returns 'pending', leave unchanged and retry next run.
      } catch (err) {
        // GeniusPay unreachable for this payment — will retry on next run.
        logger.warn('[CRON] Reconciliation — could not verify payment', { geniuspayRef: payment.geniuspayRef, error: err.message });
      }
    }

    if (synced > 0 || failed > 0) {
      logger.info('[CRON] Reconciliation completed', { synced, failed });
    }
  } catch (err) {
    logger.error('[CRON] Error reconciling payments', { error: err.message });
  }
}

/**
 * Expire free trials that have ended without a paid subscription taking over.
 *
 * trialEndsAt and trialStartedAt are NEVER cleared — they are required for
 * traceability and to prevent a professional from obtaining a second trial.
 *
 * The effective tier already falls back to GRATUIT automatically once
 * trialEndsAt is in the past (see getActiveTier in routes/subscriptions.js).
 * This job logs the expiry for audit purposes and skips professionals whose
 * payment is legitimately in-flight (PENDING_PAYMENT with scheduledStartAt
 * still in the future).
 *
 * Runs daily.
 */
async function expireTrials() {
  try {
    const now = new Date();

    const expired = await prisma.professional.findMany({
      where: {
        trialEndsAt: { lt: now },
        OR: [
          { subscription: null },
          { subscription: { status: { not: 'ACTIVE' } } },
        ],
      },
      select: {
        id: true,
        trialEndsAt: true,
        subscription: { select: { id: true, status: true, scheduledStartAt: true } },
      },
    });

    if (expired.length === 0) return;

    let skipped = 0;
    for (const pro of expired) {
      const sub = pro.subscription;
      // Payment in-flight: scheduledStartAt is set and hasn't passed yet — skip.
      if (sub && sub.status === 'PENDING_PAYMENT' && sub.scheduledStartAt && sub.scheduledStartAt > now) {
        skipped++;
        continue;
      }
      logger.info('[CRON] Trial expired — effective tier is now GRATUIT', {
        proId: pro.id,
        trialEndsAt: pro.trialEndsAt,
      });
    }

    logger.info('[CRON] Trial expiry check completed', { total: expired.length, skipped });
  } catch (err) {
    logger.error('[CRON] Error in expireTrials', { error: err.message });
  }
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * ONE_HOUR_MS;

/**
 * Mark subscription PENDING_PAYMENT sessions older than 15 minutes as checkout-stale.
 *
 * GeniusPay checkout links have a limited lifetime (~15 min). After that the pro
 * can initiate a new checkout. However, GeniusPay may still deliver a webhook
 * or return a terminal status for up to 24 hours after the link expires.
 *
 * We therefore do NOT clear geniuspayRef here — the webhook handler and
 * reconcilePendingSubscriptions both need it to match late confirmations.
 * Instead we set checkoutExpiredAt so the frontend knows a new checkout is needed,
 * while still accepting late GeniusPay confirmations.
 *
 * We do NOT downgrade the professional — they were already PENDING_PAYMENT, not ACTIVE.
 *
 * Runs every 15 minutes.
 */
async function expirePendingSubscriptions() {
  try {
    const cutoff = new Date(Date.now() - FIFTEEN_MIN_MS);
    // Only count sessions that are genuinely stale and haven't been reconciled yet.
    // We log for observability but make no DB change to geniuspayRef.
    const stale = await prisma.subscription.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        geniuspayRef: { not: null },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, tier: true, professionalId: true },
    });

    if (stale.length === 0) return;

    logger.info('[CRON] Stale subscription checkout sessions detected (geniuspayRef preserved for late webhooks)', {
      count: stale.length,
    });
  } catch (err) {
    logger.error('[CRON] Error checking pending subscriptions', { error: err.message });
  }
}

/**
 * Downgrade subscriptions whose grace period has expired without a successful payment.
 *
 * Grace period = 3 days after a confirmed payment failure.
 * After expiry the professional reverts to GRATUIT (status INACTIVE).
 *
 * Runs hourly.
 */
async function expireGracePeriods() {
  try {
    const now = new Date();
    const expired = await prisma.subscription.findMany({
      where: {
        status: 'GRACE_PERIOD',
        gracePeriodEndsAt: { lt: now },
      },
      include: {
        professional: {
          include: {
            user: { select: { id: true, email: true, firstName: true } },
          },
        },
      },
    });

    if (expired.length === 0) return;

    for (const sub of expired) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'INACTIVE',
          gracePeriodEndsAt: null,
          expiresAt: null,
        },
      });

      const proUser = sub.professional?.user;
      const userId = proUser?.id;

      // In-app notification
      if (userId) {
        try {
          await prisma.notification.create({
            data: {
              userId,
              type: 'SUBSCRIPTION_EXPIRED',
              title: 'Abonnement résilié',
              message: `Votre abonnement ${sub.tier} a expiré. Votre compte est maintenant en mode Gratuit.`,
              data: { subscriptionId: sub.id, tier: sub.tier },
            },
          });
        } catch (notifErr) {
          logger.error('[CRON] Failed to notify subscription expiry (in-app)', {
            subscriptionId: sub.id,
            error: notifErr.message,
          });
        }
      }

      // Email notification
      if (proUser?.email) {
        await subMailer.sendSubscriptionExpired({
          email: proUser.email,
          firstName: proUser.firstName,
          tier: sub.tier,
        });
      }

      logger.info('[CRON] Subscription downgraded after grace period', {
        subscriptionId: sub.id,
        tier: sub.tier,
        professionalId: sub.professionalId,
      });
    }

    logger.info('[CRON] Grace period expiry completed', { count: expired.length });
  } catch (err) {
    logger.error('[CRON] Error expiring grace periods', { error: err.message });
  }
}

/**
 * Send reminder notifications to professionals whose grace period ends within 24h.
 *
 * Runs once daily.
 */
async function sendGracePeriodReminders() {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + ONE_DAY_MS);

    const nearExpiry = await prisma.subscription.findMany({
      where: {
        status: 'GRACE_PERIOD',
        gracePeriodEndsAt: { gt: now, lt: in24h },
      },
      include: {
        professional: {
          include: {
            user: { select: { id: true, email: true, firstName: true } },
          },
        },
      },
    });

    if (nearExpiry.length === 0) return;

    for (const sub of nearExpiry) {
      const proUser = sub.professional?.user;
      const userId = proUser?.id;
      if (!userId) continue;

      // Deduplication: skip if a reminder was already sent in the last 20 hours
      // (prevents double-send on server restart within the same day).
      const recentReminder = await prisma.notification.findFirst({
        where: {
          userId,
          type: 'SUBSCRIPTION_GRACE_REMINDER',
          createdAt: { gt: new Date(Date.now() - 20 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (recentReminder) {
        logger.info('[CRON] Grace reminder already sent in last 20h — skipping', { subscriptionId: sub.id });
        continue;
      }

      // In-app notification
      try {
        await prisma.notification.create({
          data: {
            userId,
            type: 'SUBSCRIPTION_GRACE_REMINDER',
            title: 'Rappel : abonnement en attente',
            message: `Votre abonnement ${sub.tier} sera résilié dans moins de 24h si le paiement n'est pas régularisé.`,
            data: {
              subscriptionId: sub.id,
              tier: sub.tier,
              gracePeriodEndsAt: sub.gracePeriodEndsAt,
            },
          },
        });
      } catch (notifErr) {
        logger.error('[CRON] Failed to send grace period reminder (in-app)', {
          subscriptionId: sub.id,
          error: notifErr.message,
        });
      }

      // Email reminder
      if (proUser?.email) {
        await subMailer.sendGraceReminder({
          email: proUser.email,
          firstName: proUser.firstName,
          tier: sub.tier,
          gracePeriodEndsAt: sub.gracePeriodEndsAt,
        });
      }
    }

    logger.info('[CRON] Grace period reminders sent', { count: nearExpiry.length });
  } catch (err) {
    logger.error('[CRON] Error sending grace period reminders', { error: err.message });
  }
}

/**
 * Reconcile subscription payment attempts whose webhook was missed or delayed.
 *
 * Works from SubscriptionPaymentAttempt, not from Subscription.geniuspayRef.
 * Each attempt has its own reference — late webhooks for old attempts are handled
 * correctly even when newer attempts exist.
 *
 * Rules:
 * - Only reconcile CREATED or PENDING attempts (terminal statuses are skipped → no infinite loop).
 * - completed/success: activate (same logic as webhook handler).
 * - failed: mark attempt FAILED, apply grace period or preserve ACTIVE if renewal.
 * - cancelled/expired: mark attempt terminal, no grace period.
 * - pending/unknown: leave unchanged, retry next run.
 * - GeniusPay unreachable: leave unchanged, retry next run.
 * - Amount absent: REVIEW_REQUIRED, no activation.
 * - Amount mismatch (>1 XOF): REVIEW_REQUIRED, no activation.
 * - Duplicate payment (sub already ACTIVE from another attempt): REVIEW_REQUIRED + admin notification.
 *
 * Runs every 30 minutes.
 */
async function reconcilePendingSubscriptions() {
  try {
    const pendingAttempts = await prisma.subscriptionPaymentAttempt.findMany({
      where: {
        status: { in: ['CREATED', 'PENDING'] },
        geniuspayRef: { not: null },
      },
      include: {
        subscription: {
          include: {
            professional: {
              include: {
                user: { select: { id: true, email: true, firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    if (pendingAttempts.length === 0) return;
    logger.info('[CRON] reconcilePendingSubscriptions started', { count: pendingAttempts.length });

    let activated = 0;
    let failed = 0;
    let review = 0;
    let skipped = 0;

    for (const attempt of pendingAttempts) {
      const sub = attempt.subscription;
      const proUser = sub?.professional?.user;
      const now = new Date();

      try {
        const gpResponse = await geniuspay.getPayment(attempt.geniuspayRef);
        const gpData = gpResponse?.data || gpResponse;
        const realStatus = gpData?.status;

        if (realStatus === 'completed' || realStatus === 'success') {
          // Amount check — absent or mismatched → REVIEW_REQUIRED
          const received = gpData?.amount || gpData?.paid_amount;
          if (received === undefined || received === null) {
            await prisma.subscriptionPaymentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'REVIEW_REQUIRED',
                providerData: JSON.stringify({ reason: 'amount_absent', gpData, reconciledAt: now.toISOString() }),
              },
            });
            logger.warn('[CRON reconcile] Amount absent — REVIEW_REQUIRED', { attemptId: attempt.id });
            review++;
            continue;
          }

          if (Math.abs(received - attempt.expectedAmount) > 1) {
            await prisma.subscriptionPaymentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'REVIEW_REQUIRED',
                confirmedAmount: received,
                providerData: JSON.stringify({ reason: 'amount_mismatch', expected: attempt.expectedAmount, received, gpData, reconciledAt: now.toISOString() }),
              },
            });
            logger.warn('[CRON reconcile] Amount mismatch — REVIEW_REQUIRED', {
              attemptId: attempt.id, expected: attempt.expectedAmount, received,
            });
            review++;
            continue;
          }

          // Normal activation — atomic transaction with optimistic concurrency guard.
          // isPeriodAlreadyPaid runs INSIDE the transaction (using tx) to close the race window.
          // We use a txResult signal (return from callback) instead of throwing for DUPLICATE_PAYMENT
          // so the REVIEW_REQUIRED update is committed — throw inside a Prisma transaction triggers rollback.
          const activationBase = (attempt.scheduledStartAt && attempt.scheduledStartAt > now)
            ? attempt.scheduledStartAt
            : now;

          const expiresAt = computeExpiresAt(activationBase, attempt.billingCycle || 'MONTHLY');

          let txResult = 'pending';
          try {
            await prisma.$transaction(async (tx) => {
              // 1. Conditionally mark attempt SUCCEEDED (concurrent guard)
              const result = await tx.subscriptionPaymentAttempt.updateMany({
                where: { id: attempt.id, status: { in: ['CREATED', 'PENDING'] } },
                data: {
                  status: 'SUCCEEDED',
                  confirmedAmount: received,
                  confirmedAt: now,
                  providerData: JSON.stringify({ gpData, reconciledAt: now.toISOString() }),
                },
              });

              if (result.count === 0) {
                txResult = 'already_processed';
                return; // commit empty transaction
              }

              // 2. Duplicate-payment check inside the transaction (tx client = serialized read)
              const duplicate = await isPeriodAlreadyPaid(tx, attempt);
              if (duplicate) {
                await tx.subscriptionPaymentAttempt.update({
                  where: { id: attempt.id },
                  data: {
                    status: 'REVIEW_REQUIRED',
                    confirmedAmount: received,
                    confirmedAt: now,
                    providerData: JSON.stringify({ reason: 'duplicate_payment', gpData, reconciledAt: now.toISOString() }),
                  },
                });
                txResult = 'duplicate';
                return; // commit REVIEW_REQUIRED — no rollback needed
              }

              // 3. Activate subscription (same transaction — atomic)
              await tx.subscription.update({
                where: { id: sub.id },
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
              await prisma.subscriptionPaymentAttempt.update({
                where: { id: attempt.id },
                data: {
                  status: 'REVIEW_REQUIRED',
                  confirmedAmount: received,
                  confirmedAt: now,
                  providerData: JSON.stringify({ reason: 'concurrent_duplicate_payment', gpData, reconciledAt: now.toISOString() }),
                },
              });
              logger.warn('[CRON reconcile] Concurrent duplicate payment (P2002) — REVIEW_REQUIRED', { attemptId: attempt.id });
              txResult = 'duplicate';
            } else {
              throw txErr;
            }
          }

          if (txResult === 'already_processed') { skipped++; continue; }
          if (txResult === 'duplicate') {
            if (proUser?.id) {
              prisma.notification.create({
                data: {
                  userId: proUser.id,
                  type: 'SUBSCRIPTION_DUPLICATE_PAYMENT',
                  title: 'Double paiement détecté',
                  message: `Double paiement détecté pour l'abonnement ${sub.tier}. Référence : ${attempt.geniuspayRef}.`,
                  data: { subscriptionId: sub.id, attemptId: attempt.id, reference: attempt.geniuspayRef },
                },
              }).catch(e => logger.error('[CRON reconcile] Duplicate payment notif failed', { error: e.message }));
            }
            logger.warn('[CRON reconcile] Duplicate payment — REVIEW_REQUIRED', { attemptId: attempt.id });
            review++;
            continue;
          }

          logger.info('[CRON reconcile] Subscription activated via attempt', {
            attemptId: attempt.id, subscriptionId: sub.id, tier: attempt.tier, expiresAt,
          });

          if (proUser?.email) {
            subMailer.sendSubscriptionActivated({
              email: proUser.email,
              firstName: proUser.firstName,
              tier: attempt.tier,
              billingCycle: attempt.billingCycle,
              amount: attempt.expectedAmount,
              startedAt: activationBase,
              expiresAt,
              reference: attempt.geniuspayRef,
              professionalName: `${proUser.firstName || ''} ${proUser.lastName || ''}`.trim(),
            }).catch(e => logger.error('[CRON reconcile] Email failed', { error: e.message }));
          }

          if (proUser?.id) {
            prisma.notification.create({
              data: {
                userId: proUser.id,
                type: 'SUBSCRIPTION_ACTIVATED',
                title: 'Abonnement activé',
                message: `Votre abonnement ${attempt.tier} est maintenant actif.`,
                data: { subscriptionId: sub.id, tier: attempt.tier },
              },
            }).catch(e => logger.error('[CRON reconcile] In-app notif failed', { error: e.message }));
          }

          activated++;

        } else if (realStatus === 'failed') {
          await prisma.subscriptionPaymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: 'FAILED',
              providerData: JSON.stringify({ gpData, reconciledAt: now.toISOString() }),
            },
          });

          // If subscription is currently ACTIVE (renewal failure), preserve access
          const currentSub = await prisma.subscription.findUnique({
            where: { id: sub.id },
            select: { status: true },
          });

          if (currentSub?.status !== 'ACTIVE') {
            const gracePeriodEndsAt = new Date(now.getTime() + THREE_DAYS_MS);
            await prisma.subscription.updateMany({
              where: { id: sub.id, status: { not: 'ACTIVE' } },
              data: { status: 'GRACE_PERIOD', gracePeriodEndsAt },
            });
            logger.info('[CRON reconcile] Attempt FAILED — grace period started', { attemptId: attempt.id });
          } else {
            logger.info('[CRON reconcile] Renewal attempt FAILED — subscription stays ACTIVE until expiry', { attemptId: attempt.id });
          }
          failed++;

        } else if (realStatus === 'cancelled') {
          await prisma.subscriptionPaymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: 'CANCELLED',
              providerData: JSON.stringify({ gpData, reconciledAt: now.toISOString() }),
            },
          });
          logger.info('[CRON reconcile] Attempt CANCELLED', { attemptId: attempt.id });
          skipped++;

        } else if (realStatus === 'expired') {
          await prisma.subscriptionPaymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: 'EXPIRED',
              providerData: JSON.stringify({ gpData, reconciledAt: now.toISOString() }),
            },
          });
          logger.info('[CRON reconcile] Attempt EXPIRED', { attemptId: attempt.id });
          skipped++;

        } else {
          // pending or unknown — retry next run, no state change
          skipped++;
        }
      } catch (gpErr) {
        logger.warn('[CRON reconcile] Could not query GeniusPay', {
          geniuspayRef: attempt.geniuspayRef, attemptId: attempt.id, error: gpErr.message,
        });
        skipped++;
      }
    }

    logger.info('[CRON] reconcilePendingSubscriptions completed', { activated, failed, review, skipped });
  } catch (err) {
    logger.error('[CRON] Error in reconcilePendingSubscriptions', { error: err.message });
  }
}

/**
 * Start all inline cron jobs.
 * Called once from index.js after the DB connection is confirmed healthy.
 */
function initializeCronJobs() {
  setInterval(expireQuotes, ONE_HOUR_MS);
  expireQuotes();

  setInterval(cleanExpiredRefreshTokens, ONE_DAY_MS);
  cleanExpiredRefreshTokens();

  setInterval(expirePendingPayments, ONE_HOUR_MS);
  expirePendingPayments();

  setInterval(expireTrials, ONE_DAY_MS);
  expireTrials();

  // Phase 3: subscription payment lifecycle crons
  setInterval(expirePendingSubscriptions, FIFTEEN_MIN_MS);
  expirePendingSubscriptions();

  setInterval(expireGracePeriods, ONE_HOUR_MS);
  expireGracePeriods();

  setInterval(sendGracePeriodReminders, ONE_DAY_MS);
  sendGracePeriodReminders();

  // Offset +30min from other hourly crons to avoid simultaneous DB peaks.
  setTimeout(() => {
    reconcilePendingPayments();
    setInterval(reconcilePendingPayments, ONE_HOUR_MS);
  }, THIRTY_MIN_MS);

  // Subscription reconciliation — every 30min, offset 15min from expirePendingSubscriptions.
  setTimeout(() => {
    reconcilePendingSubscriptions();
    setInterval(reconcilePendingSubscriptions, THIRTY_MIN_MS);
  }, THIRTY_MIN_MS / 2);
}

module.exports = { initializeCronJobs, expireTrials, reconcilePendingSubscriptions };
