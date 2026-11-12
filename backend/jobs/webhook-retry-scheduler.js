const axios = require('axios');
const prisma = require('../config/db');
const logger = require('../utils/logger');

/**
 * Q54: Webhook Retry Logic Scheduler
 * Runs every 30 minutes to retry pending webhooks
 *
 * Strategy:
 * - Find WebhookLog entries with status='pending' and nextRetryAt <= now
 * - Retry each webhook (max 3 attempts total)
 * - Recalculate nextRetryAt with exponential backoff (5s→10s→20s)
 * - If success: mark as 'succeeded'
 * - If all 3 attempts fail: mark as 'failed' and send admin alert
 */
async function webhookRetryScheduler() {
  try {
    logger.info('[WebhookRetryScheduler] Starting webhook retry scheduler');

    // 1. Find all pending webhooks ready for retry
    const now = new Date();
    const pendingWebhooks = await prisma.webhookLog.findMany({
      where: {
        status: 'pending',
        nextRetryAt: {
          lte: now,
        },
      },
      include: {
        webhook: true,
      },
      take: 100, // Process max 100 per run to avoid overload
    });

    if (pendingWebhooks.length === 0) {
      logger.debug('[WebhookRetryScheduler] No pending webhooks to retry');
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        rescheduled: 0,
      };
    }

    logger.info('[WebhookRetryScheduler] Found pending webhooks', {
      count: pendingWebhooks.length,
    });

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let rescheduled = 0;
    const failedWebhooks = [];

    // 2. Process each webhook
    for (const webhookLog of pendingWebhooks) {
      try {
        const { id: logId, attempt, webhook, event, payload, response } = webhookLog;

        logger.debug('[WebhookRetryScheduler] Processing webhook', {
          logId,
          event,
          attempt,
          webhookUrl: webhook.url,
        });

        // 3. Check if max attempts exceeded
        const MAX_ATTEMPTS = 3;
        if (attempt >= MAX_ATTEMPTS) {
          // Mark as failed
          await prisma.webhookLog.update({
            where: { id: logId },
            data: {
              status: 'failed',
            },
          });

          logger.warn('[WebhookRetryScheduler] Webhook exhausted max attempts', {
            logId,
            event,
            attempt,
            webhookUrl: webhook.url,
          });

          failedWebhooks.push({
            logId,
            event,
            attempt,
            webhookUrl: webhook.url,
            payload,
            lastResponse: response,
          });

          failed++;
          processed++;
          continue;
        }

        // 4. Parse payload
        let parsedPayload;
        try {
          parsedPayload = JSON.parse(payload);
        } catch (e) {
          logger.error('[WebhookRetryScheduler] Failed to parse webhook payload', {
            logId,
            error: e.message,
          });

          // Mark as failed due to corrupt payload
          await prisma.webhookLog.update({
            where: { id: logId },
            data: {
              status: 'failed',
              response: JSON.stringify({
                error: 'Invalid payload JSON',
                timestamp: new Date().toISOString(),
              }),
            },
          });

          failed++;
          processed++;
          continue;
        }

        // 5. Attempt to retry webhook
        let retryResponse = null;
        let retrySuccess = false;

        try {
          const response = await axios.post(webhook.url, parsedPayload, {
            timeout: 30000,
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Event': event,
              'X-Retry-Attempt': attempt.toString(),
              'X-Webhook-Timestamp': new Date().toISOString(),
            },
          });

          retryResponse = {
            status: response.status,
            statusText: response.statusText,
            timestamp: new Date().toISOString(),
          };

          // Consider 2xx responses as success
          retrySuccess = response.status >= 200 && response.status < 300;

          logger.info('[WebhookRetryScheduler] Webhook retry attempt', {
            logId,
            event,
            attempt,
            success: retrySuccess,
            status: response.status,
          });
        } catch (err) {
          retryResponse = {
            error: err.message,
            status: err.response?.status || null,
            statusText: err.response?.statusText || null,
            timestamp: new Date().toISOString(),
          };

          logger.warn('[WebhookRetryScheduler] Webhook retry failed', {
            logId,
            event,
            attempt,
            error: err.message,
            status: err.response?.status,
          });
        }

        // 6. Update webhook log based on result
        if (retrySuccess) {
          // Success: mark as succeeded
          await prisma.webhookLog.update({
            where: { id: logId },
            data: {
              status: 'succeeded',
              response: JSON.stringify(retryResponse),
            },
          });

          succeeded++;
          logger.info('[WebhookRetryScheduler] Webhook succeeded', {
            logId,
            event,
            attempt,
          });
        } else {
          // Failure: calculate next retry time with exponential backoff
          // Backoff schedule: 5s, 10s, 20s, then mark failed
          const backoffMultiplier = 2;
          const initialDelayMs = 5000; // 5 seconds
          const delayMs = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
          const nextRetryAt = new Date(Date.now() + delayMs);

          const newAttempt = attempt + 1;

          if (newAttempt > MAX_ATTEMPTS) {
            // Final attempt failed, mark as failed
            await prisma.webhookLog.update({
              where: { id: logId },
              data: {
                status: 'failed',
                response: JSON.stringify(retryResponse),
                attempt: newAttempt,
              },
            });

            failed++;
            failedWebhooks.push({
              logId,
              event,
              attempt: newAttempt,
              webhookUrl: webhook.url,
              payload,
              lastResponse: retryResponse,
            });

            logger.warn('[WebhookRetryScheduler] Webhook failed after max attempts', {
              logId,
              event,
              finalAttempt: newAttempt,
            });
          } else {
            // Reschedule for next retry
            await prisma.webhookLog.update({
              where: { id: logId },
              data: {
                attempt: newAttempt,
                nextRetryAt: nextRetryAt,
                response: JSON.stringify(retryResponse),
              },
            });

            rescheduled++;
            logger.info('[WebhookRetryScheduler] Webhook rescheduled', {
              logId,
              event,
              nextAttempt: newAttempt,
              nextRetryAt: nextRetryAt.toISOString(),
              delayMs,
            });
          }
        }

        processed++;
      } catch (err) {
        logger.error('[WebhookRetryScheduler] Error processing webhook', {
          logId: webhookLog.id,
          error: err.message,
          stack: err.stack,
        });
        processed++;
      }
    }

    // 7. Send admin alert if webhooks failed
    if (failedWebhooks.length > 0) {
      await sendAdminAlert({
        type: 'WEBHOOK_FAILURES',
        failedCount: failedWebhooks.length,
        webhooks: failedWebhooks.slice(0, 10), // First 10 for alert
        timestamp: new Date().toISOString(),
      }).catch(err => {
        logger.error('[WebhookRetryScheduler] Failed to send admin alert', {
          error: err.message,
        });
      });
    }

    const summary = {
      processed,
      succeeded,
      failed,
      rescheduled,
      alertsSent: failedWebhooks.length > 0 ? 1 : 0,
      timestamp: new Date().toISOString(),
    };

    logger.info('[WebhookRetryScheduler] Scheduler completed', summary);

    return summary;
  } catch (err) {
    logger.error('[WebhookRetryScheduler] Fatal error in scheduler', {
      error: err.message,
      stack: err.stack,
    });

    throw err;
  }
}

