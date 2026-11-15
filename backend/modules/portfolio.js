'use strict';

const logger = require('../utils/logger');

/**
 * PortfolioModule — Portfolio project management and interaction
 */

const PORTFOLIO_SORT_OPTIONS = {
  newest: 'createdAt',
  oldest: '-createdAt',
  rating: 'averageRating',
};

class PortfolioModule {
  constructor(prisma, uploadBuffer) {
    this.prisma = prisma;
    this.uploadBuffer = uploadBuffer;
  }

  async list({ trade, professionalId, skip = 0, limit = 20, userId } = {}) {
    const where = {};
    if (trade) where.tradeCategory = trade;
    if (professionalId) where.professionalId = professionalId;

    const [projects, total] = await Promise.all([
      this.prisma.portfolioProject.findMany({
        where,
        include: { likes: { where: { userId }, select: { id: true } }, replies: { take: 3 } },
        orderBy: { createdAt: 'desc' },
        skip: Math.max(0, skip),
        take: Math.min(100, limit),
      }),
      this.prisma.portfolioProject.count({ where }),
    ]);

    return {
      projects: projects.map(p => ({
        ...p,
        liked: p.likes.length > 0,
        likes: p.likes.length,
      })),
      total,
    };
  }

  async getDetail(projectId) {
    const project = await this.prisma.portfolioProject.findUnique({
      where: { id: projectId },
      include: {
        replies: {
          include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { likes: true, replies: true } },
        professional: { select: { id: true, averageRating: true, trade: true } },
      },
    });

    if (!project) throw Object.assign(new Error('Projet introuvable'), { status: 404, code: 'PROJECT_NOT_FOUND' });

    const averageRating = project.professional?.averageRating || 0;
    return { ...project, averageRating };
  }

  async create({ userId, title, description, tradeCategory, files = [] }) {
    if (!title || !description || !tradeCategory) {
      throw Object.assign(new Error('Titre, description et catégorie requis'), { status: 400, code: 'MISSING_FIELDS' });
    }

    const professional = await this.prisma.professional.findUnique({ where: { userId }, select: { id: true } });
    if (!professional) {
      throw Object.assign(new Error('Profil professionnel introuvable'), { status: 404, code: 'PRO_NOT_FOUND' });
    }

    let photos = [];
    if (files && files.length > 0) {
      try {
        photos = await Promise.all(
          files.map(f => this.uploadBuffer(f, `portfolio/${professional.id}`))
        );
      } catch (err) {
        logger.error('[PortfolioModule] Upload failed', { userId, error: err.message });
        throw Object.assign(new Error('Erreur lors du téléchargement'), { status: 400, code: 'UPLOAD_FAILED' });
      }
    }

    const project = await this.prisma.portfolioProject.create({
      data: {
        professionalId: professional.id,
        title: title.trim(),
        description: description.trim(),
        tradeCategory,
        photos,
      },
      include: { _count: { select: { likes: true, replies: true } } },
    });

    logger.info('[PortfolioModule] Project created', { userId, projectId: project.id });
    return project;
  }

  async update(projectId, userId, { title, description, tradeCategory }) {
    const project = await this.prisma.portfolioProject.findUnique({
      where: { id: projectId },
      include: { professional: { select: { userId: true } } },
    });

    if (!project) throw Object.assign(new Error('Projet introuvable'), { status: 404, code: 'PROJECT_NOT_FOUND' });
    if (project.professional.userId !== userId) {
      throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
    }

    const updated = await this.prisma.portfolioProject.update({
      where: { id: projectId },
      data: {
        ...(title && { title: title.trim() }),
        ...(description && { description: description.trim() }),
        ...(tradeCategory && { tradeCategory }),
      },
    });

    logger.info('[PortfolioModule] Project updated', { userId, projectId });
    return updated;
  }

  async remove(projectId, userId) {
    const project = await this.prisma.portfolioProject.findUnique({
      where: { id: projectId },
      include: { professional: { select: { userId: true } } },
    });

    if (!project) throw Object.assign(new Error('Projet introuvable'), { status: 404, code: 'PROJECT_NOT_FOUND' });
    if (project.professional.userId !== userId) {
      throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
    }

    await this.prisma.portfolioProject.delete({ where: { id: projectId } });
    logger.info('[PortfolioModule] Project deleted', { userId, projectId });
    return { deleted: true };
  }

  async toggleLike(projectId, userId) {
    const existing = await this.prisma.portfolioLike.findFirst({
      where: { projectId, userId },
    });

    if (existing) {
      await this.prisma.portfolioLike.delete({ where: { id: existing.id } });
      return { liked: false };
    }

    await this.prisma.portfolioLike.create({ data: { projectId, userId } });
    return { liked: true };
  }

  async addComment(projectId, authorId, { content, rating, parentId }) {
    if (!content || content.trim().length === 0) {
      throw Object.assign(new Error('Contenu du commentaire requis'), { status: 400, code: 'EMPTY_CONTENT' });
    }

    const project = await this.prisma.portfolioProject.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw Object.assign(new Error('Projet introuvable'), { status: 404, code: 'PROJECT_NOT_FOUND' });

    const reply = await this.prisma.portfolioReply.create({
      data: {
        projectId,
        authorId,
        content: content.trim(),
        rating: rating || null,
        parentId: parentId || null,
      },
      include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });

    logger.info('[PortfolioModule] Comment added', { projectId, authorId, replyId: reply.id });
    return reply;
  }

  async removeComment(projectId, commentId, userId, userRole) {
    const reply = await this.prisma.portfolioReply.findFirst({
      where: { id: commentId, projectId },
      include: { author: { select: { id: true } }, project: { include: { professional: { select: { userId: true } } } } },
    });

    if (!reply) throw Object.assign(new Error('Commentaire introuvable'), { status: 404, code: 'COMMENT_NOT_FOUND' });

    const isOwner = reply.author.id === userId;
    const isProjectOwner = reply.project.professional.userId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isOwner && !isProjectOwner && !isAdmin) {
      throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
    }

    await this.prisma.portfolioReply.delete({ where: { id: commentId } });
    logger.info('[PortfolioModule] Comment deleted', { userId, commentId });
    return { deleted: true };
  }
}

module.exports = PortfolioModule;
