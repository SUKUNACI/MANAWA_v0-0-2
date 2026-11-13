const axios = require('axios');
const crypto = require('crypto');
const prisma = require('../config/db');
const logger = require('./logger');
const {
  webhookQueue,
  setupWebhookQueueErrorHandlers,
  cleanOldWebhookJobs,
} = require('../config/webhook-queue-config');

/**
 * Manager de la queue webhook Bull (Q56)
 *
 * Responsabilités:
 * 1. Ajouter les webhooks à la queue (au lieu d'envoi direct)
 * 2. Traiter les jobs dans l'ordre FIFO strict
 * 3. Ajouter sequence numbers à WebhookLog
 * 4. Envoyer headers X-Webhook-Sequence et X-Idempotency-Key
 * 5. Garantir l'ordre FIFO (webhook A avant webhook B)
 * 6. Permettre déduplication côté client via idempotency_key
 *
 * Architecture:
 * - triggerWebhookQueued() remplace triggerWebhook()
 * - Au lieu d'envoyer directement, mettre en queue
 * - Le processor traite 1 job à la fois (FIFO)
 * - Chaque WebhookLog reçoit un sequence number
 */

// Compteur global de sequence (en production, utiliser une BD)
// En dev/test, on peut utiliser un compteur simple
let sequenceCounter = 0;

/**
 * Initialiser la queue webhook avec handlers
 *
 * IMPORTANT: Appeler une seule fois au démarrage du serveur
 */
async function initializeWebhookQueue() {
  try {
    setupWebhookQueueErrorHandlers();

    // Processor pour traiter les jobs de la queue
    // Traite 1 job à la fois pour garantir FIFO
    webhookQueue.process(1, async (job) => {
      return await processWebhookJob(job);
    });

    logger.info('[Q56] Webhook queue initialized', {
      fifo: true,
      concurrency: 1,
      retries: 3,
    });

    // Nettoyer les vieux jobs au démarrage
    // (garder 1 jour par défaut)
    setTimeout(() => {
      cleanOldWebhookJobs(1)
        .catch(err => logger.error('[Q56] Cleanup error:', err.message));
    }, 5000);
  } catch (err) {
    logger.error('[Q56] Failed to initialize webhook queue', {
      error: err.message,
    });
    throw err;
  }
}

/**
 * Obtenir le prochain sequence number
 *
 * En production, utiliser une table dans Prisma:
 * - model WebhookSequence { nextSequence Int }
 * - Utiliser transactions pour atomicité
 */
async function getNextSequenceNumber() {
  try {
    // Approche simple: incrémenter un compteur
    // En production: utiliser une transaction DB
    sequenceCounter++;
    return sequenceCounter;
  } catch (err) {
    logger.error('[Q56] Error getting sequence number', {
      error: err.message,
    });
    throw err;
  }
}

/**
 * Trigger d'un webhook avec queue (remplace triggerWebhook original)
 *
 * À la place d'envoyer directement:
 * 1. Créer une WebhookLog avec sequence number
 * 2. Ajouter à la queue Bull
 * 3. Le processor traite dans l'ordre FIFO
 *
 * @param {string} event - Type d'événement
 * @param {Object} payload - Données du webhook
 */
async function triggerWebhookQueued(event, payload) {
  try {
    // Valider l'événement
    const { WEBHOOK_EVENTS } = require('./webhooks');
    if (!Object.values(WEBHOOK_EVENTS).includes(event)) {
      logger.warn('[Q56] Unknown webhook event', { event });
      return;
    }

    // Trouver tous les webhooks actifs abonnés à cet événement
    const webhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        events: {
          has: event,
        },
      },
    });

    if (webhooks.length === 0) {
      logger.debug('[Q56] No active webhooks for event', { event });
      return;
    }

    const payloadString = JSON.stringify(payload);
    const results = [];

    // Pour chaque webhook abonné:
    // 1. Créer une WebhookLog avec sequence number
    // 2. Ajouter à la queue
    for (const webhook of webhooks) {
      try {
        // Obtenir le prochain sequence number (Q56)
        const sequence = await getNextSequenceNumber();

        // Générer une idempotency key unique (Q56)
        const idempotencyKey = `${webhook.id}-${event}-${sequence}-${Date.now()}`;

        // Créer une WebhookLog avec sequence number (Q56)
        const log = await prisma.webhookLog.create({
          data: {
            webhookId: webhook.id,
            event,
            payload: payloadString,
            status: 'pending',
            attempt: 1,
            sequence, // Q56: Ajouter sequence number
            idempotencyKey, // Q56: Ajouter idempotency key
          },
        });

        // Générer la signature
        const signature = crypto
          .createHmac('sha256', webhook.secret)
          .update(payloadString)
          .digest('hex');

        // Ajouter à la queue Bull (Q56)
        const { addWebhookToQueue } = require('../config/webhook-queue-config');
        await addWebhookToQueue({
          webhookId: webhook.id,
          event,
          payload: payloadString,
          signature,
          sequence,
          idempotencyKey,
          logId: log.id, // Passer l'ID du log pour mise à jour
        });

        results.push({
          webhookId: webhook.id,
          status: 'queued',
          sequence,
          idempotencyKey,
          logId: log.id,
        });

        logger.debug('[Q56] Webhook queued for processing', {
          webhookId: webhook.id,
          event,
          sequence,
          idempotencyKey,
          logId: log.id,
        });
      } catch (err) {
        logger.error('[Q56] Failed to queue webhook', {
          webhookId: webhook.id,
          event,
          error: err.message,
        });
        results.push({
          webhookId: webhook.id,
          status: 'error',
          error: err.message,
        });
      }
    }

    logger.info('[Q56] Webhook event triggered (queued)', {
      event,
      targetCount: webhooks.length,
      results,
    });
  } catch (err) {
    logger.error('[Q56] Failed to trigger webhook queued', {
      event,
      error: err.message,
    });
  }
}

