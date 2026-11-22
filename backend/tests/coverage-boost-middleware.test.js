/**
 * Coverage boost — middleware gaps
 * Covers: csrfValidation, api-timeout, middleware/auth missing branches
 */

const express = require('express');
const request = require('supertest');

// ─── csrfValidation ────────────────────────────────────────────────────────────

const csrfValidation = require('../middleware/csrfValidation');

describe('csrfValidation', () => {
  function makeContext(method, headers = {}, cookies = {}) {
    const req = { method, headers, cookies };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    return { req, res, next };
  }

  test('passes GET requests without token', () => {
    const { req, res, next } = makeContext('GET');
    csrfValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes HEAD requests without token', () => {
    const { req, res, next } = makeContext('HEAD');
    csrfValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes OPTIONS requests without token', () => {
    const { req, res, next } = makeContext('OPTIONS');
    csrfValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects POST without header token', () => {
    const { req, res, next } = makeContext('POST', {}, { csrfToken: 'abc' });
    csrfValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF token missing' });
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects POST without cookie token', () => {
    const { req, res, next } = makeContext('POST', { 'x-csrf-token': 'abc' }, {});
    csrfValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF token missing' });
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects POST with mismatched tokens', () => {
    const { req, res, next } = makeContext(
      'POST',
      { 'x-csrf-token': 'token-a' },
      { csrfToken: 'token-b' }
    );
    csrfValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF token mismatch' });
    expect(next).not.toHaveBeenCalled();
  });

  test('passes POST with matching tokens via x-csrf-token', () => {
    const token = 'valid-csrf-token-123';
    const { req, res, next } = makeContext(
      'POST',
      { 'x-csrf-token': token },
      { csrfToken: token }
    );
    csrfValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes DELETE with matching tokens via x-xsrf-token', () => {
    const token = 'valid-csrf-token-456';
    const { req, res, next } = makeContext(
      'DELETE',
      { 'x-xsrf-token': token },
      { csrfToken: token }
    );
    csrfValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes PATCH with matching tokens', () => {
    const token = 'patch-token-789';
    const { req, res, next } = makeContext(
      'PATCH',
      { 'x-csrf-token': token },
      { csrfToken: token }
    );
    csrfValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects PUT without both tokens', () => {
    const { req, res, next } = makeContext('PUT', {}, {});
    csrfValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── api-timeout middleware ────────────────────────────────────────────────────

const { createTimeoutMiddleware, paymentTimeoutMiddleware, subscriptionTimeoutMiddleware } = require('../middleware/api-timeout');

describe('api-timeout — createTimeoutMiddleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  test('sends 504 when handler exceeds timeout', (done) => {
    app.use(createTimeoutMiddleware(80, 'payments'));
    app.get('/slow', (req, res) => {
      setTimeout(() => {
        try { res.json({ ok: true }); } catch (_) {}
      }, 300);
    });
    request(app)
      .get('/slow')
      .expect(504)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.code).toBe('TIMEOUT_ERR');
        expect(res.body.retryable).toBe(true);
        done();
      });
  }, 5000);

  test('error message contains service type', (done) => {
    app.use(createTimeoutMiddleware(80, 'subscriptions'));
    app.get('/slow', (req, res) => {
      setTimeout(() => {
        try { res.json({ ok: true }); } catch (_) {}
      }, 300);
    });
    request(app)
      .get('/slow')
      .expect(504)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.error).toContain('subscriptions');
        done();
      });
  }, 5000);

  test('completes normally within timeout', (done) => {
    app.use(createTimeoutMiddleware(500, 'payments'));
    app.get('/fast', (req, res) => {
      res.json({ ok: true });
    });
    request(app)
      .get('/fast')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.ok).toBe(true);
        done();
      });
  }, 5000);

  test('guards res.json post-timeout: late json call is a no-op', (done) => {
    app.use(createTimeoutMiddleware(80, 'test'));
    app.get('/late-json', (req, res) => {
      setTimeout(() => {
        try { res.json({ late: true }); } catch (_) {}
      }, 300);
    });
    request(app)
      .get('/late-json')
      .expect(504)
      .end((err) => {
        if (err) return done(err);
        done();
      });
  }, 5000);

  test('guards res.send post-timeout: late send call is a no-op', (done) => {
    app.use(createTimeoutMiddleware(80, 'test'));
    app.get('/late-send', (req, res) => {
      setTimeout(() => {
        try { res.send('late'); } catch (_) {}
      }, 300);
    });
    request(app)
      .get('/late-send')
      .expect(504)
      .end((err) => {
        if (err) return done(err);
        done();
      });
  }, 5000);

  test('paymentTimeoutMiddleware is a function', () => {
    expect(typeof paymentTimeoutMiddleware).toBe('function');
  });

  test('subscriptionTimeoutMiddleware is a function', () => {
    expect(typeof subscriptionTimeoutMiddleware).toBe('function');
  });
});

// ─── middleware/auth — requireAdminOrSuper (uncovered) ─────────────────────────

jest.mock('../config/db', () => ({
  user: { findUnique: jest.fn() },
}), { virtual: true });

jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}), { virtual: true });

const { requireAdminOrSuper, requireRole } = require('../middleware/auth');

