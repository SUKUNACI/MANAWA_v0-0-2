'use strict';

const logger = require('../utils/logger');

/**
 * ReviewModule — Review creation and professional rating management
 */

const REVIEW_CONSTRAINTS = {
  MIN_RATING: 1,
  MAX_RATING: 5,
  MAX_COMMENT_LENGTH: 1000,
  MIN_BOOKING_DURATION_DAYS: 0, // No minimum for now
};

class ReviewModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async create({ authorId, professionalId, projectId, rating, comment }) {
    if (!authorId || !professionalId || !projectId) {
      throw Object.assign(new Error('authorId, professionalId et projectId sont requis'), { status: 400, code: 'MISSING_FIELDS' });
    }

    if (rating < REVIEW_CONSTRAINTS.MIN_RATING || rating > REVIEW_CONSTRAINTS.MAX_RATING) {
      throw Object.assign(new Error(`La note doit être entre ${REVIEW_CONSTRAINTS.MIN_RATING} et ${REVIEW_CONSTRAINTS.MAX_RATING}`), { status: 400, code: 'INVALID_RATING' });
    }

    if (comment && comment.length > REVIEW_CONSTRAINTS.MAX_COMMENT_LENGTH) {
      throw Object.assign(new Error(`Commentaire trop long (max ${REVIEW_CONSTRAINTS.MAX_COMMENT_LENGTH} caractères)`), { status: 400, code: 'COMMENT_TOO_LONG' });
    }

    const professional = await this.prisma.professional.findUnique({
      where: { id: professionalId },
      select: { id: true, userId: true },
    });
    if (!professional) throw Object.assign(new Error('Professionnel introuvable'), { status: 404, code: 'PRO_NOT_FOUND' });

    const booking = await this.prisma.booking.findFirst({
      where: { projectId, professionalId, status: 'COMPLETED' },
    });
    if (!booking) {
      throw Object.assign(new Error('Aucune réservation complétée avec ce professionnel'), { status: 400, code: 'NO_COMPLETED_BOOKING' });
    }

    const existingReview = await this.prisma.review.findFirst({
      where: { authorId, professionalId, projectId },
    });
    if (existingReview) {
      throw Object.assign(new Error('Vous avez déjà évalué ce professionnel pour ce projet'), { status: 400, code: 'REVIEW_EXISTS' });
    }

    const review = await this.prisma.review.create({
      data: {
        authorId,
        professionalId,
        projectId,
        rating,
        comment: comment?.trim() || null,
      },
    });

    this._refreshProfessionalRating(professionalId).catch(
      err => logger.warn('[ReviewModule] Rating refresh failed', { professionalId, error: err.message })
    );

    logger.info('[ReviewModule] Review created', { authorId, professionalId, reviewId: review.id, rating });
    return review;
  }

  async listForProfessional(professionalId, { page = 1, limit = 20 } = {}) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, limit);

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { professionalId },
        include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
        skip: (safePage - 1) * safeLimit,
      }),
      this.prisma.review.count({ where: { professionalId } }),
    ]);

    return {
      reviews,
      total,
      page: safePage,
      pageCount: Math.ceil(total / safeLimit),
    };
  }

  getConstraints() {
    return REVIEW_CONSTRAINTS;
  }

  async _refreshProfessionalRating(professionalId) {
    const result = await this.prisma.review.aggregate({
      where: { professionalId },
      _avg: { rating: true },
      _count: true,
    });

    const avgRating = result._avg.rating ? Math.round(result._avg.rating * 10) / 10 : 0;

    await this.prisma.professional.update({
      where: { id: professionalId },
      data: { averageRating: avgRating, reviewCount: result._count },
    });
  }
}

module.exports = ReviewModule;
