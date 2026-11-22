/**
 * Coverage boost — config gaps
 * Covers: config/2fa, config/scaling (GracefulShutdown + WorkerManager), config/mailer (send function)
 */

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

// ─── config/2fa ────────────────────────────────────────────────────────────────

describe('config/2fa', () => {
  let twoFAConfig;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../utils/logger', () => ({
      info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
    }));
    twoFAConfig = require('../config/2fa');
  });

  test('generateSecret returns base32 secret and otpauth_url', async () => {
    const result = await twoFAConfig.generateSecret('user@example.com');
    expect(result.secret).toBeDefined();
    expect(result.otpauth_url).toContain('otpauth://');
  });

  test('generateQRCode returns data URL for valid otpauth URL', async () => {
    const { otpauth_url } = await twoFAConfig.generateSecret('user@example.com');
    const qr = await twoFAConfig.generateQRCode(otpauth_url);
    expect(qr).toMatch(/^data:image\/png;base64,/);
  });

  test('generateQRCode throws on invalid URL', async () => {
    await expect(twoFAConfig.generateQRCode('')).rejects.toThrow();
  });

  test('verifyToken returns false for wrong token (non-digits)', () => {
    expect(twoFAConfig.verifyToken('abc123', 'JBSWY3DPEHPK3PXP')).toBe(false);
  });

  test('verifyToken returns false for wrong 6-digit token', () => {
    expect(twoFAConfig.verifyToken('000000', 'JBSWY3DPEHPK3PXP')).toBe(false);
  });

  test('verifyToken returns false when token has spaces', () => {
    expect(twoFAConfig.verifyToken('12 34 56', 'JBSWY3DPEHPK3PXP')).toBe(false);
  });

  test('verifyToken handles exception gracefully (returns false)', () => {
    // null secret triggers error in speakeasy
    expect(twoFAConfig.verifyToken('123456', null)).toBe(false);
  });

  test('generateBackupCodes returns 10 8-digit codes', () => {
    const codes = twoFAConfig.generateBackupCodes();
    expect(codes.length).toBe(10);
    codes.forEach(code => {
      expect(code).toMatch(/^\d{8}$/);
    });
  });

  test('hashBackupCodes returns object with hashes as keys', () => {
    const codes = twoFAConfig.generateBackupCodes();
    const hashed = twoFAConfig.hashBackupCodes(codes);
    expect(Object.keys(hashed).length).toBe(10);
    Object.values(hashed).forEach(v => expect(v).toBe(false));
  });

  test('validateBackupCode returns true for valid unused code', () => {
    const codes = twoFAConfig.generateBackupCodes();
    const hashed = twoFAConfig.hashBackupCodes(codes);
    expect(twoFAConfig.validateBackupCode(codes[0], hashed)).toBe(true);
  });

  test('validateBackupCode returns false for unknown code', () => {
    const hashed = {};
    expect(twoFAConfig.validateBackupCode('99999999', hashed)).toBe(false);
  });

  test('validateBackupCode returns false for already-used code', () => {
    const codes = twoFAConfig.generateBackupCodes();
    const hashed = twoFAConfig.hashBackupCodes(codes);
    const updated = twoFAConfig.markBackupCodeUsed(codes[0], hashed);
    expect(twoFAConfig.validateBackupCode(codes[0], updated)).toBe(false);
  });

  test('markBackupCodeUsed marks hash as true', () => {
    const codes = twoFAConfig.generateBackupCodes();
    const hashed = twoFAConfig.hashBackupCodes(codes);
    const updated = twoFAConfig.markBackupCodeUsed(codes[0], hashed);
    // Original unchanged (immutable)
    expect(hashed[Object.keys(hashed)[0]]).toBe(false);
    // Count of used in updated is 1
    const usedCount = Object.values(updated).filter(v => v === true).length;
    expect(usedCount).toBe(1);
  });

  test('markBackupCodeUsed is immutable (does not mutate original)', () => {
    const codes = twoFAConfig.generateBackupCodes();
    const hashed = twoFAConfig.hashBackupCodes(codes);
    twoFAConfig.markBackupCodeUsed(codes[0], hashed);
    const usedCount = Object.values(hashed).filter(v => v === true).length;
    expect(usedCount).toBe(0);
  });

  test('getUnusedBackupCodesCount returns 10 for fresh codes', () => {
    const codes = twoFAConfig.generateBackupCodes();
    const hashed = twoFAConfig.hashBackupCodes(codes);
    expect(twoFAConfig.getUnusedBackupCodesCount(hashed)).toBe(10);
  });

  test('getUnusedBackupCodesCount decrements after use', () => {
    const codes = twoFAConfig.generateBackupCodes();
    const hashed = twoFAConfig.hashBackupCodes(codes);
    const updated = twoFAConfig.markBackupCodeUsed(codes[0], hashed);
    expect(twoFAConfig.getUnusedBackupCodesCount(updated)).toBe(9);
  });
});

