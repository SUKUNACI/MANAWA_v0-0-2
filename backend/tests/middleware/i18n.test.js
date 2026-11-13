/**
 * Tests for i18n middleware (Q101/Q102)
 */

const i18nMiddleware = require('../../middleware/i18n');
const { DEFAULT_LOCALE } = require('../../config/i18n');

function makeReqRes(overrides = {}) {
  const req = {
    user: undefined,
    headers: {},
    ...overrides,
  };
  const headers = {};
  const res = {
    setHeader: jest.fn((key, val) => { headers[key] = val; }),
    _headers: headers,
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('i18n middleware', () => {
  test('calls next()', () => {
    const { req, res, next } = makeReqRes();
    i18nMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('falls back to DEFAULT_LOCALE (fr) when no user and no header', () => {
    const { req, res, next } = makeReqRes();
    i18nMiddleware(req, res, next);
    expect(req.locale).toBe(DEFAULT_LOCALE);
  });

  test('uses user locale when req.user.locale is set', () => {
    const { req, res, next } = makeReqRes({ user: { locale: 'en' } });
    i18nMiddleware(req, res, next);
    expect(req.locale).toBe('en');
  });

  test('user locale takes precedence over Accept-Language header', () => {
    const { req, res, next } = makeReqRes({
      user: { locale: 'fr' },
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    i18nMiddleware(req, res, next);
    expect(req.locale).toBe('fr');
  });

  test('detects locale from Accept-Language header when no user locale', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    i18nMiddleware(req, res, next);
    expect(req.locale).toBe('en');
  });

  test('falls back to default if Accept-Language is unsupported', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'accept-language': 'de,es' },
    });
    i18nMiddleware(req, res, next);
    expect(req.locale).toBe(DEFAULT_LOCALE);
  });

  test('sets Content-Language header to detected locale', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'accept-language': 'en' },
    });
    i18nMiddleware(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Language', 'en');
  });

  test('attaches req.t() translation helper', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'accept-language': 'en' },
    });
    i18nMiddleware(req, res, next);
    expect(typeof req.t).toBe('function');
  });

  test('req.t() returns translated string for known key', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'accept-language': 'en' },
    });
    i18nMiddleware(req, res, next);
    const result = req.t('auth.unauthorized');
    expect(result).toBe('Unauthorized access');
  });

  test('req.t() uses French for unknown locale', () => {
    const { req, res, next } = makeReqRes();
    i18nMiddleware(req, res, next);
    const result = req.t('auth.unauthorized');
    expect(result).toBe('Accès non autorisé');
  });

  test('req.t() performs variable interpolation', () => {
    const { req, res, next } = makeReqRes();
    i18nMiddleware(req, res, next);
    const result = req.t('payment.success', { amount: 5000 });
    expect(result).toContain('5000');
  });

  test('req.t() returns key if translation missing', () => {
    const { req, res, next } = makeReqRes();
    i18nMiddleware(req, res, next);
    const result = req.t('nonexistent.key');
    expect(result).toBe('nonexistent.key');
  });

  test('handles req.user with no locale property gracefully', () => {
    const { req, res, next } = makeReqRes({ user: { id: '123' } });
    i18nMiddleware(req, res, next);
    expect(req.locale).toBe(DEFAULT_LOCALE);
  });

  test('detects fr from Accept-Language header', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' },
    });
    i18nMiddleware(req, res, next);
    expect(req.locale).toBe('fr');
  });

  test('handles empty Accept-Language header', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'accept-language': '' },
    });
    i18nMiddleware(req, res, next);
    expect(req.locale).toBe(DEFAULT_LOCALE);
  });

  test('req.t() with fr locale translates validation required', () => {
    const { req, res, next } = makeReqRes();
    i18nMiddleware(req, res, next);
    const result = req.t('validation.required');
    expect(result).toBe('Ce champ est obligatoire');
  });

  test('req.t() with en locale translates validation required', () => {
    const { req, res, next } = makeReqRes({
      headers: { 'accept-language': 'en' },
    });
    i18nMiddleware(req, res, next);
    const result = req.t('validation.required');
    expect(result).toBe('This field is required');
  });
});
