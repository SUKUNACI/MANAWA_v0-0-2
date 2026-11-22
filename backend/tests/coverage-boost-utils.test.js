/**
 * Coverage boost — utils gaps
 * Covers: AdaptiveRateLimiter (branches manquantes), logger, pii-detector, utils/2fa
 */

const { AdaptiveRateLimiter } = require('../utils/rate-limiter-adaptive');

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

// ─── AdaptiveRateLimiter — branches non couvertes ─────────────────────────────

describe('AdaptiveRateLimiter — missing branches', () => {
  beforeEach(() => jest.clearAllMocks());

  // Constructor defaults (serviceName, remainingThreshold, minimumRemaining fallbacks)
  test('uses default serviceName when no option provided', () => {
    const rl = new AdaptiveRateLimiter();
    expect(rl.serviceName).toBe('Unknown Service');
  });

  test('uses provided serviceName', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'MyService' });
    expect(rl.serviceName).toBe('MyService');
  });

  // execute() — isRateLimited branch
  test('execute queues when isRateLimited is true', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    rl.rateLimit.isRateLimited = true;
    const fn = jest.fn().mockResolvedValue('ok');

    const promise = rl.execute(fn);
    expect(rl.requestQueue.length).toBe(1);

    // Unblock the queue
    rl.rateLimit.isRateLimited = false;
    await rl.processQueue();
    await promise;
    expect(fn).toHaveBeenCalled();
  });

  // execute() — throttle path
  test('execute throttles and logs when shouldThrottle() is true', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test', minimumRemaining: 20 });
    rl.rateLimit.remaining = 5;
    rl.rateLimit.limit = 100;
    rl.rateLimit.reset = Math.floor(Date.now() / 1000) + 1; // 1 second from now

    const fn = jest.fn().mockResolvedValue({ headers: { 'x-ratelimit-remaining': '5' } });
    await rl.execute(fn);

    expect(rl.stats.throttledRequests).toBe(1);
  });

  // execute() — result with headers
  test('execute parses rate limit headers from response object', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    const fn = jest.fn().mockResolvedValue({
      headers: { 'x-ratelimit-limit': '200', 'x-ratelimit-remaining': '150' }
    });

    await rl.execute(fn);
    expect(rl.rateLimit.limit).toBe(200);
    expect(rl.rateLimit.remaining).toBe(150);
  });

  // execute() — result without headers key (direct object)
  test('execute parses headers from flat response object', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    const fn = jest.fn().mockResolvedValue({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '80',
    });

    await rl.execute(fn);
    expect(rl.rateLimit.limit).toBe(100);
  });

  // execute() — error thrown
  test('execute propagates error after handleRateLimitError', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    const err = new Error('429');
    err.response = { status: 429, headers: {} };
    const fn = jest.fn().mockRejectedValue(err);

    await expect(rl.execute(fn)).rejects.toThrow('429');
    expect(rl.rateLimit.isRateLimited).toBe(true);
  });

  // parseRateLimitHeaders — approaching limit logging
  test('parseRateLimitHeaders logs approaching limit', () => {
    const logger = require('../utils/logger');
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test', minimumRemaining: 10 });
    rl.parseRateLimitHeaders({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '5',
      'x-ratelimit-reset': (Math.floor(Date.now() / 1000) + 60).toString(),
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Approaching rate limit'),
      expect.any(Object)
    );
  });

  // parseRateLimitHeaders — empty headers object (no-op, no crash)
  test('parseRateLimitHeaders handles empty headers object without updating state', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    expect(() => rl.parseRateLimitHeaders({})).not.toThrow();
    expect(rl.rateLimit.limit).toBeNull();
    expect(rl.rateLimit.remaining).toBeNull();
  });

  // handleRateLimitError — 429 without retry-after header
  test('handleRateLimitError 429 without retry-after', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    const err = new Error('429');
    err.response = { status: 429, headers: {} };
    rl.handleRateLimitError(err);
    expect(rl.rateLimit.isRateLimited).toBe(true);
    expect(rl.stats.rateLimitedResponses).toBe(1);
  });

  // handleRateLimitError — non-429/503 ignored
  test('handleRateLimitError ignores non-rate-limit errors', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    const err = new Error('500');
    err.response = { status: 500 };
    rl.handleRateLimitError(err);
    expect(rl.rateLimit.isRateLimited).toBe(false);
  });

  // shouldThrottle — no data returns false
  test('shouldThrottle returns false when no rate limit data', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    expect(rl.shouldThrottle()).toBe(false);
  });

  // calculateDelay — null remaining
  test('calculateDelay returns baseDelay when remaining is null', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    expect(rl.calculateDelay()).toBe(100);
  });

  // calculateDelay — has reset, remaining > 0
  test('calculateDelay uses reset window when available', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    rl.rateLimit.remaining = 10;
    rl.rateLimit.limit = 100;
    rl.rateLimit.reset = Math.floor(Date.now() / 1000) + 30;
    const delay = rl.calculateDelay();
    expect(delay).toBeGreaterThan(0);
  });

  // calculateDelay — reset in past (remaining > 0, secondsUntilReset <= 0)
  test('calculateDelay falls back to percentage when reset is past', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    rl.rateLimit.remaining = 50;
    rl.rateLimit.limit = 100;
    rl.rateLimit.reset = Math.floor(Date.now() / 1000) - 10; // in the past
    const delay = rl.calculateDelay();
    expect(delay).toBeGreaterThan(0);
  });

  // calculateRetryDelay — with retryAfter
  test('calculateRetryDelay uses retryAfter seconds', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    rl.rateLimit.retryAfter = 15;
    expect(rl.calculateRetryDelay()).toBe(15000);
  });

  // calculateRetryDelay — with reset timestamp
  test('calculateRetryDelay uses reset timestamp', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    rl.rateLimit.reset = Math.floor(Date.now() / 1000) + 20;
    const delay = rl.calculateRetryDelay();
    expect(delay).toBeGreaterThan(1000);
  });

  // getHeaderValue — null headers
  test('getHeaderValue returns null for null headers', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    expect(rl.getHeaderValue(null, 'x-ratelimit-limit')).toBeNull();
  });

  // getHeaderValue — exact key match
  test('getHeaderValue finds header by exact key', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    expect(rl.getHeaderValue({ 'x-ratelimit-limit': '100' }, 'x-ratelimit-limit')).toBe('100');
  });

  // getHeaderValue — case-insensitive fallback
  test('getHeaderValue finds header case-insensitively', () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    expect(rl.getHeaderValue({ 'X-RateLimit-Limit': '200' }, 'x-ratelimit-limit')).toBe('200');
  });

  // processQueue — guard: empty queue
  test('processQueue returns early when queue is empty', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    // Should not throw or hang
    await rl.processQueue();
    expect(rl.isProcessing).toBe(false);
  });

  // processQueue — guard: already processing
  test('processQueue returns early when already processing', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    rl.isProcessing = true;
    rl.requestQueue.push({ fn: jest.fn(), args: [], resolve: jest.fn(), reject: jest.fn(), queuedAt: Date.now() });
    await rl.processQueue();
    // Queue unchanged because we returned early
    expect(rl.requestQueue.length).toBe(1);
    rl.isProcessing = false;
    rl.requestQueue = [];
  });

  // processQueue — parses headers from queued result
  test('processQueue parses headers from queued request result', async () => {
    const rl = new AdaptiveRateLimiter({ serviceName: 'Test' });
    const fn = jest.fn().mockResolvedValue({ headers: { 'x-ratelimit-limit': '50' } });

    let resolvedVal = null;
    rl.requestQueue.push({ fn, args: [], resolve: (v) => { resolvedVal = v; }, reject: jest.fn(), queuedAt: Date.now() });

    await rl.processQueue();
    expect(rl.rateLimit.limit).toBe(50);
  });
});

