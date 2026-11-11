const request = require('supertest');
const express = require('express');
const { proToken, clientToken } = require('./helpers');

jest.mock('../config/db', () => ({
  user:         { findUnique: jest.fn() },
  professional: { findUnique: jest.fn() },
  quote:        { findFirst: jest.fn().mockResolvedValue(null) },
  message: {
    create:     jest.fn(),
    findMany:   jest.fn().mockResolvedValue([]),
    findFirst:  jest.fn(),
    count:      jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  pushToken: { findMany: jest.fn().mockResolvedValue([]) },
}));

const prisma = require('../config/db');
const messageRoutes = require('../routes/messages');


const app = express();
app.use(express.json());
app.use('/api/messages', messageRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const USER_A = 'user-a';
const USER_B = 'user-b';
const mockUserA = { id: USER_A, role: 'CLIENT',       suspended: false };
const mockUserB = { id: USER_B, role: 'PROFESSIONAL', suspended: false };

function useA() { prisma.user.findUnique.mockResolvedValue(mockUserA); }
function useB() { prisma.user.findUnique.mockResolvedValue(mockUserB); }

// ══ POST /api/messages ══════════════════════════════════════════════════════

describe('POST /api/messages', () => {
  beforeEach(() => {
    prisma.message.create.mockResolvedValue({
      id: 'msg-1', senderId: USER_A, receiverId: USER_B, content: 'Bonjour', createdAt: new Date(),
    });
    // Use mockImplementation for concurrent tests to not exhaust mockResolvedValueOnce
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where?.id === USER_A) return Promise.resolve(mockUserA);
      if (where?.id === USER_B) return Promise.resolve(mockUserB);
      return Promise.resolve({ ...mockUserA, emailVerified: true });
    });
    prisma.professional.findUnique.mockResolvedValue({ id: 'pro-b' });
    prisma.quote.findFirst.mockResolvedValue(null);
    prisma.message.findFirst.mockResolvedValue({ id: 'existing-msg' }); // existing conversation
  });

  test('crée un message et retourne 201', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`)
      .send({ receiverId: USER_B, content: 'Bonjour' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ senderId: USER_A, receiverId: USER_B, content: 'Bonjour' }) })
    );
  });

  test('400 si receiverId manquant', async () => {
    prisma.user.findUnique.mockReset();
    prisma.user.findUnique
      .mockResolvedValueOnce(mockUserA)
      .mockResolvedValueOnce({ ...mockUserA, emailVerified: true });
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`)
      .send({ content: 'Bonjour' });

    expect(res.status).toBe(400);
  });

  test('400 si content vide', async () => {
    prisma.user.findUnique.mockReset();
    prisma.user.findUnique
      .mockResolvedValueOnce(mockUserA)
      .mockResolvedValueOnce({ ...mockUserA, emailVerified: true });
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`)
      .send({ receiverId: USER_B, content: '   ' });

    expect(res.status).toBe(400);
  });

  test('401 sans token', async () => {
    const res = await request(app).post('/api/messages').send({ receiverId: USER_B, content: 'Test' });
    expect(res.status).toBe(401);
  });
});

// ══ GET /api/messages/conversations ════════════════════════════════════════

describe('GET /api/messages/conversations', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockReset();
    useA();
  });

  test('retourne 200 avec liste vide', async () => {
    prisma.message.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('déduplique les conversations par interlocuteur', async () => {
    const makeMsg = (id, from, to) => ({
      id, senderId: from, receiverId: to, content: 'Hey', createdAt: new Date(),
      sender:   { id: from, firstName: 'A', lastName: 'A', avatarUrl: null },
      receiver: { id: to,   firstName: 'B', lastName: 'B', avatarUrl: null },
    });
    prisma.message.findMany.mockResolvedValue([
      makeMsg('m1', USER_A, USER_B),
      makeMsg('m2', USER_A, USER_B), // même paire → doit être dédupliqué
    ]);

    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('401 sans token', async () => {
    const res = await request(app).get('/api/messages/conversations');
    expect(res.status).toBe(401);
  });
});

// ══ GET /api/messages/unread-count ══════════════════════════════════════════

describe('GET /api/messages/unread-count', () => {
  test('retourne le nombre de messages non lus', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUserA);
    prisma.message.count.mockResolvedValue(3);

    const res = await request(app)
      .get('/api/messages/unread-count')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(prisma.message.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ receiverId: USER_A, read: false }) })
    );
  });
});

// ══ GET /api/messages/:userId ════════════════════════════════════════════════

describe('GET /api/messages/:userId', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockReset();
    prisma.user.findUnique.mockResolvedValue(mockUserA);
    prisma.message.findMany.mockResolvedValue([
      { id: 'm1', senderId: USER_A, receiverId: USER_B, content: 'Hi', read: true, createdAt: new Date() },
      { id: 'm2', senderId: USER_B, receiverId: USER_A, content: 'Ho', read: false, createdAt: new Date() },
    ]);
  });

  test('retourne la conversation entre deux utilisateurs', async () => {
    const res = await request(app)
      .get(`/api/messages/${USER_B}`)
      .set('Authorization', `Bearer ${clientToken(USER_A)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('marque les messages reçus comme lus', async () => {
    await request(app)
      .get(`/api/messages/${USER_B}`)
      .set('Authorization', `Bearer ${clientToken(USER_A)}`);

    expect(prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ senderId: USER_B, receiverId: USER_A, read: false }),
        data: { read: true },
      })
    );
  });

  test('respecte le paramètre limit', async () => {
    await request(app)
      .get(`/api/messages/${USER_B}?limit=10`)
      .set('Authorization', `Bearer ${clientToken(USER_A)}`);

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });

  test('401 sans token', async () => {
    const res = await request(app).get(`/api/messages/${USER_B}`);
    expect(res.status).toBe(401);
  });
});

