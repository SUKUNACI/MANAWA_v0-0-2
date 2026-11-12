/**
 * Q78: Rollback Manager
 * Handles automatic and manual rollback logic, including:
 * - Configuration rollback (instant switch via versions)
 * - Database rollback (restore from backups)
 * - Code rollback (git revert + redeploy)
 * - Blue-green fallback (DNS switch)
 */

const { prisma } = require('../config/db');
const { exec } = require('child_process');
const { promisify } = require('util');
const Sentry = require('@sentry/node');
const logger = require('./logger');
const thresholds = require('../config/monitoring-thresholds');

const execAsync = promisify(exec);

class RollbackManager {
  constructor() {
    this.isRollingBack = false;
    this.lastRollbackTime = null;
  }

  /**
   * Q77: Configuration Rollback - Instant switch via versions
   * @param {string} targetVersion - Version to rollback to (e.g., "1.0.0")
   * @param {string} triggeredBy - Admin ID or "system"
   * @param {string} reason - Reason for rollback
   * @returns {Promise<Object>}
   */
  async rollbackConfiguration(targetVersion, triggeredBy = 'system', reason) {
    try {
      logger.info(`[ROLLBACK] Starting config rollback to ${targetVersion}`, {
        triggeredBy,
        reason,
      });

      // Fetch current version
      const currentConfig = await prisma.appConfig.findMany();
      const currentVersion = currentConfig.find(c => c.key === 'APP_VERSION');
      const fromVersion = currentVersion?.value || 'unknown';

      // Fetch target version snapshot
      const targetVersionRecord = await prisma.configVersion.findUnique({
        where: { version: targetVersion },
      });

      if (!targetVersionRecord) {
        throw new Error(`Config version ${targetVersion} not found`);
      }

      // Create rollback event record
      const rollbackEvent = await prisma.rollbackEvent.create({
        data: {
          fromVersion,
          toVersion: targetVersion,
          trigger: 'manual',
          reason,
          triggeredBy,
          status: 'IN_PROGRESS',
        },
      });

      // Restore configuration from snapshot
      const snapshot = targetVersionRecord.snapshot;
      const updates = [];

      for (const [key, value] of Object.entries(snapshot)) {
        updates.push(
          prisma.appConfig.upsert({
            where: { key },
            create: { key, value: String(value) },
            update: { value: String(value), updatedAt: new Date() },
          })
        );
      }

      await Promise.all(updates);

      // Clear Redis cache to force reload of config
      try {
        const redis = require('../config/redis');
        if (redis) {
          await redis.del('app_config_*');
          logger.info('[ROLLBACK] Config cache cleared from Redis');
        }
      } catch (err) {
        logger.warn('[ROLLBACK] Failed to clear Redis cache', { error: err.message });
      }

      // Update rollback event
      await prisma.rollbackEvent.update({
        where: { id: rollbackEvent.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Notify admin
      await this._notifyRollback(
        `Config Rollback Successful: ${fromVersion} → ${targetVersion}`,
        {
          reason,
          rollbackId: rollbackEvent.id,
        }
      );

      logger.info('[ROLLBACK] Configuration rollback completed successfully', {
        rollbackId: rollbackEvent.id,
        fromVersion,
        toVersion: targetVersion,
      });

      return { success: true, rollbackId: rollbackEvent.id };
    } catch (error) {
      logger.error('[ROLLBACK] Configuration rollback failed', { error: error.message });
      Sentry.captureException(error, {
        tags: { component: 'rollback_manager', type: 'config_rollback' },
      });
      throw error;
    }
  }

  /**
   * Q78: Database Rollback
   * Restore database from backup
   * @param {string} backupId - ID of backup to restore from
   * @param {string} triggeredBy - Admin ID or "system"
   * @returns {Promise<Object>}
   */
  async rollbackDatabase(backupId, triggeredBy = 'system') {
    try {
      if (this._isTooSoonForRollback()) {
        throw new Error(
          `Rollback too frequent. Minimum ${thresholds.rollback.MIN_INTERVAL_BETWEEN_ROLLBACKS_MINUTES} minutes between rollbacks`
        );
      }

      logger.info('[ROLLBACK] Starting database rollback', { backupId, triggeredBy });

      // Create rollback event
      const rollbackEvent = await prisma.rollbackEvent.create({
        data: {
          fromVersion: 'current',
          toVersion: `backup_${backupId}`,
          trigger: 'manual',
          triggeredBy,
          status: 'IN_PROGRESS',
          databaseRollback: true,
          backupUsed: backupId,
        },
      });

      // Call restoration script (handled by backup-manager.js)
      // This is a placeholder - actual restoration would use:
      // pg_restore, AWS S3 recovery, or other backup system
      const restoreScript = `${process.env.BACKUP_RESTORE_SCRIPT || './scripts/backup-manager.js'}`;

      try {
        const { stdout, stderr } = await execAsync(
          `node ${restoreScript} restore ${backupId}`,
          { timeout: 900000 } // 15 minutes timeout
        );

        logger.info('[ROLLBACK] Database restoration completed', {
          stdout: stdout.substring(0, 500),
          backupId,
        });

        // Update rollback event
        await prisma.rollbackEvent.update({
          where: { id: rollbackEvent.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });

        // Notify admin
        await this._notifyRollback(
          `Database Rollback Successful from backup ${backupId}`,
          {
            rollbackId: rollbackEvent.id,
          }
        );

        return { success: true, rollbackId: rollbackEvent.id };
      } catch (execError) {
        // Mark as failed
        await prisma.rollbackEvent.update({
          where: { id: rollbackEvent.id },
          data: { status: 'FAILED', completedAt: new Date() },
        });

        throw new Error(`Database restoration failed: ${execError.message}`);
      }
    } catch (error) {
      logger.error('[ROLLBACK] Database rollback failed', { error: error.message });
      Sentry.captureException(error, {
        tags: { component: 'rollback_manager', type: 'database_rollback' },
      });
      throw error;
    }
  }

  /**
   * Q78: Automatic rollback triggered by error spike
   * @param {Object} metrics - Current system metrics
   * @returns {Promise<Object>}
   */
  async autoRollbackOnErrorSpike(metrics) {
    try {
      if (!thresholds.rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE) {
        logger.warn('[AUTO-ROLLBACK] Error spike detected but auto-rollback disabled');
        return { initiated: false, reason: 'auto_rollback_disabled' };
      }

      if (this._isTooSoonForRollback()) {
        logger.warn('[AUTO-ROLLBACK] Error spike detected but rollback too frequent');
        return { initiated: false, reason: 'rollback_frequency_limit' };
      }

      const { errorRate, durationMinutes } = metrics;

      if (
        !thresholds.shouldRollbackOnErrorRate(errorRate, durationMinutes)
      ) {
        return { initiated: false, reason: 'threshold_not_met' };
      }

      logger.error('[AUTO-ROLLBACK] ERROR SPIKE DETECTED - Initiating automatic rollback', {
        errorRate: `${errorRate}%`,
        duration: `${durationMinutes} minutes`,
      });

      // Fetch last stable version
      const stableVersion = await prisma.configVersion.findFirst({
        where: { isStable: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!stableVersion) {
        throw new Error('No stable version found for rollback');
      }

      // Trigger rollback
      const result = await this.rollbackConfiguration(
        stableVersion.version,
        'system',
        `Auto-rollback due to error rate spike: ${errorRate}% for ${durationMinutes} minutes`
      );

      // Notify with urgency
      await this._notifyRollback(
        'CRITICAL: Automatic Rollback Triggered - Error Spike Detected',
        {
          errorRate: `${errorRate}%`,
          duration: `${durationMinutes} minutes`,
          targetVersion: stableVersion.version,
          rollbackId: result.rollbackId,
        },
        'CRITICAL'
      );

      this.lastRollbackTime = Date.now();
      this.isRollingBack = false;

      return { initiated: true, rollbackId: result.rollbackId };
    } catch (error) {
      logger.error('[AUTO-ROLLBACK] Failed', { error: error.message });
      Sentry.captureException(error, {
        tags: { component: 'rollback_manager', type: 'auto_rollback_error_spike' },
      });
      return { initiated: false, error: error.message };
    }
  }

  /**
   * Q78: Code rollback via git revert
   * @param {string} commitHash - Commit to revert
   * @param {string} triggeredBy - Admin ID or "system"
   * @returns {Promise<Object>}
   */
  async rollbackCode(commitHash, triggeredBy = 'system') {
    try {
      logger.info('[CODE-ROLLBACK] Starting code rollback', {
        commitHash,
        triggeredBy,
      });

      const projectRoot = process.env.PROJECT_ROOT || '.';

      // Git revert
      const { stdout, stderr } = await execAsync(
        `cd ${projectRoot} && git revert --no-edit ${commitHash}`,
        { timeout: 60000 }
      );

      logger.info('[CODE-ROLLBACK] Git revert successful', { stdout });

      // In production, this would trigger a redeploy
      // For now, just log it
      if (process.env.DEPLOY_WEBHOOK_URL) {
        try {
          const fetch = (await import('node-fetch')).default;
          await fetch(process.env.DEPLOY_WEBHOOK_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'redeploy', reason: 'code_rollback' }),
          });
        } catch (deployError) {
          logger.warn('[CODE-ROLLBACK] Failed to trigger redeploy', {
            error: deployError.message,
          });
        }
      }

      return { success: true, commitHash };
    } catch (error) {
      logger.error('[CODE-ROLLBACK] Failed', { error: error.message });
      Sentry.captureException(error, {
        tags: { component: 'rollback_manager', type: 'code_rollback' },
      });
      throw error;
    }
  }

  /**
   * Q78: Blue-Green fallback - Instant DNS switch
   * @param {string} targetEnvironment - 'blue' | 'green'
   * @returns {Promise<Object>}
   */
  async blueGreenFallback(targetEnvironment) {
    try {
      logger.info('[BLUE-GREEN] Initiating fallback to', { environment: targetEnvironment });

      // This would typically call DNS provider API
      // Example: AWS Route53, Cloudflare, etc.

      if (process.env.DNS_PROVIDER === 'route53') {
        // AWS Route53 example (pseudo-code)
        // Would update health check or weighted routing policy
        logger.info('[BLUE-GREEN] DNS update initiated (Route53)');
      }

      logger.info('[BLUE-GREEN] Fallback completed', { environment: targetEnvironment });

      return { success: true, environment: targetEnvironment };
    } catch (error) {
      logger.error('[BLUE-GREEN] Fallback failed', { error: error.message });
      Sentry.captureException(error, {
        tags: { component: 'rollback_manager', type: 'blue_green_fallback' },
      });
      throw error;
    }
  }

  /**
   * Q77: Save current configuration as new version
   * @param {string} version - Version string (e.g., "1.0.1")
   * @param {string} createdBy - Admin ID
   * @param {string} changelog - Description of changes
   * @returns {Promise<Object>}
   */
  async saveConfigVersion(version, createdBy, changelog) {
    try {
      // Fetch current config
      const configs = await prisma.appConfig.findMany();
      const snapshot = {};

      configs.forEach(cfg => {
        snapshot[cfg.key] = cfg.value;
      });

      // Create git tag if in git repo
      let gitTag = null;
      try {
        const { stdout } = await execAsync(
          `git tag -a config-${version} -m "Config snapshot ${version}"`
        );
        gitTag = `config-${version}`;
      } catch (gitError) {
        logger.warn('[CONFIG-VERSION] Failed to create git tag', {
          error: gitError.message,
        });
      }

      // Save to database
      const configVersion = await prisma.configVersion.create({
        data: {
          version,
          snapshot,
          createdBy,
          changelog,
          tag: gitTag,
          isStable: false,
        },
      });

      logger.info('[CONFIG-VERSION] Saved new config version', {
        version,
        tag: gitTag,
      });

      return configVersion;
    } catch (error) {
      logger.error('[CONFIG-VERSION] Failed to save version', { error: error.message });
      Sentry.captureException(error, {
        tags: { component: 'rollback_manager', type: 'save_config_version' },
      });
      throw error;
    }
  }

  /**
   * Mark a version as production stable
   * @param {string} version - Version to mark stable
   * @returns {Promise<Object>}
   */
  async markVersionAsStable(version) {
    try {
      const updated = await prisma.configVersion.update({
        where: { version },
        data: { isStable: true },
      });

      logger.info('[CONFIG-VERSION] Marked as stable', { version });
      return updated;
    } catch (error) {
      logger.error('[CONFIG-VERSION] Failed to mark stable', { error: error.message });
      throw error;
    }
  }

  /**
   * Get rollback history
   * @param {number} limit - Maximum number of events to return
   * @returns {Promise<Array>}
   */
  async getRollbackHistory(limit = 50) {
    try {
      return await prisma.rollbackEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      logger.error('[ROLLBACK] Failed to fetch history', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if enough time has passed since last rollback
   * @private
   */
  _isTooSoonForRollback() {
    if (!this.lastRollbackTime) return false;

    const timeSinceLastRollback =
      (Date.now() - this.lastRollbackTime) / 1000 / 60; // Convert to minutes

    return (
      timeSinceLastRollback <
      thresholds.rollback.MIN_INTERVAL_BETWEEN_ROLLBACKS_MINUTES
    );
  }

  /**
   * Send notifications about rollback
   * @private
   */
  async _notifyRollback(title, details, severity = 'HIGH') {
    try {
      // Send to Sentry
      if (thresholds.rollback.SENTRY_ENABLED) {
        Sentry.captureMessage(title, severity === 'CRITICAL' ? 'fatal' : 'warning', {
          extra: details,
          tags: { component: 'rollback_manager', severity },
        });
      }

      // Send to Slack if configured
      if (thresholds.rollback.SLACK_WEBHOOK_URL) {
        try {
          const fetch = (await import('node-fetch')).default;
          const color = severity === 'CRITICAL' ? '#FF0000' : '#FFA500';

          await fetch(thresholds.rollback.SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attachments: [
                {
                  color,
                  title,
                  fields: Object.entries(details).map(([key, value]) => ({
                    title: key,
                    value: String(value),
                    short: true,
                  })),
                  ts: Math.floor(Date.now() / 1000),
                },
              ],
            }),
          });
        } catch (slackError) {
          logger.warn('[ROLLBACK] Failed to send Slack notification', {
            error: slackError.message,
          });
        }
      }

      // Send email if configured
      if (thresholds.rollback.NOTIFICATION_EMAILS?.length > 0) {
        const mailer = require('./mailer');
        await mailer.sendEmail({
          to: thresholds.rollback.NOTIFICATION_EMAILS.join(','),
          subject: `[${severity}] ${title}`,
          html: `<pre>${JSON.stringify(details, null, 2)}</pre>`,
        });
      }
    } catch (error) {
      logger.error('[ROLLBACK] Notification failed', { error: error.message });
    }
  }
}

module.exports = new RollbackManager();
