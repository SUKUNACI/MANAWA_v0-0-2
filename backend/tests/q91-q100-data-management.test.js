'use strict';

jest.mock('../../config/db', () => ({
  professional: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

const prisma = require('../../config/db');
const { detectPii, maskString } = require('../../utils/data-management');

describe('Data Management — PII Detection & Masking', () => {
  describe('detectPii', () => {
    it('detects email address', () => {
      expect(detectPii('Contact me at alice@example.com')).toContain('email');
    });

    it('detects phone number', () => {
      expect(detectPii('Call 06 12 34 56 78')).toContain('phone');
    });

    it('detects credit card', () => {
      expect(detectPii('Card: 4532-1234-5678-9010')).toContain('credit_card');
    });

    it('detects IBAN', () => {
      expect(detectPii('IBAN: FR7630006000011234567890189')).toContain('iban');
    });

    it('detects JWT token', () => {
      const jwt = 'test_mock_jwt_token_for_testing_purposes_only';
      expect(detectPii(jwt)).toContain('jwt');
    });

    it('detects IPv4 address', () => {
      expect(detectPii('IP: 192.168.1.42')).toContain('ip_v4');
    });

    it('returns empty array for clean text', () => {
      expect(detectPii('Connexion réussie pour utilisateur anonyme')).toEqual([]);
    });

    it('detects multiple PII types in one string', () => {
      const text = 'User alice@example.com called from 06 12 34 56 78';
      const result = detectPii(text);
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('maskString', () => {
    it('masks email', () => {
      const result = maskString('alice@example.com');
      expect(result).toContain('[EMAIL]');
      expect(result).not.toContain('alice');
    });

    it('masks phone', () => {
      const result = maskString('06 12 34 56 78');
      expect(result).toContain('[PHONE]');
    });

    it('masks IBAN', () => {
      const result = maskString('IBAN: FR7630006000011234567890189');
      expect(result).toContain('[IBAN]');
    });

    it('masks JWT', () => {
      const jwt = 'test_mock_jwt_token_for_testing_purposes_only';
      expect(maskString(jwt)).toContain('[JWT]');
    });

    it('masks IP to subnet only', () => {
      const result = maskString('192.168.1.42');
      expect(result).toContain('192.168.*.*');
      expect(result).not.toContain('192.168.1.42');
    });

    it('preserves non-PII text', () => {
      const text = 'Texte sans informations sensibles';
      expect(maskString(text)).toBe(text);
    });
  });
});
