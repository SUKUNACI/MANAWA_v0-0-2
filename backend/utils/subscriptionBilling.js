'use strict';

/**
 * Shared billing date utilities for subscription payments.
 * Used by: modules/subscription.js, routes/webhooks-geniuspay.js, jobs/cron-jobs.js
 */

/**
 * Compute expiration date based on billing cycle from an activation base date.
 * Clamps to the last day of the target month to avoid JavaScript overflow
 * (e.g. Jan 31 + 1 month = March 2/3 without clamping).
 *
 * @param {Date|string} from  - Start date
 * @param {string} billingCycle - 'MONTHLY' or 'YEARLY'
 * @returns {Date}
 */
function computeExpiresAt(from, billingCycle) {
  const d = new Date(from);
  const originalDay = d.getDate();
  if (billingCycle === 'YEARLY') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  // If the day overflowed into the next month, step back to the last day of the target month
  if (d.getDate() !== originalDay) {
    d.setDate(0);
  }
  return d;
}

/**
 * Detect whether the billing period covered by `attempt` has already been paid by
 * another SUCCEEDED attempt on the same subscription.
 *
 * Uses period-overlap when periodStartAt/periodEndAt are present (new attempts).
 * Falls back to a 1-hour proximity check for legacy attempts without period data.
 *
 * Returns true  → duplicate payment detected (block the activation).
 * Returns false → no overlap found (legitimate payment or renewal).
 *
 * @param {object} prisma  - Prisma client (or transaction client)
 * @param {object} attempt - SubscriptionPaymentAttempt row (must include .id, .subscriptionId,
 *                           .createdAt, and optionally .periodStartAt / .periodEndAt)
 * @returns {Promise<boolean>}
 */
async function isPeriodAlreadyPaid(prisma, attempt) {
  if (!attempt.periodStartAt || !attempt.periodEndAt) {
    // Legacy path: no period data stored on the attempt.
    // Treat as a duplicate only if another SUCCEEDED attempt was confirmed within 1 hour of
    // this attempt's creation — that window catches same-session double-submissions while
    // leaving renewals (confirmed days or weeks apart) untouched.
    const otherSucceeded = await prisma.subscriptionPaymentAttempt.findFirst({
      where: {
        subscriptionId: attempt.subscriptionId,
        id: { not: attempt.id },
        status: 'SUCCEEDED',
      },
    });
    if (!otherSucceeded) return false;
    if (otherSucceeded.confirmedAt && attempt.createdAt) {
      const diffMs = Math.abs(
        new Date(otherSucceeded.confirmedAt).getTime() - new Date(attempt.createdAt).getTime(),
      );
      return diffMs < 60 * 60 * 1000; // < 1 h → probable same-session duplicate
    }
    return false;
  }

  // Precise overlap check: does any other SUCCEEDED attempt cover the same period?
  // Two periods overlap when: startA < endB AND endA > startB
  const overlapping = await prisma.subscriptionPaymentAttempt.findFirst({
    where: {
      subscriptionId: attempt.subscriptionId,
      id: { not: attempt.id },
      status: 'SUCCEEDED',
      periodStartAt: { lt: new Date(attempt.periodEndAt) },
      periodEndAt:   { gt: new Date(attempt.periodStartAt) },
    },
  });
  return overlapping !== null;
}

module.exports = { computeExpiresAt, isPeriodAlreadyPaid };
