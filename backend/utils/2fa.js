/**
 * 2FA Utilities
 * Helpers for TOTP setup, verification, and backup code management
 */

const twoFAConfig = require('../config/2fa');
const logger = require('./logger');

/**
 * Setup 2FA for a user - returns secret and QR code
 * @param {string} email - User's email
 * @returns {Promise<object>} Secret, QR code, and backup codes
 */
async function setup2FA(email) {
  try {
    // Generate secret
    const { secret, otpauth_url } = await twoFAConfig.generateSecret(email);

    // Generate QR code
    const qrCode = await twoFAConfig.generateQRCode(otpauth_url);

    // Generate backup codes
    const backupCodes = twoFAConfig.generateBackupCodes();
    const hashedBackupCodes = twoFAConfig.hashBackupCodes(backupCodes);

    return {
      secret,
      qrCode,
      backupCodes,
      hashedBackupCodes,
      otpauth_url,
    };
  } catch (error) {
    logger.error('Error setting up 2FA', { error: error.message, email });
    throw error;
  }
}

/**
 * Verify TOTP token
 * @param {string} token - 6-digit TOTP token
 * @param {string} secret - Base32 encoded secret
 * @returns {boolean} True if token is valid
 */
function verify2FAToken(token, secret) {
  try {
    return twoFAConfig.verifyToken(token, secret);
  } catch (error) {
    logger.error('Error verifying 2FA token', { error: error.message });
    return false;
  }
}

/**
 * Verify backup code
 * @param {string} code - Backup code
 * @param {object} hashedBackupCodes - Stored hashed backup codes
 * @returns {boolean} True if backup code is valid and unused
 */
function verifyBackupCode(code, hashedBackupCodes) {
  try {
    return twoFAConfig.validateBackupCode(code, hashedBackupCodes);
  } catch (error) {
    logger.error('Error verifying backup code', { error: error.message });
    return false;
  }
}

/**
 * Use a backup code (mark as used)
 * @param {string} code - Backup code to use
 * @param {object} hashedBackupCodes - Stored hashed backup codes
 * @returns {object} Updated backup codes
 */
function useBackupCode(code, hashedBackupCodes) {
  try {
    return twoFAConfig.markBackupCodeUsed(code, hashedBackupCodes);
  } catch (error) {
    logger.error('Error using backup code', { error: error.message });
    throw error;
  }
}

/**
 * Get the count of remaining backup codes
 * @param {object} hashedBackupCodes - Stored hashed backup codes
 * @returns {number} Count of unused codes
 */
function getRemainingBackupCodes(hashedBackupCodes) {
  try {
    return twoFAConfig.getUnusedBackupCodesCount(hashedBackupCodes);
  } catch (error) {
    logger.error('Error getting backup codes count', { error: error.message });
    return 0;
  }
}

/**
 * Generate new backup codes (used during 2FA management)
 * @returns {Promise<object>} New backup codes and hashed version
 */
async function regenerateBackupCodes() {
  try {
    const backupCodes = twoFAConfig.generateBackupCodes();
    const hashedBackupCodes = twoFAConfig.hashBackupCodes(backupCodes);

    return {
      backupCodes,
      hashedBackupCodes,
    };
  } catch (error) {
    logger.error('Error regenerating backup codes', { error: error.message });
    throw error;
  }
}

module.exports = {
  setup2FA,
  verify2FAToken,
  verifyBackupCode,
  useBackupCode,
  getRemainingBackupCodes,
  regenerateBackupCodes,
};
