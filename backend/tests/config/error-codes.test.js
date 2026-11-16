const { ERROR_CODES, createError, getErrorCode, isRetryable } = require('../../config/error-codes');
const { t } = require('../../config/i18n');

describe('error-codes.js', () => {
  describe('ERROR_CODES structure', () => {
    test('should have all required error code categories', () => {
      const categories = ['AUTH_', 'VAL_', 'PAY_', 'RES_', 'SVC_', 'BUS_'];
      categories.forEach(cat => {
        const found = Object.keys(ERROR_CODES).some(key => key.startsWith(cat));
        expect(found).toBe(true);
      });
    });

    test('each error code should have required fields', () => {
      Object.values(ERROR_CODES).forEach(errorCode => {
        expect(errorCode).toHaveProperty('code');
        expect(errorCode).toHaveProperty('status');
        expect(errorCode).toHaveProperty('retryable');
        expect(errorCode).toHaveProperty('i18nKey');
        expect(typeof errorCode.code).toBe('string');
        expect(typeof errorCode.status).toBe('number');
        expect(typeof errorCode.retryable).toBe('boolean');
        expect(typeof errorCode.i18nKey).toBe('string');
      });
    });

    test('all status codes should be valid HTTP statuses', () => {
      const validStatuses = [400, 401, 402, 403, 404, 409, 410, 429, 500, 502, 503, 504];
      Object.values(ERROR_CODES).forEach(errorCode => {
        expect(validStatuses).toContain(errorCode.status);
      });
    });

    test('error codes should be unique', () => {
      const codes = Object.values(ERROR_CODES).map(e => e.code);
      const uniqueCodes = new Set(codes);
      expect(codes.length).toBe(uniqueCodes.size);
    });

    test('i18nKeys should exist in i18n config', () => {
      Object.values(ERROR_CODES).forEach(errorCode => {
        const translated = t(errorCode.i18nKey, 'fr');
        expect(translated).not.toBe(errorCode.i18nKey);
      });
    });
  });

  describe('createError()', () => {
    test('should create error object with correct structure', () => {
      const error = createError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'fr', t);
      expect(error).toHaveProperty('error');
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('status');
      expect(error).toHaveProperty('retryable');
    });

    test('should use i18n translation for error message', () => {
      const error = createError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'fr', t);
      expect(error.error).toBe('Email ou mot de passe incorrect');
    });

    test('should support English locale', () => {
      const error = createError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'en', t);
      expect(error.error).toBe('Invalid email or password');
    });

    test('should throw error for invalid error code', () => {
      expect(() => createError(null, 'fr', t)).toThrow();
    });

    test('should support i18n variable interpolation', () => {
      const error = createError(ERROR_CODES.VAL_MIN_LENGTH, 'fr', t, { min: 8 });
      expect(error.error).toContain('8');
    });

    test('should set correct HTTP status', () => {
      const error = createError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'fr', t);
      expect(error.status).toBe(401);
    });

    test('should indicate retryability', () => {
      const nonRetryable = createError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'fr', t);
      expect(nonRetryable.retryable).toBe(false);

      const retryable = createError(ERROR_CODES.SVC_TIMEOUT, 'fr', t);
      expect(retryable.retryable).toBe(true);
    });
  });

  describe('getErrorCode()', () => {
    test('should retrieve error code by key', () => {
      const code = getErrorCode('AUTH_INVALID_CREDENTIALS');
      expect(code).toEqual(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    });

    test('should return null for unknown key', () => {
      const code = getErrorCode('UNKNOWN_ERROR');
      expect(code).toBeNull();
    });

    test('should work with all defined codes', () => {
      Object.keys(ERROR_CODES).forEach(key => {
        const code = getErrorCode(key);
        expect(code).not.toBeNull();
        expect(code.code).toBeDefined();
      });
    });
  });

  describe('isRetryable()', () => {
    test('should return true for retryable errors', () => {
      expect(isRetryable('SVC_TIMEOUT')).toBe(true);
      expect(isRetryable('PAY_TIMEOUT')).toBe(true);
      expect(isRetryable('AUTH_TOO_MANY_ATTEMPTS')).toBe(true);
    });

    test('should return false for non-retryable errors', () => {
      expect(isRetryable('AUTH_INVALID_CREDENTIALS')).toBe(false);
      expect(isRetryable('VAL_INVALID_EMAIL')).toBe(false);
      expect(isRetryable('RES_NOT_FOUND')).toBe(false);
    });

    test('should return false for unknown errors', () => {
      expect(isRetryable('UNKNOWN_ERROR')).toBe(false);
    });
  });

  describe('error code consistency', () => {
    test('authentication errors should have 401 or 403 status', () => {
      Object.entries(ERROR_CODES).forEach(([key, value]) => {
        if (key.startsWith('AUTH_')) {
          expect([401, 403, 429]).toContain(value.status);
        }
      });
    });

    test('validation errors should have 400 status', () => {
      Object.entries(ERROR_CODES).forEach(([key, value]) => {
        if (key.startsWith('VAL_')) {
          expect([400, 409]).toContain(value.status);
        }
      });
    });

    test('payment errors should have 4xx status', () => {
      Object.entries(ERROR_CODES).forEach(([key, value]) => {
        if (key.startsWith('PAY_')) {
          expect([400, 402, 409, 504, 502]).toContain(value.status);
        }
      });
    });

    test('service errors should have 5xx or 429 status', () => {
      Object.entries(ERROR_CODES).forEach(([key, value]) => {
        if (key.startsWith('SVC_')) {
          expect([429, 500, 502, 503, 504]).toContain(value.status);
        }
      });
    });
  });

  describe('timeout and retry scenarios', () => {
    test('timeout errors should be retryable with 504 status', () => {
      const timeoutCodes = ['SVC_TIMEOUT', 'PAY_TIMEOUT'];
      timeoutCodes.forEach(key => {
        const code = getErrorCode(key);
        expect(code.status).toBe(504);
        expect(code.retryable).toBe(true);
      });
    });

    test('rate limit should be retryable with 429 status', () => {
      const code = getErrorCode('SVC_RATE_LIMITED');
      expect(code.status).toBe(429);
      expect(code.retryable).toBe(true);
    });

    test('database errors should be retryable', () => {
      const code = getErrorCode('SVC_DATABASE_ERROR');
      expect(code.retryable).toBe(true);
    });
  });

  describe('all error codes defined', () => {
    test('should have at least 28 error codes', () => {
      expect(Object.keys(ERROR_CODES).length).toBeGreaterThanOrEqual(28);
    });

    test('AUTH category should have at least 9 codes', () => {
      const authCodes = Object.keys(ERROR_CODES).filter(k => k.startsWith('AUTH_'));
      expect(authCodes.length).toBeGreaterThanOrEqual(9);
    });

    test('VAL category should have at least 9 codes', () => {
      const valCodes = Object.keys(ERROR_CODES).filter(k => k.startsWith('VAL_'));
      expect(valCodes.length).toBeGreaterThanOrEqual(9);
    });

    test('PAY category should have at least 6 codes', () => {
      const payCodes = Object.keys(ERROR_CODES).filter(k => k.startsWith('PAY_'));
      expect(payCodes.length).toBeGreaterThanOrEqual(6);
    });

    test('RES category should have at least 5 codes', () => {
      const resCodes = Object.keys(ERROR_CODES).filter(k => k.startsWith('RES_'));
      expect(resCodes.length).toBeGreaterThanOrEqual(5);
    });

    test('SVC category should have at least 8 codes', () => {
      const svcCodes = Object.keys(ERROR_CODES).filter(k => k.startsWith('SVC_'));
      expect(svcCodes.length).toBeGreaterThanOrEqual(8);
    });

    test('BUS category should have at least 5 codes', () => {
      const busCodes = Object.keys(ERROR_CODES).filter(k => k.startsWith('BUS_'));
      expect(busCodes.length).toBeGreaterThanOrEqual(5);
    });
  });
});
