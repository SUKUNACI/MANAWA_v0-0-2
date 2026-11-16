const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class AuditLogModule {
  /**
   * Crée une entrée d'audit avec hash chain pour immutabilité
   * @param {Object} data - { action, resourceType, resourceId, userId, ipAddress, userAgent, metadata }
   * @returns {Promise<Object>} Audit log créé
   */
  static async createAuditLog(data) {
    const {
      action,
      resourceType,
      resourceId,
      userId,
      ipAddress,
      userAgent,
      metadata = {},
    } = data;

    // Récupère le hash précédent (dernière entrée du même type)
    const lastEntry = await prisma.auditLog.findFirst({
      where: {
        resourceType,
        resourceId,
      },
      orderBy: { timestamp: 'desc' },
      select: { currentHash: true },
    });

    const previousHash = lastEntry?.currentHash || null;

    // Génère le hash actuel (SHA256)
    const hashInput = JSON.stringify({
      action,
      resourceType,
      resourceId,
      userId,
      timestamp: new Date().toISOString(),
      previousHash,
      metadata,
    });
    const currentHash = crypto
      .createHash('sha256')
      .update(hashInput)
      .digest('hex');

    // Crée l'entrée d'audit
    const auditLog = await prisma.auditLog.create({
      data: {
        action,
        resourceType,
        resourceId,
        userId,
        ipAddress,
        userAgent,
        previousHash,
        currentHash,
        metadata,
      },
    });

    return auditLog;
  }

  /**
   * Vérifie l'intégrité d'une chaîne de hash
   * @param {string} resourceType - Type de ressource
   * @param {string} resourceId - ID de la ressource
   * @returns {Promise<Object>} { isValid, tamperedAt, details }
   */
  static async verifyChain(resourceType, resourceId) {
    const entries = await prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { timestamp: 'asc' },
    });

    if (entries.length === 0) {
      return { isValid: true, message: 'Aucune entrée d\'audit trouvée' };
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expectedPreviousHash = i === 0 ? null : entries[i - 1].currentHash;

      // Vérifie que previousHash correspond
      if (entry.previousHash !== expectedPreviousHash) {
        return {
          isValid: false,
          tamperedAt: i,
          details: `Chaîne brisée à l'index ${i}. Expected previousHash: ${expectedPreviousHash}, Got: ${entry.previousHash}`,
        };
      }

      // Recalcule le hash pour vérifier
      const hashInput = JSON.stringify({
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        userId: entry.userId,
        timestamp: entry.timestamp.toISOString(),
        previousHash: entry.previousHash,
        metadata: entry.metadata,
      });
      const recalculatedHash = crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex');

      if (recalculatedHash !== entry.currentHash) {
        return {
          isValid: false,
          tamperedAt: i,
          details: `Hash modifié à l'index ${i}. Expected: ${recalculatedHash}, Got: ${entry.currentHash}`,
        };
      }
    }

    return {
      isValid: true,
      chainLength: entries.length,
      message: `Chaîne d'audit vérifiée (${entries.length} entrées)`,
    };
  }

  /**
   * Récupère l'historique d'audit avec vérification optionnelle
   * @param {Object} filters - { resourceType, resourceId, userId, action, startDate, endDate }
   * @param {boolean} verify - Vérifie l'intégrité
   * @returns {Promise<Array>} Entrées d'audit
   */
  static async getAuditTrail(filters = {}, verify = false) {
    const {
      resourceType,
      resourceId,
      userId,
      action,
      startDate,
      endDate,
      limit = 100,
      skip = 0,
    } = filters;

    const where = {};
    if (resourceType) where.resourceType = resourceType;
    if (resourceId) where.resourceId = resourceId;
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate) where.timestamp.lte = new Date(endDate);
    }

    const entries = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip,
    });

    if (verify && resourceType && resourceId) {
      const verification = await this.verifyChain(resourceType, resourceId);
      return {
        entries,
        verification,
      };
    }

    return entries;
  }

  /**
   * Exporte l'audit trail en CSV
   * @param {Object} filters - Filtres de recherche
   * @returns {Promise<string>} CSV content
   */
  static async exportAuditTrail(filters = {}) {
    const entries = await this.getAuditTrail(filters, false);

    const headers = [
      'ID',
      'Action',
      'Resource Type',
      'Resource ID',
      'User ID',
      'Timestamp',
      'IP Address',
      'User Agent',
      'Current Hash',
      'Previous Hash',
    ];

    const rows = entries.map((e) => [
      e.id,
      e.action,
      e.resourceType,
      e.resourceId,
      e.userId || '',
      e.timestamp.toISOString(),
      e.ipAddress || '',
      e.userAgent || '',
      e.currentHash,
      e.previousHash || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((r) => r.map((v) => `"${v.toString().replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    return csv;
  }

  /**
   * Nettoie les vieux audit logs (archivage)
   * @param {number} daysOld - Garder les logs plus vieux que X jours
   * @returns {Promise<number>} Nombre de logs supprimés
   */
  static async archiveOldLogs(daysOld = 365) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await prisma.auditLog.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }
}

module.exports = AuditLogModule;
