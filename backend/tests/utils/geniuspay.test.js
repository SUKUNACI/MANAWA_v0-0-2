// ── Mock environment variables BEFORE requiring geniuspay ─────────────────────
// geniuspay.js reads process.env at module-load time (API_KEY, API_SECRET, WEBHOOK_SECRET)
process.env.GENIUSPAY_API_KEY = 'test-api-key';
process.env.GENIUSPAY_API_SECRET = 'test-api-secret';
process.env.GENIUSPAY_WEBHOOK_SECRET = 'test-webhook-secret';

// ── Mock axios ──────────────────────────────────────────────────────────────────
// geniuspay.js calls axios.create() at module level and stores the result in `client`.
// The mock must return the SAME instance every call so tests and production code share it.
const mockedAxiosClient = {
  post: jest.fn(),
  get: jest.fn(),
};

jest.mock('axios', () => ({
  create: jest.fn(() => mockedAxiosClient),
}));

// geniuspay.js instancie CircuitBreaker et AdaptiveRateLimiter à la charge du module.
// Ces singletons accumulent de l'état (circuit ouvert, rate limit en file d'attente) au
// fil des tests d'erreur et bloquent les tests suivants avec des timeouts ou des
// rejects CIRCUIT_BREAKER_OPEN. On les remplace par des passthroughs transparents.
jest.mock('../../utils/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: (fn, args = []) => fn(...args),
  })),
}));

jest.mock('../../utils/rate-limiter-adaptive', () => ({
  AdaptiveRateLimiter: jest.fn().mockImplementation(() => ({
    execute: (fn, args = []) => fn(...args),
  })),
}));

const crypto = require('crypto');
const geniuspay = require('../../utils/geniuspay');
const axios = require('axios');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Fixtures ────────────────────────────────────────────────────────────────────
const mockPaymentPayload = {
  amount: 100000,
  description: 'Test payment',
  customerName: 'John Doe',
  customerEmail: 'john@test.com',
  customerPhone: '+225123456789',
  quoteId: 'quote-1',
  projectId: 'proj-1',
  isDeposit: true,
  userId: 'user-1',
  idempotencyKey: 'idem-key-1',
  successUrl: 'https://example.com/success',
  errorUrl: 'https://example.com/error',
};

