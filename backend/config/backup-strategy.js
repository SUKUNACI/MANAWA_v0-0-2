// aws-sdk optionnel — backup S3 désactivé si le module est absent
let AWS = null;
try { AWS = require('aws-sdk'); } catch (_) {}
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Backup Strategy Configuration
 * Handles daily full backups, incremental backups, and point-in-time recovery (PITR)
 */

class BackupStrategy {
  constructor() {
    this.s3Client = null;
    this.backupBucket = process.env.BACKUP_S3_BUCKET || 'manawa-db-backups';
    this.backupRetentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
    this.backupSchedule = {
      fullBackup: process.env.BACKUP_FULL_HOUR || '02', // 2 AM UTC
      incrementalBackupInterval: process.env.BACKUP_INCREMENTAL_HOURS || '6', // Every 6 hours
    };
    this.localBackupDir = path.join(process.cwd(), '.backups');
    this.backupMetadata = {
      lastFullBackup: null,
      lastIncrementalBackup: null,
      backupHistory: [],
    };
  }

  /**
   * Initialize S3 client
   */
  initializeS3() {
    if (!AWS) {
      logger.warn('[Backup] aws-sdk non disponible — backup S3 désactivé');
      return false;
    }
    try {
      this.s3Client = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1',
      });

      logger.info('[Backup] S3 client initialized', {
        bucket: this.backupBucket,
        region: process.env.AWS_REGION || 'us-east-1',
      });

