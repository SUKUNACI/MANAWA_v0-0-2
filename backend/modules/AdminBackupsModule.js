/**
 * AdminBackupsModule
 * Business logic for backup management
 */

const logger = require('../utils/logger');

class AdminBackupsModule {
  constructor(backupStrategy, replication) {
    this.backupStrategy = backupStrategy;
    this.replication = replication;
  }

  // List backups with pagination
  async listBackups(pagination = {}, filters = {}) {
    const { page = 1, limit = 20 } = pagination;
    const { type } = filters;

    const stats = await this.backupStrategy.getBackupStats();
    if (!stats) return null;

    // Filter by type
    let backups = stats.backups;
    if (type === 'full') {
      backups = backups.filter(b => !b.key.includes('incremental'));
    } else if (type === 'incremental') {
      backups = backups.filter(b => b.key.includes('incremental'));
    }

    // Sort descending
    backups.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    // Paginate
    const offset = (page - 1) * limit;
    const paginatedBackups = backups.slice(offset, offset + limit);

    return {
      backups: paginatedBackups.map(b => ({
        key: b.key,
        size: b.size,
        sizeInMB: (b.size / 1024 / 1024).toFixed(2),
        lastModified: b.lastModified,
        storageClass: b.storageClass,
        type: b.key.includes('incremental') ? 'incremental' : 'full',
      })),
      pagination: { page, limit, total: backups.length, pages: Math.ceil(backups.length / limit) },
    };
  }

  // Get backup status
  async getStatus() {
    const [replicationStatus, backupStats] = await Promise.all([
      this.replication.healthCheck(),
      this.backupStrategy.getBackupStats(),
    ]);

    const isHealthy =
      replicationStatus.primary.connected &&
      (replicationStatus.replicas?.length > 0 ? replicationStatus.replicas.some(r => r.connected) : true);

    return {
      replication: {
        primary: replicationStatus.primary,
        replicas: replicationStatus.replicas || [],
        currentPrimary: replicationStatus.currentPrimary,
        lastFailover: replicationStatus.lastFailover,
        healthy: isHealthy,
      },
      backups: {
        lastFullBackup: backupStats?.lastFullBackup,
        lastIncrementalBackup: backupStats?.lastIncrementalBackup,
        totalBackups: backupStats?.totalBackups,
        totalSizeInMB: backupStats ? (backupStats.totalSize / 1024 / 1024).toFixed(2) : 0,
        retentionPolicy: { retentionDays: this.backupStrategy.backupRetentionDays },
      },
      rto: { targetMinutes: 30, actualMinutes: replicationStatus.replicas?.length > 0 ? 5 : 30 },
      rpo: { targetMinutes: 60, actualMinutes: 6 },
    };
  }

  // Trigger backup
  async triggerBackup(type) {
    let result;
    if (type === 'full') {
      result = await this.backupStrategy.createFullBackup();
    } else {
      result = await this.backupStrategy.createIncrementalBackup();
    }
    return result;
  }

  // Restore from backup
  async restoreBackup(backupName) {
    return this.backupStrategy.restoreFromBackup(backupName);
  }

  // Test backup integrity
  async testBackup(backupName) {
    return this.backupStrategy.testBackupIntegrity(backupName);
  }

  // Get replication status
  async getReplicationStatus() {
    const status = await this.replication.healthCheck();
    return {
      replication: status,
      replicas: (status.replicas || []).map(r => ({
        ...r,
        healthy: r.connected && r.lag < 60,
      })),
    };
  }

  // Cleanup old backups
  async cleanup() {
    await this.backupStrategy.cleanupOldBackups();
    const stats = await this.backupStrategy.getBackupStats();
    return {
      stats: {
        totalBackups: stats?.totalBackups || 0,
        totalSizeInMB: stats ? (stats.totalSize / 1024 / 1024).toFixed(2) : 0,
      },
    };
  }
}

module.exports = AdminBackupsModule;
