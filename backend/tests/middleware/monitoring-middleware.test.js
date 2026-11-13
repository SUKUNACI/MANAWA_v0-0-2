/**
 * Tests for monitoring-middleware.js
 */

const monitoring = require('../../utils/monitoring');

jest.mock('../../utils/monitoring', () => ({
  recordRequest: jest.fn(),
  recordDatabaseOperation: jest.fn(),
  recordPayment: jest.fn(),
  recordBooking: jest.fn(),
  recordActiveUser: jest.fn(),
  recordQuote: jest.fn(),
  recordConversion: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  monitoringMiddleware,
  recordDatabaseMetrics,
  recordPaymentMetrics,
  recordBookingMetrics,
  recordActiveUserMetrics,
  recordQuoteMetrics,
  recordConversionMetrics,
} = require('../../middleware/monitoring-middleware');

function makeReqRes() {
  const req = { method: 'GET', path: '/test', route: { path: '/test' } };
  const eventListeners = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    _originalJson: null,
    _originalSend: null,
    json: jest.fn(),
    send: jest.fn(),
    on: jest.fn((event, cb) => { eventListeners[event] = cb; }),
    _emit: (event) => { if (eventListeners[event]) eventListeners[event](); },
  };
  res._originalJson = res.json;
  res._originalSend = res.send;
  const next = jest.fn();
  return { req, res, next, eventListeners };
}

describe('monitoringMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls next()', () => {
    const { req, res, next } = makeReqRes();
    monitoringMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('overrides res.json and calls monitoring.recordRequest when json is called', () => {
    const { req, res, next } = makeReqRes();
    monitoringMiddleware(req, res, next);

    // Calling the overridden json
    res.json({ hello: 'world' });

    expect(monitoring.recordRequest).toHaveBeenCalledWith(
      req,
      res,
      expect.any(Number)
    );
  });

  test('overrides res.send and calls monitoring.recordRequest when send is called', () => {
    const { req, res, next } = makeReqRes();
    monitoringMiddleware(req, res, next);

    res.send('some text');

    expect(monitoring.recordRequest).toHaveBeenCalledWith(
      req,
      res,
      expect.any(Number)
    );
  });

  test('registers finish event listener on res', () => {
    const { req, res, next } = makeReqRes();
    monitoringMiddleware(req, res, next);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  test('responseTime passed to recordRequest is a non-negative number', () => {
    const { req, res, next } = makeReqRes();
    monitoringMiddleware(req, res, next);
    res.json({ ok: true });

    const responseTime = monitoring.recordRequest.mock.calls[0][2];
    expect(typeof responseTime).toBe('number');
    expect(responseTime).toBeGreaterThanOrEqual(0);
  });
});

describe('recordDatabaseMetrics', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('calls monitoring.recordDatabaseOperation with success=true', () => {
    recordDatabaseMetrics(true, 50, 'SELECT * FROM users');
    expect(monitoring.recordDatabaseOperation).toHaveBeenCalledWith(true, 50, 'SELECT * FROM users');
  });

  test('calls monitoring.recordDatabaseOperation with success=false', () => {
    recordDatabaseMetrics(false, 100, 'INSERT INTO orders');
    expect(monitoring.recordDatabaseOperation).toHaveBeenCalledWith(false, 100, 'INSERT INTO orders');
  });
});

describe('recordPaymentMetrics', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('calls monitoring.recordPayment with amount and status', () => {
    recordPaymentMetrics(5000, 'succeeded');
    expect(monitoring.recordPayment).toHaveBeenCalledWith(5000, 'succeeded');
  });

  test('calls monitoring.recordPayment for failed payment', () => {
    recordPaymentMetrics(1000, 'failed');
    expect(monitoring.recordPayment).toHaveBeenCalledWith(1000, 'failed');
  });
});

describe('recordBookingMetrics', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('calls monitoring.recordBooking', () => {
    recordBookingMetrics();
    expect(monitoring.recordBooking).toHaveBeenCalledTimes(1);
  });
});

describe('recordActiveUserMetrics', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('calls monitoring.recordActiveUser with userId', () => {
    recordActiveUserMetrics('user-123');
    expect(monitoring.recordActiveUser).toHaveBeenCalledWith('user-123');
  });
});

describe('recordQuoteMetrics', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('calls monitoring.recordQuote', () => {
    recordQuoteMetrics();
    expect(monitoring.recordQuote).toHaveBeenCalledTimes(1);
  });
});

describe('recordConversionMetrics', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('calls monitoring.recordConversion', () => {
    recordConversionMetrics();
    expect(monitoring.recordConversion).toHaveBeenCalledTimes(1);
  });
});
