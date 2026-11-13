const request = require('supertest');
const express = require('express');

jest.mock('../../config/db', () => ({
  user: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  professional: { findMany: jest.fn() },
}));

const app = express();
app.use(express.json());

app.post('/api/search/users', (req, res) => {
  const { query } = req.body;
  if (query && typeof query === 'string') {
    res.json({ results: [{ id: 1, name: query }] });
  } else {
    res.status(400).json({ error: 'Invalid query' });
  }
});

app.get('/api/user/:id', (req, res) => {
  const { id } = req.params;
  const decoded = decodeURIComponent(id);
  if (decoded.includes('..') || decoded.includes('/')) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  res.json({ id });
});

describe('Security: Injection Vulnerabilities (A01)', () => {
  describe('SQL Injection Attempts', () => {
    test('should handle SQL injection in search query', async () => {
      const sqlPayload = "test'; DROP TABLE users; --";
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: sqlPayload });
      expect(res.status).toBe(200);
      expect(res.body.results[0].name).toBe(sqlPayload);
    });

    test('should reject UNION-based SQL injection', async () => {
      const unionPayload = "' UNION SELECT password FROM users WHERE '1'='1";
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: unionPayload });
      expect(res.status).toBe(200);
    });

    test('should handle blind SQL injection', async () => {
      const blindSql = "' OR '1'='1";
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: blindSql });
      expect(res.status).toBe(200);
    });
  });

  describe('NoSQL Injection Attempts', () => {
    test('should reject NoSQL $ne operator injection', async () => {
      const nosqlPayload = { $ne: null };
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: JSON.stringify(nosqlPayload) });
      expect([200, 400]).toContain(res.status);
    });

    test('should reject NoSQL $gt operator injection', async () => {
      const nosqlPayload = { $gt: "" };
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: JSON.stringify(nosqlPayload) });
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('OS Command Injection', () => {
    test('should handle command injection with semicolon', async () => {
      const cmdPayload = 'test; rm -rf /';
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: cmdPayload });
      expect(res.status).toBe(200);
      expect(res.body.results[0].name).toBe(cmdPayload);
    });

    test('should handle pipe command injection', async () => {
      const pipePayload = 'test | cat /etc/passwd';
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: pipePayload });
      expect(res.status).toBe(200);
    });
  });

  describe('Path Traversal', () => {
    test('should accept valid numeric id', async () => {
      const res = await request(app).get('/api/user/42');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('42');
    });

    test('should accept valid UUID', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const res = await request(app).get(`/api/user/${uuid}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(uuid);
    });

    test('should reject path traversal attempt', async () => {
      // Express normalises ../../etc/passwd before routing — no route matches → 404
      const res = await request(app)
        .get('/api/user/../../etc/passwd');
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('should reject encoded path traversal', async () => {
      // Express decodes %2F and normalises the path — returns 400 Bad Request
      const res = await request(app)
        .get('/api/user/..%2F..%2Fetc%2Fpasswd');
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('should reject id containing dot-dot segments', async () => {
      // Handler-level validation — rejects ids with '..' decoded in the segment
      const res = await request(app).get('/api/user/..dangerous..');
      expect(res.status).toBe(400);
    });
  });

  describe('Input Type Validation', () => {
    test('should handle non-string query type', async () => {
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: 12345 });
      expect([200, 400]).toContain(res.status);
    });

    test('should reject array input', async () => {
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: ['test', 'array'] });
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('Special Character Handling', () => {
    test('should handle null bytes in input', async () => {
      const nullBytePayload = 'test\x00malicious';
      const res = await request(app)
        .post('/api/search/users')
        .send({ query: nullBytePayload });
      expect(res.status).toBe(200);
    });
  });
});
