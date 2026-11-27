/**
 * Tests for encryptString/decryptString (generic string encryption for 2FA secrets)
 */

process.env.IDENTITY_AES_KEY = 'a'.repeat(64); // 32-byte key (64 hex chars)

const { encryptString, decryptString } = require('../../utils/identityCrypto');

describe('identityCrypto.encryptString/decryptString', () => {
  const secret = 'JBSWY3DPEHPK3PXP';

  test('roundtrip: plaintext → ciphertext → plaintext', () => {
    const encrypted = encryptString(secret);
    const decrypted = decryptString(encrypted);
    expect(decrypted).toBe(secret);
  });

  test('ciphertext begins with enc:v1:', () => {
    const encrypted = encryptString(secret);
    expect(encrypted).toMatch(/^enc:v1:/);
  });

  test('two encryptions of the same text produce different ciphertexts (random IV)', () => {
    const enc1 = encryptString(secret);
    const enc2 = encryptString(secret);
    expect(enc1).not.toBe(enc2);
    // But they decrypt to the same value
    expect(decryptString(enc1)).toBe(secret);
    expect(decryptString(enc2)).toBe(secret);
  });

  test('legacy plaintext (not prefixed) decrypts to itself', () => {
    const plaintext = 'SECRETENCLAIR';
    const decrypted = decryptString(plaintext);
    expect(decrypted).toBe(plaintext);
  });

  test('tampered ciphertext throws error', () => {
    const encrypted = encryptString(secret);
    const tampered = encrypted.slice(0, -5) + 'XXXXX';
    expect(() => decryptString(tampered)).toThrow();
  });

  test('encryptString with empty string throws error', () => {
    expect(() => encryptString('')).toThrow();
  });

  test('encryptString without IDENTITY_AES_KEY throws error', () => {
    const saved = process.env.IDENTITY_AES_KEY;
    delete process.env.IDENTITY_AES_KEY;
    try {
      expect(() => encryptString(secret)).toThrow();
    } finally {
      process.env.IDENTITY_AES_KEY = saved;
    }
  });
});
