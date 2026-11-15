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
   * Count retry attempts from audit logs or payment metadata
   */
  async countRetryAttempts(payment) {
    if (!payment.auditLogs) {
      return 0;
    }
    return payment.auditLogs.filter(log => log.reason === 'retry').length;
  }

  /**
   * Reapply promo code if applicable
   */
  async reapplyPromoCode(payment, professional) {
    let promo = null;

    if (payment.metadata) {
      const metadata = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
      if (metadata.promoCodeId) {
        const promoCode = await this.prisma.promoCode.findUnique({
          where: { id: metadata.promoCodeId },
        });

        // Check if promo is still valid
        if (promoCode && promoCode.active && (!promoCode.validUntil || new Date() <= promoCode.validUntil)) {
          promo = promoCode;
        }
      }
    }

    return promo;
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
    const retryCount = await this.countRetryAttempts(payment);
    if (retryCount >= MAX_RETRY_ATTEMPTS) {
      const err = new Error('Maximum de tentatives atteint (3)');
      err.status = 400;
      throw err;
    }

    // Reapply promo
    const promo = await this.reapplyPromoCode(payment, payment.quote.professional);

    let amount = payment.amount;
    let discountAmount = 0;

    // Recalculate if promo reapplied
    if (promo) {
      if (promo.discountType === 'PERCENT') {
        discountAmount = Math.floor(payment.amount * (promo.discountValue / 100));
      } else {
        discountAmount = promo.discountValue;
      }
      amount = Math.max(0, payment.amount - discountAmount);
    }

    // Call GeniusPay
    let geniusPayResponse;
    try {
      geniusPayResponse = await geniuspay.createPayment({
        amount,
        reference: paymentId,
        description: `Retry payment ${paymentId}`,
        customer: {
          email: payment.quote.professional.user.email,
          firstName: payment.quote.professional.user.firstName,
          lastName: payment.quote.professional.user.lastName,
        },
      });
    } catch (err) {
      const error = new Error('Impossible de réessayer le paiement');
      error.status = 500;
      throw error;
    }

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
        metadata: promo ? { ...payment.metadata, promoCodeId: promo.id } : payment.metadata,
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
        appliedPromoCode: promo ? promo.code : null,
        discountAmount: discountAmount || null,
      },
    };
  }
}

module.exports = PaymentRetryModule;
