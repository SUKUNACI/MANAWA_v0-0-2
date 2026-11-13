/**
 * Tests for stub/placeholder routes
 * Covers: availability.js, badges-admin.js, kpis-admin.js, packages.js, referrals-admin.js, reports.js
 * These routes are simple stubs that return a 200 JSON message.
 */

const request = require('supertest');
const express = require('express');

// Helper to build a minimal app mounting a single router
function buildApp(routerPath, mountPath) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, require(routerPath));
  return app;
}

// ─── availability.js ─────────────────────────────────────────────────────────

describe('availability stub', () => {
  let app;
  beforeAll(() => {
    app = buildApp('../../routes/availability', '/api/availability');
  });

  it('GET / — 200 avec message', async () => {
    const res = await request(app).get('/api/availability');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toBe('Availability endpoint');
  });
});

// ─── badges-admin.js ──────────────────────────────────────────────────────────

describe('badges-admin stub', () => {
  let app;
  beforeAll(() => {
    app = buildApp('../../routes/badges-admin', '/admin/badges');
  });

  it('GET / — 200 avec message', async () => {
    const res = await request(app).get('/admin/badges');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toBe('Badges Admin endpoint');
  });
});

// ─── kpis-admin.js ───────────────────────────────────────────────────────────

describe('kpis-admin stub', () => {
  let app;
  beforeAll(() => {
    app = buildApp('../../routes/kpis-admin', '/admin/kpis');
  });

  it('GET / — 200 avec message', async () => {
    const res = await request(app).get('/admin/kpis');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toBe('KPIs Admin endpoint');
  });
});

// ─── packages.js ──────────────────────────────────────────────────────────────

describe('packages stub', () => {
  let app;
  beforeAll(() => {
    app = buildApp('../../routes/packages', '/api/packages');
  });

  it('GET / — 200 avec message', async () => {
    const res = await request(app).get('/api/packages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toBe('Packages endpoint');
  });
});

// ─── referrals-admin.js ───────────────────────────────────────────────────────

describe('referrals-admin stub', () => {
  let app;
  beforeAll(() => {
    app = buildApp('../../routes/referrals-admin', '/admin/referrals');
  });

  it('GET / — 200 avec message', async () => {
    const res = await request(app).get('/admin/referrals');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toBe('Referrals Admin endpoint');
  });
});

// ─── reports.js ───────────────────────────────────────────────────────────────

describe('reports stub', () => {
  let app;
  beforeAll(() => {
    app = buildApp('../../routes/reports', '/api/reports');
  });

  it('GET / — 200 avec message', async () => {
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toBe('Reports endpoint');
  });
});
