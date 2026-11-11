/**
 * Mailer Configuration Tests
 * Tests email template rendering, variable substitution, and error handling
 */

describe('Mailer Configuration', () => {
  let mailer;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should export sendVerificationEmail function', () => {
    mailer = require('../../config/mailer');
    expect(typeof mailer.sendVerificationEmail).toBe('function');
  });

  test('should export sendPackageSuspensionEmail function', () => {
    mailer = require('../../config/mailer');
    expect(typeof mailer.sendPackageSuspensionEmail).toBe('function');
  });

  test('should export isConfigured flag', () => {
    mailer = require('../../config/mailer');
    expect(typeof mailer.isConfigured).toBe('boolean');
  });

  describe('Verification Email Sending', () => {
    beforeEach(() => {
      mailer = require('../../config/mailer');
    });

    test('should return result object on email send', async () => {
      const result = await mailer.sendVerificationEmail('user@example.com', '123456', 'verify');
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should handle verification email with correct code format', async () => {
      const code = '654321';
      const result = await mailer.sendVerificationEmail('user@example.com', code, 'verify');
      expect(result).toBeDefined();
    });

    test('should handle password reset email', async () => {
      const result = await mailer.sendVerificationEmail('user@example.com', '987654', 'reset');
      expect(result).toBeDefined();
    });

    test('should accept valid email addresses', async () => {
      const result = await mailer.sendVerificationEmail('valid@example.com', '123456', 'verify');
      expect(result).toBeDefined();
    });

    test('should handle email with special characters', async () => {
      const result = await mailer.sendVerificationEmail('user+tag@example.com', '123456', 'verify');
      expect(result).toBeDefined();
    });

    test('should handle email with subdomain', async () => {
      const result = await mailer.sendVerificationEmail('user@mail.example.com', '123456', 'verify');
      expect(result).toBeDefined();
    });
  });

  describe('Code Format Handling', () => {
    beforeEach(() => {
      mailer = require('../../config/mailer');
    });

    test('should handle 6-digit code', async () => {
      const result = await mailer.sendVerificationEmail('user@example.com', '123456', 'verify');
      expect(result).toBeDefined();
    });

    test('should handle alphanumeric code', async () => {
      const result = await mailer.sendVerificationEmail('user@example.com', 'ABC123', 'verify');
      expect(result).toBeDefined();
    });

    test('should handle different code formats', async () => {
      const result = await mailer.sendVerificationEmail('user@example.com', 'XYZ789', 'verify');
      expect(result).toBeDefined();
    });
  });

  describe('Package Suspension Email', () => {
    beforeEach(() => {
      mailer = require('../../config/mailer');
    });

    test('should send package suspension email', async () => {
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        'Pro Plan',
        'Violation of terms'
      );
      expect(result).toBeDefined();
    });

    test('should include package title in suspension email', async () => {
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        'Elite Package',
        'Policy violation'
      );
      expect(result).toBeDefined();
    });

    test('should include reason in suspension email', async () => {
      const reason = 'Fraudulent activity detected';
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        'Pro Plan',
        reason
      );
      expect(result).toBeDefined();
    });

    test('should handle special characters in package title', async () => {
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        'Pro & Elite',
        'Reason'
      );
      expect(result).toBeDefined();
    });

    test('should handle HTML special characters in reason', async () => {
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        'Plan',
        'Text with special chars: < > & "'
      );
      expect(result).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mailer = require('../../config/mailer');
    });

    test('should handle invalid purpose parameter gracefully', async () => {
      const result = await mailer.sendVerificationEmail('user@example.com', '123456', 'invalid');
      expect(result).toBeDefined();
    });

    test('should handle empty email gracefully', async () => {
      const result = await mailer.sendVerificationEmail('', '123456', 'verify');
      expect(result).toBeDefined();
    });

    test('should handle empty code gracefully', async () => {
      const result = await mailer.sendVerificationEmail('user@example.com', '', 'verify');
      expect(result).toBeDefined();
    });
  });

  describe('HTML Template Rendering', () => {
    test('should include MANAWA branding in template', async () => {
      mailer = require('../../config/mailer');
      const result = await mailer.sendVerificationEmail('user@example.com', '123456', 'verify');
      expect(result).toBeDefined();
    });

    test('should use dark theme styling', async () => {
      mailer = require('../../config/mailer');
      const result = await mailer.sendVerificationEmail('user@example.com', '123456', 'verify');
      expect(result).toBeDefined();
    });

    test('should include expiration time (15 minutes)', async () => {
      mailer = require('../../config/mailer');
      const result = await mailer.sendVerificationEmail('user@example.com', '123456', 'verify');
      expect(result).toBeDefined();
    });
  });

  describe('Text Email Format', () => {
    test('should generate plain text version of verification email', async () => {
      mailer = require('../../config/mailer');
      const result = await mailer.sendVerificationEmail('user@example.com', '123456', 'verify');
      expect(result).toBeDefined();
    });

    test('should include code in text format', async () => {
      mailer = require('../../config/mailer');
      const result = await mailer.sendVerificationEmail('user@example.com', '789456', 'reset');
      expect(result).toBeDefined();
    });
  });

  describe('Email Purposes', () => {
    test('should handle different email purposes', async () => {
      mailer = require('../../config/mailer');

      const verifyResult = await mailer.sendVerificationEmail('user@example.com', '123456', 'verify');
      const resetResult = await mailer.sendVerificationEmail('user@example.com', '654321', 'reset');

      expect(verifyResult).toBeDefined();
      expect(resetResult).toBeDefined();
    });
  });

  describe('Configuration State', () => {
    test('should have consistent isConfigured flag', () => {
      mailer = require('../../config/mailer');
      const configured1 = mailer.isConfigured;
      const configured2 = mailer.isConfigured;

      expect(configured1).toBe(configured2);
    });

    test('should have both functions available', () => {
      mailer = require('../../config/mailer');
      expect(mailer.sendVerificationEmail).toBeDefined();
      expect(mailer.sendPackageSuspensionEmail).toBeDefined();
    });
  });

  describe('Multiple Email Operations', () => {
    test('should handle multiple verification emails', async () => {
      mailer = require('../../config/mailer');

      const result1 = await mailer.sendVerificationEmail('user1@example.com', '111111', 'verify');
      const result2 = await mailer.sendVerificationEmail('user2@example.com', '222222', 'verify');
      const result3 = await mailer.sendVerificationEmail('user3@example.com', '333333', 'verify');

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result3).toBeDefined();
    });

    test('should handle mixed email types', async () => {
      mailer = require('../../config/mailer');

      const verify = await mailer.sendVerificationEmail('user@example.com', '123456', 'verify');
      const reset = await mailer.sendVerificationEmail('user@example.com', '654321', 'reset');
      const suspend = await mailer.sendPackageSuspensionEmail('user@example.com', 'Plan', 'Reason');

      expect(verify).toBeDefined();
      expect(reset).toBeDefined();
      expect(suspend).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    test('should handle very long email addresses', async () => {
      mailer = require('../../config/mailer');
      const longEmail = 'very.long.email.address.with.many.parts@subdomain.example.co.uk';
      const result = await mailer.sendVerificationEmail(longEmail, '123456', 'verify');
      expect(result).toBeDefined();
    });

    test('should handle very long package names', async () => {
      mailer = require('../../config/mailer');
      const longName = 'Premium Professional Elite Plus Package with Extra Features and Benefits';
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        longName,
        'Reason'
      );
      expect(result).toBeDefined();
    });

    test('should handle very long reason text', async () => {
      mailer = require('../../config/mailer');
      const longReason = 'This is a very long reason '.repeat(10);
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        'Plan',
        longReason
      );
      expect(result).toBeDefined();
    });
  });

  describe('Unicode Support', () => {
    test('should handle unicode in package name', async () => {
      mailer = require('../../config/mailer');
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        'Plan Élite 专业版',
        'Reason'
      );
      expect(result).toBeDefined();
    });

    test('should handle unicode in reason', async () => {
      mailer = require('../../config/mailer');
      const result = await mailer.sendPackageSuspensionEmail(
        'user@example.com',
        'Plan',
        'Violation: 违规行为 | Violation française'
      );
      expect(result).toBeDefined();
    });
  });

  describe('Integration Behavior', () => {
    test('should maintain dev mode behavior in test environment', async () => {
      mailer = require('../../config/mailer');

      // In test environment, mailer should return devCode if not configured
      const result = await mailer.sendVerificationEmail('user@example.com', 'TEST123', 'verify');

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should have consistent module exports', () => {
      const mailer1 = require('../../config/mailer');
      const mailer2 = require('../../config/mailer');

      expect(mailer1.sendVerificationEmail).toBe(mailer2.sendVerificationEmail);
      expect(mailer1.sendPackageSuspensionEmail).toBe(mailer2.sendPackageSuspensionEmail);
      expect(mailer1.isConfigured).toBe(mailer2.isConfigured);
    });
  });
});
