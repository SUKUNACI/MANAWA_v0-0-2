/**
 * Tests for versioningMiddleware.js
 */

const {
  versioningHeadersMiddleware,
  apiRedirectMiddleware,
  versionValidationMiddleware,
} = require('../../middleware/versioningMiddleware');

const { CURRENT_VERSION } = require('../../config/versioning');

function makeReq(overrides = {}) {
  return {
    baseUrl: '/api/v1',
    path: '/some-route',
    url: '/some-route',
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

function makeRes() {
  const headers = {};
  let statusCode = null;
  let redirectUrl = null;
  let jsonBody = null;

  const res = {
    _headers: headers,
    setHeader: jest.fn((k, v) => { headers[k] = v; }),
    status: jest.fn((code) => { statusCode = code; return res; }),
    json: jest.fn((body) => { jsonBody = body; return res; }),
    redirect: jest.fn((code, url) => { statusCode = code; redirectUrl = url; }),
    getStatusCode: () => statusCode,
    getRedirectUrl: () => redirectUrl,
    getJsonBody: () => jsonBody,
  };

  // Attach the original json method so versioningHeadersMiddleware can store it
  const originalJson = res.json;
  res._originalJson = originalJson;

  return res;
}

describe('versioningHeadersMiddleware', () => {
  test('calls next()', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    versioningHeadersMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('adds X-API-Version header when json is called', () => {
    const req = makeReq({ baseUrl: '/api/v1' });
    const res = makeRes();
    const next = jest.fn();

    versioningHeadersMiddleware(req, res, next);
    res.json({ ok: true });

    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', CURRENT_VERSION);
  });

  test('sets Deprecation: false for /api/v1 paths', () => {
    const req = makeReq({ baseUrl: '/api/v1' });
    const res = makeRes();
    const next = jest.fn();

    versioningHeadersMiddleware(req, res, next);
    res.json({ ok: true });

    expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'false');
  });

  test('sets Deprecation: true for non-v1 paths (deprecated)', () => {
    const req = makeReq({ baseUrl: '/api' });
    const res = makeRes();
    const next = jest.fn();

    versioningHeadersMiddleware(req, res, next);
    res.json({ ok: true });

    expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
  });

  test('sets Sunset header for deprecated paths', () => {
    const req = makeReq({ baseUrl: '/api' });
    const res = makeRes();
    const next = jest.fn();

    versioningHeadersMiddleware(req, res, next);
    res.json({ ok: true });

    const setHeaderCalls = res.setHeader.mock.calls.map(c => c[0]);
    expect(setHeaderCalls).toContain('Sunset');
  });

  test('sets Deprecation-Info header for deprecated paths', () => {
    const req = makeReq({ baseUrl: '/api' });
    const res = makeRes();
    const next = jest.fn();

    versioningHeadersMiddleware(req, res, next);
    res.json({ ok: true });

    const setHeaderCalls = res.setHeader.mock.calls.map(c => c[0]);
    expect(setHeaderCalls).toContain('Deprecation-Info');
  });

  test('no Deprecation header added when json is not called', () => {
    const req = makeReq({ baseUrl: '/api/v1' });
    const res = makeRes();
    const next = jest.fn();

    versioningHeadersMiddleware(req, res, next);
    // Don't call res.json — headers should not be set yet
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

describe('apiRedirectMiddleware', () => {
  test('redirects /api/* paths that are not /api/v1/* or /api/v0/*', () => {
    const req = makeReq({ path: '/api/users', url: '/users', baseUrl: '/api' });
    const res = makeRes();
    const next = jest.fn();

    apiRedirectMiddleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(301, '/api/v1/users');
    expect(next).not.toHaveBeenCalled();
  });

  test('does NOT redirect /api/v1/* paths', () => {
    const req = makeReq({ path: '/api/v1/users', url: '/users', baseUrl: '/api/v1' });
    const res = makeRes();
    const next = jest.fn();

    apiRedirectMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('calls next() when path does not match redirect pattern', () => {
    const req = makeReq({ path: '/health', url: '/health', baseUrl: '' });
    const res = makeRes();
    const next = jest.fn();

    apiRedirectMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('versionValidationMiddleware', () => {
  test('calls next() when no version header is provided', () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = jest.fn();

    versionValidationMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('calls next() when client requests current version', () => {
    const req = makeReq({ headers: { 'x-api-version': CURRENT_VERSION } });
    const res = makeRes();
    const next = jest.fn();

    versionValidationMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('calls next() when client requests deprecated but not sunset version', () => {
    // v0 is deprecated but sunsetDate is in future (2027-05-10)
    const req = makeReq({ headers: { 'x-api-version': 'v0' } });
    const res = makeRes();
    const next = jest.fn();

    versionValidationMiddleware(req, res, next);

    // next() should be called since sunset is in the future
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('uses accept-version header as well as x-api-version', () => {
    const req = makeReq({ headers: { 'accept-version': CURRENT_VERSION } });
    const res = makeRes();
    const next = jest.fn();

    versionValidationMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('calls next() for unknown version not in deprecation schedule', () => {
    const req = makeReq({ headers: { 'x-api-version': 'v99' } });
    const res = makeRes();
    const next = jest.fn();

    versionValidationMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