/**
 * Send admin alert for failed webhooks
 */
async function sendAdminAlert(alertData) {
  try {
    // Find admin users or send to admin email
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
        suspended: false,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
      },
    });

    if (admins.length === 0) {
      logger.warn('[WebhookRetryScheduler] No admin users found for alert');
      return;
    }

    logger.info('[WebhookRetryScheduler] Sending admin alert', {
      adminCount: admins.length,
      failedCount: alertData.failedCount,
    });

    // Create notification or send email to all admins
    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: 'ALERT',
          title: `Échec de webhooks (${alertData.failedCount} erreur${alertData.failedCount > 1 ? 's' : ''})`,
          body: `${alertData.failedCount} webhook(s) ont échoué après le maximum de tentatives`,
          metadata: JSON.stringify({
            type: 'WEBHOOK_FAILURES',
            failedCount: alertData.failedCount,
            failedWebhooks: alertData.webhooks.map(w => ({
              event: w.event,
              url: w.webhookUrl,
            })),
            timestamp: alertData.timestamp,
          }),
        },
      }).catch(err => {
        logger.error('[WebhookRetryScheduler] Failed to create notification', {
          adminId: admin.id,
          error: err.message,
        });
      });
    }

    logger.info('[WebhookRetryScheduler] Admin alerts sent', { adminCount: admins.length });
  } catch (err) {
    logger.error('[WebhookRetryScheduler] Error sending admin alert', {
      error: err.message,
    });
    throw err;
  }
}

/**
 * Get scheduler statistics
 */
async function getWebhookRetryStats() {
  try {
    const stats = await prisma.webhookLog.groupBy({
      by: ['status'],
      _count: {
        id: true,
      },
    });

    const pendingCount = await prisma.webhookLog.count({
      where: {
        status: 'pending',
        nextRetryAt: { lte: new Date() },
      },
    });

    return {
      statusDistribution: stats,
      readyForRetry: pendingCount,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('[getWebhookRetryStats] Error', { error: err.message });
    throw err;
  }
}

module.exports = {
  webhookRetryScheduler,
  sendAdminAlert,
  getWebhookRetryStats,
};