/**
 * Processor pour les jobs de la queue webhook (Q56)
 *
 * Traite un job à la fois (FIFO strict)
 * Envoie le webhook avec:
 * - X-Webhook-Signature: sha256=<signature>
 * - X-Webhook-Sequence: <sequence_number>
 * - X-Idempotency-Key: <idempotency_key>
 * - X-Webhook-Event: <event>
 * - X-Webhook-Attempt: <attempt>
 *
 * @param {Job} job - Job Bull
 */
async function processWebhookJob(job) {
  const {
    webhookId,
    event,
    payload,
    signature,
    sequence,
    idempotencyKey,
    logId,
    attempt = 1,
  } = job.data;

  try {
    // Récupérer le webhook
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      logger.error('[Q56] Webhook not found', { webhookId, jobId: job.id });
      throw new Error(`Webhook ${webhookId} not found`);
    }

    if (!webhook.isActive) {
      logger.warn('[Q56] Webhook is inactive', {
        webhookId,
        jobId: job.id,
        sequence,
      });

      // Mettre à jour le log comme failed
      if (logId) {
        await prisma.webhookLog.update({
          where: { id: logId },
          data: {
            status: 'failed',
            response: JSON.stringify({
              message: 'Webhook is inactive',
              sequence,
            }),
            attempt,
          },
        });
      }

      throw new Error('Webhook is inactive');
    }

    // Envoyer le webhook avec headers Q56
    const response = await axios.post(
      webhook.url,
      JSON.parse(payload),
      {
        headers: {
          'X-Webhook-Event': event,
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Sequence': sequence.toString(), // Q56
          'X-Idempotency-Key': idempotencyKey, // Q56
          'X-Webhook-Attempt': attempt.toString(),
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );

    // Vérifier le succès
    if (response.status >= 200 && response.status < 300) {
      // Success
      if (logId) {
        await prisma.webhookLog.update({
          where: { id: logId },
          data: {
            status: 'success',
            response: JSON.stringify({
              statusCode: response.status,
              body: response.data,
            }),
            attempt,
            sequence,
          },
        });
      }

      logger.info('[Q56] Webhook delivered successfully', {
        jobId: job.id,
        webhookId,
        event,
        sequence,
        idempotencyKey,
        statusCode: response.status,
      });

      return {
        success: true,
        statusCode: response.status,
        sequence,
      };
    }

    // Erreur HTTP non-2xx
    const error = new Error(`HTTP ${response.status}`);
    error.statusCode = response.status;
    error.responseBody = response.data;
    throw error;
  } catch (err) {
    logger.warn('[Q56] Webhook delivery failed', {
      jobId: job.id,
      webhookId,
      event,
      sequence,
      idempotencyKey,
      attempt: job.attemptsMade || 0,
      maxAttempts: job.opts.attempts,
      error: err.message,
    });

    // Mettre à jour le log comme pending (il sera retenté)
    if (logId && attempt <= 3) {
      const nextRetryDelay = 5000 * Math.pow(2, attempt - 1); // 5s, 10s, 20s
      const nextRetryAt = new Date(Date.now() + nextRetryDelay);

      await prisma.webhookLog.update({
        where: { id: logId },
        data: {
          status: 'pending',
          response: JSON.stringify({
            message: err.message,
            statusCode: err.statusCode,
            sequence,
          }),
          attempt: attempt + 1,
          nextRetryAt,
        },
      });
    } else if (logId) {
      // Max retries exceeded
      await prisma.webhookLog.update({
        where: { id: logId },
        data: {
          status: 'failed',
          response: JSON.stringify({
            message: 'Max retries exceeded',
            lastError: err.message,
            sequence,
          }),
          attempt: Math.max(attempt, 3),
        },
      });
    }

    throw err; // Bull va retry automatiquement
  }
}

/**
 * Helper: Obtenir les stats de la queue webhook
 */
async function getWebhookQueueStatus() {
  try {
    const { getWebhookQueueStats } = require('../config/webhook-queue-config');
    return await getWebhookQueueStats();
  } catch (err) {
    logger.error('[Q56] Error getting queue status', {
      error: err.message,
    });
    return { error: err.message };
  }
}

/**
 * Helper: Réinitialiser le compteur de sequence (pour tests)
 */
function resetSequenceCounter() {
  sequenceCounter = 0;
  logger.info('[Q56] Sequence counter reset to 0');
}

module.exports = {
  initializeWebhookQueue,
  triggerWebhookQueued,
  processWebhookJob,
  getWebhookQueueStatus,
  getNextSequenceNumber,
  resetSequenceCounter,
};
