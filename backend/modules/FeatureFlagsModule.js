'use strict';

const logger = require('../utils/logger');

class FeatureFlagsModule {
  constructor(prisma, utils = {}) {
    this.prisma = prisma;
    this.invalidateCache = utils.invalidateCache || (() => {});
  }

  async listFlags(query = {}) {
    const { page = '1', limit = '50', enabled } = query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = enabled !== undefined ? { enabled: enabled === 'true' || enabled === true } : {};

    const [flags, total] = await Promise.all([
      this.prisma.featureFlag.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.featureFlag.count({ where }),
    ]);

    return { flags, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } };
  }

  async getFlag(name) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { name } });
    if (!flag) throw new Error(`Feature flag ${name} not found`);
    return flag;
  }

  async createFlag(data) {
    const { name, description, enabled, rolloutPercentage } = data;
    if (!name) throw new Error('Feature flag requires name');

    const existing = await this.prisma.featureFlag.findUnique({ where: { name } });
    if (existing) throw new Error('Feature flag already exists');

    const flag = await this.prisma.featureFlag.create({
      data: { name, description, enabled, rolloutPercentage },
    });

    logger.info(`Feature flag created: ${flag.id}`);
    this.invalidateCache();
    return flag;
  }

  async updateFlag(name, data) {
    const existing = await this.prisma.featureFlag.findUnique({ where: { name } });
    if (!existing) throw new Error(`Feature flag ${name} not found`);

    const flag = await this.prisma.featureFlag.update({
      where: { name },
      data: { ...data },
    });

    logger.info(`Feature flag updated: ${name}`);
    this.invalidateCache();
    return flag;
  }

  async updateRollout(name, rolloutPercentage) {
    const existing = await this.prisma.featureFlag.findUnique({ where: { name } });
    if (!existing) throw new Error(`Feature flag ${name} not found`);

    const flag = await this.prisma.featureFlag.update({
      where: { name },
      data: { rolloutPercentage },
    });

    logger.info(`Feature flag ${name} rollout updated to ${rolloutPercentage}%`);
    this.invalidateCache();
    return flag;
  }

  async deleteFlag(name) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { name } });
    if (!flag) throw new Error(`Feature flag ${name} not found`);

    await this.prisma.featureFlag.delete({ where: { name } });

    logger.info(`Feature flag deleted: ${name}`);
    this.invalidateCache();
    return { message: 'Deleted' };
  }

  async writeAdminLog(userId, action, entityType, entityId, data) {
    logger.info(`[ADMIN-${action}] ${userId} on ${entityType} ${entityId}:`, data);
  }
}

module.exports = FeatureFlagsModule;
