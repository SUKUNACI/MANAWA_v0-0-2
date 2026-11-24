/**
 * T2.07 — 2FA Rate Limit Test (Real twoFAVerifyLimiter from Production)
 *
 * Tests the REAL twoFAVerifyLimiter exported from routes/auth-2fa.js.
 * Verifies that 10 requests per 15 minutes per IP are allowed, and the 11th is blocked with 429.
 *
 * Key design:
 * - Desmocks express-rate-limit and loads the actual twoFAVerifyLimiter from production code
 * - Uses jest.isolateModules to bypass tests/setup.js global mock during the import
 * - Tests the limiter with 11 sequential requests from the same IP
 * - Expects requests 1-10: 200 OK
 * - Expects request 11: 429 TOO_MANY_2FA_ATTEMPTS
 */

jest.unmock('express-rate-limit');

const express = require('express');
const request = require('supertest');

describe('T2.07 — 2FA Rate Limit Test (Real twoFAVerifyLimiter)', () => {
  let app;
  let twoFAVerifyLimiter;

  beforeAll(() => {
    // Isolate modules: load the real twoFAVerifyLimiter without the setup.js mock
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const authModule = require('../../routes/auth-2fa');
      twoFAVerifyLimiter = authModule.twoFAVerifyLimiter;
    });

    app = express();
    app.use(express.json());

    // Test endpoint: uses the REAL production limiter
    app.post('/api/v1/auth/2fa/verify', twoFAVerifyLimiter, (req, res) => {
      res.status(200).json({ success: true, message: 'Vérification 2FA acceptée' });
    });
  });

  afterAll(async () => {
    // Reset the in-memory rate-limit store to avoid affecting other tests
    if (typeof twoFAVerifyLimiter.resetKey === 'function') {
      await Promise.all([
        twoFAVerifyLimiter.resetKey('192.168.1.100'),
        twoFAVerifyLimiter.resetKey('127.0.0.1'),
      ].map(p => p.catch(() => {})));
    }
  });

  it('allows first 10 requests and blocks the 11th with 429 rate-limit error', async () => {
    const payload = {
      twoFAToken: 'test-token',
      totpCode: '123456',
    };

    // Send 10 requests — should all succeed (200 OK)
    for (let i = 1; i <= 10; i++) {
      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send(payload)
        .set('X-Forwarded-For', '192.168.1.100');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      console.log(`Request ${i}: Status ${response.status} ✓`);
    }

    // Send 11th request — should be rate-limited (429)
    const blockedResponse = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send(payload)
      .set('X-Forwarded-For', '192.168.1.100');

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body.error).toMatch(/Trop de tentatives de vérification 2FA/);
    expect(blockedResponse.body.code).toBe('TOO_MANY_2FA_ATTEMPTS');
    console.log(`Request 11: Status ${blockedResponse.status} (rate-limited) ✓`);
  });
});