describe('middleware/auth — requireAdminOrSuper', () => {
  function ctx(user = null) {
    const req = { headers: {}, cookies: {}, user };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    return { req, res, next };
  }

  test('rejects when no user', () => {
    const { req, res, next } = ctx(null);
    requireAdminOrSuper(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects CLIENT role', () => {
    const { req, res, next } = ctx({ id: 'u1', role: 'CLIENT' });
    requireAdminOrSuper(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('passes ADMIN role', () => {
    const { req, res, next } = ctx({ id: 'u1', role: 'ADMIN' });
    requireAdminOrSuper(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('middleware/auth — requireRole with array arg', () => {
  function ctx(role) {
    const req = { headers: {}, cookies: {}, user: { id: 'u1', role } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    return { req, res, next };
  }

  test('accepts array form requireRole([...])', () => {
    const { req, res, next } = ctx('ADMIN');
    requireRole(['ADMIN', 'MODERATOR'])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects role not in array', () => {
    const { req, res, next } = ctx('CLIENT');
    requireRole(['ADMIN', 'MODERATOR'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── api-timeout — unit tests (socket errors + write guard) ───────────────────

describe('api-timeout — unit tests (socket errors, write guard, else-if path)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // Builds a minimal req/res/next. The socket mimics the interception pattern:
  // createTimeoutMiddleware replaces req.socket.on; we keep the original so
  // calling req.socket.on('error', handler) after middleware runs stores the
  // wrapped handler. We then fire it by calling wrappedHandlers['error'](err).
  function makeFullRes() {
    return {
      headersSent: false,
      finished: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      write: jest.fn().mockReturnValue(true),
      end: jest.fn().mockReturnThis(),
      on: jest.fn(),
    };
  }

  function makeReq() {
    const capturedHandlers = {};
    const req = {
      path: '/test',
      method: 'GET',
      socket: { on: (evt, cb) => { capturedHandlers[evt] = cb; } },
    };
    return { req, capturedHandlers };
  }

  test('else-if path: timeout fires when headersSent=true and not finished → calls res.end()', () => {
    const { req } = makeReq();
    const res = makeFullRes();
    createTimeoutMiddleware(1000, 'test')(req, res, jest.fn());
    // res.end is now the middleware wrapper. Spy on it after wrapping.
    const endSpy = jest.spyOn(res, 'end');
    res.headersSent = true;
    res.finished = false;
    jest.advanceTimersByTime(1000);
    expect(endSpy).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('res.write guard: timedOut+headersSent → returns false', () => {
    const { req } = makeReq();
    const res = makeFullRes();
    createTimeoutMiddleware(1000, 'test')(req, res, jest.fn());
    jest.advanceTimersByTime(1000);
    res.headersSent = true;
    const result = res.write('late data');
    expect(result).toBe(false);
  });

  test('socket error ECONNABORTED triggers 504 via captured wrapped handler', () => {
    const { req, capturedHandlers } = makeReq();
    const res = makeFullRes();
    // Save mock references before middleware replaces them
    const statusMock = res.status;
    const jsonMock = res.json;
    createTimeoutMiddleware(5000, 'payments')(req, res, jest.fn());
    req.socket.on('error', jest.fn());
    capturedHandlers['error']({ code: 'ECONNABORTED' });
    expect(statusMock).toHaveBeenCalledWith(504);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TIMEOUT_ECONNABORTED', retryable: true })
    );
  });

  test('socket error ETIMEDOUT triggers 504', () => {
    const { req, capturedHandlers } = makeReq();
    const res = makeFullRes();
    const statusMock = res.status;
    const jsonMock = res.json;
    createTimeoutMiddleware(5000, 'subscriptions')(req, res, jest.fn());
    req.socket.on('error', jest.fn());
    capturedHandlers['error']({ code: 'ETIMEDOUT' });
    expect(statusMock).toHaveBeenCalledWith(504);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TIMEOUT_ETIMEDOUT' })
    );
  });

  test('socket error skips 504 when headersSent=true', () => {
    const { req, capturedHandlers } = makeReq();
    const res = makeFullRes();
    const statusMock = res.status;
    res.headersSent = true;
    createTimeoutMiddleware(5000, 'test')(req, res, jest.fn());
    req.socket.on('error', jest.fn());
    capturedHandlers['error']({ code: 'ECONNABORTED' });
    expect(statusMock).not.toHaveBeenCalled();
  });

  test('socket error calls original handler for non-timeout code (ECONNRESET)', () => {
    const { req, capturedHandlers } = makeReq();
    const res = makeFullRes();
    const statusMock = res.status;
    createTimeoutMiddleware(5000, 'test')(req, res, jest.fn());
    const original = jest.fn();
    req.socket.on('error', original);
    capturedHandlers['error']({ code: 'ECONNRESET' });
    expect(original).toHaveBeenCalledWith(expect.objectContaining({ code: 'ECONNRESET' }));
    expect(statusMock).not.toHaveBeenCalled();
  });

  test('socket.on for non-error event calls through without wrapping', () => {
    const { req, capturedHandlers } = makeReq();
    const res = makeFullRes();
    createTimeoutMiddleware(5000, 'test')(req, res, jest.fn());
    const handler = jest.fn();
    req.socket.on('close', handler);
    capturedHandlers['close']();
    expect(handler).toHaveBeenCalled();
  });
});
