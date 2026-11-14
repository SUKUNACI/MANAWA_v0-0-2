'use strict';

const logger = require('../utils/logger');

/**
 * Project Module — Creation, listing, detail, status transitions, photo management
 */

const PROJECT_STATUSES = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

class ProjectModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // ---- Query shapes ----

  _myProjectInclude() {
    return {
      photos: true,
      quotes: {
        include: {
          professional: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, city: true } },
            },
          },
        },
      },
    };
  }

  _detailInclude() {
    return {
      photos: true,
      client: { select: { firstName: true, lastName: true, city: true, phone: true } },
      quotes: {
        include: {
          professional: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
            },
          },
          items: { orderBy: { sortOrder: 'asc' } },
          payments: { select: { id: true, status: true, isDeposit: true, geniuspayRef: true } },
        },
        orderBy: { version: 'desc' },
      },
      review: true,
    };
  }

  // ---- Access control ----

  checkAccess(project, userId, userRole) {
    const isOwner = project.clientId === userId;
    const isInvolvedPro = project.quotes.some(q => q.professional?.user?.id === userId);
    return isOwner || isInvolvedPro || userRole === 'ADMIN';
  }

  // ---- Create ----

  async create({ clientId, title, description, tradeNeeded, budgetMin, budgetMax, city, latitude, longitude, photos }) {
    try {
      const project = await this.prisma.project.create({
        data: {
          clientId,
          title,
          description,
          tradeNeeded,
          budgetMin,
          budgetMax,
          city,
          latitude,
          longitude,
          photos: photos ? { create: photos.map(url => ({ imageUrl: url })) } : undefined,
        },
        include: { photos: true },
      });

      logger.info('[ProjectModule] Project created', { projectId: project.id, clientId });
      return project;
    } catch (err) {
      logger.error('[ProjectModule] create failed', { clientId, error: err.message });
      throw err;
    }
  }

  // ---- List (open projects for discovery) ----

  async list({ where = {}, paginationQuery = {} } = {}) {
    try {
      const projects = await this.prisma.project.findMany({
        where,
        include: {
          client: { select: { firstName: true, lastName: true, city: true } },
          _count: { select: { quotes: true, photos: true } },
        },
        ...paginationQuery,
      });
      return projects;
    } catch (err) {
      logger.error('[ProjectModule] list failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Determine which project IDs the given professional has already quoted on.
   */
  async getAlreadyQuotedIds(projects, userId, userRole) {
    if (userRole !== 'PROFESSIONAL') return new Set();

    const pro = await this.prisma.professional.findUnique({ where: { userId }, select: { id: true } });
    if (!pro) return new Set();

    const existing = await this.prisma.quote.findMany({
      where: { professionalId: pro.id, projectId: { in: projects.map(p => p.id) } },
      select: { projectId: true },
    });
    return new Set(existing.map(q => q.projectId));
  }

  /**
   * Apply subscription-based delay to a Prisma where clause.
   * Modifies `where` in place (intentional — mirrors the existing route pattern).
   */
  async applySubscriptionDelay(userId, where, { getActiveTier, getTierConfig }) {
    const pro = await this.prisma.professional.findUnique({
      where: { userId },
      include: { subscription: true },
    });
    if (!pro) return;

    const tier = getActiveTier(pro.subscription, pro);
    const delayMs = getTierConfig(tier).projectsDelayMs;
    if (delayMs > 0) {
      where.createdAt = { lte: new Date(Date.now() - delayMs) };
    }
  }

  // ---- Client: own projects ----

  async listMine(clientId) {
    return this.prisma.project.findMany({
      where: { clientId },
      include: this._myProjectInclude(),
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ---- Detail ----

  async getDetail(id) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: this._detailInclude(),
    });
    if (!project) throw Object.assign(new Error('Projet introuvable'), { status: 404, code: 'PROJECT_NOT_FOUND' });
    return project;
  }

  // ---- Update status ----

  async updateStatus(id, status) {
    const allowedStatuses = Object.values(PROJECT_STATUSES);
    if (!allowedStatuses.includes(status)) {
      throw Object.assign(new Error('Statut invalide'), { status: 400, code: 'INVALID_STATUS' });
    }
    return this.prisma.project.update({ where: { id }, data: { status } });
  }

  // ---- Completion (dual confirmation) ----

  async clientConfirmCompletion(projectId) {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: { quotes: { where: { status: 'ACCEPTED' } } },
      });
      if (!project) throw Object.assign(new Error('Projet introuvable'), { status: 404 });
      if (project.status !== PROJECT_STATUSES.IN_PROGRESS) {
        throw Object.assign(new Error('Ce projet doit être en cours pour être marqué comme terminé'), { status: 400, code: 'INVALID_PROJECT_STATUS' });
      }

      const bothConfirmed = project.proConfirmedCompletion;
      await this.prisma.project.update({
        where: { id: projectId },
        data: { clientConfirmedCompletion: true, status: bothConfirmed ? PROJECT_STATUSES.COMPLETED : PROJECT_STATUSES.IN_PROGRESS },
      });

      return { completed: bothConfirmed, waitingForOtherParty: !bothConfirmed, acceptedQuote: project.quotes[0] || null };
    } catch (err) {
      logger.error('[ProjectModule] clientConfirmCompletion failed', { projectId, error: err.message });
      throw err;
    }
  }

  async proConfirmCompletion(projectId, proId) {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: { quotes: { where: { status: 'ACCEPTED', professionalId: proId } } },
      });
      if (!project || project.quotes.length === 0) {
        throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
      }
      if (project.status !== PROJECT_STATUSES.IN_PROGRESS) {
        throw Object.assign(new Error('Ce projet doit être en cours'), { status: 400, code: 'INVALID_PROJECT_STATUS' });
      }

      const bothConfirmed = project.clientConfirmedCompletion;
      await this.prisma.project.update({
        where: { id: projectId },
        data: { proConfirmedCompletion: true, status: bothConfirmed ? PROJECT_STATUSES.COMPLETED : PROJECT_STATUSES.IN_PROGRESS },
      });

      return { completed: bothConfirmed, waitingForOtherParty: !bothConfirmed };
    } catch (err) {
      logger.error('[ProjectModule] proConfirmCompletion failed', { projectId, proId, error: err.message });
      throw err;
    }
  }

  async incrementCompletedMissions(professionalId) {
    try {
      await this.prisma.professional.update({
        where: { id: professionalId },
        data: { completedMissionsCount: { increment: 1 } },
      });
    } catch (err) {
      logger.error('[ProjectModule] incrementCompletedMissions failed', { professionalId, error: err.message });
    }
  }

  // ---- Cancel ----

  async cancel(projectId, clientId) {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: { quotes: { where: { status: 'ACCEPTED' } } },
      });
      if (!project || project.clientId !== clientId) {
        throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
      }

      const wasInProgress = project.status === PROJECT_STATUSES.IN_PROGRESS;
      await this.prisma.project.update({ where: { id: projectId }, data: { status: PROJECT_STATUSES.CANCELLED } });

      const acceptedQuote = project.quotes[0];
      if (wasInProgress && acceptedQuote) {
        await this.prisma.professional.update({
          where: { id: acceptedQuote.professionalId },
          data: { cancelledMissionsCount: { increment: 1 } },
        }).catch(err => logger.error('[ProjectModule] cancel — failed to update cancelled count', { error: err.message }));
      }

      return { cancelled: true };
    } catch (err) {
      logger.error('[ProjectModule] cancel failed', { projectId, error: err.message });
      throw err;
    }
  }

  // ---- Photos ----

  async addPhotos(projectId, clientId, imageUrls) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.clientId !== clientId) {
      throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
    }

    return Promise.all(
      imageUrls.map(imageUrl => this.prisma.projectPhoto.create({ data: { projectId, imageUrl } }))
    );
  }
}

module.exports = ProjectModule;
