/**
 * Tests for Third-party Error Handler (Q60)
 */

const {
  classifyError,
  handleThirdPartyError,
  getFallbackStrategy,
  formatErrorResponse,
  logTimeout,
} = require('../../utils/error-handler-third-party');
const timeoutConfig = require('../../config/timeout-config');

describe('Error Handler - Third Party (Q60)', () => {
  describe('classifyError', () => {
    test('should classify timeout errors (Q59)', () => {
      const error = new Error('Request timeout');
      error.code = timeoutConfig.ERROR_CODES.TIMEOUT_ERR;

      const result = classifyError(error, 'geniuspay');

      expect(result.type).toBe(timeoutConfig.SERVICE_ERRORS.TIMEOUT);
      expect(result.code).toBe(timeoutConfig.ERROR_CODES.TIMEOUT_ERR);
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(504);
    });

    test('should classify rate-limit errors (429)', () => {
      const error = new Error('Too many requests');
      error.response = { status: 429 };

      const result = classifyError(error, 'mailjet');

      expect(result.type).toBe(timeoutConfig.SERVICE_ERRORS.RATE_LIMIT);
      expect(result.code).toBe('RATE_LIMIT_ERR');
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    test('should classify auth errors (401/403)', () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401 };

      const result = classifyError(error, 'twilio');

      expect(result.type).toBe(timeoutConfig.SERVICE_ERRORS.AUTH_INVALID);
      expect(result.code).toBe('AUTH_INVALID_ERR');
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(503);
    });

    test('should classify server errors (5xx)', () => {
      const error = new Error('Internal Server Error');
      error.response = { status: 500 };

      const result = classifyError(error, 'geniuspay');

      expect(result.type).toBe(timeoutConfig.SERVICE_ERRORS.SERVER_ERROR);
      expect(result.code).toBe('SERVER_ERROR_ERR');
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    test('should classify network errors', () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';

      const result = classifyError(error, 'mailjet');

      expect(result.type).toBe(timeoutConfig.SERVICE_ERRORS.NETWORK_ERROR);
      expect(result.code).toBe('NETWORK_ERROR_ERR');
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    test('should classify ECONNABORTED as timeout', () => {
      const error = new Error('Connection aborted');
      error.code = 'ECONNABORTED';

      const result = classifyError(error, 'twilio');

      expect(result.type).toBe(timeoutConfig.SERVICE_ERRORS.TIMEOUT);
      expect(result.retryable).toBe(true);
    });

    test('should classify ETIMEDOUT as timeout', () => {
      const error = new Error('Socket timeout');
      error.code = 'ETIMEDOUT';

      const result = classifyError(error, 'twilio');

      expect(result.type).toBe(timeoutConfig.SERVICE_ERRORS.TIMEOUT);
      expect(result.retryable).toBe(true);
    });
  });

  describe('handleThirdPartyError', () => {
    test('should handle timeout errors with context', () => {
      const error = new Error('Request timeout');
      error.code = timeoutConfig.ERROR_CODES.TIMEOUT_ERR;

      const context = { userId: '123', action: 'payment' };
      const result = handleThirdPartyError(error, 'geniuspay', context);

      expect(result.type).toBe(timeoutConfig.SERVICE_ERRORS.TIMEOUT);
      expect(result.code).toBe(timeoutConfig.ERROR_CODES.TIMEOUT_ERR);
    });
  });

  describe('getFallbackStrategy', () => {
    test('should return SMS fallback when Twilio fails (Q60)', () => {
      const strategy = getFallbackStrategy('mailjet', 'email');

      expect(strategy.fallbackService).toBe('twilio');
      expect(strategy.fallbackType).toBe('sms_notification');
      expect(strategy.message).toContain('SMS');
    });

    test('should return email fallback when Twilio fails for SMS (Q60)', () => {
      const strategy = getFallbackStrategy('twilio', 'sms_otp');

      expect(strategy.fallbackService).toBe('mailjet');
      expect(strategy.fallbackType).toBe('email_otp');
      expect(strategy.message).toContain('email');
    });

    test('should return error message when GeniusPay fails (Q60)', () => {
      const strategy = getFallbackStrategy('geniuspay', 'payment');

      expect(strategy.fallbackService).toBeNull();
      expect(strategy.fallbackType).toBe('error_message');
      expect(strategy.message).toContain('Paiement échoué');
    });

    test('should handle unknown services gracefully', () => {
      const strategy = getFallbackStrategy('unknown-service', 'notification');

      expect(strategy.fallbackService).toBeNull();
      expect(strategy.fallbackType).toBeNull();
    });
  });

  describe('formatErrorResponse', () => {
    test('should format timeout error response clearly (Q60)', () => {
      const error = new Error('Request timeout');
      error.code = timeoutConfig.ERROR_CODES.TIMEOUT_ERR;

      const response = formatErrorResponse(error, 'geniuspay', 504);

      expect(response.success).toBe(false);
      expect(response.error).toContain('dépassé');
      expect(response.error).not.toContain('Erreur interne');
      expect(response.code).toBe(timeoutConfig.ERROR_CODES.TIMEOUT_ERR);
      expect(response.retryable).toBe(true);
    });

    test('should format rate-limit error response clearly', () => {
      const error = new Error('Too many requests');
      error.response = { status: 429 };

      const response = formatErrorResponse(error, 'mailjet', 429);

      expect(response.success).toBe(false);
      expect(response.error).toContain('temporairement');
      expect(response.code).toBe('RATE_LIMIT_ERR');
      expect(response.retryable).toBe(true);
    });

    test('should format GeniusPay error message clearly (Q60)', () => {
      const error = new Error('Payment processing failed');
      error.response = { status: 400 };

      const response = formatErrorResponse(error, 'geniuspay', 400);

      expect(response.error).toContain('Erreur');
      expect(response.success).toBe(false);
    });

    test('should include timestamp in response', () => {
      const error = new Error('Network error');
      error.code = 'ECONNREFUSED';

      const response = formatErrorResponse(error, 'mailjet', 503);

      expect(response).toHaveProperty('timestamp');
      expect(new Date(response.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('logTimeout', () => {
    test('should log timeout separately with TIMEOUT_ERR code (Q59)', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const context = { endpoint: '/payments', userId: '123' };
      logTimeout('geniuspay', context);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Fallback strategies integration (Q60)', () => {
    test('SMS OTP should fallback to email when Twilio fails', () => {
      const error = new Error('Twilio timeout');
      error.code = timeoutConfig.ERROR_CODES.TIMEOUT_ERR;

      const classification = classifyError(error, 'twilio');
      const fallback = getFallbackStrategy('twilio', 'sms_otp');

      expect(classification.retryable).toBe(true);
      expect(fallback.fallbackService).toBe('mailjet');
      expect(fallback.fallbackType).toBe('email_otp');
    });

    test('Email notification should fallback to SMS when Mailjet fails', () => {
      const error = new Error('Mailjet rate limit');
      error.response = { status: 429 };

      const classification = classifyError(error, 'mailjet');
      const fallback = getFallbackStrategy('mailjet', 'email_notification');

      expect(classification.type).toBe(timeoutConfig.SERVICE_ERRORS.RATE_LIMIT);
      expect(fallback.fallbackService).toBe('twilio');
      expect(fallback.fallbackType).toBe('sms_notification');
    });

    test('GeniusPay failure should provide clear payment error message', () => {
      const error = new Error('Payment failed');
      error.response = { status: 502 };

      const classification = classifyError(error, 'geniuspay');
      const response = formatErrorResponse(error, 'geniuspay', 502);
      const fallback = getFallbackStrategy('geniuspay', 'payment');

      expect(classification.retryable).toBe(true);
      // Server errors (5xx) return generic "erreur serveur" message
      expect(response.error).toContain('erreur serveur');
      expect(fallback.message).toContain('Paiement échoué');
    });
  });

  describe('Error differentiation (Q60)', () => {
    test('timeout error should be differentiated from rate-limit', () => {
      const timeoutError = new Error('Timeout');
      timeoutError.code = timeoutConfig.ERROR_CODES.TIMEOUT_ERR;

      const rateLimitError = new Error('Rate limit');
      rateLimitError.response = { status: 429 };

      const timeoutClassified = classifyError(timeoutError, 'mailjet');
      const rateLimitClassified = classifyError(rateLimitError, 'mailjet');

      expect(timeoutClassified.type).toBe(timeoutConfig.SERVICE_ERRORS.TIMEOUT);
      expect(rateLimitClassified.type).toBe(timeoutConfig.SERVICE_ERRORS.RATE_LIMIT);
      expect(timeoutClassified.message).not.toBe(rateLimitClassified.message);
    });

    test('auth error should be differentiated from server error', () => {
      const authError = new Error('Unauthorized');
      authError.response = { status: 401 };

      const serverError = new Error('Server error');
      serverError.response = { status: 500 };

      const authClassified = classifyError(authError, 'twilio');
      const serverClassified = classifyError(serverError, 'twilio');

      expect(authClassified.type).toBe(timeoutConfig.SERVICE_ERRORS.AUTH_INVALID);
      expect(serverClassified.type).toBe(timeoutConfig.SERVICE_ERRORS.SERVER_ERROR);
      expect(authClassified.retryable).toBe(false);
      expect(serverClassified.retryable).toBe(true);
    });
  });
});
