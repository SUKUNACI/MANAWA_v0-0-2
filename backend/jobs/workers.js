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
    // Email queue worker
    await emailQueue.process(5, async (job) => {
      return await sendEmailJob(job);
    });
    logger.info('[Workers] Email queue worker initialized (concurrency: 5)');

    // PDF queue worker
    await pdfQueue.process(2, async (job) => {
      return await generatePdfJob(job);
    });
    logger.info('[Workers] PDF queue worker initialized (concurrency: 2)');

    // Analytics queue worker
    await analyticsQueue.process(1, async (job) => {
      return await calculateAnalyticsJob(job);
    });
    logger.info('[Workers] Analytics queue worker initialized (concurrency: 1)');

    // Payment queue worker
    await paymentQueue.process(3, async (job) => {
      return await processPaymentJob(job);
    });
    logger.info('[Workers] Payment queue worker initialized (concurrency: 3)');

    // Badges queue worker
    await badgesQueue.process(2, async (job) => {
      return await updateBadgesJob(job);
    });
    logger.info('[Workers] Badges queue worker initialized (concurrency: 2)');

    logger.info('[Workers] All job queue workers initialized successfully');
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
