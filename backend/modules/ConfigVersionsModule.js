/**
 * ConfigVersionsModule
 * Business logic for configuration versioning
 */

const logger = require('../utils/logger');

class ConfigVersionsModule {
  constructor(prisma, rollbackManager) {
    this.prisma = prisma;
    this.rollbackManager = rollbackManager;
  }

  // List versions
  async listVersions(pagination = {}) {
    const { limit = 20, offset = 0 } = pagination;
    const [versions, total] = await Promise.all([
      this.prisma.configVersion.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.configVersion.count(),
    ]);
    return { versions, total, limit, offset };
  }

  // Get specific version
  async getVersion(version) {
    const configVersion = await this.prisma.configVersion.findUnique({ where: { version } });
    if (!configVersion) throw new Error(`Version ${version} not found`);
    return configVersion;
  }

  // Create new version
  async createVersion(data, adminId) {
    const { version, changelog } = data;
    const existing = await this.prisma.configVersion.findUnique({ where: { version } });
    if (existing) throw new Error(`Version ${version} already exists`);
    return this.rollbackManager.saveConfigVersion(version, adminId, changelog);
  }

  // Restore version
  async restoreVersion(version, adminId, reason) {
    return this.rollbackManager.rollbackConfiguration(version, adminId, reason);
  }

  // Mark as stable
  async markStable(version) {
    return this.rollbackManager.markVersionAsStable(version);
  }

  // Get rollback history
  async getRollbackHistory() {
    return this.rollbackManager.getRollbackHistory();
  }

  // Get health metrics
  async getHealthMetrics() {
    const metrics = await this.prisma.systemHealthMetric.findMany({
      orderBy: { timestamp: 'desc' },
      take: 1,
    });
    return metrics[0] || null;
  }
}

module.exports = ConfigVersionsModule;
