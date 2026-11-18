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

    // Register all queue processors
    // CRITICAL INSTRUMENTATION: Log queue.isReady state before/after process() call
    for (const config of queueConfigs) {
      try {
        const t0 = Date.now();
        logger.info(`[Workers] About to call queue.process() for ${config.name}`, {
          elapsed: t0 - startTime,
          queueReady: config.queue.isReady ? 'true' : 'false'
        });

        // Call process() WITHOUT await - it's synchronous for registration
        const processPromise = config.queue.process(config.concurrency, async (job) => {
          return await config.handler(job);
        });

        logger.info(`[Workers] queue.process() called for ${config.name}, got Promise immediately`, {
          elapsed: Date.now() - startTime,
          callTime: Date.now() - t0,
          promiseReady: processPromise ? 'true' : 'false'
        });

        // DON'T await - that's the bug. Just continue to next queue.
        // The Promise will resolve in background when Redis ready.

      } catch (err) {
        logger.error(`[Workers] ${config.name} process call failed`, {
          error: err.message,
          elapsed: Date.now() - startTime
        });
        throw err;
      }
    }

    logger.info('[Workers] All queue.process() calls completed (non-blocking)', {
      totalElapsed: Date.now() - startTime
    });

    // Log individual queue status
    const queueStatuses = queueConfigs.map(c => ({
      name: c.name,
      concurrency: c.concurrency,
      isReady: c.queue.isReady || false,
      isProcessing: c.queue._isProcessing || false
    }));
    logger.info('[Workers] Queue statuses after registration', { queueStatuses });

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
