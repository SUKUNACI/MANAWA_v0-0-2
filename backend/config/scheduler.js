/**
 * Job Scheduler Configuration
 * Uses node-cron to schedule jobs
 */

const cron = require('node-cron');
const secretRotationDailyJob = require('../jobs/secret-rotation-daily');

let scheduledJobs = [];

/**
 * Initialize all scheduled jobs
 */
function initializeScheduler() {
  console.log('[SCHEDULER] Initializing scheduled jobs...');

  const secretRotationSchedule = '0 2 * * *'; // 2 AM UTC

  const secretRotationJob = cron.schedule(secretRotationSchedule, async () => {
    console.log(`[SCHEDULER] Running secret rotation job at ${new Date().toISOString()}`);

    try {
      const result = await secretRotationDailyJob();
      console.log(`[SCHEDULER] Secret rotation job completed:`, result);
    } catch (error) {
      console.error('[SCHEDULER] Secret rotation job failed:', error.message);
    }
  });

  scheduledJobs.push({
    name: 'secret-rotation-daily',
    schedule: secretRotationSchedule,
    task: secretRotationJob,
  });

  console.log(`[SCHEDULER] ✅ Scheduled ${scheduledJobs.length} job(s)`);
  scheduledJobs.forEach((job) => {
    console.log(`  - ${job.name}: ${job.schedule}`);
  });
}

/**
 * Stop all scheduled jobs
 */
function stopScheduler() {
  console.log('[SCHEDULER] Stopping all scheduled jobs...');

  scheduledJobs.forEach((job) => {
    job.task.stop();
    console.log(`  - Stopped: ${job.name}`);
  });

  scheduledJobs = [];
  console.log('[SCHEDULER] All jobs stopped');
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
