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

    // Register all queue processors (synchronous in Bull v4)
    for (const config of queueConfigs) {
      try {
        const t0 = Date.now();
        logger.info(`[Workers] Registering ${config.name} processor`, { elapsed: t0 - startTime });

        config.queue.process(config.concurrency, async (job) => {
          return await config.handler(job);
        });

        logger.info(`[Workers] ${config.name} queue worker initialized (concurrency: ${config.concurrency})`, {
          elapsed: Date.now() - startTime,
          registerTime: Date.now() - t0
        });
      } catch (err) {
        logger.error(`[Workers] ${config.name} process registration failed`, {
          error: err.message,
          elapsed: Date.now() - startTime
        });
        throw err;
      }
    }

    logger.info('[Workers] All job queue workers initialized successfully', {
      totalElapsed: Date.now() - startTime
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
