const geniuspay = require('../utils/geniuspay');

const MAX_RETRY_ATTEMPTS = 3;

class PaymentRetryModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Validate that user owns the payment
   */
  async validatePaymentOwnership(payment, userId) {
    const quote = payment.quote || (await this.prisma.quote.findUnique({
      where: { id: payment.quoteId },
      include: { professional: true, project: true },
    }));

    const clientId = quote.project.clientId;
    const professionalId = quote.professional.userId;

    if (userId !== clientId && userId !== professionalId) {
      const err = new Error('Accès refusé');
      err.status = 403;
      throw err;
    }
  }

  /**
   * Check if payment can be retried
   */
  async canRetryPayment(payment) {
    if (payment.status !== 'failed') {
      const err = new Error('Payment ne peut pas être réessayé (not in failed state)');
      err.status = 400;
      throw err;
    }
  }

  /**
   * Count retry attempts from audit logs
   */
  async countRetryAttempts(paymentId) {
    const retries = await this.prisma.paymentAuditLog.findMany({
      where: { paymentId, reason: 'retry' },
    });

    return retries.length;
  }

  /**
   * Reapply promo code if applicable
   */
  async reapplyPromoCode(payment, professional) {
    let promoCodeId = null;

    if (payment.metadata && payment.metadata.promoCodeId) {
      const promoCode = await this.prisma.promoCode.findUnique({
        where: { id: payment.metadata.promoCodeId },
      });

      // Check if promo is still valid
      if (promoCode && promoCode.active && (!promoCode.validUntil || new Date() <= promoCode.validUntil)) {
        promoCodeId = promoCode.id;
      }
    }

    return promoCodeId;
  }

  /**
   * POST /:paymentId/retry — Retry failed payment
   */
  async retryPayment(paymentId, userId) {
    // Fetch payment
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        quote: {
          include: {
            professional: true,
            project: true,
          },
        },
      },
    });

    if (!payment) {
      const err = new Error('Payment introuvable');
      err.status = 404;
      throw err;
    }

    // Check ownership
    await this.validatePaymentOwnership(payment, userId);

    // Check status
    await this.canRetryPayment(payment);

    // Check retry count
    const retryCount = await this.countRetryAttempts(paymentId);
    if (retryCount >= MAX_RETRY_ATTEMPTS) {
      const err = new Error('Maximum de tentatives atteint (3)');
      err.status = 400;
      throw err;
    }

    // Reapply promo
    const promoCodeId = await this.reapplyPromoCode(payment, payment.quote.professional);

    let amount = payment.amount;
    let discountAmount = 0;

    // Recalculate if promo reapplied
    if (promoCodeId) {
      const promo = await this.prisma.promoCode.findUnique({ where: { id: promoCodeId } });
      if (promo.discountType === 'PERCENT') {
        discountAmount = Math.floor(payment.amount * (promo.discountValue / 100));
      } else {
        discountAmount = promo.discountValue;
      }
      amount = Math.max(0, payment.amount - discountAmount);
    }

    // Call GeniusPay
    const geniusPayResponse = await geniuspay.createPayment({
      amount,
      reference: paymentId,
      description: `Retry payment ${paymentId}`,
      customer: {
        email: payment.quote.professional.user.email,
        firstName: payment.quote.professional.user.firstName,
        lastName: payment.quote.professional.user.lastName,
      },
    });

    if (!geniusPayResponse || !geniusPayResponse.reference) {
      const err = new Error('Impossible de réessayer le paiement');
      err.status = 500;
      throw err;
    }

    // Update payment
    const updatedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'pending',
        geniuspayRef: geniusPayResponse.reference,
        amount,
        metadata: promoCodeId ? { ...payment.metadata, promoCodeId } : payment.metadata,
      },
    });

    // Log retry attempt
    await this.prisma.paymentAuditLog.create({
      data: {
        paymentId,
        action: 'retry',
        reason: 'retry',
        details: `Retry attempt ${retryCount + 1}`,
      },
    });

    return {
      success: true,
      data: {
        id: updatedPayment.id,
        status: updatedPayment.status,
        geniuspayRef: updatedPayment.geniuspayRef,
        amount: updatedPayment.amount,
        retryAttempt: retryCount + 1,
        appliedPromoCode: promoCodeId ? true : null,
        discountAmount: discountAmount || null,
      },
    };
  }
}

module.exports = PaymentRetryModule;
