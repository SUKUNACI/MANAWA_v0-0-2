const Queue = require('bull');
const redis = require('redis');
const logger = require('../utils/logger');

// Redis connection configuration
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

// Initialize queues with retry logic and settings
const createQueueConfig = (queueName) => ({
  redis: redisConfig,
  settings: {
    // Max attempts: 3 retries
    maxRetries: 3,
    // Exponential backoff: 2s, 4s, 8s
    retryBackoff: {
      type: 'exponential',
      delay: 2000,
    },
    // Complete jobs after 24 hours
    completedInterval: 60000,
    // Clean up failed jobs after 7 days
    failedInterval: 3600000,
    // Max stalled count: mark as failed after 2 stalls
    maxStalledCount: 2,
    // Lock duration: 30 seconds
    lockDuration: 30000,
    // Lock renew time: 15 seconds
    lockRenewTime: 15000,
    // Use a predictable job id naming
    enablePriority: true,
  },
});

// Define queues
const emailQueue = new Queue('emails', createQueueConfig('emails'));
const pdfQueue = new Queue('pdfs', createQueueConfig('pdfs'));
const analyticsQueue = new Queue('analytics', createQueueConfig('analytics'));
const paymentQueue = new Queue('payments', createQueueConfig('payments'));
const badgesQueue = new Queue('badges', createQueueConfig('badges'));

// Global error handlers
const setupQueueErrorHandlers = (queue, queueName) => {
  queue.on('error', (err) => {
    logger.error(`[Queue ${queueName}] Error:`, {
      message: err.message,
      stack: err.stack,
    });
  });

  queue.on('failed', (job, err) => {
    logger.warn(`[Queue ${queueName}] Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}):`, {
      jobData: job.data,
      error: err.message,
      stack: err.stack,
    });
  });

  queue.on('completed', (job) => {
    logger.debug(`[Queue ${queueName}] Job ${job.id} completed`, {
      jobData: job.data,
      result: job.returnvalue,
    });
  });

  queue.on('stalled', (job) => {
    logger.warn(`[Queue ${queueName}] Job ${job.id} stalled (${job.progress()}% progress)`, {
      jobData: job.data,
    });
  });
};

// Setup error handlers for all queues
[emailQueue, pdfQueue, analyticsQueue, paymentQueue, badgesQueue].forEach((queue, index) => {
  const names = ['emails', 'pdfs', 'analytics', 'payments', 'badges'];
  setupQueueErrorHandlers(queue, names[index]);
});

// Helper function to get queue stats
async function getQueueStats(queue, queueName) {
  try {
    const counts = await queue.getJobCounts();
    const failedJobs = await queue.getFailed(0, 10);
    const delayedJobs = await queue.getDelayed(0, 10);

    return {
      name: queueName,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      waiting: counts.waiting,
      recentFailedJobs: failedJobs.length,
      recentDelayedJobs: delayedJobs.length,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.error(`[getQueueStats] Error getting stats for ${queueName}:`, err.message);
    return {
      name: queueName,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// Helper function to retry failed jobs
async function retryFailedJobs(queue, queueName, limit = 10) {
  try {
    const failedJobs = await queue.getFailed(0, limit);
    const retried = [];

    for (const job of failedJobs) {
      await job.retry();
      retried.push({
        jobId: job.id,
        data: job.data,
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`[${queueName}] Retried ${retried.length} failed jobs`);
    return retried;
  } catch (err) {
    logger.error(`[retryFailedJobs] Error retrying failed jobs in ${queueName}:`, err.message);
    throw err;
  }
}

// Helper function to clean old jobs
async function cleanOldJobs(queue, queueName, daysOld = 7) {
  try {
    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const completed = await queue.clean(cutoffTime, 0, 'completed');
    const failed = await queue.clean(cutoffTime, 0, 'failed');

    logger.info(`[${queueName}] Cleaned ${completed.length} completed + ${failed.length} failed jobs older than ${daysOld} days`);
    return { completed: completed.length, failed: failed.length };
  } catch (err) {
    logger.error(`[cleanOldJobs] Error cleaning old jobs in ${queueName}:`, err.message);
    throw err;
  }
}

module.exports = {
  emailQueue,
  pdfQueue,
  analyticsQueue,
  paymentQueue,
  badgesQueue,
  getQueueStats,
  retryFailedJobs,
  cleanOldJobs,
};