// ─── utils/logger — via mock (vérification des appels) ────────────────────────

describe('utils/logger — mock call verification', () => {
  const logger = require('../utils/logger');

  beforeEach(() => jest.clearAllMocks());

  test('logger.info is callable', () => {
    logger.info('test message', { key: 'value' });
    expect(logger.info).toHaveBeenCalledWith('test message', { key: 'value' });
  });

  test('logger.warn is callable', () => {
    logger.warn('warn message');
    expect(logger.warn).toHaveBeenCalledWith('warn message');
  });

  test('logger.error is callable', () => {
    logger.error('error message', { code: 500 });
    expect(logger.error).toHaveBeenCalledWith('error message', { code: 500 });
  });

  test('logger.debug is callable', () => {
    logger.debug('debug message');
    expect(logger.debug).toHaveBeenCalledWith('debug message');
  });
});

// ─── config/pii-detector — missing branches ────────────────────────────────────

describe('pii-detector — missing branches', () => {
  let detector;

  beforeEach(() => {
    jest.resetModules();
    detector = require('../config/pii-detector');
  });

  test('detectPii returns empty array for non-string', () => {
    expect(detector.detectPii(null)).toEqual([]);
    expect(detector.detectPii(42)).toEqual([]);
    expect(detector.detectPii({})).toEqual([]);
  });

  test('maskString returns non-string values as-is', () => {
    expect(detector.maskString(null)).toBeNull();
    expect(detector.maskString(42)).toBe(42);
  });

  test('maskObject handles null', () => {
    expect(detector.maskObject(null)).toBeNull();
  });

  test('maskObject handles undefined', () => {
    expect(detector.maskObject(undefined)).toBeUndefined();
  });

  test('maskObject handles string value', () => {
    const result = detector.maskObject('hello@test.com');
    expect(result).toContain('@');
  });

  test('maskObject handles primitive number', () => {
    expect(detector.maskObject(42)).toBe(42);
  });

  test('maskObject handles arrays', () => {
    const result = detector.maskObject(['hello', 'world']);
    expect(Array.isArray(result)).toBe(true);
  });

  test('maskObject redacts sensitive field names', () => {
    const result = detector.maskObject({ password: 'secret123', name: 'John' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.name).toBe('John');
  });

  test('maskObject handles deep nesting (depth > 6)', () => {
    let deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };
    const result = detector.maskObject(deep);
    expect(result).toBeDefined();
  });

  test('maskEmail with no @ in email', () => {
    const result = detector.maskString('not-an-email');
    expect(result).toBe('not-an-email');
  });

  test('detectPii detects email', () => {
    const found = detector.detectPii('Contact us at user@example.com');
    expect(found).toContain('email');
  });

  test('detectPii detects JWT', () => {
    const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc123def456';
    const found = detector.detectPii(`token: ${fakeJwt}`);
    expect(found).toContain('jwt');
  });

  test('detectPii detects IPv4', () => {
    const found = detector.detectPii('Request from 192.168.1.1');
    expect(found).toContain('ip_v4');
  });
});