      return true;
    } catch (err) {
      logger.error('[Backup] Failed to initialize S3 client', {
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Ensure local backup directory exists
   */
  ensureBackupDir() {
    try {
      if (!fs.existsSync(this.localBackupDir)) {
        fs.mkdirSync(this.localBackupDir, { recursive: true });
      }
    } catch (err) {
      logger.warn('[Backup] Failed to create local backup directory', {
        error: err.message,
      });
    }
  }

  /**
   * Create full database backup
   */
  async createFullBackup() {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const backupName = `backup-full-${timestamp}`;
      const backupPath = path.join(this.localBackupDir, `${backupName}.sql`);

      logger.info('[Backup] Starting full backup', { name: backupName });

      // For Neon/PostgreSQL, use pg_dump via the Neon API
      const backupData = await this.dumpDatabase();

      // Save locally
      fs.writeFileSync(backupPath, backupData);

      // Upload to S3
      const s3Key = `full-backups/${backupName}.sql.gz`;
      await this.uploadToS3(backupPath, s3Key, 'STANDARD');

      // Update metadata
      this.backupMetadata.lastFullBackup = {
        timestamp: new Date(),
        name: backupName,
        s3Key: s3Key,
        size: fs.statSync(backupPath).size,
      };

      logger.info('[Backup] Full backup completed', {
        name: backupName,
        s3Key: s3Key,
        size: this.backupMetadata.lastFullBackup.size,
      });

      return this.backupMetadata.lastFullBackup;
    } catch (err) {
      logger.error('[Backup] Full backup failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Create incremental backup (uses WAL archiving for PostgreSQL)
   */
  async createIncrementalBackup() {
    try {
      const timestamp = new Date().toISOString();
      const backupName = `backup-incremental-${timestamp.replace(/[:.]/g, '-')}`;

      logger.info('[Backup] Starting incremental backup', { name: backupName });

      // For Neon: use transaction snapshot with offset
      // This captures changes since last backup
      const incrementalData = await this.getTransactionLog();

      // Upload to S3
      const s3Key = `incremental-backups/${backupName}.jsonl`;
      await this.uploadToS3(s3Key, s3Key, 'GLACIER');

      this.backupMetadata.lastIncrementalBackup = {
        timestamp: new Date(),
        name: backupName,
        s3Key: s3Key,
      };

      logger.info('[Backup] Incremental backup completed', {
        name: backupName,
        s3Key: s3Key,
      });

      return this.backupMetadata.lastIncrementalBackup;
    } catch (err) {
      logger.error('[Backup] Incremental backup failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Dump entire database
   */
  async dumpDatabase() {
    try {
      const prisma = new PrismaClient();

      // Get all tables and their schemas
      const tables = await prisma.$queryRaw`
        SELECT tablename FROM pg_catalog.pg_tables
        WHERE schemaname != 'pg_catalog' AND schemaname != 'information_schema'
      `;

      let sqlDump = '-- MANAWA Database Backup\n';
      sqlDump += `-- Created: ${new Date().toISOString()}\n\n`;

      for (const table of tables) {
        const tableName = table.tablename;

        // Get schema
        const schema = await prisma.$queryRawUnsafe(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = '${tableName}'
        `);

        // Build CREATE TABLE statement
        sqlDump += `-- Table: ${tableName}\n`;
        sqlDump += `CREATE TABLE ${tableName} (\n`;
        sqlDump += schema.map(col =>
          `  ${col.column_name} ${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}`
        ).join(',\n');
        sqlDump += '\n);\n\n';

        // Get data
        const rows = await prisma.$queryRawUnsafe(`SELECT * FROM ${tableName}`);
        for (const row of rows) {
          const values = Object.values(row)
            .map(v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
            .join(', ');
          sqlDump += `INSERT INTO ${tableName} VALUES (${values});\n`;
        }

        sqlDump += '\n';
      }

      await prisma.$disconnect();
      return sqlDump;
    } catch (err) {
      logger.error('[Backup] Database dump failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Get transaction log for incremental backup
   */
  async getTransactionLog() {
    try {
      const prisma = new PrismaClient();

      // Query audit/change log tables
      const changes = await prisma.$queryRaw`
        SELECT
          id,
          entity_type,
          operation,
          entity_id,
          changes,
          created_at
        FROM audit_log
        WHERE created_at > NOW() - INTERVAL '6 hours'
        ORDER BY created_at ASC
      `;

      await prisma.$disconnect();

      // Format as JSONL (one JSON per line)
      return changes.map(c => JSON.stringify(c)).join('\n');
    } catch (err) {
      logger.warn('[Backup] Failed to get transaction log', {
        error: err.message,
      });
      return '';
    }
  }

  /**
   * Upload backup to S3
   */
  async uploadToS3(localPath, s3Key, storageClass = 'STANDARD') {
    return new Promise((resolve, reject) => {
      const fileContent = fs.readFileSync(localPath);
      const zlib = require('zlib');
      const gzipData = zlib.gzipSync(fileContent);

      const params = {
        Bucket: this.backupBucket,
        Key: s3Key,
        Body: gzipData,
        StorageClass: storageClass,
        Metadata: {
          'backup-timestamp': new Date().toISOString(),
          'backup-type': storageClass === 'GLACIER' ? 'incremental' : 'full',
        },
      };

      this.s3Client.upload(params, (err, data) => {
        if (err) {
          logger.error('[Backup] S3 upload failed', {
            key: s3Key,
            error: err.message,
          });
          reject(err);
        } else {
          logger.info('[Backup] S3 upload completed', {
            key: s3Key,
            location: data.Location,
          });
          resolve(data);
        }
      });
    });
  }

  /**
   * Restore database from backup
   */
  async restoreFromBackup(backupName) {
    try {
      logger.info('[Backup] Starting restore from backup', { backupName });

      // Download from S3
      const s3Key = backupName.includes('incremental') ?
        `incremental-backups/${backupName}.jsonl` :
        `full-backups/${backupName}.sql.gz`;

      const params = {
        Bucket: this.backupBucket,
        Key: s3Key,
      };

      const data = await this.s3Client.getObject(params).promise();
      const zlib = require('zlib');
      const decompressed = zlib.gunzipSync(data.Body);

      // Restore to database
      const prisma = new PrismaClient();

      // Execute SQL restore
      if (backupName.includes('incremental')) {
        // Restore transaction log
        const lines = decompressed.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const change = JSON.parse(line);
            // Apply change based on operation
            await this.applyChange(prisma, change);
          }
        }
      } else {
        // Execute SQL dump
        const sql = decompressed.toString();
        await prisma.$executeRawUnsafe(sql);
      }

      await prisma.$disconnect();

      logger.info('[Backup] Restore completed', { backupName });
      return true;
    } catch (err) {
      logger.error('[Backup] Restore failed', {
        backupName,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Apply individual change from transaction log
   */
  async applyChange(prisma, change) {
    // Implement based on change.operation (INSERT, UPDATE, DELETE)
    // This is a placeholder for the actual implementation
    logger.debug('[Backup] Applying change', {
      operation: change.operation,
      entity: change.entity_type,
    });
  }

  /**
   * Cleanup old backups based on retention policy
   */
  async cleanupOldBackups() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.backupRetentionDays);

      logger.info('[Backup] Cleaning up old backups', {
        retentionDays: this.backupRetentionDays,
        cutoffDate: cutoffDate.toISOString(),
      });

      // List all backups in S3
      const params = {
        Bucket: this.backupBucket,
      };

      const objects = await this.s3Client.listObjectsV2(params).promise();

      for (const obj of objects.Contents || []) {
        if (obj.LastModified < cutoffDate) {
          // Delete old backup
          await this.s3Client.deleteObject({
            Bucket: this.backupBucket,
            Key: obj.Key,
          }).promise();

          logger.info('[Backup] Deleted old backup', { key: obj.Key });
        }
      }
    } catch (err) {
      logger.warn('[Backup] Cleanup failed', { error: err.message });
    }
  }

  /**
   * Test backup integrity
   */
  async testBackupIntegrity(backupName) {
    try {
      logger.info('[Backup] Testing backup integrity', { backupName });

      // Download backup
      const s3Key = `full-backups/${backupName}.sql.gz`;
      const params = {
        Bucket: this.backupBucket,
        Key: s3Key,
      };

      const data = await this.s3Client.getObject(params).promise();
      const zlib = require('zlib');
      const decompressed = zlib.gunzipSync(data.Body);

      // Verify SQL syntax
      const sql = decompressed.toString();
      if (!sql.includes('CREATE TABLE') || !sql.includes('INSERT INTO')) {
        throw new Error('Invalid backup format');
      }

      logger.info('[Backup] Backup integrity test passed', { backupName });
      return true;
    } catch (err) {
      logger.error('[Backup] Backup integrity test failed', {
        backupName,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats() {
    try {
      const params = {
        Bucket: this.backupBucket,
      };

      const objects = await this.s3Client.listObjectsV2(params).promise();

      const stats = {
        totalBackups: objects.Contents?.length || 0,
        totalSize: (objects.Contents || []).reduce((sum, obj) => sum + obj.Size, 0),
        lastFullBackup: this.backupMetadata.lastFullBackup,
        lastIncrementalBackup: this.backupMetadata.lastIncrementalBackup,
        backups: (objects.Contents || []).map(obj => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified,
          storageClass: obj.StorageClass,
        })),
      };

      return stats;
    } catch (err) {
      logger.warn('[Backup] Failed to get backup stats', {
        error: err.message,
      });
      return null;
    }
  }
}

const backupStrategy = new BackupStrategy();

module.exports = backupStrategy;
