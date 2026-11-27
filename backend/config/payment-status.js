/**
 * Payment Status Constants
 *
 * Centralized payment status definitions used across the system.
 * Aligns with GeniusPay webhook events (payment.success, payment.failed, etc.)
 *
 * Used by:
 * - modules/payments.js (refund checks, status updates)
 * - modules/finance.js (revenue filters)
 * - routes/payments.js (status validation)
 * - routes/webhooks-geniuspay.js (webhook event handling)
 */

const PAYMENT_STATUSES = {
  PENDING: 'pending',           // Payment created, awaiting GeniusPay processing
  SUCCEEDED: 'succeeded',       // GeniusPay payment.success webhook received
  FAILED: 'failed',             // GeniusPay payment.failed webhook received
  CANCELLED: 'cancelled',       // GeniusPay payment.cancelled webhook received
  EXPIRED: 'expired',           // GeniusPay payment.expired webhook received
  REFUNDED: 'refunded',         // Payment refunded via GeniusPay API
  COMPLETED: 'succeeded',       // Alias for succeeded (backward compatibility)
};

module.exports = PAYMENT_STATUSES;
