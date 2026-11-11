const prisma = require('../config/db');
const logger = require('../utils/logger');

/**
 * Process payment job processor
 * Handles payment confirmation and webhook events
 *
 * Job data shape:
 * {
 *   type: 'confirmation' | 'webhook' | 'refund',
 *   paymentId: string,
 *   transactionId?: string,
 *   amount?: number,
 *   status?: string,
 *   metadata?: object
 * }
 */
async function processPaymentJob(job) {
  const { type, paymentId, transactionId, amount, status, metadata } = job.data;

  if (!type || !paymentId) {
    throw new Error('Missing required fields: type, paymentId');
  }

  try {
    await job.progress(10);

    logger.debug('[processPaymentJob] Processing payment', {
      jobId: job.id,
      type,
      paymentId,
      status,
      metadata,
    });

    let result;

    switch (type) {
      case 'confirmation':
        result = await processPaymentConfirmation(job, paymentId, amount, transactionId);
        break;
      case 'webhook':
        result = await processPaymentWebhook(job, paymentId, status);
        break;
      case 'refund':
        result = await processPaymentRefund(job, paymentId);
        break;
      default:
        throw new Error(`Unsupported payment type: ${type}`);
    }

    await job.progress(100);

    return result;
  } catch (err) {
    logger.error('[processPaymentJob] Error processing payment', {
      jobId: job.id,
      type,
      paymentId,
      error: err.message,
      stack: err.stack,
      metadata,
    });

    throw err;
  }
}

/**
 * Process payment confirmation
 */
async function processPaymentConfirmation(job, paymentId, amount, transactionId) {
  await job.progress(30);

  try {
    // Fetch payment record
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: true,
        user: true,
      },
    });

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    // Verify amount matches
    if (amount && payment.amount !== amount) {
      throw new Error(`Amount mismatch: expected ${payment.amount}, got ${amount}`);
    }

    await job.progress(50);

    // Update payment status
    const updatedPayment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'CONFIRMED',
        transactionId: transactionId || payment.transactionId,
        confirmedAt: new Date(),
      },
    });

    await job.progress(75);

    // If booking exists, update its status
    if (payment.bookingId) {
      await prisma.booking.update({
        where: { id: payment.bookingId },
        data: {
          status: 'CONFIRMED',
        },
      });
    }

    logger.info('[processPaymentConfirmation] Payment confirmed', {
      jobId: job.id,
      paymentId,
      amount,
      transactionId,
    });

    return {
      success: true,
      jobId: job.id,
      paymentId,
      status: updatedPayment.status,
      confirmedAt: updatedPayment.confirmedAt,
    };
  } catch (err) {
    logger.error('[processPaymentConfirmation] Error:', err.message);
    throw err;
  }
}

/**
 * Process payment webhook
 */
async function processPaymentWebhook(job, paymentId, status) {
  await job.progress(30);

  try {
    // Validate status
    const validStatuses = ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid payment status: ${status}`);
    }

    // Fetch payment record
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        booking: true,
        user: true,
      },
    });

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    await job.progress(50);

    // Update payment status
    const updatedPayment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status,
        webhookReceivedAt: new Date(),
      },
    });

    await job.progress(75);

    // Handle based on new status
    if (status === 'FAILED') {
      logger.warn('[processPaymentWebhook] Payment failed', {
        jobId: job.id,
        paymentId,
      });
    } else if (status === 'REFUNDED') {
      logger.info('[processPaymentWebhook] Payment refunded', {
        jobId: job.id,
        paymentId,
      });
    }

    logger.info('[processPaymentWebhook] Webhook processed', {
      jobId: job.id,
      paymentId,
      status,
    });

    return {
      success: true,
      jobId: job.id,
      paymentId,
      status: updatedPayment.status,
      processedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('[processPaymentWebhook] Error:', err.message);
    throw err;
  }
}

/**
 * Process payment refund
 */
async function processPaymentRefund(job, paymentId) {
  await job.progress(30);

  try {
    // Fetch payment record
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    if (payment.status !== 'CONFIRMED') {
      throw new Error(`Cannot refund payment with status: ${payment.status}`);
    }

    await job.progress(50);

    // TODO: Call payment processor API to initiate refund
    // This is where you'd integrate with Stripe, PayPal, etc.

    await job.progress(75);

    // Update payment status
    const updatedPayment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
      },
    });

    logger.info('[processPaymentRefund] Payment refunded', {
      jobId: job.id,
      paymentId,
      amount: payment.amount,
    });

    return {
      success: true,
      jobId: job.id,
      paymentId,
      status: updatedPayment.status,
      refundedAt: updatedPayment.refundedAt,
    };
  } catch (err) {
    logger.error('[processPaymentRefund] Error:', err.message);
    throw err;
  }
}

/**
 * Helper to queue payment confirmation
 */
async function queuePaymentConfirmation(paymentQueue, paymentId, amount, transactionId) {
  return await paymentQueue.add(
    {
      type: 'confirmation',
      paymentId,
      amount,
      transactionId,
      metadata: {
        queuedAt: new Date().toISOString(),
      },
    },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

/**
 * Helper to queue payment webhook processing
 */
async function queuePaymentWebhook(paymentQueue, paymentId, status) {
  return await paymentQueue.add(
    {
      type: 'webhook',
      paymentId,
      status,
      metadata: {
        queuedAt: new Date().toISOString(),
      },
    },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

module.exports = {
  processPaymentJob,
  processPaymentConfirmation,
  processPaymentWebhook,
  processPaymentRefund,
  queuePaymentConfirmation,
  queuePaymentWebhook,
};
