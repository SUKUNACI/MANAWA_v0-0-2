/**
 * Tests for API Timeout Middleware (Q59)
 */

const express = require('express');
const request = require('supertest');
const { createTimeoutMiddleware } = require('../../middleware/api-timeout');

describe('API Timeout Middleware (Q59)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  test('should timeout after specified duration', (done) => {
    const timeoutMs = 100; // 100ms timeout for testing
    app.use(createTimeoutMiddleware(timeoutMs, 'test-service'));

    app.get('/test', (req, res) => {
      // Simulate slow endpoint
      setTimeout(() => {
        res.json({ status: 'ok' });
      }, 500); // 500ms delay > 100ms timeout
    });

    request(app)
      .get('/test')
      .expect(504)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body).toHaveProperty('code', 'TIMEOUT_ERR');
        expect(res.body).toHaveProperty('retryable', true);
        done();
      });
  });

  test('should not timeout if request completes in time', (done) => {
    const timeoutMs = 500; // 500ms timeout
    app.use(createTimeoutMiddleware(timeoutMs, 'test-service'));

    app.get('/test', (req, res) => {
      // Quick response
      res.json({ status: 'ok' });
    });

    request(app)
      .get('/test')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body).toHaveProperty('status', 'ok');
        done();
      });
  });

  test('should return 504 status code on timeout', (done) => {
    const timeoutMs = 50;
    app.use(createTimeoutMiddleware(timeoutMs, 'payments'));

    app.get('/test', (req, res) => {
      setTimeout(() => {
        res.json({ status: 'ok' });
      }, 200);
    });

    request(app)
      .get('/test')
      .expect(504)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.code).toBe('TIMEOUT_ERR');
        done();
      });
  });

  test('should clean up timeout on successful response', (done) => {
    const timeoutMs = 500;
    app.use(createTimeoutMiddleware(timeoutMs, 'test-service'));

    let requestCompleted = false;

    app.get('/test', (req, res) => {
      res.json({ status: 'ok' });
      requestCompleted = true;
    });

    request(app)
      .get('/test')
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(requestCompleted).toBe(true);
        done();
      });
  });

  test('should include service name in timeout error', (done) => {
    const timeoutMs = 50;
    const serviceType = 'custom-service';
    app.use(createTimeoutMiddleware(timeoutMs, serviceType));

    app.get('/test', (req, res) => {
      setTimeout(() => {
        res.json({ status: 'ok' });
      }, 200);
    });

    request(app)
      .get('/test')
      .expect(504)
      .end((err, res) => {
        if (err) return done(err);
        expect(res.body.error).toContain(serviceType);
        done();
      });
  });
});
