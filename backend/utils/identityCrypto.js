'use strict';

/**
 * Secure identity document number handling.
 *
 * Two independent operations:
 *   hashDocumentNumber(raw)   — deterministic HMAC-SHA256 for uniqueness checks.
 *                               Never stores the raw number; two calls with the same
 *                               input produce the same hash, two different inputs
 *                               produce different hashes (collision-resistant).
 *
 *   encryptDocumentNumber(raw)   — AES-256-GCM encryption for authorised retrieval.
 *   decryptDocumentNumber(enc)   — inverse of encryption.
 *
 * Required env vars (startup fails if missing):
 *   IDENTITY_HMAC_SECRET  — hex-encoded 32-byte secret for HMAC (64 hex chars)
 *   IDENTITY_AES_KEY      — hex-encoded 32-byte key for AES-256-GCM (64 hex chars)
 *
 * Security properties:
 *   - Raw number is never logged or returned in API responses.
 *   - HMAC is keyed — a leaked hash cannot be used to brute-force the document number
 *     without also knowing IDENTITY_HMAC_SECRET.
 *   - AES-GCM provides authenticated encryption; tampered ciphertext is rejected.
 *   - Each encryption uses a fresh 12-byte random IV; identical inputs produce
 *     different ciphertexts.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function requireSecret(name) {
  const val = process.env[name];
  if (!val) throw new Error(`[identityCrypto] Missing required env var: ${name}`);
  if (val.length !== 64) throw new Error(`[identityCrypto] ${name} must be 64 hex characters (32 bytes)`);
  return Buffer.from(val, 'hex');
}

/**
 * Returns a deterministic HMAC-SHA256 hex string for the given document number.
 * Used to enforce uniqueness in the database without storing the raw number.
 */
function hashDocumentNumber(rawNumber) {
  if (!rawNumber || typeof rawNumber !== 'string') {
    throw new Error('[identityCrypto] hashDocumentNumber: rawNumber must be a non-empty string');
  }
  const secret = requireSecret('IDENTITY_HMAC_SECRET');
  return crypto.createHmac('sha256', secret).update(rawNumber.toUpperCase().trim()).digest('hex');
}

/**
 * Encrypts a document number with AES-256-GCM.
 * Returns a base64 string: iv(12) + authTag(16) + ciphertext.
 */
function encryptDocumentNumber(rawNumber) {
  if (!rawNumber || typeof rawNumber !== 'string') {
    throw new Error('[identityCrypto] encryptDocumentNumber: rawNumber must be a non-empty string');
  }
  const key = requireSecret('IDENTITY_AES_KEY');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(rawNumber.toUpperCase().trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64-encoded ciphertext produced by encryptDocumentNumber.
 * Returns the original document number string, or throws if tampered/invalid.
 */
function decryptDocumentNumber(encryptedBase64) {
  if (!encryptedBase64 || typeof encryptedBase64 !== 'string') {
    throw new Error('[identityCrypto] decryptDocumentNumber: input must be a non-empty string');
  }
  const key = requireSecret('IDENTITY_AES_KEY');
  const buf = Buffer.from(encryptedBase64, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('[identityCrypto] decryptDocumentNumber: ciphertext too short');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

module.exports = { hashDocumentNumber, encryptDocumentNumber, decryptDocumentNumber };
