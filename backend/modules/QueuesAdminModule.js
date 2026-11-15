/**
 * QueuesAdminModule
 * Business logic for queue administration
 */

const logger = require('../utils/logger');

const VALID_QUEUES = ['emails', 'pdfs', 'analytics', 'payments', 'badges'];
const VALID_JOB_STATUSES = ['active', 'completed', 'failed', 'delayed', 'waiting'];

class QueuesAdminModule {
  constructor(queueConfig) {
    this.queueConfig = queueConfig;
  }

  // Get all queue stats
  async getAllQueueStats() {
    const stats = [];
    for (const queueName of VALID_QUEUES) {
      const queue = this.getQueueByName(queueName);
      const stat = await this.queueConfig.getQueueStats(queue, queueName);
      stats.push(stat);
    }
    return { queues: stats, timestamp: new Date().toISOString() };
  }

  // Get specific queue stats
  async getQueueStats(queueName) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);
    const queue = this.getQueueByName(queueName);
    const stats = await this.queueConfig.getQueueStats(queue, queueName);
    return { queue: stats, timestamp: new Date().toISOString() };
  }

  // List jobs in queue
  async listJobs(queueName, status = 'waiting', pagination = {}) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);
    if (!VALID_JOB_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);

    const { limit = 50, offset = 0 } = pagination;
    const queue = this.getQueueByName(queueName);

    let jobs = [];
    switch (status) {
      case 'active':
        jobs = await queue.getActive(offset, offset + limit - 1);
        break;
      case 'completed':
        jobs = await queue.getCompleted(offset, offset + limit - 1);
        break;
      case 'failed':
        jobs = await queue.getFailed(offset, offset + limit - 1);
        break;
      case 'delayed':
        jobs = await queue.getDelayed(offset, offset + limit - 1);
        break;
      case 'waiting':
      default:
        jobs = await queue.getWaiting(offset, offset + limit - 1);
        break;
    }

    const jobsData = jobs.map(job => ({
      id: job.id,
      data: job.data,
      status: job.getState ? job.getState() : status,
      progress: job.progress ? job.progress() : 0,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
    }));

    const counts = await queue.getJobCountByTypes(status);
    return {
      queueName,
      status,
      jobs: jobsData,
      pagination: { offset, limit, total: counts[status] || 0 },
      timestamp: new Date().toISOString(),
    };
  }

  // Get job details
  async getJobDetails(queueName, jobId) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);

    const queue = this.getQueueByName(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error('Job not found');

    const state = await job.getState();
    const progress = job.progress();
    const logs = (await job.getLog()).slice(-50);

    return {
      job: {
        id: job.id,
        data: job.data,
        state,
        progress,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        logs,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Retry failed jobs
  async retryFailedJobs(queueName, limit = 10) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);
    const jobs = await this.queueConfig.retryFailedJobs(this.getQueueByName(queueName), queueName, limit);
    return { jobs, message: `Retried ${jobs.length} jobs`, timestamp: new Date().toISOString() };
  }

  // Retry specific job
  async retryJob(queueName, jobId) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);

    const queue = this.getQueueByName(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error('Job not found');

    await job.retry();
    return { job: { id: job.id }, message: 'Job retried', timestamp: new Date().toISOString() };
  }

  // Delete job
  async deleteJob(queueName, jobId) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);

    const queue = this.getQueueByName(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error('Job not found');

    await job.remove();
    return { message: 'Job removed', timestamp: new Date().toISOString() };
  }

  // Clean old jobs
  async cleanOldJobs(queueName, daysOld = 7) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);
    const cleaned = await this.queueConfig.cleanOldJobs(this.getQueueByName(queueName), queueName, daysOld);
    return { cleaned, message: `Cleaned jobs older than ${daysOld} days`, timestamp: new Date().toISOString() };
  }

  // Pause queue
  async pauseQueue(queueName) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);
    const queue = this.getQueueByName(queueName);
    await queue.pause();
    return { message: 'Queue paused', timestamp: new Date().toISOString() };
  }

  // Resume queue
  async resumeQueue(queueName) {
    if (!VALID_QUEUES.includes(queueName)) throw new Error(`Invalid queue: ${queueName}`);
    const queue = this.getQueueByName(queueName);
    await queue.resume();
    return { message: 'Queue resumed', timestamp: new Date().toISOString() };
  }

  getQueueByName(queueName) {
    const queues = {
      emails: this.queueConfig.emailQueue,
      pdfs: this.queueConfig.pdfQueue,
      analytics: this.queueConfig.analyticsQueue,
      payments: this.queueConfig.paymentQueue,
      badges: this.queueConfig.badgesQueue,
    };
    return queues[queueName];
  }

  static getValidQueues() { return VALID_QUEUES; }
  static getValidStatuses() { return VALID_JOB_STATUSES; }
}

module.exports = QueuesAdminModule;
