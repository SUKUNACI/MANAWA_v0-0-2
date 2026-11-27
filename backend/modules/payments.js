'use strict';

const logger = require('../utils/logger');
const geniuspay = require('../utils/geniuspay');
const PAYMENT_STATUSES = require('../config/payment-status');

/**
 * Payments Module — Centralized payment processing via GeniusPay
 * Handles payment creation, webhook handling, and refunds
 */

class PaymentsModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Get all valid payment statuses
   * @returns {object}
   */
  getStatuses() {
    return PAYMENT_STATUSES;
  }

  /**
   * Create a payment intent for a booking
   * @param {object} opts - { bookingId, amount, currency, description }
   * @returns {Promise<object>}
   */
  async createPaymentIntent({ bookingId, amount, currency = 'EUR', description }) {
    try {
      // Verify booking exists
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, clientId: true },
      });

      if (!booking) {
        throw new Error('Booking not found');
      }

      // Create payment record in PENDING state
      const payment = await this.prisma.payment.create({
        data: {
          bookingId,
          amount,
          currency,
          status: PAYMENT_STATUSES.PENDING,
          description,
        },
      });

      logger.info('[PaymentsModule] Payment intent created', { paymentId: payment.id, bookingId, amount });
      return payment;
    } catch (err) {
      logger.error('[PaymentsModule] createPaymentIntent failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Process payment (mock or Stripe)
   * @param {string} paymentId - Payment ID
   * @param {object} opts - { stripeToken, metadata }
   * @returns {Promise<object>}
   */
  async processPayment(paymentId, { stripeToken, metadata = {} } = {}) {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      // All payments processed via GeniusPay webhooks
      // This method is kept for backward compatibility but no longer processes direct payments
      const updated = await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PAYMENT_STATUSES.COMPLETED,
          completedAt: new Date(),
        },
      });

      logger.info('[PaymentsModule] Payment processed (mock mode)', { paymentId });
      return updated;
    } catch (err) {
      logger.error('[PaymentsModule] processPayment failed', { paymentId, error: err.message });
      throw err;
    }
  }

  /**
   * Refund a payment
   * @param {string} paymentId - Payment ID
   * @param {object} opts - { reason, metadata }
   * @returns {Promise<object>}
   */
  async refundPayment(paymentId, { reason, metadata = {} } = {}) {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status !== PAYMENT_STATUSES.SUCCEEDED) {
        throw new Error('Only succeeded payments can be refunded');
      }

      if (!payment.geniuspayRef) {
        throw new Error('Payment has no GeniusPay reference for refund');
      }

      // Process refund via GeniusPay
      try {
        await geniuspay.refundPayment(payment.geniuspayRef, payment.amount, reason);
        logger.info('[PaymentsModule] GeniusPay refund initiated', {
          paymentId,
          geniuspayRef: payment.geniuspayRef,
          amount: payment.amount,
          reason,
        });
      } catch (gpayErr) {
        logger.error('[PaymentsModule] GeniusPay refund failed', {
          paymentId,
          geniuspayRef: payment.geniuspayRef,
          error: gpayErr.message,
        });
        throw gpayErr;
      }

      // Update payment status after successful refund
      const updated = await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PAYMENT_STATUSES.REFUNDED,
          refundReason: reason,
          refundedAt: new Date(),
        },
      });

      logger.info('[PaymentsModule] Payment refunded', { paymentId, reason });
      return updated;
    } catch (err) {
      logger.error('[PaymentsModule] refundPayment failed', { paymentId, error: err.message });
      throw err;
    }
  }

  /**
   * Get payment details
   * @param {string} paymentId - Payment ID
   * @returns {Promise<object>}
   */
  async getDetails(paymentId) {
    try {
      return await this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: { booking: true },
      });
    } catch (err) {
      logger.error('[PaymentsModule] getDetails failed', { paymentId, error: err.message });
      throw err;
    }
  }

  /**
   * Get payment metrics for dashboard
   * @param {object} opts - { dateFrom, dateTo }
   * @returns {Promise<{totalAmount, completedCount, failedCount, refundedAmount}>}
   */
  async getMetrics({ dateFrom, dateTo } = {}) {
    try {
      let where = {};
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) where.createdAt.lte = new Date(dateTo);
      }

      const [completed, failed, refunded] = await Promise.all([
        this.prisma.payment.aggregate({
          where: { ...where, status: PAYMENT_STATUSES.COMPLETED },
          _sum: { amount: true },
          _count: { id: true },
        }),
        this.prisma.payment.count({ where: { ...where, status: PAYMENT_STATUSES.FAILED } }),
        this.prisma.payment.aggregate({
          where: { ...where, status: PAYMENT_STATUSES.REFUNDED },
          _sum: { amount: true },
        }),
      ]);

      return {
        totalAmount: completed._sum.amount || 0,
        completedCount: completed._count.id,
        failedCount: failed,
        refundedAmount: refunded._sum.amount || 0,
      };
    } catch (err) {
      logger.warn('[PaymentsModule] getMetrics failed', { error: err.message });
      return { totalAmount: 0, completedCount: 0, failedCount: 0, refundedAmount: 0 };
    }
  }
}

module.exports = PaymentsModule;
