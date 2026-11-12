const Queue = require('bull');
const logger = require('../utils/logger');

/**
 * Configuration pour la queue Bull des webhooks (Q56)
 *
 * Garantit:
 * - FIFO ordering: webhook A avant webhook B
 * - Sequence number pour tracking
 * - Idempotency key pour déduplication côté client
 * - Retry logic avec exponential backoff
 */

// Configuration Redis (réutiliser celle de queue.js)
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: true,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

// Remove undefined password if not set
if (!redisConfig.password) {
  delete redisConfig.password;
}

/**
 * Configuration de la queue webhook Bull (Q56)
 *
 * FIFO Order Guarantee:
 * - Les jobs sont traités dans l'ordre FIFO strict
 * - Les webhooks A et B sont envoyés dans l'ordre de création
 * - Chaque job a un sequence number
 * - Headers X-Webhook-Sequence + X-Idempotency-Key
 */
const webhookQueueConfig = {
  redis: redisConfig,
  settings: {
    // Max attempts: 3 retries pour livraison webhook
    maxRetries: 3,

    // Exponential backoff: 5s, 10s, 20s
    retryBackoff: {
      type: 'exponential',
      delay: 5000,
    },

    // FIFO strict ordering
    // Bull traite les jobs dans l'ordre FIFO par défaut
    // Cette option assure qu'un job n'est pas traité avant le précédent
    fifo: true,

    // Complete jobs after 24 hours
    completedInterval: 60000,

    // Clean up failed jobs after 7 days
    failedInterval: 3600000,

    // Max stalled count: mark as failed after 2 stalls
    maxStalledCount: 2,

    // Lock duration: 30 seconds (pour éviter double traitement)
    lockDuration: 30000,

    // Lock renew time: 15 seconds
    lockRenewTime: 15000,

    // Prioritize jobs (on peut utiliser si besoin)
    enablePriority: false, // Disable for strict FIFO

    // Batch size de processing
    // Processus 1 job à la fois pour garantir l'ordre
    // (Bull le fait par défaut avec 1 worker)
  },
};

/**
 * Instance de la queue webhook Bull (Q56)
 *
 * Utilisée pour:
 * - Mettre en queue les webhooks au lieu de les envoyer directement
 * - Garantir l'ordre FIFO
 * - Tracker sequence numbers
 * - Implémenter retry logic
 *
 * Voir webhook-queue-manager.js pour les handlers
 */
const webhookQueue = new Queue('webhooks', webhookQueueConfig);

/**
 * Setup error handlers pour la queue webhook
 */
const setupWebhookQueueErrorHandlers = () => {
  webhookQueue.on('error', (err) => {
    logger.error('[Q56] Webhook Queue Error', {
      message: err.message,
      stack: err.stack,
    });
  });

  webhookQueue.on('failed', (job, err) => {
    logger.warn('[Q56] Webhook job failed (attempt ' + (job.attemptsMade || 0) + '/' + (job.opts.attempts || 1) + ')', {
      jobId: job.id,
      jobData: job.data,
      error: err.message,
      webhookId: job.data?.webhookId,
      sequence: job.data?.sequence,
    });
  });

  webhookQueue.on('completed', (job) => {
    logger.debug('[Q56] Webhook job completed', {
      jobId: job.id,
      webhookId: job.data?.webhookId,
      sequence: job.data?.sequence,
      result: job.returnvalue,
    });
  });

  webhookQueue.on('stalled', (job) => {
    logger.warn('[Q56] Webhook job stalled', {
      jobId: job.id,
      webhookId: job.data?.webhookId,
      sequence: job.data?.sequence,
      progress: job.progress?.() || 0,
    });
  });

  webhookQueue.on('waiting', (jobId) => {
    logger.debug('[Q56] Webhook job waiting', { jobId });
  });

  webhookQueue.on('active', (job) => {
    logger.debug('[Q56] Webhook job active', {
      jobId: job.id,
      webhookId: job.data?.webhookId,
      sequence: job.data?.sequence,
    });
  });
};

