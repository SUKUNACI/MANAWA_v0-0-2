const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query, param, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { emailQueue, pdfQueue, analyticsQueue, paymentQueue, badgesQueue, getQueueStats, retryFailedJobs, cleanOldJobs } = require('../config/queue');
const { applyPagination, validatePaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');

const router = express.Router();

// Rate limiters
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper to get queue by name
function getQueueByName(queueName) {
  const queues = {
    'emails': emailQueue,
    'pdfs': pdfQueue,
    'analytics': analyticsQueue,
    'payments': paymentQueue,
    'badges': badgesQueue,
  };
  return queues[queueName];
}

// GET /api/admin/queues - View all queue statuses
router.get('/', requireAuth, requireRole('ADMIN'), readLimiter, async (req, res, next) => {
  try {
    const queues = ['emails', 'pdfs', 'analytics', 'payments', 'badges'];
    const stats = [];

    for (const queueName of queues) {
      const queue = getQueueByName(queueName);
      const stat = await getQueueStats(queue, queueName);
      stats.push(stat);
    }

    res.json({
      success: true,
      queues: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/queues/:queueName - Get specific queue status
router.get('/:queueName',
  requireAuth,
  requireRole('ADMIN'),
  readLimiter,
  [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges'])],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName } = req.params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const stats = await getQueueStats(queue, queueName);

    res.json({
      success: true,
      queue: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/queues/:queueName/jobs - Get jobs in queue
router.get('/:queueName/jobs',
  requireAuth,
  requireRole('ADMIN'),
  readLimiter,
  [
    param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']),
    query('status').optional().isIn(['active', 'completed', 'failed', 'delayed', 'waiting']),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName } = req.params;
    const { status = 'waiting', limit = 50, offset = 0 } = req.query;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

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

    const jobsData = jobs.map((job) => ({
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

    const total = await queue.getJobCountByTypes(status);

    res.json({
      success: true,
      queueName,
      status,
      jobs: jobsData,
      pagination: {
        offset,
        limit,
        total: total[status] || 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/queues/:queueName/jobs/:jobId - Get specific job details
router.get('/:queueName/jobs/:jobId',
  requireAuth,
  requireRole('ADMIN'),
  readLimiter,
  [
    param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']),
    param('jobId').notEmpty().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName, jobId } = req.params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const state = await job.getState();
    const progress = job.progress();
    const log = await job.getLog();

    res.json({
      success: true,
      job: {
        id: job.id,
        data: job.data,
        state,
        progress,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        timestamp: job.timestamp,
        startedOn: job.startedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        returnValue: job.returnvalue,
        logs: log.slice(-50), // Last 50 log entries
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/queues/:queueName/retry - Retry failed jobs
router.post('/:queueName/retry',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [
    param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']),
    body('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName } = req.params;
    const { limit = 10 } = req.body;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const retried = await retryFailedJobs(queue, queueName, limit);

    logger.info(`[Admin] Retried ${retried.length} jobs in queue ${queueName}`);

    res.json({
      success: true,
      message: `${retried.length} failed jobs will be retried`,
      jobs: retried,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/queues/:queueName/jobs/:jobId/retry - Retry specific job
router.post('/:queueName/jobs/:jobId/retry',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [
    param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']),
    param('jobId').notEmpty().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName, jobId } = req.params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await job.retry();

    logger.info(`[Admin] Retried job ${jobId} in queue ${queueName}`);

    res.json({
      success: true,
      message: 'Job will be retried',
      job: {
        id: job.id,
        data: job.data,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/queues/:queueName/jobs/:jobId - Remove specific job
router.delete('/:queueName/jobs/:jobId',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [
    param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']),
    param('jobId').notEmpty().trim(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName, jobId } = req.params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await job.remove();

    logger.info(`[Admin] Removed job ${jobId} from queue ${queueName}`);

    res.json({
      success: true,
      message: 'Job removed',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/queues/:queueName/clean - Clean old jobs
router.post('/:queueName/clean',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [
    param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']),
    body('daysOld').optional().isInt({ min: 1, max: 365 }).toInt(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName } = req.params;
    const { daysOld = 7 } = req.body;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const cleaned = await cleanOldJobs(queue, queueName, daysOld);

    logger.info(`[Admin] Cleaned old jobs in queue ${queueName}: ${cleaned.completed} completed, ${cleaned.failed} failed`);

    res.json({
      success: true,
      message: `Cleaned ${cleaned.completed} completed and ${cleaned.failed} failed jobs older than ${daysOld} days`,
      cleaned,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/queues/:queueName/pause - Pause queue
router.post('/:queueName/pause',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges'])],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName } = req.params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    await queue.pause(false, true); // Pause processing, keep waiting jobs

    logger.info(`[Admin] Paused queue ${queueName}`);

    res.json({
      success: true,
      message: `Queue ${queueName} paused`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/queues/:queueName/resume - Resume queue
router.post('/:queueName/resume',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges'])],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { queueName } = req.params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    await queue.resume(false, true); // Resume processing

    logger.info(`[Admin] Resumed queue ${queueName}`);

    res.json({
      success: true,
      message: `Queue ${queueName} resumed`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
