const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

let prisma;

const getPrisma = () => {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
};

class AuditLogModule {
  static setPrisma(instance) {
    prisma = instance;
  }

  static async createAuditLog(data) {
    try {
      const db = getPrisma();
      const log = await db.auditLog.create({
        data: {
          action: data.action,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          userId: data.userId,
          ipAddress: data.ipAddress || 'unknown',
          userAgent: data.userAgent || 'unknown',
          metadata: data.metadata || {},
          timestamp: new Date(),
        },
      });

      logger.info(`[AuditLog] ${data.action}`, {
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        userId: data.userId,
      });

      return log;
    } catch (err) {
      logger.error('[AuditLogModule] createAuditLog failed', {
        error: err.message,
        action: data.action,
      });
      throw err;
    }
  }

  static async getAuditHistory(userId, limit = 100) {
    try {
      const db = getPrisma();
      return await db.auditLog.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
    } catch (err) {
      logger.error('[AuditLogModule] getAuditHistory failed', { error: err.message, userId });
      throw err;
    }
  }

  static async getAuditsByResourceType(resourceType, limit = 100) {
    try {
      const db = getPrisma();
      return await db.auditLog.findMany({
        where: { resourceType },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
    } catch (err) {
      logger.error('[AuditLogModule] getAuditsByResourceType failed', { error: err.message, resourceType });
      throw err;
    }
  }

  static async exportAuditLogs(startDate, endDate, userId = null) {
    try {
      const db = getPrisma();
      const where = {
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      };
      if (userId) where.userId = userId;

      return await db.auditLog.findMany({
        where,
        orderBy: { timestamp: 'asc' },
      });
    } catch (err) {
      logger.error('[AuditLogModule] exportAuditLogs failed', { error: err.message });
      throw err;
    }
  }
}

module.exports = AuditLogModule;
