const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

/**
 * SecretAccessTracker — Log all access to sensitive secrets/keys
 * Tracks: API keys, encryption keys, credentials, tokens
 */
class SecretAccessTracker {
  /**
   * Hash secret for secure storage (never store raw secret)
   */
  static hashSecret(secret) {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  /**
   * Log access to a secret
   * @param {Object} data — { secretId, secretType, action, userId, ipAddress, userAgent, reason, metadata }
   */
  static async logAccess(data) {
    try {
      const { secretId, secretType, action, userId, ipAddress, userAgent, reason, metadata } = data;

      if (!secretId || !secretType || !action || !userId) {
        logger.warn('[SecretAccessTracker] Missing required fields', { data });
        return null;
      }

      const hashedSecretId = this.hashSecret(secretId);

      const log = await prisma.secretAccessLog.create({
        data: {
          secretId: hashedSecretId,
          secretType,
          action,
          userId,
          ipAddress,
          userAgent,
          reason: reason || 'unspecified',
        },
      });

      logger.info(`[SecretAccessTracker] ${action} — ${secretType}`, {
        secretType,
        action,
        userId,
        reason,
        ipAddress,
      });

      return log;
    } catch (err) {
      logger.error('[SecretAccessTracker] Log failed', { error: err.message, data });
      return null;
    }
  }

  /**
   * Get access history for a secret type
   */
  static async getAccessHistory(secretType, limit = 100, userId = null) {
    try {
      const logs = await prisma.secretAccessLog.findMany({
        where: {
          secretType,
          ...(userId && { userId }),
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return logs;
    } catch (err) {
      logger.error('[SecretAccessTracker] Get history failed', { error: err.message, secretType });
      return [];
    }
  }

  /**
   * Get all access for a user
   */
  static async getUserAccessHistory(userId, limit = 100) {
    try {
      const logs = await prisma.secretAccessLog.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return logs;
    } catch (err) {
      logger.error('[SecretAccessTracker] Get user history failed', { error: err.message, userId });
      return [];
    }
  }

  /**
   * Detect suspicious patterns (e.g., unusual access frequency)
   */
  static async detectAnomalies(secretType, timeWindowMinutes = 60) {
    try {
      const cutoffTime = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

      const recentAccess = await prisma.secretAccessLog.findMany({
        where: {
          secretType,
          timestamp: { gte: cutoffTime },
        },
        orderBy: { timestamp: 'desc' },
      });

      // Anomaly: > 5 accesses in 60 minutes
      if (recentAccess.length > 5) {
        logger.warn('[SecretAccessTracker] Anomaly detected', {
          secretType,
          accessCount: recentAccess.length,
          timeWindow: `${timeWindowMinutes}min`,
        });

        return {
          isAnomaly: true,
          accessCount: recentAccess.length,
          logs: recentAccess,
        };
      }

      return { isAnomaly: false, accessCount: recentAccess.length };
    } catch (err) {
      logger.error('[SecretAccessTracker] Anomaly detection failed', { error: err.message, secretType });
      return { isAnomaly: false, error: err.message };
    }
  }

  /**
   * Export access logs (audit trail)
   */
  static async exportAccessLogs(secretType = null, startDate = null, endDate = null) {
    try {
      const where = {};
      if (secretType) where.secretType = secretType;
      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = new Date(startDate);
        if (endDate) where.timestamp.lte = new Date(endDate);
      }

      const logs = await prisma.secretAccessLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
      });

      return logs;
    } catch (err) {
      logger.error('[SecretAccessTracker] Export failed', { error: err.message });
      return [];
    }
  }

  /**
   * Clean old logs (retention policy)
   */
  static async cleanOldLogs(daysOld = 90) {
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

      const result = await prisma.secretAccessLog.deleteMany({
        where: { timestamp: { lt: cutoffDate } },
      });

      logger.info('[SecretAccessTracker] Old logs cleaned', { daysOld, deletedCount: result.count });

      return result;
    } catch (err) {
      logger.error('[SecretAccessTracker] Cleanup failed', { error: err.message });
      return null;
    }
  }

  /**
   * Get summary stats for all secrets
   */
  static async getSummaryStats() {
    try {
      const stats = await prisma.secretAccessLog.groupBy({
        by: ['secretType', 'action'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });

      return stats;
    } catch (err) {
      logger.error('[SecretAccessTracker] Summary stats failed', { error: err.message });
      return [];
    }
  }
}

module.exports = SecretAccessTracker;