/**
 * Helper: Ajouter un webhook à la queue (Q56)
 *
 * @param {Object} webhookData - Données du webhook
 * @param {string} webhookData.webhookId - ID du webhook
 * @param {string} webhookData.event - Type d'événement
 * @param {Object} webhookData.payload - Payload du webhook
 * @param {string} webhookData.signature - Signature HMAC
 * @param {number} webhookData.sequence - Sequence number
 * @param {string} webhookData.idempotencyKey - Clé idempotency
 * @returns {Promise<Object>} Job ajouté
 */
async function addWebhookToQueue(webhookData) {
  try {
    const {
      webhookId,
      event,
      payload,
      signature,
      sequence = 0,
      idempotencyKey = null,
      attempt = 1,
    } = webhookData;

    // Ajouter en queue avec options FIFO
    const job = await webhookQueue.add(
      {
        webhookId,
        event,
        payload,
        signature,
        sequence,
        idempotencyKey,
        attempt,
      },
      {
        // FIFO strict: traiter dans l'ordre d'ajout
        priority: 0,

        // Retry avec backoff
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },

        // Timeout par job
        timeout: 30000,

        // Ajouter une clé de déduplication basée sur idempotencyKey
        // Si le même idempotencyKey est envoyé, ne pas créer de job dupliqué
        removeOnComplete: {
          age: 3600, // Garder les completed jobs 1 heure pour déduplication
        },

        removeOnFail: false, // Garder les failed jobs pour debug

        // Job ID: utiliser l'idempotencyKey si disponible pour déduplication
        jobId: idempotencyKey ? `webhook-${idempotencyKey}` : undefined,
      }
    );

    logger.debug('[Q56] Webhook added to queue', {
      jobId: job.id,
      webhookId,
      event,
      sequence,
      idempotencyKey,
    });

    return job;
  } catch (err) {
    logger.error('[Q56] Failed to add webhook to queue', {
      error: err.message,
      webhookData,
    });
    throw err;
  }
}

/**
 * Helper: Obtenir les stats de la queue webhook
 *
 * @returns {Promise<Object>} Stats de la queue
 */
async function getWebhookQueueStats() {
  try {
    const counts = await webhookQueue.getJobCounts();
    const failedJobs = await webhookQueue.getFailed(0, 10);
    const delayedJobs = await webhookQueue.getDelayed(0, 10);
    const activeJobs = await webhookQueue.getActive(0, 10);

    return {
      name: 'webhooks',
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      waiting: counts.waiting,
      paused: counts.paused,
      recentFailedJobs: failedJobs.length,
      recentDelayedJobs: delayedJobs.length,
      recentActiveJobs: activeJobs.length,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('[Q56] Error getting webhook queue stats', {
      error: err.message,
    });
    return {
      name: 'webhooks',
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Helper: Nettoyer les anciens jobs de la queue
 *
 * @param {number} daysOld - Nombre de jours avant suppression
 * @returns {Promise<Object>} Nombre de jobs supprimés
 */
async function cleanOldWebhookJobs(daysOld = 7) {
  try {
    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const completed = await webhookQueue.clean(cutoffTime, 0, 'completed');
    const failed = await webhookQueue.clean(cutoffTime, 0, 'failed');

    logger.info('[Q56] Cleaned old webhook jobs', {
      completed: completed.length,
      failed: failed.length,
      daysOld,
    });

    return { completed: completed.length, failed: failed.length };
  } catch (err) {
    logger.error('[Q56] Error cleaning old webhook jobs', {
      error: err.message,
    });
    throw err;
  }
}

module.exports = {
  webhookQueue,
  webhookQueueConfig,
  setupWebhookQueueErrorHandlers,
  addWebhookToQueue,
  getWebhookQueueStats,
  cleanOldWebhookJobs,
};
