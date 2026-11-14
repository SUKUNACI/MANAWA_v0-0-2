'use strict';

const logger = require('../utils/logger');

/**
 * Professional Module — Public listing, profile detail, follow/unfollow
 */

class ProfessionalModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // ---- Public listing ----

  /**
   * List verified, non-suspended professionals with optional city/trade filters.
   */
  async list({ city, trade, page = 1, limit = 20 } = {}) {
    const take = Math.min(100, parseInt(limit) || 20);
    const skip = (Math.max(1, parseInt(page) || 1) - 1) * take;

    const where = { user: { suspended: false } };
    if (city) where.user.city = city;
    if (trade) where.trade = trade;

    try {
      const professionals = await this.prisma.professional.findMany({
        where,
        include: {
          user: {
            select: {
              id: true, firstName: true, lastName: true,
              email: true, city: true, avatarUrl: true, suspended: true,
            },
          },
          _count: { select: { followers: true } },
        },
        skip,
        take,
        orderBy: { averageRating: 'desc' },
      });

      return professionals;
    } catch (err) {
      logger.error('[ProfessionalModule] list failed', { error: err.message });
      throw err;
    }
  }

  // ---- Identity status (own profile) ----

  async getMyStatus(userId) {
    const pro = await this.prisma.professional.findUnique({
      where: { userId },
      select: {
        id: true, identityStatus: true, identityRejectionReason: true,
        verifiedByAdmin: true, decennale: true, accountType: true,
      },
    });

    if (!pro) throw Object.assign(new Error('Profil professionnel introuvable'), { status: 404 });
    return pro;
  }

  // ---- Public profile detail ----

  async getById(id) {
    const pro = await this.prisma.professional.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true,
            email: true, city: true, avatarUrl: true, phone: true, suspended: true,
          },
        },
        _count: { select: { followers: true } },
        companyMembers: true,
      },
    });

    if (!pro) throw Object.assign(new Error('Professionnel introuvable'), { status: 404 });

    return { ...pro, followerCount: pro._count.followers };
  }

  // ---- Follow / unfollow ----

  /**
   * Toggle follow state for a user on a professional.
   * @returns {{ following: boolean }}
   */
  async toggleFollow(professionalId, userId) {
    try {
      const pro = await this.prisma.professional.findUnique({ where: { id: professionalId } });
      if (!pro) throw Object.assign(new Error('Professionnel introuvable'), { status: 404 });

      const existing = await this.prisma.follow.findUnique({
        where: { followerId_professionalId: { followerId: userId, professionalId } },
      });

      if (existing) {
        await this.prisma.follow.delete({ where: { id: existing.id } });
        return { following: false };
      }

      await this.prisma.follow.create({ data: { followerId: userId, professionalId } });

      // Fire-and-forget notification — do not block the response
      this.prisma.notification.create({
        data: { userId: pro.userId, type: 'NEW_FOLLOWER', message: 'Quelqu\'un vous suit maintenant' },
      }).catch(() => {});

      return { following: true };
    } catch (err) {
      logger.error('[ProfessionalModule] toggleFollow failed', { professionalId, userId, error: err.message });
      throw err;
    }
  }
}

module.exports = ProfessionalModule;
