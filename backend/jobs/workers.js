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
    const initQueue = async (queue, concurrency, queueName, jobHandler) => {
      const t0 = Date.now();
      logger.info(`[Workers] Starting ${queueName} process registration`, { elapsed: t0 - startTime });

      let processRegistered = false;
      try {
        await Promise.race([
          (async () => {
            await queue.process(concurrency, jobHandler);
            processRegistered = true;
            logger.info(`[Workers] ${queueName} queue worker initialized (concurrency: ${concurrency})`, {
              elapsed: Date.now() - startTime,
              registerTime: Date.now() - t0
            });
          })(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${queueName} process() timeout after 10s`)), 10000)
          )
        ]);
      } catch (err) {
        logger.error(`[Workers] ${queueName} process registration failed`, {
          error: err.message,
          elapsed: Date.now() - startTime,
          registerTime: Date.now() - t0,
          processRegistered
        });
        throw err;
      }
    };

    // Email queue worker
    await initQueue(emailQueue, 5, 'emails', async (job) => {
      return await sendEmailJob(job);
    });

    // PDF queue worker
    await initQueue(pdfQueue, 2, 'pdfs', async (job) => {
      return await generatePdfJob(job);
    });

    // Analytics queue worker
    await initQueue(analyticsQueue, 1, 'analytics', async (job) => {
      return await calculateAnalyticsJob(job);
    });

    // Payment queue worker
    await initQueue(paymentQueue, 3, 'payments', async (job) => {
      return await processPaymentJob(job);
    });

    // Badges queue worker
    await initQueue(badgesQueue, 2, 'badges', async (job) => {
      return await updateBadgesJob(job);
    });

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
