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

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const THIRTY_MIN_MS = 30 * 60 * 1000;

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

  // Offset +30min from other hourly crons to avoid simultaneous DB peaks.
  setTimeout(() => {
    reconcilePendingPayments();
    setInterval(reconcilePendingPayments, ONE_HOUR_MS);
  }, THIRTY_MIN_MS);
}

module.exports = { initializeCronJobs };
