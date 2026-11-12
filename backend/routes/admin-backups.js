const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query, param, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const backupStrategy = require('../config/backup-strategy');
const replication = require('../config/database-replication');
const { applyPageBasedPagination, validatePageBasedPaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');

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
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/admin/backups
 * List all backups with pagination and filtering
 */
router.get('/',
  requireAuth,
  requireRole('ADMIN'),
  readLimiter,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('type').optional().isIn(['full', 'incremental']),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20, type } = req.params;

      const stats = await backupStrategy.getBackupStats();

      if (!stats) {
        return res.status(503).json({
          success: false,
          error: 'Backup service unavailable',
        });
      }

      // Filter by type
      let backups = stats.backups;
      if (type === 'full') {
        backups = backups.filter(b => !b.key.includes('incremental'));
      } else if (type === 'incremental') {
        backups = backups.filter(b => b.key.includes('incremental'));
      }

      // Sort by date descending
      backups.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

      // Paginate
      const offset = (page - 1) * limit;
      const paginatedBackups = backups.slice(offset, offset + limit);

      logger.info('[Admin Backups] List backups', {
        page,
        limit,
        type,
        totalCount: backups.length,
      });

      res.json({
        success: true,
        backups: paginatedBackups.map(b => ({
          key: b.key,
          size: b.size,
          sizeInMB: (b.size / 1024 / 1024).toFixed(2),
          lastModified: b.lastModified,
          storageClass: b.storageClass,
          type: b.key.includes('incremental') ? 'incremental' : 'full',
        })),
        pagination: {
          page,
          limit,
          total: backups.length,
          pages: Math.ceil(backups.length / limit),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Admin Backups] List failed', { error: err.message });
      next(err);
    }
  }
);

/**
 * GET /api/admin/backups/status
 * Get replication and backup status
 */
router.get('/status',
  requireAuth,
  requireRole('ADMIN'),
  readLimiter,
  async (req, res, next) => {
    try {
      // Get replication status
      const replicationStatus = await replication.healthCheck();

      // Get backup stats
      const backupStats = await backupStrategy.getBackupStats();

      logger.info('[Admin Backups] Status check');

      res.json({
        success: true,
        replication: {
          primary: replicationStatus.primary,
          replicas: replicationStatus.replicas || [],
          currentPrimary: replicationStatus.currentPrimary,
          lastFailover: replicationStatus.lastFailover,
          healthy: replicationStatus.primary.connected &&
                   (replicationStatus.replicas?.length > 0 ?
                    replicationStatus.replicas.some(r => r.connected) : true),
        },
        backups: {
          lastFullBackup: backupStats?.lastFullBackup,
          lastIncrementalBackup: backupStats?.lastIncrementalBackup,
          totalBackups: backupStats?.totalBackups,
          totalSizeInMB: backupStats ? (backupStats.totalSize / 1024 / 1024).toFixed(2) : 0,
          retentionPolicy: {
            retentionDays: backupStrategy.backupRetentionDays,
          },
        },
        rto: {
          targetMinutes: 30, // Recovery Time Objective: 30 minutes
          actualMinutes: replicationStatus.replicas?.length > 0 ? 5 : 30,
        },
        rpo: {
          targetMinutes: 60, // Recovery Point Objective: 60 minutes
          actualMinutes: 6, // Incremental backup every 6 hours
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Admin Backups] Status check failed', { error: err.message });
      next(err);
    }
  }
);

/**
 * POST /api/admin/backups/trigger
 * Manually trigger a backup
 */
router.post('/trigger',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [
    body('type').isIn(['full', 'incremental']),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { type } = req.body;

      let result;
      if (type === 'full') {
        result = await backupStrategy.createFullBackup();
      } else {
        result = await backupStrategy.createIncrementalBackup();
      }

      logger.info('[Admin Backups] Manual backup triggered', {
        type,
        backupName: result.name,
      });

      res.json({
        success: true,
        message: `${type === 'full' ? 'Full' : 'Incremental'} backup triggered`,
        backup: {
          name: result.name,
          s3Key: result.s3Key,
          timestamp: result.timestamp,
          size: result.size,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Admin Backups] Trigger backup failed', {
        error: err.message,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to trigger backup: ' + err.message,
      });
    }
  }
);

/**
 * POST /api/admin/backups/:backupName/restore
 * Restore database from backup
 */
router.post('/:backupName/restore',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [
    param('backupName').matches(/^backup-[a-z0-9\-\.]+$/),
    body('confirmation').equals('restore'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { backupName } = req.params;

      logger.warn('[Admin Backups] RESTORE INITIATED', {
        backupName,
        adminId: req.user?.id,
        timestamp: new Date().toISOString(),
      });

      // Restore from backup
      const success = await backupStrategy.restoreFromBackup(backupName);

      if (!success) {
        return res.status(500).json({
          success: false,
          error: 'Restore failed',
        });
      }

      logger.warn('[Admin Backups] RESTORE COMPLETED', {
        backupName,
        adminId: req.user?.id,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        message: 'Database restored successfully',
        backup: backupName,
        warning: 'Database has been restored. All data after this backup has been lost.',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Admin Backups] Restore failed', {
        backupName: req.params.backupName,
        error: err.message,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to restore backup: ' + err.message,
      });
    }
  }
);

/**
 * POST /api/admin/backups/:backupName/test
 * Test backup integrity
 */
router.post('/:backupName/test',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  [
    param('backupName').matches(/^backup-[a-z0-9\-\.]+$/),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { backupName } = req.params;

      logger.info('[Admin Backups] Testing backup integrity', { backupName });

      const isValid = await backupStrategy.testBackupIntegrity(backupName);

      res.json({
        success: true,
        backup: backupName,
        valid: isValid,
        message: isValid ? 'Backup is valid and recoverable' : 'Backup failed integrity check',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Admin Backups] Test failed', {
        backupName: req.params.backupName,
        error: err.message,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to test backup: ' + err.message,
      });
    }
  }
);

/**
 * GET /api/admin/backups/replication/status
 * Get detailed replication status
 */
router.get('/replication/status',
  requireAuth,
  requireRole('ADMIN'),
  readLimiter,
  async (req, res, next) => {
    try {
      const status = await replication.healthCheck();

      res.json({
        success: true,
        replication: status,
        replicas: (status.replicas || []).map((r, idx) => ({
          index: idx,
          connected: r.connected,
          lagSeconds: r.lag,
          lastCheck: r.lastCheck,
          healthy: r.connected && r.lag < 60, // Consider healthy if < 60s lag
        })),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Admin Backups] Replication status failed', {
        error: err.message,
      });
      next(err);
    }
  }
);

/**
 * POST /api/admin/backups/cleanup
 * Manually run cleanup of old backups
 */
router.post('/cleanup',
  requireAuth,
  requireRole('ADMIN'),
  writeLimiter,
  async (req, res, next) => {
    try {
      logger.info('[Admin Backups] Manual cleanup triggered', {
        adminId: req.user?.id,
      });

      await backupStrategy.cleanupOldBackups();

      const stats = await backupStrategy.getBackupStats();

      res.json({
        success: true,
        message: 'Backup cleanup completed',
        stats: {
          totalBackups: stats?.totalBackups,
          totalSizeInMB: stats ? (stats.totalSize / 1024 / 1024).toFixed(2) : 0,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Admin Backups] Cleanup failed', {
        error: err.message,
      });
      next(err);
    }
  }
);

module.exports = router;
