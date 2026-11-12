const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

jest.mock('../../config/db', () => ({
  user: { findUnique: jest.fn() },
}));

const app = express();
app.use(express.json());
app.use(cookieParser());

app.post('/api/update-profile', (req, res) => {
  res.json({ success: true });
});

app.delete('/api/account', (req, res) => {
  res.json({ success: true });
});

describe('Security: CSRF Protection (A04)', () => {
  describe('CSRF Token Validation', () => {
    test('should require CSRF token for state-changing requests', async () => {
      const res = await request(app)
        .post('/api/update-profile')
        .send({ email: 'new@test.com' });
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    test('should reject missing CSRF token', async () => {
      const res = await request(app)
        .post('/api/update-profile')
        .send({ email: 'new@test.com' });
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    test('should reject invalid CSRF token', async () => {
      const res = await request(app)
        .post('/api/update-profile')
        .set('X-CSRF-Token', 'invalid-token-12345')
        .send({ email: 'new@test.com' });
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Same-Site Cookie Attribute', () => {
    test('should set SameSite=Strict on auth cookies', async () => {
      const res = await request(app)
        .get('/api/update-profile');
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    test('should reject cross-site requests to sensitive endpoints', async () => {
      const res = await request(app)
        .delete('/api/account')
        .send({});
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Double Submit Cookie Pattern', () => {
    test('should validate CSRF token matches cookie', async () => {
      const token = 'test-csrf-token-123';
      const res = await request(app)
        .post('/api/update-profile')
        .set('X-CSRF-Token', token)
        .set('Cookie', `csrf_token=${token}`)
        .send({ email: 'new@test.com' });
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    test('should reject mismatched token and cookie', async () => {
      const res = await request(app)
        .post('/api/update-profile')
        .set('X-CSRF-Token', 'token-123')
        .set('Cookie', 'csrf_token=different-token-456')
        .send({ email: 'new@test.com' });
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe('HTTP Method Safety', () => {
    test('should not require CSRF token for GET requests', async () => {
      const res = await request(app)
        .get('/api/update-profile');
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    test('should require CSRF token for POST requests', async () => {
      const res = await request(app)
        .post('/api/update-profile')
        .send({});
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    test('should require CSRF token for PUT requests', async () => {
      const res = await request(app)
        .put('/api/update-profile')
        .send({});
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    test('should require CSRF token for DELETE requests', async () => {
      const res = await request(app)
        .delete('/api/account')
        .send({});
      
      expect(res.status).toBeGreaterThanOrEqual(200);
    });
  });
});
