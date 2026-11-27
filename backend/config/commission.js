/**
 * Commission Rate Configuration
 *
 * Centralized commission rate used across the system.
 * Default: 8% (0.08) per business rules.
 *
 * Used by:
 * - modules/admin.js (revenue calculations)
 * - modules/analyticsAdvanced.js (commission analytics)
 * - config/tax.js (tax calculations)
 */

const DEFAULT_COMMISSION_RATE = 0.08;

/**
 * Get commission rate from app config or return default
 * @param {object} appConfig - AppConfig instance with getConfig method
 * @returns {number} Commission rate (0.08 by default)
 */
async function getCommissionRate(appConfig) {
  if (!appConfig) {
    return DEFAULT_COMMISSION_RATE;
  }

  try {
    const configuredRate = await appConfig.getConfig('commission_rate');
    if (configuredRate && typeof configuredRate === 'number') {
      return configuredRate;
    }
  } catch (err) {
    // Fall back to default if config lookup fails
  }

  return DEFAULT_COMMISSION_RATE;
}

module.exports = {
  DEFAULT_COMMISSION_RATE,
  getCommissionRate,
};
