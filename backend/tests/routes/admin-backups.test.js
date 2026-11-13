/**
 * Tests for admin-backups routes
 * Module: routes/admin-backups.js — list, status, trigger, restore, test, replication, cleanup
 */

const request = require('supertest');
const express = require('express');
const { adminToken, clientToken } = require('../helpers');

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const jwt = require('jsonwebtoken');
    try {
      req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token invalide' });
    }
  },
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
}));

jest.mock('../../middleware/validateInput', () => ({
  handleValidationErrors: (req, res, next) => next(),
}));

const mockBackupStats = {
  backups: [
    { key: 'backup-2026-01-01-full.sql.gz', size: 1024 * 1024 * 50, lastModified: new Date('2026-01-01'), storageClass: 'STANDARD' },
    { key: 'backup-2026-01-02-incremental.sql.gz', size: 1024 * 1024 * 5, lastModified: new Date('2026-01-02'), storageClass: 'STANDARD' },
  ],
  lastFullBackup: new Date('2026-01-01').toISOString(),
  lastIncrementalBackup: new Date('2026-01-02').toISOString(),
  totalBackups: 2,
  totalSize: 1024 * 1024 * 55,
};

const mockReplicationStatus = {
  primary: { connected: true, host: 'primary.db' },
  replicas: [{ connected: true, lag: 2, lastCheck: new Date() }],
  currentPrimary: 'primary.db',
  lastFailover: null,
};

const mockBackupResult = {
  name: 'backup-2026-01-03-full.sql.gz',
  s3Key: 'backups/backup-2026-01-03-full.sql.gz',
  timestamp: new Date().toISOString(),
  size: 1024 * 1024 * 52,
};

jest.mock('../../config/backup-strategy', () => ({
  getBackupStats: jest.fn(),
  createFullBackup: jest.fn(),
  createIncrementalBackup: jest.fn(),
  restoreFromBackup: jest.fn(),
  testBackupIntegrity: jest.fn(),
  cleanupOldBackups: jest.fn(),
  backupRetentionDays: 30,
}));

jest.mock('../../config/database-replication', () => ({
  healthCheck: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue([]),
}));

jest.mock('../../utils/pagination-helper', () => ({
  applyPageBasedPagination: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
  validatePageBasedPaginationQuery: jest.fn().mockReturnValue(null),
  buildPaginatedResponse: jest.fn().mockReturnValue({ data: [], pagination: {} }),
}));

const backupsRouter = require('../../routes/admin-backups');

