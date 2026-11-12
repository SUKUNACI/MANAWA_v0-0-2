const prisma = require('../config/db');
const geniuspay = require('../utils/geniuspay');
const { logPaymentStatus } = require('../utils/paymentAudit');
const logger = require('../utils/logger');

/**
 * Q52: Payment Reconciliation Cron Job
 * Runs daily at midnight (00:00 UTC)
 *
 * - Checks ALL pending payments
 * - Calls GeniusPay API for each payment
 * - Syncs status (succeeded, failed, cancelled, expired)
 * - Detects amount mismatches (tolerance ±1 XOF)
 * - Logs audit trail for each change
 * - Alerts admin if > 10 payments stuck > 7 days
 */

/**
 * Main reconciliation function
 */
async function reconcilePaymentsDaily() {
  const startTime = Date.now();
  const logger_ctx = logger.child({ job: 'payment_reconciliation_daily' });

  logger_ctx.info('[PaymentReconciliation] Starting daily reconciliation');

  try {
    // 1. Find ALL pending payments
    const pendingPayments = await prisma.payment.findMany({
      where: { status: 'pending' },
      include: {
        quote: { include: { client: true } },
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    logger_ctx.info('[PaymentReconciliation] Found pending payments', {
      count: pendingPayments.length,
    });

    if (pendingPayments.length === 0) {
      logger_ctx.info('[PaymentReconciliation] No pending payments to reconcile');
      return { reconciled: 0, synced: 0, failed: 0, errors: [] };
    }

    let synced = 0;
    let failed = 0;
    const errors = [];
    const stuckPayments = [];

    // 2. Iterate through each pending payment
    for (const payment of pendingPayments) {
      try {
        // Skip payments without GeniusPay reference
        if (!payment.geniuspayRef) {
          logger_ctx.warn('[PaymentReconciliation] Payment missing geniuspayRef', {
            paymentId: payment.id,
          });
          continue;
        }

        // 3. Call GeniusPay API to get latest status
        const gpResponse = await geniuspay.getPayment(payment.geniuspayRef);
        const gpData = gpResponse?.data || gpResponse;
        const realStatus = gpData?.status;

        logger_ctx.debug('[PaymentReconciliation] Fetched GeniusPay status', {
          paymentId: payment.id,
          reference: payment.geniuspayRef,
          gpStatus: realStatus,
        });

        // 4. Sync status
        if (realStatus === 'completed' || realStatus === 'success' || realStatus === 'succeeded') {
          // Payment succeeded on GeniusPay
          const receivedAmount = gpData?.amount || gpData?.paid_amount;

          // Check amount tolerance (±1 XOF)
          if (receivedAmount !== undefined && Math.abs(receivedAmount - payment.amount) > 1) {
            logger_ctx.warn('[PaymentReconciliation] Amount mismatch detected', {
              paymentId: payment.id,
              expected: payment.amount,
              received: receivedAmount,
            });

            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: 'failed',
                metadata: JSON.stringify({
                  reason: 'amount_mismatch',
                  expected: payment.amount,
                  received: receivedAmount,
                  geniuspayStatus: realStatus,
                }),
              },
            });

            await logPaymentStatus({
              paymentId: payment.id,
              fromStatus: 'pending',
              toStatus: 'failed',
              reason: 'reconciliation',
              metadata: {
                cause: 'amount_mismatch',
                expected: payment.amount,
                received: receivedAmount,
              },
            });

            failed++;
          } else {
            // Amount matches, update to succeeded
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: 'succeeded',
                completedAt: new Date(),
                reconciledAt: new Date(),
                reconciledBy: 'reconciliation_job',
                metadata: JSON.stringify({
                  geniuspayStatus: realStatus,
                  geniuspayData: gpData,
                  reconciledAt: new Date().toISOString(),
                }),
              },
            });

            await logPaymentStatus({
              paymentId: payment.id,
              fromStatus: 'pending',
              toStatus: 'succeeded',
              reason: 'reconciliation',
              metadata: { geniuspayStatus: realStatus },
            });

            synced++;

            logger_ctx.info('[PaymentReconciliation] Payment synced to succeeded', {
              paymentId: payment.id,
              amount: payment.amount,
            });
          }
        } else if (realStatus === 'failed' || realStatus === 'cancelled' || realStatus === 'expired') {
          // Payment failed on GeniusPay
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: 'failed',
              reconciledAt: new Date(),
              reconciledBy: 'reconciliation_job',
              metadata: JSON.stringify({
                geniuspayStatus: realStatus,
                geniuspayData: gpData,
                reconciledAt: new Date().toISOString(),
              }),
            },
          });

          await logPaymentStatus({
            paymentId: payment.id,
            fromStatus: 'pending',
            toStatus: 'failed',
            reason: 'reconciliation',
            metadata: { geniuspayStatus: realStatus },
          });

          failed++;

          logger_ctx.info('[PaymentReconciliation] Payment synced to failed', {
            paymentId: payment.id,
            geniuspayStatus: realStatus,
          });
        } else if (realStatus === 'pending' || realStatus === 'processing') {
          // Still pending on GeniusPay — check if stuck > 7 days
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (payment.createdAt < sevenDaysAgo) {
            stuckPayments.push({
              paymentId: payment.id,
              amount: payment.amount,
              createdAt: payment.createdAt,
              daysStuck: Math.floor((Date.now() - payment.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
              clientEmail: payment.quote?.client?.email,
              reference: payment.geniuspayRef,
            });
          }
        } else {
          logger_ctx.warn('[PaymentReconciliation] Unknown GeniusPay status', {
            paymentId: payment.id,
            geniuspayStatus: realStatus,
          });
        }
      } catch (err) {
        logger_ctx.error('[PaymentReconciliation] Error reconciling payment', {
          paymentId: payment.id,
          error: err.message,
        });

        errors.push({
          paymentId: payment.id,
          error: err.message,
        });
      }
    }

    // 5. Alert admin if > 10 payments stuck > 7 days
    if (stuckPayments.length > 10) {
      logger_ctx.warn('[PaymentReconciliation] ALERT: Multiple stuck payments detected', {
        count: stuckPayments.length,
      });

      try {
        // Create admin notification
        const adminUsers = await prisma.user.findMany({
          where: {
            OR: [{ role: 'ADMIN' }, { adminLevel: { not: null } }],
          },
          select: { id: true, email: true },
        });

        for (const admin of adminUsers) {
          await prisma.notification.create({
            data: {
              userId: admin.id,
              type: 'SYSTEM_ALERT',
              title: 'Alerte: Paiements bloqués',
              message: `${stuckPayments.length} paiements sont bloqués depuis plus de 7 jours. Vérification nécessaire.`,
              metadata: JSON.stringify({
                stuckCount: stuckPayments.length,
                samples: stuckPayments.slice(0, 5).map(p => ({
                  paymentId: p.paymentId,
                  amount: p.amount,
                  daysStuck: p.daysStuck,
                })),
              }),
            },
          });
        }

        logger_ctx.info('[PaymentReconciliation] Admin alerts created', {
          stuckCount: stuckPayments.length,
          adminCount: adminUsers.length,
        });
      } catch (err) {
        logger_ctx.error('[PaymentReconciliation] Failed to create admin notifications', {
          error: err.message,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger_ctx.info('[PaymentReconciliation] Daily reconciliation completed', {
      duration: `${duration}ms`,
      synced,
      failed,
      errors: errors.length,
      stuckPayments: stuckPayments.length,
      totalProcessed: pendingPayments.length,
    });

    return {
      reconciled: pendingPayments.length,
      synced,
      failed,
      errors,
      stuckPayments,
    };
  } catch (err) {
    logger_ctx.error('[PaymentReconciliation] Fatal error', {
      error: err.message,
      stack: err.stack,
    });

    // Send error notification to admins
    try {
      const adminUsers = await prisma.user.findMany({
        where: {
          OR: [{ role: 'ADMIN' }, { adminLevel: { not: null } }],
        },
        select: { id: true },
      });

      for (const admin of adminUsers) {
        await prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'SYSTEM_ALERT',
            title: 'Erreur: Réconciliation paiements échouée',
            message: `La tâche de réconciliation quotidienne a échoué: ${err.message}`,
            metadata: JSON.stringify({ error: err.message }),
          },
        });
      }
    } catch (notifyErr) {
      logger_ctx.error('[PaymentReconciliation] Failed to send error notification', {
        error: notifyErr.message,
      });
    }

    throw err;
  }
}

/**
 * Schedule the reconciliation job to run daily at midnight (00:00 UTC)
 */
function schedulePaymentReconciliation() {
  logger.info('[PaymentReconciliation] Scheduling daily reconciliation at 00:00 UTC');

  // Calculate milliseconds until next midnight (UTC)
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  // Schedule first run at next midnight
  setTimeout(() => {
    reconcilePaymentsDaily().catch(err => {
      logger.error('[PaymentReconciliation] Job failed', { error: err.message });
    });

    // Then schedule to run every 24 hours
    setInterval(() => {
      reconcilePaymentsDaily().catch(err => {
        logger.error('[PaymentReconciliation] Job failed', { error: err.message });
      });
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  logger.info('[PaymentReconciliation] First reconciliation scheduled in', {
    hours: Math.round(msUntilMidnight / (60 * 60 * 1000)),
    minutes: Math.round((msUntilMidnight % (60 * 60 * 1000)) / (60 * 1000)),
  });
}

module.exports = {
  reconcilePaymentsDaily,
  schedulePaymentReconciliation,
};
