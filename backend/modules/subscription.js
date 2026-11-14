const appConfig = require('../utils/appConfig');
const geniuspay = require('../utils/geniuspay');

// Tier configurations
const TIERS = {
  GRATUIT: { key: 'GRATUIT', name: 'Gratuit', price: 0, billingCycle: 'FREE', features: [] },
  PRO: { key: 'PRO', name: 'Pro', price: 2500, billingCycle: 'MONTHLY', features: ['Feature 1', 'Feature 2'] },
  ESSENTIEL: { key: 'ESSENTIEL', name: 'Essentiel', price: 5000, billingCycle: 'MONTHLY', features: ['Feature 1', 'Feature 2', 'Feature 3'] },
  ELITE: { key: 'ELITE', name: 'Elite', price: 10000, billingCycle: 'MONTHLY', features: ['Feature 1', 'Feature 2', 'Feature 3', 'Feature 4'] },
};

class SubscriptionModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * GET /api/subscriptions/me — Get subscription status
   */
  async getCurrentStatus(userId) {
    const professional = await this.prisma.professional.findUnique({
      where: { userId },
      include: { subscription: true },
    });

    if (!professional) {
      const err = new Error('Professional not found');
      err.status = 404;
      throw err;
    }

    let tier = 'GRATUIT';
    let isPremium = false;
    let isOnTrial = false;
    let trialDaysLeft = null;
    let expiresAt = null;

    // Check subscription first (highest priority)
    if (professional.subscription && professional.subscription.status === 'ACTIVE') {
      tier = professional.subscription.tier;
      isPremium = true;
      expiresAt = professional.subscription.expiresAt;
    }
    // Check trial
    else if (professional.trialEndsAt && new Date() < professional.trialEndsAt) {
      tier = 'PRO';
      isPremium = true;
      isOnTrial = true;
      trialDaysLeft = Math.ceil((professional.trialEndsAt - new Date()) / (1000 * 60 * 60 * 24));
      expiresAt = professional.trialEndsAt;
    }

    // Load available plans (exclude GRATUIT)
    const plans = [TIERS.PRO, TIERS.ESSENTIEL, TIERS.ELITE];

    return {
      tier,
      isPremium,
      isOnTrial,
      trialDaysLeft,
      expiresAt,
      plans,
    };
  }

  /**
   * POST /api/subscriptions/validate-promo — Validate promo code
   */
  async validatePromoForCheckout(code, tier, professionalId) {
    if (!code) {
      const err = new Error('Code requis');
      err.status = 400;
      throw err;
    }

    // Fetch promo code (case-insensitive)
    const promoCode = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!promoCode) {
      const err = new Error('Code invalide');
      err.status = 400;
      throw err;
    }

    // Check active
    if (!promoCode.active) {
      const err = new Error('Code désactivé');
      err.status = 400;
      throw err;
    }

    // Check expiration
    if (promoCode.validUntil && new Date() > promoCode.validUntil) {
      const err = new Error('Code expiré');
      err.status = 400;
      throw err;
    }

    // Check max uses
    if (promoCode.maxUses && promoCode.usedCount >= promoCode.maxUses) {
      const err = new Error('Code limite atteinte');
      err.status = 400;
      throw err;
    }

    // Check user hasn't used this code
    const alreadyUsed = await this.prisma.promoUsage.findUnique({
      where: { professionalId_promoCodeId: { professionalId, promoCodeId: promoCode.id } },
    });

    if (alreadyUsed) {
      const err = new Error('Code déjà utilisé par cet utilisateur');
      err.status = 400;
      throw err;
    }

    // Check tier applicability
    if (promoCode.applicableTiers && promoCode.applicableTiers.length > 0) {
      if (!promoCode.applicableTiers.includes(tier)) {
        const err = new Error('Code non applicable à ce tier');
        err.status = 400;
        throw err;
      }
    }

    // Get tier pricing
    const tierConfig = TIERS[tier];
    const originalAmount = tierConfig.price;

    // Calculate discount
    let discountAmount = 0;
    if (promoCode.discountType === 'PERCENT') {
      discountAmount = Math.floor(originalAmount * (promoCode.discountValue / 100));
    } else if (promoCode.discountType === 'FIXED') {
      discountAmount = promoCode.discountValue;
    }

    const finalAmount = Math.max(0, originalAmount - discountAmount);

    return {
      valid: true,
      code: promoCode.code,
      discountType: promoCode.discountType,
      discountValue: promoCode.discountValue,
      discountAmount,
      originalAmount,
      finalAmount,
    };
  }

  /**
   * POST /api/subscriptions/checkout — Create subscription and initiate payment
   */
  async createCheckout(tier, promoCode, professional) {
    if (!['PRO', 'ESSENTIEL', 'ELITE'].includes(tier)) {
      const err = new Error('Tier invalide');
      err.status = 400;
      throw err;
    }

    const tierConfig = TIERS[tier];
    let amount = tierConfig.price;
    let promoCodeId = null;
    let discountAmount = 0;

    // Validate and apply promo if provided
    if (promoCode) {
      try {
        const validation = await this.validatePromoForCheckout(promoCode, tier, professional.id);
        amount = validation.finalAmount;
        promoCodeId = (await this.prisma.promoCode.findUnique({
          where: { code: promoCode.toUpperCase() },
        })).id;
        discountAmount = validation.discountAmount;
      } catch (err) {
        // Promo validation failed - proceed without promo
        promoCodeId = null;
        discountAmount = 0;
        amount = tierConfig.price;
      }
    }

    // Special case: free tier
    if (amount === 0) {
      // Activate subscription immediately
      const subscription = await this.prisma.subscription.upsert({
        where: { professionalId: professional.id },
        create: {
          professionalId: professional.id,
          tier,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          autoRenew: true,
        },
        update: {
          tier,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          autoRenew: true,
        },
      });

      return {
        activated: true,
        tier,
        amount: 0,
        message: 'Abonnement activé sans frais',
      };
    }

    // Create subscription in PENDING_PAYMENT
    const subscription = await this.prisma.subscription.upsert({
      where: { professionalId: professional.id },
      create: {
        professionalId: professional.id,
        tier,
        status: 'PENDING_PAYMENT',
        expiresAt: null,
        autoRenew: true,
        metadata: promoCodeId ? { promoCodeId } : {},
      },
      update: {
        tier,
        status: 'PENDING_PAYMENT',
        expiresAt: null,
        metadata: promoCodeId ? { promoCodeId } : {},
      },
    });

    // Call GeniusPay
    const payment = await geniuspay.createPayment({
      amount,
      reference: subscription.id,
      description: `Abonnement ${tier}`,
      customer: {
        email: professional.user.email,
        firstName: professional.user.firstName,
        lastName: professional.user.lastName,
        phone: professional.user.phone,
      },
    });

    if (!payment || !payment.checkout_url) {
      const err = new Error('Impossible de créer le paiement');
      err.status = 500;
      throw err;
    }

    return {
      paymentUrl: payment.checkout_url,
      reference: payment.reference,
      tier,
      amount,
      appliedPromoCode: promoCode || null,
      discountAmount: discountAmount || null,
    };
  }
}

module.exports = SubscriptionModule;