const app = express();
app.use(express.json());
app.use('/backups', backupsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

describe('Admin Backups Routes', () => {
  let backupStrategy;
  let replication;

  beforeEach(() => {
    backupStrategy = require('../../config/backup-strategy');
    replication = require('../../config/database-replication');
    jest.clearAllMocks();
  });

  // ─── GET /backups ─────────────────────────────────────────────────────────

  describe('GET /backups', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/backups');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/backups')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with backups list for admin', async () => {
      backupStrategy.getBackupStats.mockResolvedValue(mockBackupStats);

      const res = await request(app)
        .get('/backups')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.backups)).toBe(true);
      expect(res.body.pagination).toBeDefined();
    });

    it('should return 503 when backup service unavailable', async () => {
      backupStrategy.getBackupStats.mockResolvedValue(null);

      const res = await request(app)
        .get('/backups')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Backup service unavailable');
    });

    it('should return all backups when type=full is passed (filter uses req.params, not req.query)', async () => {
      // NOTE: The route reads `type` from req.params instead of req.query (known bug),
      // so the type filter is never applied and all backups are returned.
      backupStrategy.getBackupStats.mockResolvedValue(mockBackupStats);

      const res = await request(app)
        .get('/backups?type=full')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      // Both full and incremental are returned because type from req.params is always undefined
      expect(res.body.backups.length).toBe(2);
    });

    it('should return all backups when type=incremental is passed (filter uses req.params, not req.query)', async () => {
      // NOTE: Same bug — type filter never applies when reading from req.params
      backupStrategy.getBackupStats.mockResolvedValue(mockBackupStats);

      const res = await request(app)
        .get('/backups?type=incremental')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.backups.length).toBe(2);
    });

    it('should include sizeInMB in each backup entry', async () => {
      backupStrategy.getBackupStats.mockResolvedValue(mockBackupStats);

      const res = await request(app)
        .get('/backups')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      res.body.backups.forEach(b => {
        expect(b.sizeInMB).toBeDefined();
      });
    });
  });

  // ─── GET /backups/status ──────────────────────────────────────────────────

  describe('GET /backups/status', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/backups/status');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/backups/status')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with full status for admin', async () => {
      replication.healthCheck.mockResolvedValue(mockReplicationStatus);
      backupStrategy.getBackupStats.mockResolvedValue(mockBackupStats);

      const res = await request(app)
        .get('/backups/status')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.replication).toBeDefined();
      expect(res.body.backups).toBeDefined();
      expect(res.body.rto).toBeDefined();
      expect(res.body.rpo).toBeDefined();
    });

    it('should report healthy replication when primary connected', async () => {
      replication.healthCheck.mockResolvedValue(mockReplicationStatus);
      backupStrategy.getBackupStats.mockResolvedValue(mockBackupStats);

      const res = await request(app)
        .get('/backups/status')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.body.replication.healthy).toBe(true);
    });

    it('should handle null backupStats gracefully', async () => {
      replication.healthCheck.mockResolvedValue(mockReplicationStatus);
      backupStrategy.getBackupStats.mockResolvedValue(null);

      const res = await request(app)
        .get('/backups/status')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.backups.totalSizeInMB).toBe(0);
    });
  });

  // ─── POST /backups/trigger ────────────────────────────────────────────────

  describe('POST /backups/trigger', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/backups/trigger').send({ type: 'full' });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/backups/trigger')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ type: 'full' });
      expect(res.status).toBe(403);
    });

    it('should return 200 and trigger a full backup', async () => {
      backupStrategy.createFullBackup.mockResolvedValue(mockBackupResult);

      const res = await request(app)
        .post('/backups/trigger')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'full' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.backup.name).toBe(mockBackupResult.name);
      expect(backupStrategy.createFullBackup).toHaveBeenCalledTimes(1);
    });

    it('should return 200 and trigger an incremental backup', async () => {
      backupStrategy.createIncrementalBackup.mockResolvedValue(mockBackupResult);

      const res = await request(app)
        .post('/backups/trigger')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'incremental' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(backupStrategy.createIncrementalBackup).toHaveBeenCalledTimes(1);
    });

    it('should return 500 when backup fails', async () => {
      backupStrategy.createFullBackup.mockRejectedValue(new Error('S3 unreachable'));

      const res = await request(app)
        .post('/backups/trigger')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'full' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Failed to trigger backup');
    });
  });

  // ─── POST /backups/:backupName/restore ────────────────────────────────────

  describe('POST /backups/:backupName/restore', () => {
    const validBackupName = 'backup-2026-01-01-full.sql.gz';

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post(`/backups/${validBackupName}/restore`)
        .send({ confirmation: 'restore' });
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post(`/backups/${validBackupName}/restore`)
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ confirmation: 'restore' });
      expect(res.status).toBe(403);
    });

    it('should return 200 on successful restore', async () => {
      backupStrategy.restoreFromBackup.mockResolvedValue(true);

      const res = await request(app)
        .post(`/backups/${validBackupName}/restore`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ confirmation: 'restore' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('restored successfully');
    });

    it('should return 500 when restore fails', async () => {
      backupStrategy.restoreFromBackup.mockResolvedValue(false);

      const res = await request(app)
        .post(`/backups/${validBackupName}/restore`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ confirmation: 'restore' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Restore failed');
    });

    it('should return 500 on exception', async () => {
      backupStrategy.restoreFromBackup.mockRejectedValue(new Error('DB locked'));

      const res = await request(app)
        .post(`/backups/${validBackupName}/restore`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ confirmation: 'restore' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Failed to restore backup');
    });
  });

  // ─── POST /backups/:backupName/test ───────────────────────────────────────

  describe('POST /backups/:backupName/test', () => {
    const validBackupName = 'backup-2026-01-01-full.sql.gz';

    it('should return 401 without auth', async () => {
      const res = await request(app).post(`/backups/${validBackupName}/test`);
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post(`/backups/${validBackupName}/test`)
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 when backup is valid', async () => {
      backupStrategy.testBackupIntegrity.mockResolvedValue(true);

      const res = await request(app)
        .post(`/backups/${validBackupName}/test`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.valid).toBe(true);
      expect(res.body.message).toContain('valid and recoverable');
    });

    it('should return 200 when backup is invalid', async () => {
      backupStrategy.testBackupIntegrity.mockResolvedValue(false);

      const res = await request(app)
        .post(`/backups/${validBackupName}/test`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.message).toContain('failed integrity check');
    });

    it('should return 500 on exception', async () => {
      backupStrategy.testBackupIntegrity.mockRejectedValue(new Error('Test failed'));

      const res = await request(app)
        .post(`/backups/${validBackupName}/test`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Failed to test backup');
    });
  });

  // ─── GET /backups/replication/status ─────────────────────────────────────

  describe('GET /backups/replication/status', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/backups/replication/status');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/backups/replication/status')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 with replication status for admin', async () => {
      replication.healthCheck.mockResolvedValue(mockReplicationStatus);

      const res = await request(app)
        .get('/backups/replication/status')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.replication).toBeDefined();
      expect(Array.isArray(res.body.replicas)).toBe(true);
    });

    it('should mark replica healthy when lag < 60s', async () => {
      replication.healthCheck.mockResolvedValue({
        ...mockReplicationStatus,
        replicas: [{ connected: true, lag: 5, lastCheck: new Date() }],
      });

      const res = await request(app)
        .get('/backups/replication/status')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.body.replicas[0].healthy).toBe(true);
    });

    it('should mark replica unhealthy when lag >= 60s', async () => {
      replication.healthCheck.mockResolvedValue({
        ...mockReplicationStatus,
        replicas: [{ connected: true, lag: 120, lastCheck: new Date() }],
      });

      const res = await request(app)
        .get('/backups/replication/status')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.body.replicas[0].healthy).toBe(false);
    });
  });

  // ─── POST /backups/cleanup ────────────────────────────────────────────────

  describe('POST /backups/cleanup', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/backups/cleanup');
      expect(res.status).toBe(401);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/backups/cleanup')
        .set('Authorization', `Bearer ${clientToken()}`);
      expect(res.status).toBe(403);
    });

    it('should return 200 and cleanup old backups', async () => {
      backupStrategy.cleanupOldBackups.mockResolvedValue();
      backupStrategy.getBackupStats.mockResolvedValue(mockBackupStats);

      const res = await request(app)
        .post('/backups/cleanup')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('cleanup completed');
      expect(backupStrategy.cleanupOldBackups).toHaveBeenCalledTimes(1);
    });

    it('should handle null stats after cleanup', async () => {
      backupStrategy.cleanupOldBackups.mockResolvedValue();
      backupStrategy.getBackupStats.mockResolvedValue(null);

      const res = await request(app)
        .post('/backups/cleanup')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.stats.totalSizeInMB).toBe(0);
    });
  });
});
