'use strict';

/**
 * Canonical premium-active check used by route middleware.
 * Mirrors the logic in getActiveTier() from routes/subscriptions.js so that
 * this utility can be imported without going through that module's Jest mock.
 *
 * A subscription is considered active when:
 *   – the professional is within a free-trial window, OR
 *   – the subscription status is ACTIVE and expiresAt is a future date.
 */
function isPremiumActive(subscription, pro) {
  const trialActive = !!pro?.trialEndsAt && new Date(pro.trialEndsAt) > new Date();
  const paidActive =
    !!subscription &&
    subscription.status === 'ACTIVE' &&
    !!subscription.expiresAt &&
    new Date(subscription.expiresAt) > new Date();
  return trialActive || paidActive;
}

module.exports = { isPremiumActive };