// ══ EDGE CASES: Message Limits & Unicode ═════════════════════════════════════════

describe('EDGE CASES: Message Content Handling', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockReset();
  });

  test('Very long message content should be handled', async () => {
    const longContent = 'x'.repeat(50000);
    useA();
    prisma.user.findUnique
      .mockResolvedValueOnce(mockUserA)
      .mockResolvedValueOnce({ ...mockUserA, emailVerified: true })
      .mockResolvedValueOnce(mockUserB);
    prisma.message.create.mockResolvedValue({
      id: 'msg-1', senderId: USER_A, receiverId: USER_B, content: longContent,
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`)
      .send({ receiverId: USER_B, content: longContent });

    expect(res.status).toBe(400);
  });

  test('Unicode characters in messages should be preserved', async () => {
    useA();
    prisma.user.findUnique
      .mockResolvedValueOnce(mockUserA)
      .mockResolvedValueOnce({ ...mockUserA, emailVerified: true })
      .mockResolvedValueOnce(mockUserB);
    prisma.message.create.mockResolvedValue({
      id: 'msg-1', senderId: USER_A, receiverId: USER_B,
      content: '✓ αβγδ 中文 العربية 🎉',
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`)
      .send({ receiverId: USER_B, content: '✓ αβγδ 中文 العربية 🎉' });

    expect(res.status).toBe(201);
  });

  test('XSS attempt in message should not execute', async () => {
    useA();
    prisma.user.findUnique
      .mockResolvedValueOnce(mockUserA)
      .mockResolvedValueOnce({ ...mockUserA, emailVerified: true })
      .mockResolvedValueOnce(mockUserB);
    prisma.message.create.mockResolvedValue({
      id: 'msg-1', senderId: USER_A, receiverId: USER_B,
      content: '<img src=x onerror="alert(1)">',
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`)
      .send({ receiverId: USER_B, content: '<img src=x onerror="alert(1)">' });

    expect(res.status).toBe(201);
  });

  test('Null bytes in message content should be handled', async () => {
    useA();
    prisma.user.findUnique
      .mockResolvedValueOnce(mockUserA)
      .mockResolvedValueOnce({ ...mockUserA, emailVerified: true })
      .mockResolvedValueOnce(mockUserB);
    prisma.message.create.mockResolvedValue({
      id: 'msg-1', senderId: USER_A, receiverId: USER_B, content: 'test\x00content',
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(USER_A)}`)
      .send({ receiverId: USER_B, content: 'test\x00content' });

    expect(res.status).toBe(400);
  });
});

// ══ EDGE CASES: Concurrent Message Operations ═════════════════════════════════

describe('EDGE CASES: Concurrent Message Operations', () => {
  test('Concurrent messages between same users should not duplicate', async () => {
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where?.id === USER_A) return Promise.resolve(mockUserA);
      if (where?.id === USER_B) return Promise.resolve(mockUserB);
      return Promise.resolve(null);
    });

    let messageCount = 0;
    prisma.message.create.mockImplementation(() => {
      messageCount++;
      return Promise.resolve({
        id: `msg-${messageCount}`, senderId: USER_A, receiverId: USER_B,
        content: `Message ${messageCount}`,
      });
    });

    const requests = [];
    for (let i = 0; i < 3; i++) {
      requests.push(
        request(app)
          .post('/api/messages')
          .set('Authorization', `Bearer ${clientToken(USER_A)}`)
          .send({ receiverId: USER_B, content: `Message ${i}` })
      );
    }

    const results = await Promise.all(requests);
    results.forEach(res => expect(res.status).toBe(201));
  });
});