const mockGeniuspayResponse = {
  id: 'pay-gp-1',
  reference: 'REF-12345',
  amount: 100000,
  currency: 'XOF',
  status: 'PENDING',
  created_at: '2026-01-01T00:00:00Z',
  payment_url: 'https://geniuspay.ci/pay/REF-12345',
  metadata: {
    quoteId: 'quote-1',
    projectId: 'proj-1',
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// createPayment - Payment creation
// ══════════════════════════════════════════════════════════════════════════════

describe('geniuspay.createPayment', () => {
  test('should create payment with correct payload structure', async () => {
    mockedAxiosClient.post.mockResolvedValue({ data: mockGeniuspayResponse });

    const result = await geniuspay.createPayment(mockPaymentPayload);

    expect(result).toEqual(mockGeniuspayResponse);
    expect(mockedAxiosClient.post).toHaveBeenCalled();
  });

  test('should include idempotency key to prevent duplicate payments', async () => {
    mockedAxiosClient.post.mockResolvedValue({ data: mockGeniuspayResponse });

    await geniuspay.createPayment(mockPaymentPayload);

    const callArgs = mockedAxiosClient.post.mock.calls[0];
    expect(callArgs[2].headers['X-Idempotency-Key']).toBe(mockPaymentPayload.idempotencyKey);
  });

  test('should include customer information in payload', async () => {
    mockedAxiosClient.post.mockResolvedValue({ data: mockGeniuspayResponse });

    await geniuspay.createPayment(mockPaymentPayload);

    const callArgs = mockedAxiosClient.post.mock.calls[0];
    const payload = callArgs[1];

    expect(payload.customer.name).toBe(mockPaymentPayload.customerName);
    expect(payload.customer.email).toBe(mockPaymentPayload.customerEmail);
    expect(payload.customer.phone).toBe(mockPaymentPayload.customerPhone);
  });

  test('should set currency to XOF', async () => {
    mockedAxiosClient.post.mockResolvedValue({ data: mockGeniuspayResponse });

    await geniuspay.createPayment(mockPaymentPayload);

    const callArgs = mockedAxiosClient.post.mock.calls[0];
    const payload = callArgs[1];
    expect(payload.currency).toBe('XOF');
  });

  test('should include metadata with quote and project IDs', async () => {
    mockedAxiosClient.post.mockResolvedValue({ data: mockGeniuspayResponse });

    await geniuspay.createPayment(mockPaymentPayload);

    const callArgs = mockedAxiosClient.post.mock.calls[0];
    const payload = callArgs[1];

    expect(payload.metadata.quoteId).toBe(mockPaymentPayload.quoteId);
    expect(payload.metadata.projectId).toBe(mockPaymentPayload.projectId);
    expect(payload.metadata.isDeposit).toBe(mockPaymentPayload.isDeposit);
  });

  test('should handle API timeout error', async () => {
    const timeoutError = new Error('ECONNABORTED');
    timeoutError.code = 'ECONNABORTED';
    timeoutError.response = undefined;

    mockedAxiosClient.post.mockRejectedValue(timeoutError);

    await expect(geniuspay.createPayment(mockPaymentPayload)).rejects.toThrow();
  });

  test('should handle payment declined error (4xx)', async () => {
    const declinedError = new Error('Payment declined');
    declinedError.response = {
      status: 402,
      data: { error: 'Insufficient funds' },
    };

    mockedAxiosClient.post.mockRejectedValue(declinedError);

    await expect(geniuspay.createPayment(mockPaymentPayload)).rejects.toThrow();
  });

  test('should handle server error (5xx)', async () => {
    const serverError = new Error('Internal server error');
    serverError.response = {
      status: 500,
      data: { error: 'Server error' },
    };

    mockedAxiosClient.post.mockRejectedValue(serverError);

    await expect(geniuspay.createPayment(mockPaymentPayload)).rejects.toThrow();
  });

  test('should handle network errors gracefully', async () => {
    const networkError = new Error('Network error');
    networkError.code = 'ENOTFOUND';

    mockedAxiosClient.post.mockRejectedValue(networkError);

    await expect(geniuspay.createPayment(mockPaymentPayload)).rejects.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getPayment - Retrieve payment details
// ══════════════════════════════════════════════════════════════════════════════

describe('geniuspay.getPayment', () => {
  test('should retrieve payment by reference', async () => {
    const reference = 'REF-12345';
    mockedAxiosClient.get.mockResolvedValue({ data: mockGeniuspayResponse });

    const result = await geniuspay.getPayment(reference);

    expect(result).toEqual(mockGeniuspayResponse);
    expect(mockedAxiosClient.get).toHaveBeenCalledWith(`/payments/${reference}`);
  });

  test('should handle payment not found error', async () => {
    const notFoundError = new Error('Not found');
    notFoundError.response = {
      status: 404,
      data: { error: 'Payment not found' },
    };

    mockedAxiosClient.get.mockRejectedValue(notFoundError);

    await expect(geniuspay.getPayment('invalid-ref')).rejects.toThrow();
  });

  test('should handle API timeout on get', async () => {
    const timeoutError = new Error('Timeout');
    timeoutError.code = 'ECONNABORTED';

    mockedAxiosClient.get.mockRejectedValue(timeoutError);

    await expect(geniuspay.getPayment('REF-12345')).rejects.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listPayments - List payments with filters
// ══════════════════════════════════════════════════════════════════════════════

describe('geniuspay.listPayments', () => {
  test('should list payments with default filters', async () => {
    const mockList = {
      payments: [mockGeniuspayResponse],
      total: 1,
    };

    mockedAxiosClient.get.mockResolvedValue({ data: mockList });

    const result = await geniuspay.listPayments();

    expect(result).toEqual(mockList);
    expect(mockedAxiosClient.get).toHaveBeenCalledWith('/payments', { params: {} });
  });

  test('should apply status filter when provided', async () => {
    const mockList = { payments: [mockGeniuspayResponse], total: 1 };

    mockedAxiosClient.get.mockResolvedValue({ data: mockList });

    await geniuspay.listPayments({ status: 'COMPLETED' });

    expect(mockedAxiosClient.get).toHaveBeenCalledWith('/payments', { params: { status: 'COMPLETED' } });
  });

  test('should apply multiple filters', async () => {
    const mockList = { payments: [], total: 0 };

    mockedAxiosClient.get.mockResolvedValue({ data: mockList });

    const filters = {
      status: 'COMPLETED',
      limit: 10,
      offset: 0,
    };

    await geniuspay.listPayments(filters);

    expect(mockedAxiosClient.get).toHaveBeenCalledWith('/payments', { params: filters });
  });

  test('should handle empty results', async () => {
    mockedAxiosClient.get.mockResolvedValue({ data: { payments: [], total: 0 } });

    const result = await geniuspay.listPayments();

    expect(result.payments).toEqual([]);
    expect(result.total).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Account Info & Balance
// ══════════════════════════════════════════════════════════════════════════════

describe('geniuspay.getAccountInfo', () => {
  test('should retrieve account information', async () => {
    const accountInfo = {
      id: 'account-1',
      name: 'MANAWA Inc',
      email: 'admin@manawa.ci',
      balance: 5000000,
      currency: 'XOF',
    };

    mockedAxiosClient.get.mockResolvedValue({ data: accountInfo });

    const result = await geniuspay.getAccountInfo();

    expect(result).toEqual(accountInfo);
    expect(mockedAxiosClient.get).toHaveBeenCalledWith('/account');
  });

  test('should handle account retrieval error', async () => {
    const error = new Error('Unauthorized');
    error.response = {
      status: 401,
      data: { error: 'Invalid API key' },
    };

    mockedAxiosClient.get.mockRejectedValue(error);

    await expect(geniuspay.getAccountInfo()).rejects.toThrow();
  });
});

describe('geniuspay.getAccountBalance', () => {
  test('should retrieve account balance', async () => {
    const balanceInfo = {
      available: 5000000,
      pending: 1000000,
      total: 6000000,
      currency: 'XOF',
    };

    mockedAxiosClient.get.mockResolvedValue({ data: balanceInfo });

    const result = await geniuspay.getAccountBalance();

    expect(result).toEqual(balanceInfo);
    expect(mockedAxiosClient.get).toHaveBeenCalledWith('/account/balance');
  });

  test('should handle zero balance', async () => {
    const balanceInfo = {
      available: 0,
      pending: 0,
      total: 0,
      currency: 'XOF',
    };

    mockedAxiosClient.get.mockResolvedValue({ data: balanceInfo });

    const result = await geniuspay.getAccountBalance();

    expect(result.available).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Pawapay Providers
// ══════════════════════════════════════════════════════════════════════════════

describe('geniuspay.getPawapayProviders', () => {
  test('should retrieve all providers without country filter', async () => {
    const providers = [
      { id: 'mtn-ci', name: 'MTN Côte d\'Ivoire', country: 'CI' },
      { id: 'orange-ci', name: 'Orange Côte d\'Ivoire', country: 'CI' },
    ];

    mockedAxiosClient.get.mockResolvedValue({ data: { providers } });

    const result = await geniuspay.getPawapayProviders();

    expect(result).toEqual({ providers });
    expect(mockedAxiosClient.get).toHaveBeenCalledWith('/pawapay/providers');
  });

  test('should filter providers by country', async () => {
    const providers = [
      { id: 'mtn-ci', name: 'MTN Côte d\'Ivoire', country: 'CI' },
    ];

    mockedAxiosClient.get.mockResolvedValue({ data: { providers } });

    await geniuspay.getPawapayProviders('CI');

    expect(mockedAxiosClient.get).toHaveBeenCalledWith('/pawapay/providers?country=CI');
  });

  test('should handle provider list error', async () => {
    const error = new Error('Service unavailable');
    error.response = {
      status: 503,
      data: { error: 'Service unavailable' },
    };

    mockedAxiosClient.get.mockRejectedValue(error);

    await expect(geniuspay.getPawapayProviders()).rejects.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// refundPayment - Payment refunds
// ══════════════════════════════════════════════════════════════════════════════

describe('geniuspay.refundPayment', () => {
  test('should initiate refund with correct parameters', async () => {
    const refundResponse = {
      id: 'refund-1',
      reference: 'REFUND-12345',
      amount: 100000,
      status: 'INITIATED',
    };

    mockedAxiosClient.post.mockResolvedValue({ data: refundResponse });

    const result = await geniuspay.refundPayment('REF-12345', 100000, 'Customer request');

    expect(result).toEqual(refundResponse);
  });

  test('should use default refund reason if not provided', async () => {
    const refundResponse = { id: 'refund-1', status: 'INITIATED' };

    mockedAxiosClient.post.mockResolvedValue({ data: refundResponse });

    await geniuspay.refundPayment('REF-12345', 50000);

    const callArgs = mockedAxiosClient.post.mock.calls[0];
    const payload = callArgs[1];
    expect(payload.reason).toBe('Remboursement client MANAWA');
  });

  test('should include currency in refund request', async () => {
    mockedAxiosClient.post.mockResolvedValue({ data: { id: 'refund-1' } });

    await geniuspay.refundPayment('REF-12345', 50000, 'Custom reason');

    const callArgs = mockedAxiosClient.post.mock.calls[0];
    const payload = callArgs[1];
    expect(payload.currency).toBe('XOF');
  });

  test('should handle partial refund', async () => {
    mockedAxiosClient.post.mockResolvedValue({ data: { id: 'refund-1' } });

    await geniuspay.refundPayment('REF-12345', 50000);

    const callArgs = mockedAxiosClient.post.mock.calls[0];
    const payload = callArgs[1];
    expect(payload.amount).toBe(50000);
  });

  test('should handle refund already processed error', async () => {
    const error = new Error('Refund already processed');
    error.response = {
      status: 409,
      data: { error: 'Refund already processed' },
    };

    mockedAxiosClient.post.mockRejectedValue(error);

    await expect(geniuspay.refundPayment('REF-12345', 100000)).rejects.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Webhook Verification
// ══════════════════════════════════════════════════════════════════════════════

describe('geniuspay.verifyWebhookSignature', () => {
  test('should verify valid webhook signature', () => {
    const timestamp = '1609459200';
    const payload = { id: 'pay-1', status: 'COMPLETED' };
    const data = `${timestamp}.${JSON.stringify(payload)}`;
    const signature = crypto
      .createHmac('sha256', 'test-webhook-secret')
      .update(data)
      .digest('hex');

    const isValid = geniuspay.verifyWebhookSignature(signature, timestamp, payload);

    expect(isValid).toBe(true);
  });

  test('should reject invalid webhook signature', () => {
    const timestamp = '1609459200';
    const payload = { id: 'pay-1', status: 'COMPLETED' };
    const invalidSignature = 'invalid-signature-hash';

    const isValid = geniuspay.verifyWebhookSignature(invalidSignature, timestamp, payload);

    expect(isValid).toBe(false);
  });

  test('should reject signature for tampered payload', () => {
    const timestamp = '1609459200';
    const originalPayload = { id: 'pay-1', status: 'COMPLETED' };
    const data = `${timestamp}.${JSON.stringify(originalPayload)}`;
    const signature = crypto
      .createHmac('sha256', 'test-webhook-secret')
      .update(data)
      .digest('hex');

    // Verify with tampered payload
    const tamperedPayload = { id: 'pay-1', status: 'FAILED' };
    const isValid = geniuspay.verifyWebhookSignature(signature, timestamp, tamperedPayload);

    expect(isValid).toBe(false);
  });

  test('should prevent timing attacks with timingSafeEqual', () => {
    const timestamp = '1609459200';
    const payload = { id: 'pay-1', status: 'COMPLETED' };
    const data = `${timestamp}.${JSON.stringify(payload)}`;
    const signature = crypto
      .createHmac('sha256', 'test-webhook-secret')
      .update(data)
      .digest('hex');

    // Slightly different signature
    const wrongSignature = signature.slice(0, -1) + '0';

    const isValid = geniuspay.verifyWebhookSignature(wrongSignature, timestamp, payload);

    expect(isValid).toBe(false);
  });

  test('should return false when webhook secret is not configured', () => {
    process.env.GENIUSPAY_WEBHOOK_SECRET = '';

    const isValid = geniuspay.verifyWebhookSignature('signature', '1609459200', {});

    expect(isValid).toBe(false);
  });

  test('should handle different payload structures', () => {
    const timestamp = '1609459200';
    const payload = {
      id: 'pay-1',
      status: 'COMPLETED',
      amount: 100000,
      metadata: { quoteId: 'quote-1' },
    };
    const data = `${timestamp}.${JSON.stringify(payload)}`;
    const signature = crypto
      .createHmac('sha256', 'test-webhook-secret')
      .update(data)
      .digest('hex');

    const isValid = geniuspay.verifyWebhookSignature(signature, timestamp, payload);

    expect(isValid).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Webhook Timestamp Verification
// ══════════════════════════════════════════════════════════════════════════════

describe('geniuspay.verifyWebhookTimestamp', () => {
  test('should accept timestamp within 5-minute window', () => {
    const now = Math.floor(Date.now() / 1000);
    const recentTimestamp = now - 60; // 1 minute ago

    const isValid = geniuspay.verifyWebhookTimestamp(recentTimestamp.toString());

    expect(isValid).toBe(true);
  });

  test('should accept current timestamp', () => {
    const now = Math.floor(Date.now() / 1000);

    const isValid = geniuspay.verifyWebhookTimestamp(now.toString());

    expect(isValid).toBe(true);
  });

  test('should reject timestamp older than 5 minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    const oldTimestamp = now - 600; // 10 minutes ago

    const isValid = geniuspay.verifyWebhookTimestamp(oldTimestamp.toString());

    expect(isValid).toBe(false);
  });

  test('should reject future timestamp beyond 5-minute skew', () => {
    const now = Math.floor(Date.now() / 1000);
    const futureTimestamp = now + 600; // 10 minutes in future

    const isValid = geniuspay.verifyWebhookTimestamp(futureTimestamp.toString());

    expect(isValid).toBe(false);
  });

  test('should allow small future timestamps for clock skew', () => {
    const now = Math.floor(Date.now() / 1000);
    const skewedTimestamp = now + 30; // 30 seconds in future

    const isValid = geniuspay.verifyWebhookTimestamp(skewedTimestamp.toString());

    expect(isValid).toBe(true);
  });

  test('should handle string timestamps correctly', () => {
    const now = Math.floor(Date.now() / 1000);
    const timestamp = (now - 120).toString();

    const isValid = geniuspay.verifyWebhookTimestamp(timestamp);

    expect(isValid).toBe(true);
  });

  test('should reject timestamps older than exactly 5 minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    const exactBoundary = now - 301; // Just over 5 minutes

    const isValid = geniuspay.verifyWebhookTimestamp(exactBoundary.toString());

    expect(isValid).toBe(false);
  });
});
