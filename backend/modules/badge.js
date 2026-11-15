'use strict';

const logger = require('../utils/logger');

class BadgeModule {
  constructor(prisma, computeBadges, BADGES) {
    this.prisma = prisma;
    this.computeBadges = computeBadges;
    this.BADGES = BADGES;
  }

  async getBadgesForPro(proId) {
    const pro = await this.prisma.professional.findUnique({
      where: { id: proId },
      select: { id: true },
    });
    if (!pro) throw Object.assign(new Error('Professionnel introuvable'), { status: 404, code: 'PRO_NOT_FOUND' });

    this.computeBadges(pro.id).catch(() => {});

    const badges = await this.prisma.professionalBadge.findMany({
      where: { professionalId: pro.id },
      orderBy: { earnedAt: 'asc' },
    });

    return badges.map(b => ({ ...b, ...this.BADGES[b.badgeKey] })).filter(b => b.label);
  }

  async computeForPro(userId) {
    const pro = await this.prisma.professional.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!pro) {
      throw Object.assign(new Error('Profil professionnel introuvable'), { status: 404, code: 'PRO_NOT_FOUND' });
    }

    const before = await this.prisma.professionalBadge.findMany({
      where: { professionalId: pro.id },
      select: { badgeKey: true },
    });
    const beforeKeys = new Set(before.map(b => b.badgeKey));

    const allBadges = await this.computeBadges(pro.id);
    const newBadges = allBadges.filter(b => !beforeKeys.has(b.badgeKey));

    logger.info('[BadgeModule] Badges computed', { userId, total: allBadges.length, newCount: newBadges.length });
    return { badges: allBadges, newBadges };
  }
}

module.exports = BadgeModule;