// ─── config/scaling — GracefulShutdown + WorkerManager ────────────────────────

describe('config/scaling — GracefulShutdown', () => {
  let GracefulShutdown;
  let logger;
  let exitSpy;

  // Fake timers + process.exit mock are set up HERE so afterEach always cleans up,
  // even if a test throws mid-way.
  beforeEach(() => {
    jest.resetModules();
    jest.mock('../utils/logger', () => ({
      info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
    }));
    jest.useFakeTimers();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    ({ GracefulShutdown } = require('../config/scaling'));
    logger = require('../utils/logger');
  });

  afterEach(() => {
    // clearAllTimers before useRealTimers so no fake interval leaks into real time
    jest.clearAllTimers();
    jest.useRealTimers();
    exitSpy.mockRestore();
  });

  function makeServer() {
    const listeners = {};
    return {
      on: (event, cb) => { listeners[event] = cb; },
      close: jest.fn(cb => cb && cb()),
      _emit: (event, ...args) => listeners[event] && listeners[event](...args),
    };
  }

  test('initialize tracks request and removes on finish', () => {
    const server = makeServer();
    const gs = new GracefulShutdown(server, { timeout: 5000, logger });
    gs.initialize();

    const finishListeners = [];
    const res = { on: (evt, cb) => { if (evt === 'finish') finishListeners.push(cb); } };
    server._emit('request', {}, res);
    expect(gs.activeConnections.size).toBe(1);

    finishListeners[0]();
    expect(gs.activeConnections.size).toBe(0);
  });

  test('shutdown sets isShuttingDown synchronously and closes server', () => {
    const server = makeServer();
    const gs = new GracefulShutdown(server, { timeout: 5000, logger });

    gs.shutdown('SIGTERM');

    expect(gs.isShuttingDown).toBe(true);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  test('shutdown calls process.exit(0) after first tick with no active connections', () => {
    const server = makeServer();
    const gs = new GracefulShutdown(server, { timeout: 5000, logger });

    gs.shutdown('SIGTERM');
    // No active connections: first tick at 1000ms triggers clearInterval + process.exit(0)
    jest.advanceTimersByTime(1000);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('shutdown is idempotent — second call when already shutting down is a no-op', async () => {
    const server = makeServer();
    const gs = new GracefulShutdown(server, { timeout: 5000, logger });
    gs.isShuttingDown = true;
    await gs.shutdown('SIGTERM');
    expect(server.close).not.toHaveBeenCalled();
  });

  test('getStats returns activeConnections and isShuttingDown', () => {
    const server = makeServer();
    const gs = new GracefulShutdown(server, { timeout: 5000, logger });
    const stats = gs.getStats();
    expect(stats.activeConnections).toBe(0);
    expect(stats.isShuttingDown).toBe(false);
  });
});

describe('config/scaling — WorkerManager', () => {
  let WorkerManager;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../utils/logger', () => ({
      info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
    }));
    ({ WorkerManager } = require('../config/scaling'));
    logger = require('../utils/logger');
  });

  // afterEach cleans up any fake timers left by monitorMemory test
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('getWorkerInfo returns pid, uptime, memory', () => {
    const wm = new WorkerManager({ logger });
    const info = wm.getWorkerInfo();
    expect(info.pid).toBe(process.pid);
    expect(typeof info.uptime).toBe('number');
    expect(info.memory).toBeDefined();
  });

  test('getConfig returns numWorkers and nodeVersion', () => {
    const wm = new WorkerManager({ logger });
    const config = wm.getConfig();
    expect(config.numWorkers).toBeGreaterThan(0);
    expect(config.nodeVersion).toMatch(/^v\d+/);
  });

  test('monitorMemory fires the interval callback without throwing', () => {
    jest.useFakeTimers();
    const wm = new WorkerManager({ logger });
    wm.monitorMemory({ maxMemoryMb: 500, checkInterval: 1000 });
    // Advance exactly one tick to exercise the callback (memory check)
    jest.advanceTimersByTime(1000);
    // afterEach handles clearAllTimers + useRealTimers
  });
});

describe('config/scaling — getEcosystemConfig', () => {
  test('returns apps array with cluster config', () => {
    const { getEcosystemConfig } = require('../config/scaling');
    const config = getEcosystemConfig();
    expect(config.apps).toBeDefined();
    expect(config.apps.length).toBeGreaterThan(0);
    expect(config.apps[0].exec_mode).toBe('cluster');
  });
});

// Note: mailer tests are in coverage-boost-mailer.test.js (needs its own mock setup)
