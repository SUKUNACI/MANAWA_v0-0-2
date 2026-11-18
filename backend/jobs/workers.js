const logger = require('../utils/logger');
const { emailQueue, pdfQueue, analyticsQueue, paymentQueue, badgesQueue } = require('../config/queue');
const { sendEmailJob } = require('./sendEmailJob');
const { generatePdfJob } = require('./generatePdfJob');
const { calculateAnalyticsJob } = require('./calculateAnalyticsJob');
const { processPaymentJob } = require('./processPaymentJob');
const { updateBadgesJob } = require('./updateBadgesJob');

/**
 * Initialize all queue workers
 * This function must be called once when the server starts
 */
async function initializeWorkers() {
  logger.info('[Workers] Initializing job queue workers');

  try {
    const startTime = Date.now();
    const queueConfigs = [
      { queue: emailQueue, concurrency: 5, name: 'emails', handler: sendEmailJob },
      { queue: pdfQueue, concurrency: 2, name: 'pdfs', handler: generatePdfJob },
      { queue: analyticsQueue, concurrency: 1, name: 'analytics', handler: calculateAnalyticsJob },
      { queue: paymentQueue, concurrency: 3, name: 'payments', handler: processPaymentJob },
      { queue: badgesQueue, concurrency: 2, name: 'badges', handler: updateBadgesJob },
    ];

    // CRITICAL: Register all processors with parallel wait
    // queue.process() returns a Promise that resolves when worker is ACTUALLY ready to process jobs.
    // We must wait for all to resolve, but do so in parallel to avoid sequential blocking.
    const processPromises = [];

    for (const config of queueConfigs) {
      try {
        const t0 = Date.now();
        logger.info(`[Workers] Registering ${config.name} processor`, { elapsed: t0 - startTime });

        // queue.process() is synchronous for registration, but returns a Promise
        // that resolves when the worker is actually ready
        const promise = config.queue.process(config.concurrency, async (job) => {
          return await config.handler(job);
        });

        logger.info(`[Workers] ${config.name} processor registered (Promise created)`, {
          elapsed: Date.now() - startTime,
          registerTime: Date.now() - t0
        });

        processPromises.push(
          promise
            .then(() => {
              logger.info(`[Workers] ${config.name} worker ready to process jobs`, {
                elapsed: Date.now() - startTime
              });
              return { name: config.name, status: 'ready' };
            })
            .catch(err => {
              logger.error(`[Workers] ${config.name} worker failed to initialize`, {
                error: err.message,
                elapsed: Date.now() - startTime
              });
              return { name: config.name, status: 'failed', error: err.message };
            })
        );
      } catch (err) {
        logger.error(`[Workers] ${config.name} process registration failed`, {
          error: err.message,
          elapsed: Date.now() - startTime
        });
        throw err;
      }
    }

    // Wait for all workers to be ready in parallel (non-blocking)
    logger.info('[Workers] Waiting for all workers to be ready...', {
      totalQueues: queueConfigs.length
    });

    const results = await Promise.all(processPromises);

    const failedWorkers = results.filter(r => r.status !== 'ready');
    if (failedWorkers.length > 0) {
      const error = `${failedWorkers.length} workers failed to initialize: ${failedWorkers.map(w => w.name).join(', ')}`;
      logger.error(`[Workers] ${error}`);
      throw new Error(error);
    }

    logger.info('[Workers] All job queue workers initialized successfully and ready to process jobs', {
      totalElapsed: Date.now() - startTime,
      workersReady: queueConfigs.length
    });

    return true;
  } catch (err) {
    logger.error('[Workers] Error initializing workers:', err.message);
    throw err;
  }
}

/**
 * Gracefully shutdown all workers
 */
async function shutdownWorkers() {
  logger.info('[Workers] Shutting down job queue workers');

  try {
    await emailQueue.close();
    await pdfQueue.close();
    await analyticsQueue.close();
    await paymentQueue.close();
    await badgesQueue.close();
    logger.info('[Workers] All job queue workers shut down successfully');
  } catch (err) {
    logger.error('[Workers] Error shutting down workers:', err.message);
  }
}

module.exports = {
  initializeWorkers,
  shutdownWorkers,
};
