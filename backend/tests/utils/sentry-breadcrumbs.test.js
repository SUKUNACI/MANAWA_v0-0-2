const Sentry = require('@sentry/node');
const {
  addAuthBreadcrumb,
  addPaymentBreadcrumb,
  addSearchBreadcrumb,
  addDatabaseBreadcrumb,
  addAPIBreadcrumb,
  addFileBreadcrumb,
  addErrorBreadcrumb,
  addRetryBreadcrumb,
  addCircuitBreakerBreadcrumb,
} = require('../../utils/sentry-breadcrumbs');

jest.mock('@sentry/node');

describe('sentry-breadcrumbs.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addAuthBreadcrumb', () => {
    test('should add auth breadcrumb with action and data', () => {
      addAuthBreadcrumb('Login attempt', { email: 'user@example.com', userId: 123, ip: '192.168.1.1' });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'auth',
        message: 'Login attempt',
        level: 'info',
        data: expect.objectContaining({
          email: expect.any(String),
          userId: 123,
          ip: '192.168.1.1',
        }),
      });
    });

    test('should mask email in auth breadcrumb', () => {
      addAuthBreadcrumb('Login', { email: 'john.doe@example.com' });

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.data.email).not.toContain('john.doe');
      expect(call.data.email).toMatch(/^jo\*\*\*\*@/);
    });

    test('should handle missing email', () => {
      addAuthBreadcrumb('Logout', { userId: 123 });

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.data.email).toBeUndefined();
    });
  });

  describe('addPaymentBreadcrumb', () => {
    test('should add payment breadcrumb with payment details', () => {
      addPaymentBreadcrumb('Payment initiated', {
        paymentId: 'pay_123',
        amount: 5000,
        currency: 'XOF',
        method: 'card',
        userId: 456,
        status: 'pending',
      });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'payment',
        message: 'Payment initiated',
        level: 'warning',
        data: expect.objectContaining({
          paymentId: 'pay_123',
          amount: 5000,
          currency: 'XOF',
          method: 'card',
          userId: 456,
          status: 'pending',
        }),
      });
    });

    test('should set warning level for payments', () => {
      addPaymentBreadcrumb('Payment timeout', { paymentId: 'pay_456' });

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.level).toBe('warning');
    });
  });

  describe('addSearchBreadcrumb', () => {
    test('should add search breadcrumb with query details', () => {
      addSearchBreadcrumb('Global search', {
        query: 'plumber',
        filters: { category: 'services' },
        resultCount: 42,
        duration: 150,
        userId: 789,
      });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'search',
        message: 'Global search',
        level: 'info',
        data: expect.objectContaining({
          query: 'plumber',
          filters: { category: 'services' },
          resultCount: 42,
          duration: 150,
          userId: 789,
        }),
      });
    });
  });

  describe('addDatabaseBreadcrumb', () => {
    test('should add database breadcrumb with operation details', () => {
      addDatabaseBreadcrumb('Query executed', {
        operation: 'SELECT',
        table: 'users',
        recordCount: 100,
        duration: 45,
      });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'database',
        message: 'Query executed',
        level: 'info',
        data: expect.objectContaining({
          operation: 'SELECT',
          table: 'users',
          recordCount: 100,
          duration: 45,
        }),
      });
    });
  });

  describe('addAPIBreadcrumb', () => {
    test('should add API breadcrumb with call details', () => {
      addAPIBreadcrumb('GeniusPay API call', {
        service: 'GeniusPay',
        endpoint: '/api/payments',
        method: 'POST',
        status: 200,
        duration: 1200,
      });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'api',
        message: 'GeniusPay API call',
        level: 'info',
        data: expect.objectContaining({
          service: 'GeniusPay',
          endpoint: '/api/payments',
          method: 'POST',
          status: 200,
          duration: 1200,
        }),
      });
    });
  });

  describe('addFileBreadcrumb', () => {
    test('should add file breadcrumb with operation details', () => {
      addFileBreadcrumb('PDF generated', {
        filename: 'invoice_123.pdf',
        operation: 'generate',
        size: 250000,
        type: 'application/pdf',
        duration: 2500,
      });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'file',
        message: 'PDF generated',
        level: 'info',
        data: expect.objectContaining({
          filename: 'invoice_123.pdf',
          operation: 'generate',
          size: 250000,
          type: 'application/pdf',
          duration: 2500,
        }),
      });
    });
  });

  describe('addErrorBreadcrumb', () => {
    test('should add error breadcrumb with error details (no PII)', () => {
      const error = new Error('Payment failed');
      error.code = 'PAY_DECLINED';

      addErrorBreadcrumb('Payment processing error', error, { paymentId: 'pay_789' });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'error',
        message: 'Payment processing error',
        level: 'error',
        data: {
          errorCode: 'PAY_DECLINED',
          errorType: 'Error',
        },
      });
    });
  });

  describe('addRetryBreadcrumb', () => {
    test('should add retry breadcrumb with attempt count', () => {
      addRetryBreadcrumb('API retry', 2, 3, { service: 'GeniusPay' });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'retry',
        message: 'API retry (attempt 2/3)',
        level: 'warning',
        data: expect.objectContaining({
          attempt: 2,
          maxAttempts: 3,
          service: 'GeniusPay',
        }),
      });
    });

    test('should set error level on final attempt', () => {
      addRetryBreadcrumb('API retry', 3, 3, { service: 'GeniusPay' });

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.level).toBe('error');
    });

    test('should set warning level on non-final attempt', () => {
      addRetryBreadcrumb('API retry', 1, 3, { service: 'GeniusPay' });

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.level).toBe('warning');
    });
  });

  describe('addCircuitBreakerBreadcrumb', () => {
    test('should add circuit breaker breadcrumb with status', () => {
      addCircuitBreakerBreadcrumb('GeniusPay', 'OPEN', {
        failureCount: 5,
        threshold: 5,
        resetTime: 300000,
      });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'circuit-breaker',
        message: 'Circuit breaker GeniusPay: OPEN',
        level: 'error',
        data: expect.objectContaining({
          service: 'GeniusPay',
          status: 'OPEN',
          failureCount: 5,
          threshold: 5,
          resetTime: 300000,
        }),
      });
    });

    test('should set error level for OPEN status', () => {
      addCircuitBreakerBreadcrumb('Mailjet', 'OPEN', {});

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.level).toBe('error');
    });

    test('should set warning level for HALF_OPEN status', () => {
      addCircuitBreakerBreadcrumb('Twilio', 'HALF_OPEN', {});

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.level).toBe('warning');
    });
  });

  describe('PII masking', () => {
    test('should mask email with at least 3 chars', () => {
      addAuthBreadcrumb('Login', { email: 'john@example.com' });

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.data.email).toMatch(/^jo\*\*\*\*@example\.com$/);
    });

    test('should mask short emails', () => {
      addAuthBreadcrumb('Login', { email: 'a@example.com' });

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call.data.email).toBeDefined();
    });
  });

  describe('breadcrumb structure', () => {
    test('all breadcrumbs have required fields', () => {
      addAuthBreadcrumb('Test', {});

      const call = Sentry.addBreadcrumb.mock.calls[0][0];
      expect(call).toHaveProperty('category');
      expect(call).toHaveProperty('message');
      expect(call).toHaveProperty('level');
      expect(call).toHaveProperty('data');
      expect(['info', 'warning', 'error']).toContain(call.level);
    });
  });
});
