'use strict';

const logger = require('../utils/logger');

class ExperimentsModule {
  constructor(prisma, utils = {}) {
    this.prisma = prisma;
    this.calculateExperimentStats = utils.calculateExperimentStats || (() => ({}));
    this.testSignificance = utils.testSignificance || (() => false);
  }

  async listExperiments(query = {}) {
    const { page = '1', limit = '50', status } = query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = status ? { status } : {};

    const [experiments, total] = await Promise.all([
      this.prisma.experiment.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.experiment.count({ where }),
    ]);

    return { experiments, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } };
  }

  async getExperiment(id) {
    const experiment = await this.prisma.experiment.findUnique({ where: { id } });
    if (!experiment) throw new Error(`Experiment ${id} not found`);

    const stats = await this.calculateExperimentStats(experiment, id);
    return { experiment, stats };
  }

  async createExperiment(data) {
    const { name, description, trafficPercentage, variants } = data;
    if (!name || !variants || variants.length < 2) {
      throw new Error('Experiment requires name and at least 2 variants');
    }

    const existing = await this.prisma.experiment.findUnique({ where: { name } });
    if (existing) throw new Error('Experiment name already exists');

    const experiment = await this.prisma.experiment.create({
      data: { name, description, trafficPercentage, variants, status: 'DRAFT' },
    });
    logger.info(`Experiment created: ${experiment.id}`);
    return { experiment };
  }

  async updateStatus(id, status) {
    const experiment = await this.prisma.experiment.findUnique({ where: { id } });
    if (!experiment) throw new Error(`Experiment ${id} not found`);

    const updated = await this.prisma.experiment.update({
      where: { id },
      data: { status },
    });
    logger.info(`Experiment ${id} status updated to ${status}`);
    return { experiment: updated };
  }

  async getResults(id, variant1, variant2) {
    const experiment = await this.prisma.experiment.findUnique({ where: { id } });
    if (!experiment) throw new Error(`Experiment ${id} not found`);

    const results = await this.prisma.experimentResult.findMany({
      where: { experimentId: id },
    });
    
    const stats = await this.calculateExperimentStats(experiment, results);
    const significance = this.testSignificance(results, variant1, variant2);

    return { results, stats, significant: significance };
  }

  async deleteExperiment(id) {
    const experiment = await this.prisma.experiment.findUnique({ where: { id } });
    if (!experiment) throw new Error(`Experiment ${id} not found`);
    if (experiment.status === 'ACTIVE') throw new Error('Cannot delete an active experiment');

    await this.prisma.experimentResult.deleteMany({ where: { experimentId: id } });
    await this.prisma.experiment.delete({ where: { id } });
    logger.info(`Experiment ${id} deleted`);
    return { message: 'Experiment deleted' };
  }
}

module.exports = ExperimentsModule;