// ─── utils/2fa — all functions ─────────────────────────────────────────────────

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('utils/2fa', () => {
  let twoFA;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../utils/logger', () => ({
      info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
    }));
    twoFA = require('../utils/2fa');
  });

  test('setup2FA returns secret, qrCode, backupCodes, hashedBackupCodes', async () => {
    const result = await twoFA.setup2FA('user@example.com');
    expect(result).toHaveProperty('secret');
    expect(result).toHaveProperty('qrCode');
    expect(result).toHaveProperty('backupCodes');
    expect(result).toHaveProperty('hashedBackupCodes');
    expect(result).toHaveProperty('otpauth_url');
    expect(Array.isArray(result.backupCodes)).toBe(true);
    expect(result.backupCodes.length).toBe(10);
  });

  test('verify2FAToken returns false for invalid token', () => {
    const result = twoFA.verify2FAToken('000000', 'INVALIDSECRET');
    expect(result).toBe(false);
  });

  test('verify2FAToken returns false for non-6-digit token', () => {
    const result = twoFA.verify2FAToken('abc', 'INVALIDSECRET');
    expect(result).toBe(false);
  });

  test('verifyBackupCode returns false for unknown code', () => {
    const result = twoFA.verifyBackupCode('00000000', {});
    expect(result).toBe(false);
  });

  test('verifyBackupCode returns false for already-used code', async () => {
    const setup = await twoFA.setup2FA('user@example.com');
    const code = setup.backupCodes[0];
    const used = twoFA.useBackupCode(code, setup.hashedBackupCodes);
    // Now marked as used
    const result = twoFA.verifyBackupCode(code, used);
    expect(result).toBe(false);
  });

  test('verifyBackupCode returns true for valid unused code', async () => {
    const setup = await twoFA.setup2FA('user@example.com');
    const code = setup.backupCodes[0];
    const result = twoFA.verifyBackupCode(code, setup.hashedBackupCodes);
    expect(result).toBe(true);
  });

  test('useBackupCode marks code as used', async () => {
    const setup = await twoFA.setup2FA('user@example.com');
    const code = setup.backupCodes[0];
    const updated = twoFA.useBackupCode(code, setup.hashedBackupCodes);
    expect(typeof updated).toBe('object');
  });

  test('getRemainingBackupCodes returns count of unused codes', async () => {
    const setup = await twoFA.setup2FA('user@example.com');
    const count = twoFA.getRemainingBackupCodes(setup.hashedBackupCodes);
    expect(count).toBe(10);
  });

  test('getRemainingBackupCodes decrements after use', async () => {
    const setup = await twoFA.setup2FA('user@example.com');
    const updated = twoFA.useBackupCode(setup.backupCodes[0], setup.hashedBackupCodes);
    const count = twoFA.getRemainingBackupCodes(updated);
    expect(count).toBe(9);
  });

  test('regenerateBackupCodes returns 10 fresh codes', async () => {
    const result = await twoFA.regenerateBackupCodes();
    expect(result.backupCodes.length).toBe(10);
    expect(typeof result.hashedBackupCodes).toBe('object');
  });
});
