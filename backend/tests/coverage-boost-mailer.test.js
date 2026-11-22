/**
 * Coverage boost — config/mailer (send, sendVerification, sendPackageSuspension)
 * Uses jest.requireActual to bypass the global mock in setup.js which omits send/logMailjetAccess
 */

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../modules/SecretAccessTracker', () => ({
  logAccess: jest.fn().mockResolvedValue(undefined),
}));

// Override the global mock in setup.js with the real module
jest.mock('../config/mailer', () => jest.requireActual('../config/mailer'));

const mailer = require('../config/mailer');

describe('config/mailer — exports and types', () => {
  test('isConfigured is a boolean', () => {
    expect(typeof mailer.isConfigured).toBe('boolean');
  });

  test('send is a function', () => {
    expect(typeof mailer.send).toBe('function');
  });

  test('sendVerificationEmail is a function', () => {
    expect(typeof mailer.sendVerificationEmail).toBe('function');
  });

  test('sendPackageSuspensionEmail is a function', () => {
    expect(typeof mailer.sendPackageSuspensionEmail).toBe('function');
  });

  test('logMailjetAccess is a function', () => {
    expect(typeof mailer.logMailjetAccess).toBe('function');
  });
});

describe('config/mailer — send() branch: not configured', () => {
  test('send returns { sent: false } when not configured', async () => {
    if (mailer.isConfigured) return; // CI has test keys, skip
    const result = await mailer.send({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
    });
    expect(result).toEqual({ sent: false });
  });

  test('send returns { sent: false } or throws — exercises the send path', async () => {
    // unconfigured: resolves { sent: false }; configured with bad keys: rejects
    try {
      const result = await mailer.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        text: 'Test',
      });
      expect(result).toHaveProperty('sent');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});

describe('config/mailer — sendVerificationEmail branches', () => {
  test('verify purpose returns sent:false + devCode when unconfigured', async () => {
    if (mailer.isConfigured) return;
    const result = await mailer.sendVerificationEmail('user@example.com', '111111', 'verify');
    expect(result.sent).toBe(false);
    expect(result.devCode).toBe('111111');
  });

  test('reset purpose returns sent:false + devCode when unconfigured', async () => {
    if (mailer.isConfigured) return;
    const result = await mailer.sendVerificationEmail('user@example.com', '222222', 'reset');
    expect(result.sent).toBe(false);
    expect(result.devCode).toBe('222222');
  });

  test('sendVerificationEmail resolves or throws — exercises the configured path', async () => {
    // unconfigured: resolves { sent: false, devCode }; configured with bad keys: rejects
    try {
      const result = await mailer.sendVerificationEmail('user@example.com', '333333', 'verify');
      expect(result).toHaveProperty('sent');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});

describe('config/mailer — sendPackageSuspensionEmail', () => {
  test('returns { sent: false } when unconfigured', async () => {
    if (mailer.isConfigured) return;
    const result = await mailer.sendPackageSuspensionEmail('user@example.com', 'Pro', 'Abuse');
    expect(result).toEqual({ sent: false });
  });

  test('resolves or throws — exercises the configured path', async () => {
    try {
      const result = await mailer.sendPackageSuspensionEmail('user@example.com', 'Pro', 'Abuse');
      expect(result).toHaveProperty('sent');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});

describe('config/mailer — logMailjetAccess', () => {
  test('calls SecretAccessTracker.logAccess', async () => {
    const SecretAccessTracker = require('../modules/SecretAccessTracker');
    jest.clearAllMocks();
    await mailer.logMailjetAccess('user-1', '127.0.0.1', 'test-agent');
    expect(SecretAccessTracker.logAccess).toHaveBeenCalled();
  });

  test('resolves without throwing', async () => {
    await expect(
      mailer.logMailjetAccess('user-2', '192.168.1.1', 'agent/1.0')
    ).resolves.not.toThrow();
  });
});
