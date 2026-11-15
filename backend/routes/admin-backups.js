const express = require('express');
const { body, query } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { handleValidationErrors } = require('../middleware/validateInput');
const backupStrategy = require('../config/backup-strategy');
const replication = require('../config/database-replication');
const AdminBackupsModule = require('../modules/AdminBackupsModule');

const router = express.Router();
const module_ = new AdminBackupsModule(backupStrategy, replication);

const readLimiter = rateLimit({ windowMs: 60000, max: 100, keyGenerator: (req) => req.user?.id || req.ip });
const writeLimiter = rateLimit({ windowMs: 60000, max: 10, keyGenerator: (req) => req.user?.id || req.ip });

router.get('/', requireAuth, requireRole('ADMIN'), readLimiter, [query('page').optional().isInt({ min: 1 }).toInt(), query('limit').optional().isInt({ min: 1, max: 100 }).toInt(), query('type').optional().isIn(['full', 'incremental'])], handleValidationErrors, async (req, res, next) => {
  try { const { page = 1, limit = 20 } = req.query; const r = await module_.listBackups({ page: parseInt(page), limit: parseInt(limit) }, req.query); r ? res.json({ success: true, backups: r.backups, pagination: r.pagination, timestamp: new Date().toISOString() }) : res.status(503).json({ success: false, error: 'Backup service unavailable' }); } catch (err) { next(err); }
});

router.get('/status', requireAuth, requireRole('ADMIN'), readLimiter, async (req, res, next) => {
  try { const r = await module_.getStatus(); res.json({ success: true, replication: r.replication, backups: r.backups, rto: r.rto, rpo: r.rpo, timestamp: new Date().toISOString() }); } catch (err) { next(err); }
});

router.post('/trigger', requireAuth, requireRole('ADMIN'), writeLimiter, [body('type').isIn(['full', 'incremental'])], handleValidationErrors, async (req, res, next) => {
  try { const r = await module_.triggerBackup(req.body.type); res.json({ success: true, backup: r, message: `${req.body.type} backup triggered`, timestamp: new Date().toISOString() }); } catch (err) { res.status(500).json({ error: 'Failed to trigger backup' }); }
});

router.post('/:backupName/restore', requireAuth, requireRole('ADMIN'), writeLimiter, async (req, res, next) => {
  try { const r = await module_.restoreBackup(req.params.backupName); r ? res.json({ success: true, message: `restored successfully` }) : res.status(500).json({ error: 'Restore failed' }); } catch (err) { res.status(500).json({ error: 'Failed to restore backup' }); }
});

router.post('/:backupName/test', requireAuth, requireRole('ADMIN'), readLimiter, async (req, res, next) => {
  try { const v = await module_.testBackup(req.params.backupName); res.json({ success: true, valid: v, message: v ? 'valid and recoverable' : 'failed integrity check' }); } catch (err) { res.status(500).json({ error: 'Failed to test backup' }); }
});

router.get('/replication/status', requireAuth, requireRole('ADMIN'), readLimiter, async (req, res, next) => {
  try { const r = await module_.getReplicationStatus(); res.json({ success: true, replication: r.replication, replicas: r.replicas, timestamp: new Date().toISOString() }); } catch (err) { next(err); }
});

router.post('/cleanup', requireAuth, requireRole('ADMIN'), writeLimiter, async (req, res, next) => {
  try { const r = await module_.cleanup(); res.json({ success: true, message: 'cleanup completed', stats: r.stats, timestamp: new Date().toISOString() }); } catch (err) { next(err); }
});

module.exports = router;
