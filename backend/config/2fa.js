/**
 * 2FA (TOTP) Configuration
 * Handles Time-based One-Time Password (TOTP) setup and validation
 */

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

/**
 * TOTP Configuration constants
 */
const TOTP_CONFIG = {
  name: 'MANAWA',
  issuer: 'MANAWA',
  encoding: 'base32',
  window: 1, // Allow 30 seconds before/after current time
  timeStep: 30, // Standard TOTP time step (30 seconds)
};

/**
 * Backup codes configuration
 */
const BACKUP_CODES_CONFIG = {
  count: 10,
  length: 8,
};

/**
 * Generate a TOTP secret for a user
 * @param {string} email - User's email address
 * @returns {object} Secret object with key and QR code URI
 */
async function generateSecret(email) {
  const secret = speakeasy.generateSecret({
    name: `${TOTP_CONFIG.name} (${email})`,
    issuer: TOTP_CONFIG.issuer,
    length: 32,
  });

  return {
    secret: secret.base32,
    otpauth_url: secret.otpauth_url,
  };
}

/**
 * Generate QR code for authenticator apps
 * @param {string} otpauthUrl - OTPAuth URL from secret
 * @returns {Promise<string>} QR code as data URL
 */
async function generateQRCode(otpauthUrl) {
  try {
    const qrCode = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      width: 300,
      margin: 1,
    });
    return qrCode;
  } catch (error) {
    throw new Error(`Failed to generate QR code: ${error.message}`);
  }
}

/**
 * Verify a TOTP token against a secret
 * @param {string} token - 6-digit TOTP token
 * @param {string} secret - Base32 encoded secret
 * @returns {boolean} True if token is valid
 */
function verifyToken(token, secret) {
  try {
    // Remove any whitespace from token
    const cleanToken = token.replace(/\s/g, '');

    // Validate token format (must be 6 digits)
    if (!/^\d{6}$/.test(cleanToken)) {
      return false;
    }

    const verified = speakeasy.totp.verify({
      secret,
      encoding: TOTP_CONFIG.encoding,
      token: cleanToken,
      window: TOTP_CONFIG.window,
    });

    return verified;
  } catch (error) {
    return false;
  }
}

/**
 * Generate backup codes
 * @returns {Array<string>} Array of backup codes
 */
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < BACKUP_CODES_CONFIG.count; i++) {
    let code = '';
    for (let j = 0; j < BACKUP_CODES_CONFIG.length; j++) {
      code += Math.floor(Math.random() * 10);
    }
    codes.push(code);
  }
  return codes;
}

/**
 * Hash backup codes for storage
 * @param {Array<string>} codes - Array of backup codes
 * @returns {object} Object mapping hashed codes to used status
 */
function hashBackupCodes(codes) {
  const crypto = require('crypto');
  const hashed = {};
  codes.forEach((code) => {
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    hashed[hash] = false; // false = not used yet
  });
  return hashed;
}

/**
 * Validate and mark a backup code as used
 * @param {string} code - Backup code to validate
 * @param {object} hashedCodes - Hashed backup codes storage
 * @returns {boolean} True if code is valid and not used
 */
function validateBackupCode(code, hashedCodes) {
  try {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(code).digest('hex');

    if (hashedCodes[hash] === undefined) {
      return false;
    }

    if (hashedCodes[hash] === true) {
      return false; // Already used
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Mark a backup code as used
 * @param {string} code - Backup code to mark
 * @param {object} hashedCodes - Hashed backup codes storage
 * @returns {object} Updated hashedCodes object
 */
function markBackupCodeUsed(code, hashedCodes) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  const updated = { ...hashedCodes };
  if (updated[hash] !== undefined) {
    updated[hash] = true;
  }
  return updated;
}

/**
 * Get unused backup codes count
 * @param {object} hashedCodes - Hashed backup codes storage
 * @returns {number} Count of unused codes
 */
function getUnusedBackupCodesCount(hashedCodes) {
  return Object.values(hashedCodes).filter((used) => used === false).length;
}

module.exports = {
  TOTP_CONFIG,
  BACKUP_CODES_CONFIG,
  generateSecret,
  generateQRCode,
  verifyToken,
  generateBackupCodes,
  hashBackupCodes,
  validateBackupCode,
  markBackupCodeUsed,
  getUnusedBackupCodesCount,
};
