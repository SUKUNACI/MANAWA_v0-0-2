'use strict';

const logger = require('../utils/logger');

const REFERRAL_STATUS = {
  PENDING: 'PENDING',
  QUALIFIED: 'QUALIFIED',
  REWARDED: 'REWARDED',
};

class ReferralModule {
  constructor(prisma, sendPush = null) {
    this.prisma = prisma;
    this.sendPush = sendPush;
  }

  async getOrCreateCode(userId) {
    let referral = await this.prisma.referral.findFirst({
      where: { referrerId: userId },
    });

    if (!referral) {
      const code = this._generateCode();
      referral = await this.prisma.referral.create({
        data: { referrerId: userId, code },
      });
    }

    const [qualified, rewarded] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: userId, status: REFERRAL_STATUS.QUALIFIED } }),
      this.prisma.referral.count({ where: { referrerId: userId, status: REFERRAL_STATUS.REWARDED } }),
    ]);

    const total = await this.prisma.referral.count({ where: { referrerId: userId } });

    return { code: referral.code, total, qualified, rewarded };
  }

  async useCode({ userId, code }) {
    if (!code || !userId) {
      throw Object.assign(new Error('Code et userId sont requis'), { status: 400, code: 'MISSING_FIELDS' });
    }

    const referrer = await this._findReferrerByCode(code);
    if (!referrer) {
      throw Object.assign(new Error('Code invalide'), { status: 400, code: 'INVALID_CODE' });
    }
    if (referrer === userId) {
      throw Object.assign(new Error('Vous ne pouvez pas utiliser votre propre code'), { status: 400, code: 'CANNOT_USE_OWN_CODE' });
    }

    const existing = await this.prisma.referral.findFirst({
      where: { referredId: userId },
    });
    if (existing) {
      throw Object.assign(new Error('Vous avez deja ete parraine'), { status: 400, code: 'ALREADY_REFERRED' });
    }

    const referral = await this.prisma.referral.create({
      data: { referrerId: referrer, referredId: userId, code, status: REFERRAL_STATUS.PENDING },
    });

    if (this.sendPush) {
      this.sendPush(referrer, 'Nouveau parrainage', 'Quelqu\'un a utilise votre code de parrainage!', {
        type: 'referral',
        referralId: referral.id,
      }).catch(err => logger.warn('[ReferralModule] Push failed', { error: err.message }));
    }

    logger.info('[ReferralModule] Code used', { userId, referrerId: referrer, referralId: referral.id });
    return { referrerName: 'Sponsor' };
  }

  async listReferrals(userId) {
    return this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referred: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReferrer(userId) {
    const referral = await this.prisma.referral.findFirst({
      where: { referredId: userId },
      include: { referrer: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!referral) return { referrer: null };

    return {
      referrer: referral.referrer,
      status: referral.status,
      createdAt: referral.createdAt,
    };
  }

  async calculateBonus(referrerId) {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId },
    });

    const pending = referrals.filter(r => r.status === REFERRAL_STATUS.PENDING).length;
    const qualified = referrals.filter(r => r.status === REFERRAL_STATUS.QUALIFIED).length;
    const rewarded = referrals.filter(r => r.status === REFERRAL_STATUS.REWARDED).length;

    const BONUS_PER_REFERRAL = 25;
    const totalRewardValue = rewarded * BONUS_PER_REFERRAL;

    return { pending, qualified, rewarded, totalRewardValue };
  }

  _generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'REF-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async _findReferrerByCode(code) {
    const config = await this.prisma.appConfig.findFirst({
      where: { key: 'referral_code_' + code },
    });
    return config ? config.value : null;
  }
}

module.exports = ReferralModule;
