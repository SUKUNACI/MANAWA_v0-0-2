/**
 * Job Scheduler Configuration
 * Uses node-cron to schedule jobs
 */

const cron = require('node-cron');
const secretRotationDailyJob = require('../jobs/secret-rotation-daily');
const logger = require('../utils/logger');

let scheduledJobs = [];

/**
 * Initialize all scheduled jobs (idempotent)
 */
function initializeScheduler() {
  if (scheduledJobs.length > 0) {
    logger.warn('[SCHEDULER] Already initialized — skipping duplicate');
    return;
  }
  logger.info('[SCHEDULER] Initializing scheduled jobs...');

  const secretRotationSchedule = '0 2 * * *'; // 2 AM UTC

  const secretRotationJob = cron.schedule(secretRotationSchedule, async () => {
    logger.info('[SCHEDULER] Running secret rotation job', { startedAt: new Date().toISOString() });

    try {
      const result = await secretRotationDailyJob();
      logger.info('[SCHEDULER] Secret rotation job completed', result);
    } catch (error) {
      logger.error('[SCHEDULER] Secret rotation job failed', { error: error.message });
    }
  });

  scheduledJobs.push({
    name: 'secret-rotation-daily',
    schedule: secretRotationSchedule,
    task: secretRotationJob,
  });

  logger.info('[SCHEDULER] Scheduled jobs initialized', {
    count: scheduledJobs.length,
    jobs: scheduledJobs.map(j => ({ name: j.name, schedule: j.schedule })),
  });
}

/**
 * Stop all scheduled jobs
 */
function stopScheduler() {
  logger.info('[SCHEDULER] Stopping all scheduled jobs...', { count: scheduledJobs.length });

  scheduledJobs.forEach((job) => {
    job.task.stop();
    logger.info('[SCHEDULER] Stopped job', { name: job.name });
  });

  scheduledJobs = [];
  logger.info('[SCHEDULER] All jobs stopped');
}

/**
 * Get list of scheduled jobs
 */
function getScheduledJobs() {
  return scheduledJobs.map((job) => ({
    name: job.name,
    schedule: job.schedule,
    active: job.task ? true : false,
  }));
}

module.exports = {
  initializeScheduler,
  stopScheduler,
  getScheduledJobs,
};
