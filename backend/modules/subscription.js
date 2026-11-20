'use strict';

const appConfig = require('../utils/appConfig');
const geniuspay = require('../utils/geniuspay');
const { v4: uuidv4 } = require('uuid');
const { computeExpiresAt } = require('../utils/subscriptionBilling');

// Canonical pricing — Sujet Redmi V1.0
// Monthly: ESSENTIEL=2500, PRO=5000, ELITE=10000 XOF
// Yearly:  ESSENTIEL=25000, PRO=50000, ELITE=100000 XOF (2 months free vs 12×monthly)
// Server-side only — never trust the amount sent by the client.
const TIER_PRICING = {
  ESSENTIEL: { MONTHLY: 2500,  YEARLY: 25000  },
  PRO:       { MONTHLY: 5000,  YEARLY: 50000  },
  ELITE:     { MONTHLY: 10000, YEARLY: 100000 },
};

const TIERS = {
  GRATUIT:   { key: 'GRATUIT',   name: 'Gratuit',   monthlyPrice: 0,     yearlyPrice: 0,      features: [] },
  ESSENTIEL: { key: 'ESSENTIEL', name: 'Essentiel', monthlyPrice: 2500,  yearlyPrice: 25000,  features: ['Feature 1', 'Feature 2', 'Feature 3'] },
  PRO:       { key: 'PRO',       name: 'Pro',        monthlyPrice: 5000,  yearlyPrice: 50000,  features: ['Feature 1', 'Feature 2'] },
  ELITE:     { key: 'ELITE',     name: 'Elite',      monthlyPrice: 10000, yearlyPrice: 100000, features: ['Feature 1', 'Feature 2', 'Feature 3', 'Feature 4'] },
};

function getCanonicalPrice(tier, billingCycle) {
  const pricing = TIER_PRICING[tier];
  if (!pricing) return null;
  return pricing[billingCycle] ?? null;
}

class SubscriptionModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

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
    let isInGracePeriod = false;
    let gracePeriodEndsAt = null;

    const sub = professional.subscription;
    const now = new Date();

    if (professional.trialEndsAt && now < professional.trialEndsAt) {
      tier = 'PRO';
      isPremium = true;
      isOnTrial = true;
      trialDaysLeft = Math.ceil((professional.trialEndsAt - now) / (1000 * 60 * 60 * 24));
      expiresAt = professional.trialEndsAt;
    } else if (sub && sub.status === 'ACTIVE' && sub.expiresAt && now < sub.expiresAt) {
      tier = sub.tier;
      isPremium = true;
      expiresAt = sub.expiresAt;
    } else if (sub && sub.status === 'GRACE_PERIOD' && sub.gracePeriodEndsAt && now < sub.gracePeriodEndsAt) {
      tier = sub.tier;
      isPremium = true;
      isInGracePeriod = true;
      gracePeriodEndsAt = sub.gracePeriodEndsAt;
      expiresAt = sub.gracePeriodEndsAt;
    }

    const plans = [TIERS.PRO, TIERS.ESSENTIEL, TIERS.ELITE];

    return {
      tier,
      isPremium,
      isOnTrial,
      trialDaysLeft,
      expiresAt,
      isInGracePeriod,
      gracePeriodEndsAt,
      plans,
    };
  }

  async validatePromoForCheckout(code, tier, professionalId, billingCycle = 'MONTHLY') {
    if (!code) {
      const err = new Error('Code requis');
      err.status = 400;
      throw err;
    }

    const promoCode = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!promoCode) {
      const err = new Error('Code invalide');
      err.status = 400;
      throw err;
    }

    if (!promoCode.active) {
      const err = new Error('Code désactivé');
      err.status = 400;
      throw err;
    }

    if (promoCode.validUntil && new Date() > promoCode.validUntil) {
      const err = new Error('Code expiré');
      err.status = 400;
      throw err;
    }

    if (promoCode.maxUses && promoCode.usedCount >= promoCode.maxUses) {
      const err = new Error('Code limite atteinte');
      err.status = 400;
      throw err;
    }

    const alreadyUsed = await this.prisma.promoUsage.findUnique({
      where: { professionalId_promoCodeId: { professionalId, promoCodeId: promoCode.id } },
    });

    if (alreadyUsed) {
      const err = new Error('Code déjà utilisé par cet utilisateur');
      err.status = 400;
      throw err;
    }

    if (promoCode.applicableTiers && promoCode.applicableTiers.length > 0) {
      if (!promoCode.applicableTiers.includes(tier)) {
        const err = new Error('Code non applicable à ce tier');
        err.status = 400;
        throw err;
      }
    }

    const originalAmount = getCanonicalPrice(tier, billingCycle) ?? 0;

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
   * POST /api/subscriptions/checkout
   *
   * Creates a SubscriptionPaymentAttempt for each checkout request.
   * Multiple attempts can coexist for the same subscription — no reference is ever
   * overwritten. Webhooks and the reconciliation cron look up attempts by geniuspayRef.
   *
   * Idempotency: same (professionalId, tier, billingCycle, day) reuses the existing
   * attempt if it is still CREATED or PENDING — prevents double-creation on rapid retries.
   */
  async createCheckout(tier, promoCode, professional, billingCycle = 'MONTHLY') {
    if (!['PRO', 'ESSENTIEL', 'ELITE'].includes(tier)) {
      const err = new Error('Tier invalide');
      err.status = 400;
      throw err;
    }

    if (!['MONTHLY', 'YEARLY'].includes(billingCycle)) {
      const err = new Error('Cycle de facturation invalide');
      err.status = 400;
      throw err;
    }

    const canonicalPrice = getCanonicalPrice(tier, billingCycle);
    if (canonicalPrice === null) {
      const err = new Error('Prix non défini pour ce tier/cycle');
      err.status = 400;
      throw err;
    }

    let amount = canonicalPrice;
    let promoCodeId = null;
    let discountAmount = 0;

    if (promoCode) {
      try {
        const validation = await this.validatePromoForCheckout(promoCode, tier, professional.id, billingCycle);
        amount = validation.finalAmount;
        const pc = await this.prisma.promoCode.findUnique({ where: { code: promoCode.toUpperCase() } });
        promoCodeId = pc?.id || null;
        discountAmount = validation.discountAmount;
      } catch (_) {
        promoCodeId = null;
        discountAmount = 0;
        amount = canonicalPrice;
      }
    }

    // Free-tier promo: activate immediately, no payment needed, no attempt created
    if (amount === 0) {
      const freeExpiresAt = billingCycle === 'YEARLY'
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await this.prisma.subscription.upsert({
        where: { professionalId: professional.id },
        create: {
          professionalId: professional.id,
          tier,
          billingCycle,
          amount: 0,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: freeExpiresAt,
          gracePeriodEndsAt: null,
        },
        update: {
          tier,
          billingCycle,
          amount: 0,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: freeExpiresAt,
          gracePeriodEndsAt: null,
          geniuspayRef: null,
        },
      });

      return {
        activated: true,
        tier,
        billingCycle,
        finalAmount: 0,
        message: 'Abonnement activé sans frais',
      };
    }

    // Deferred billing: if the professional is in a free trial, billing starts the day after.
    let scheduledStartAt = null;
    if (professional.trialEndsAt && new Date(professional.trialEndsAt) > new Date()) {
      const dayAfterTrial = new Date(professional.trialEndsAt);
      dayAfterTrial.setDate(dayAfterTrial.getDate() + 1);
      dayAfterTrial.setHours(0, 0, 0, 0);
      scheduledStartAt = dayAfterTrial;
    }

    // Idempotency key: one attempt per (professional, tier, cycle, day).
    const today = new Date().toISOString().slice(0, 10);
    const baseKey = `sub-checkout-${professional.id}-${tier}-${billingCycle}-${today}`;

    // Statuts terminaux : une tentative dans cet état ne doit PAS être recyclée.
    // Un retry légitime (ex : paiement échoué aujourd'hui) doit créer une NOUVELLE tentative.
    const TERMINAL_STATUSES = ['FAILED', 'CANCELLED', 'EXPIRED', 'REVIEW_REQUIRED'];

    // Idempotency check: look up the base key first.
    const existingAttempt = await this.prisma.subscriptionPaymentAttempt.findUnique({
      where: { idempotencyKey: baseKey },
      include: { subscription: true },
    });

    // Determine the effective idempotency key for the new (or reused) attempt.
    let idempotencyKey = baseKey;

    if (existingAttempt && (existingAttempt.status === 'CREATED' || existingAttempt.status === 'PENDING')) {
      // Safe to reuse: open attempt, same checkout session.
      if (existingAttempt.geniuspayRef) {
        return {
          paymentUrl: null,
          reference: existingAttempt.geniuspayRef,
          attemptId: existingAttempt.id,
          tier,
          amount: existingAttempt.expectedAmount,
          billingCycle,
          appliedPromoCode: promoCode || null,
          discountAmount: discountAmount || null,
          scheduledStartAt,
          idempotent: true,
        };
      }
      // No geniuspayRef yet — fall through to call GeniusPay using the same key.
    } else if (existingAttempt && TERMINAL_STATUSES.includes(existingAttempt.status)) {
      // Terminal attempt exists for today's base key — the user is retrying after a failure.
      // Build a unique suffix from the count of existing attempts that share the base key prefix.
      const countToday = await this.prisma.subscriptionPaymentAttempt.count({
        where: {
          subscriptionId: existingAttempt.subscriptionId,
          idempotencyKey: { startsWith: baseKey },
        },
      });
      idempotencyKey = `${baseKey}-r${countToday}`;
    }
    // If existingAttempt is null, idempotencyKey stays as baseKey (first attempt today).

    // Ensure the Subscription row exists (upsert without changing its current status/expiresAt
    // if already ACTIVE — do not revoke paid benefits during a renewal checkout).
    const existingSub = await this.prisma.subscription.findUnique({
      where: { professionalId: professional.id },
      select: { id: true, status: true, expiresAt: true, tier: true, billingCycle: true },
    });

    const isCurrentlyActive = existingSub
      && existingSub.status === 'ACTIVE'
      && existingSub.expiresAt
      && new Date(existingSub.expiresAt) > new Date();

    const subscription = await this.prisma.subscription.upsert({
      where: { professionalId: professional.id },
      create: {
        professionalId: professional.id,
        tier,
        billingCycle,
        amount,
        status: 'PENDING_PAYMENT',
        expiresAt: null,
        scheduledStartAt,
        gracePeriodEndsAt: null,
      },
      update: {
        tier,
        billingCycle,
        amount,
        scheduledStartAt,
        ...(isCurrentlyActive ? {} : {
          status: 'PENDING_PAYMENT',
          expiresAt: null,
          gracePeriodEndsAt: null,
        }),
        // geniuspayRef on Subscription is now only a convenience copy of the latest attempt ref.
        // It is set after GeniusPay responds, not here.
      },
    });

    // Calculate the billing period covered by this payment attempt.
    // periodStartAt rules:
    //   • deferred (trial active)   → scheduledStartAt
    //   • upgrade to higher tier    → now (immediate activation, new period starts now)
    //   • renewal / downgrade /
    //     cycle change (sub ACTIVE) → expiresAt (next period starts where current ends)
    //   • new subscription          → now
    const TIER_RANK = { GRATUIT: 0, ESSENTIEL: 1, PRO: 2, ELITE: 3 };
    const now = new Date();
    const isUpgrade = isCurrentlyActive
      && (TIER_RANK[tier] ?? 0) > (TIER_RANK[existingSub.tier] ?? 0);
    const periodStartAt = scheduledStartAt
      ? scheduledStartAt
      : (isUpgrade
          ? now
          : (isCurrentlyActive && existingSub.expiresAt ? new Date(existingSub.expiresAt) : now));
    const periodEndAt = computeExpiresAt(periodStartAt, billingCycle);

    // Create the payment attempt record BEFORE calling GeniusPay.
    // If GeniusPay fails, the attempt stays CREATED and can be resumed.
    // NOTE: we always create a fresh attempt here — the idempotencyKey above is either:
    //   • baseKey        (first attempt today, or reuse of open attempt — but that returns early above)
    //   • baseKey-r{n}   (retry after a terminal attempt)
    // The `existingAttempt || create()` pattern was removed to prevent recycling terminal attempts.
    let attempt;
    if (existingAttempt && (existingAttempt.status === 'CREATED' || existingAttempt.status === 'PENDING') && !existingAttempt.geniuspayRef) {
      // Reuse the open attempt that has no ref yet (geniuspayRef is null — GeniusPay not yet called)
      attempt = existingAttempt;
    } else {
      attempt = await this.prisma.subscriptionPaymentAttempt.create({
        data: {
          id: uuidv4(),
          subscriptionId: subscription.id,
          idempotencyKey,
          provider: 'geniuspay',
          tier,
          billingCycle,
          expectedAmount: amount,
          status: 'CREATED',
          scheduledStartAt,
          periodStartAt,
          periodEndAt,
        },
      });
    }

    // Call GeniusPay
    let payment;
    try {
      payment = await geniuspay.createPayment({
        amount,
        description: `Abonnement ${tier} ${billingCycle === 'YEARLY' ? 'annuel' : 'mensuel'} — MANAWA`,
        customerName: `${professional.user.firstName} ${professional.user.lastName}`,
        customerEmail: professional.user.email,
        customerPhone: professional.user.phone || '',
        idempotencyKey,
        metadata: {
          subscriptionId: subscription.id,
          attemptId: attempt.id,
          professionalId: professional.id,
          tier,
          billingCycle,
        },
      });
    } catch (gpErr) {
      // GeniusPay unreachable — mark attempt as CREATED (not FAILED) so reconciliation can retry
      await this.prisma.subscriptionPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'CREATED', providerData: JSON.stringify({ error: gpErr.message }) },
      });
      const err = new Error('Impossible de créer le paiement');
      err.status = 500;
      throw err;
    }

    if (!payment || !payment.checkout_url) {
      await this.prisma.subscriptionPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'CREATED', providerData: JSON.stringify({ error: 'No checkout_url returned' }) },
      });
      const err = new Error('Impossible de créer le paiement');
      err.status = 500;
      throw err;
    }

    // Store the GeniusPay reference on the attempt and update the subscription's convenience ref
    await this.prisma.subscriptionPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        geniuspayRef: payment.reference,
        status: 'PENDING',
      },
    });

    // Keep Subscription.geniuspayRef updated to the latest pending attempt for backward compat
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { geniuspayRef: payment.reference },
    });

    return {
      paymentUrl: payment.checkout_url,
      reference: payment.reference,
      attemptId: attempt.id,
      tier,
      amount,
      billingCycle,
      appliedPromoCode: promoCode || null,
      discountAmount: discountAmount || null,
      scheduledStartAt,
    };
  }
}

module.exports = SubscriptionModule;
module.exports.TIER_PRICING = TIER_PRICING;
module.exports.getCanonicalPrice = getCanonicalPrice;
