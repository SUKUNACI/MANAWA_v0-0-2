'use strict';

const logger = require('../utils/logger');

/**
 * Payments Module — Centralized payment processing and Stripe integration
 * Handles payment creation, webhook handling, and refunds
 */

const PAYMENT_STATUSES = {
  PENDING: 'PENDING',           // Awaiting payment
  PROCESSING: 'PROCESSING',     // Payment in progress
  COMPLETED: 'COMPLETED',       // Payment successful
  FAILED: 'FAILED',             // Payment failed
  REFUNDED: 'REFUNDED',         // Payment refunded
};

class PaymentsModule {
  constructor(prisma, stripe = null) {
    this.prisma = prisma;
    this.stripe = stripe; // Optional Stripe client
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

      // Update to PROCESSING
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.PROCESSING },
      });

      // If Stripe client available, process real payment
      if (this.stripe && stripeToken) {
        try {
          const intent = await this.stripe.paymentIntents.create({
            amount: Math.round(payment.amount * 100), // Convert to cents
            currency: payment.currency.toLowerCase(),
            source: stripeToken,
            metadata: { paymentId, ...metadata },
            description: payment.description,
          });

          // Mark as COMPLETED
          const updated = await this.prisma.payment.update({
            where: { id: paymentId },
            data: {
              status: PAYMENT_STATUSES.COMPLETED,
              stripePaymentIntentId: intent.id,
              completedAt: new Date(),
            },
          });

          logger.info('[PaymentsModule] Payment processed', { paymentId, stripeIntentId: intent.id });
          return updated;
        } catch (stripeErr) {
          // Mark as FAILED if Stripe rejects
          await this.prisma.payment.update({
            where: { id: paymentId },
            data: {
              status: PAYMENT_STATUSES.FAILED,
              errorMessage: stripeErr.message,
            },
          });
          throw stripeErr;
        }
      }

      // Mock mode: auto-complete (for testing)
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

      if (payment.status !== PAYMENT_STATUSES.COMPLETED) {
        throw new Error('Only completed payments can be refunded');
      }

      // If Stripe integration available, process refund
      if (this.stripe && payment.stripePaymentIntentId) {
        try {
          await this.stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            metadata: { refundReason: reason, ...metadata },
          });
        } catch (stripeErr) {
          logger.error('[PaymentsModule] Stripe refund failed', { paymentId, error: stripeErr.message });
          throw stripeErr;
        }
      }

      // Update payment status
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
   * Handle Stripe webhook event
   * @param {object} event - Stripe webhook event
   * @returns {Promise<object>}
   */
  async handleStripeWebhook(event) {
    try {
      const { type, data } = event;

      switch (type) {
        case 'payment_intent.succeeded': {
          const { id: stripeIntentId } = data.object;
          await this.prisma.payment.updateMany({
            where: { stripePaymentIntentId: stripeIntentId },
            data: { status: PAYMENT_STATUSES.COMPLETED, completedAt: new Date() },
          });
          logger.info('[PaymentsModule] Webhook: payment succeeded', { stripeIntentId });
          break;
        }

        case 'payment_intent.payment_failed': {
          const { id: stripeIntentId, last_payment_error } = data.object;
          await this.prisma.payment.updateMany({
            where: { stripePaymentIntentId: stripeIntentId },
            data: {
              status: PAYMENT_STATUSES.FAILED,
              errorMessage: last_payment_error?.message,
            },
          });
          logger.warn('[PaymentsModule] Webhook: payment failed', { stripeIntentId });
          break;
        }

        case 'charge.refunded': {
          const { payment_intent: stripeIntentId } = data.object;
          await this.prisma.payment.updateMany({
            where: { stripePaymentIntentId: stripeIntentId },
            data: { status: PAYMENT_STATUSES.REFUNDED, refundedAt: new Date() },
          });
          logger.info('[PaymentsModule] Webhook: charge refunded', { stripeIntentId });
          break;
        }

        default:
          logger.debug('[PaymentsModule] Unhandled webhook event', { type });
      }

      return { success: true, event: type };
    } catch (err) {
      logger.error('[PaymentsModule] handleStripeWebhook failed', { error: err.message });
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
