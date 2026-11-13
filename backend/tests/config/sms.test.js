'use strict';
/**
 * Tests for config/sms.js
 */

jest.mock('../../config/timeout-config', () => ({
  TWILIO_TIMEOUT: 5000,
}));

jest.mock('../../utils/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn) => fn()),
  })),
}));

jest.mock('../../utils/rate-limiter-adaptive', () => ({
  AdaptiveRateLimiter: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn) => fn()),
  })),
}));

jest.mock('../../config/third-party-api-config', () => ({
  getConfig: jest.fn().mockReturnValue({
    circuitBreaker: {},
    rateLimiter: {},
  }),
}));

describe('sms config', () => {
  describe('sans Twilio configuré', () => {
    let sms;

    beforeEach(() => {
      jest.resetModules();
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_PHONE_NUMBER;

      jest.mock('../../config/timeout-config', () => ({ TWILIO_TIMEOUT: 5000 }));
      jest.mock('../../utils/circuit-breaker', () => ({
        CircuitBreaker: jest.fn().mockImplementation(() => ({
          execute: jest.fn((fn) => fn()),
        })),
      }));
      jest.mock('../../utils/rate-limiter-adaptive', () => ({
        AdaptiveRateLimiter: jest.fn().mockImplementation(() => ({
          execute: jest.fn((fn) => fn()),
        })),
      }));
      jest.mock('../../config/third-party-api-config', () => ({
        getConfig: jest.fn().mockReturnValue({ circuitBreaker: {}, rateLimiter: {} }),
      }));

      sms = require('../../config/sms');
    });

    it('exporte sendVerificationSms, isConfigured, circuitBreaker, rateLimiter', () => {
      expect(typeof sms.sendVerificationSms).toBe('function');
      // isConfigured peut être undefined/false/truthy selon les env vars
      expect(sms.circuitBreaker).toBeDefined();
      expect(sms.rateLimiter).toBeDefined();
    });

    it('isConfigured est falsy sans variables env Twilio', () => {
      expect(sms.isConfigured).toBeFalsy();
    });

    it('retourne {sent: false, devCode} en mode dev', async () => {
      const result = await sms.sendVerificationSms('+33612345678', '123456');
      expect(result.sent).toBe(false);
      expect(result.devCode).toBe('123456');
    });

    it('gère différents numéros de téléphone en mode dev', async () => {
      const result = await sms.sendVerificationSms('+1234567890', '654321');
      expect(result.sent).toBe(false);
      expect(result.devCode).toBe('654321');
    });

    it('retourne le code pour vérification en test', async () => {
      const code = '999888';
      const result = await sms.sendVerificationSms('+33600000000', code);
      expect(result.devCode).toBe(code);
    });
  });

  describe('avec Twilio configuré', () => {
    let sms;
    const mockCreate = jest.fn().mockResolvedValue({ sid: 'SM123' });

    beforeEach(() => {
      jest.resetModules();
      process.env.TWILIO_ACCOUNT_SID = 'ACtest';
      process.env.TWILIO_AUTH_TOKEN = 'authtest';
      process.env.TWILIO_PHONE_NUMBER = '+15551234567';

      jest.mock('twilio', () => jest.fn().mockImplementation(() => ({
        messages: { create: mockCreate },
      })));
      jest.mock('../../config/timeout-config', () => ({ TWILIO_TIMEOUT: 5000 }));
      jest.mock('../../utils/circuit-breaker', () => ({
        CircuitBreaker: jest.fn().mockImplementation(() => ({
          execute: jest.fn((fn) => fn()),
        })),
      }));
      jest.mock('../../utils/rate-limiter-adaptive', () => ({
        AdaptiveRateLimiter: jest.fn().mockImplementation(() => ({
          execute: jest.fn((fn) => fn()),
        })),
      }));
      jest.mock('../../config/third-party-api-config', () => ({
        getConfig: jest.fn().mockReturnValue({ circuitBreaker: {}, rateLimiter: {} }),
      }));

      sms = require('../../config/sms');
    });

    afterEach(() => {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_PHONE_NUMBER;
    });

    it('isConfigured est truthy avec les variables env', () => {
      expect(sms.isConfigured).toBeTruthy();
    });

    it('appelle twilio.messages.create avec les bons paramètres', async () => {
      await sms.sendVerificationSms('+33612345678', '123456');
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.stringContaining('123456'),
        from: '+15551234567',
        to: '+33612345678',
      }));
    });

    it('retourne {sent: true} si Twilio réussit', async () => {
      mockCreate.mockResolvedValueOnce({ sid: 'SM_success' });
      const result = await sms.sendVerificationSms('+33612345678', '999999');
      expect(result.sent).toBe(true);
    });

    it('lance une erreur si Twilio échoue', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Twilio error'));
      await expect(sms.sendVerificationSms('+33612345678', '123456')).rejects.toThrow('Twilio error');
    });
  });
});
