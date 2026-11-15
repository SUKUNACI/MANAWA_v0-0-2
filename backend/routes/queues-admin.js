const express = require('express');
const { param, query, body, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { handleValidationErrors } = require('../middleware/validateInput');
const queueConfig = require('../config/queue');
const QueuesAdminModule = require('../modules/QueuesAdminModule');

const router = express.Router();
const qModule = new QueuesAdminModule(queueConfig);

const readLimiter = rateLimit({ windowMs: 60000, max: 100, keyGenerator: (req) => req.user?.id || req.ip });
const writeLimiter = rateLimit({ windowMs: 60000, max: 30, keyGenerator: (req) => req.user?.id || req.ip });

router.get('/', requireAuth, requireRole('ADMIN'), readLimiter, async (req, res, next) => { try { const r = await qModule.getAllQueueStats(); res.json({ success: true, ...r }); } catch (err) { next(err); } });

router.get('/:queueName', requireAuth, requireRole('ADMIN'), readLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges'])], handleValidationErrors, async (req, res, next) => { try { const r = await qModule.getQueueStats(req.params.queueName); res.json({ success: true, ...r }); } catch (err) { next(err); } });

router.get('/:queueName/jobs', requireAuth, requireRole('ADMIN'), readLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']), query('status').optional().isIn(['active', 'completed', 'failed', 'delayed', 'waiting']), query('limit').optional().isInt({ min: 1, max: 100 }).toInt(), query('offset').optional().isInt({ min: 0 }).toInt()], handleValidationErrors, async (req, res, next) => { try { const { status = 'waiting', limit = 50, offset = 0 } = req.query; const r = await qModule.listJobs(req.params.queueName, status, { limit: parseInt(limit), offset: parseInt(offset) }); res.json({ success: true, ...r }); } catch (err) { next(err); } });

router.get('/:queueName/jobs/:jobId', requireAuth, requireRole('ADMIN'), readLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']), param('jobId').notEmpty().trim()], handleValidationErrors, async (req, res, next) => { try { const r = await qModule.getJobDetails(req.params.queueName, req.params.jobId); res.json({ success: true, ...r }); } catch (err) { err.message.includes('not found') ? res.status(404).json({ error: 'Job not found' }) : next(err); } });

router.post('/:queueName/retry', requireAuth, requireRole('ADMIN'), writeLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']), body('limit').optional().isInt({ min: 1 }).toInt()], handleValidationErrors, async (req, res, next) => { try { const limit = req.body.limit || 10; const r = await qModule.retryFailedJobs(req.params.queueName, limit); res.json({ success: true, ...r }); } catch (err) { next(err); } });

router.post('/:queueName/jobs/:jobId/retry', requireAuth, requireRole('ADMIN'), writeLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']), param('jobId').notEmpty().trim()], handleValidationErrors, async (req, res, next) => { try { const r = await qModule.retryJob(req.params.queueName, req.params.jobId); res.json({ success: true, ...r }); } catch (err) { err.message.includes('not found') ? res.status(404).json({ error: 'Job not found' }) : next(err); } });

router.delete('/:queueName/jobs/:jobId', requireAuth, requireRole('ADMIN'), writeLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']), param('jobId').notEmpty().trim()], handleValidationErrors, async (req, res, next) => { try { const r = await qModule.deleteJob(req.params.queueName, req.params.jobId); res.json({ success: true, ...r }); } catch (err) { err.message.includes('not found') ? res.status(404).json({ error: 'Job not found' }) : next(err); } });

router.post('/:queueName/clean', requireAuth, requireRole('ADMIN'), writeLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges']), body('daysOld').optional().isInt({ min: 1 }).toInt()], handleValidationErrors, async (req, res, next) => { try { const daysOld = req.body.daysOld || 7; const r = await qModule.cleanOldJobs(req.params.queueName, daysOld); res.json({ success: true, ...r }); } catch (err) { next(err); } });

router.post('/:queueName/pause', requireAuth, requireRole('ADMIN'), writeLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges'])], handleValidationErrors, async (req, res, next) => { try { const r = await qModule.pauseQueue(req.params.queueName); res.json({ success: true, ...r }); } catch (err) { next(err); } });

router.post('/:queueName/resume', requireAuth, requireRole('ADMIN'), writeLimiter, [param('queueName').isIn(['emails', 'pdfs', 'analytics', 'payments', 'badges'])], handleValidationErrors, async (req, res, next) => { try { const r = await qModule.resumeQueue(req.params.queueName); res.json({ success: true, ...r }); } catch (err) { next(err); } });

module.exports = router;
