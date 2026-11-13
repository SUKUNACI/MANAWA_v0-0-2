const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
  },
  professional: {
    findUnique: jest.fn(),
  },
  quote: {
    findFirst: jest.fn(),
  },
  message: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
}));

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ sent: false }),
}));

jest.mock('../../config/cloudinary', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://res.cloudinary.com/test/attachment.jpg'),
}));

// Variable mutable accessible dans la closure du mock (var = pas de TDZ avec le hoisting jest.mock)
// eslint-disable-next-line no-var
var mockInjectedFile = null;

// Mock upload : le middleware délègue à la variable mutable pour permettre
// l'injection de req.file par test, même si upload.single() est capturé une seule fois
jest.mock('../../config/upload', () => ({
  single: () => (req, res, next) => {
    if (mockInjectedFile !== null) {
      req.file = mockInjectedFile;
    }
    next();
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt']),
}));

jest.mock('../../utils/pagination-helper', () => ({
  validatePageBasedPaginationQuery: jest.fn().mockReturnValue([]),
  applyPageBasedPagination: jest.fn().mockImplementation((query) => {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, parseInt(query.limit) || 30);
    const skip = (page - 1) * limit;
    return { limit, skip, offset: skip };
  }),
  buildPaginatedResponse: jest.fn().mockReturnValue({}),
}));

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const jwt = require('jsonwebtoken');
    try {
      req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token invalide' });
    }
  },
  requireEmailVerified: (req, res, next) => {
    // Simule la vérification d'email côté base
    const prisma = require('../../config/db');
    return prisma.user.findUnique({ where: { id: req.user.id } }).then((user) => {
      if (!user || user.emailVerified !== true) {
        return res.status(403).json({
          error: 'Veuillez vérifier votre adresse email avant de continuer.',
          code: 'EMAIL_NOT_VERIFIED',
        });
      }
      next();
    });
  },
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
}));

const prisma = require('../../config/db');
const { sendPushNotification } = require('../../config/pushNotifications');
const { uploadBuffer } = require('../../config/cloudinary');
const messagesRouter = require('../../routes/messages');

const app = express();
app.use(express.json());
app.use('/api/messages', messagesRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ TEST DATA FIXTURES ============

const CLIENT_ID = 'client-1';
const PRO_USER_ID = 'pro-user-1';
const PRO_ID = 'pro-1';
const ADMIN_ID = 'admin-1';

const mockClient = { id: CLIENT_ID, role: 'CLIENT', suspended: false, emailVerified: true };
const mockProUser = { id: PRO_USER_ID, role: 'PROFESSIONAL', suspended: false, emailVerified: true };
const mockAdmin = { id: ADMIN_ID, role: 'ADMIN', suspended: false, emailVerified: true };

const mockMessage = {
  id: 'msg-1',
  senderId: CLIENT_ID,
  receiverId: PRO_USER_ID,
  content: 'Bonjour, je souhaite un devis',
  read: false,
  createdAt: new Date().toISOString(),
};

// ============ POST /api/messages ============

describe('POST /api/messages', () => {
  beforeEach(() => {
    // requireAuth → client vérifié
    // requireEmailVerified → emailVerified:true
    // handler → cherche receiver
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where?.id === CLIENT_ID) return Promise.resolve(mockClient);
      if (where?.id === PRO_USER_ID) return Promise.resolve(mockProUser);
      if (where?.id === ADMIN_ID) return Promise.resolve(mockAdmin);
      return Promise.resolve(null);
    });
    prisma.professional.findUnique.mockResolvedValue({ id: PRO_ID });
    prisma.quote.findFirst.mockResolvedValue(null);
    prisma.message.findFirst.mockResolvedValue({ id: 'existing-msg' }); // conversation existante
    prisma.message.create.mockResolvedValue(mockMessage);
  });

  test('201 — crée un message client→professionnel (conversation existante)', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'Bonjour, je souhaite un devis' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderId: CLIENT_ID,
          receiverId: PRO_USER_ID,
          content: 'Bonjour, je souhaite un devis',
        }),
      })
    );
  });

  test('201 — crée un message client→professionnel (via devis)', async () => {
    prisma.message.findFirst.mockResolvedValue(null); // pas de conversation
    prisma.quote.findFirst.mockResolvedValue({ id: 'quote-1' }); // devis existant

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'Suite à mon projet' });

    expect(res.status).toBe(201);
  });

  test('201 — message avec attachmentUrl et attachmentType', async () => {
    prisma.message.create.mockResolvedValue({
      ...mockMessage,
      attachmentUrl: 'https://cdn.example.com/file.pdf',
      attachmentType: 'pdf',
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({
        receiverId: PRO_USER_ID,
        content: 'Voir le fichier joint',
        attachmentUrl: 'https://cdn.example.com/file.pdf',
        attachmentType: 'pdf',
      });

    expect(res.status).toBe(201);
  });

  test('201 — ADMIN peut envoyer à n\'importe qui', async () => {
    prisma.message.create.mockResolvedValue({ ...mockMessage, senderId: ADMIN_ID });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ receiverId: CLIENT_ID, content: 'Message admin' });

    expect(res.status).toBe(201);
  });

  test('400 — receiverId manquant', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ content: 'Bonjour' });

    expect(res.status).toBe(400);
  });

  test('400 — content manquant', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID });

    expect(res.status).toBe(400);
  });

  test('400 — content vide (espaces uniquement)', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: '   ' });

    expect(res.status).toBe(400);
  });

  test('400 — content trop long (> 5000 chars)', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'x'.repeat(5001) });

    expect(res.status).toBe(400);
  });

  test('400 — content contient des null bytes', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'test\x00content' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid content/i);
  });

  test('400 — attachmentType invalide', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'Test', attachmentType: 'video' });

    expect(res.status).toBe(400);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .post('/api/messages')
      .send({ receiverId: PRO_USER_ID, content: 'Test' });

    expect(res.status).toBe(401);
  });

  test('403 — email non vérifié', async () => {
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where?.id === CLIENT_ID) {
        return Promise.resolve({ ...mockClient, emailVerified: false });
      }
      return Promise.resolve(mockProUser);
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'Bonjour' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('403 — destinataire suspendu', async () => {
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where?.id === CLIENT_ID) return Promise.resolve(mockClient);
      if (where?.id === PRO_USER_ID) return Promise.resolve({ ...mockProUser, suspended: true });
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'Bonjour' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspendu/i);
  });

  test('403 — messagerie réservée client↔professionnel (client→client)', async () => {
    const otherClient = { id: 'client-2', role: 'CLIENT', suspended: false, emailVerified: true };
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where?.id === CLIENT_ID) return Promise.resolve(mockClient);
      if (where?.id === 'client-2') return Promise.resolve(otherClient);
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: 'client-2', content: 'Bonjour' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/client-professionnel/i);
  });

  test('403 — aucune relation (pas de devis, pas de conversation existante)', async () => {
    prisma.message.findFirst.mockResolvedValue(null); // pas de conversation
    prisma.quote.findFirst.mockResolvedValue(null); // pas de devis

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'Premier contact sans projet' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/après avoir soumis un projet/i);
  });

  test('403 — pro introuvable en base (aucune relation possible)', async () => {
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.quote.findFirst.mockResolvedValue(null);
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'Bonjour' });

    expect(res.status).toBe(403);
  });

  test('404 — destinataire introuvable', async () => {
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where?.id === CLIENT_ID) return Promise.resolve(mockClient);
      return Promise.resolve(null); // destinataire inexistant
    });

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: 'inexistant-999', content: 'Bonjour' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Destinataire introuvable/i);
  });

  test('500 — erreur DB lors du create', async () => {
    prisma.message.create.mockRejectedValue(new Error('DB failure'));

    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ receiverId: PRO_USER_ID, content: 'Bonjour' });

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/messages/conversations ============

describe('GET /api/messages/conversations', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockClient);
    prisma.message.findMany.mockResolvedValue([]);
  });

  test('200 — retourne liste vide', async () => {
    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  test('200 — déduplique les conversations par interlocuteur', async () => {
    const makeMsg = (id, from, to) => ({
      id,
      senderId: from,
      receiverId: to,
      content: 'Hey',
      createdAt: new Date(),
      sender: { id: from, firstName: 'Alice', lastName: 'Dupont', avatarUrl: null },
      receiver: { id: to, firstName: 'Bob', lastName: 'Martin', avatarUrl: null },
    });

    prisma.message.findMany.mockResolvedValue([
      makeMsg('m1', CLIENT_ID, PRO_USER_ID),
      makeMsg('m2', CLIENT_ID, PRO_USER_ID), // même paire → dédupliqué
      makeMsg('m3', PRO_USER_ID, CLIENT_ID), // direction inverse → même paire → dédupliqué
    ]);

    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('200 — plusieurs interlocuteurs distincts', async () => {
    const makeMsg = (id, from, to, fromUser, toUser) => ({
      id, senderId: from, receiverId: to, content: 'Test', createdAt: new Date(),
      sender: { id: from, ...fromUser },
      receiver: { id: to, ...toUser },
    });

    prisma.message.findMany.mockResolvedValue([
      makeMsg('m1', CLIENT_ID, PRO_USER_ID,
        { firstName: 'Alice', lastName: 'A', avatarUrl: null },
        { firstName: 'Bob', lastName: 'B', avatarUrl: null }),
      makeMsg('m2', CLIENT_ID, 'pro-user-2',
        { firstName: 'Alice', lastName: 'A', avatarUrl: null },
        { firstName: 'Carl', lastName: 'C', avatarUrl: null }),
    ]);

    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/messages/conversations');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du findMany', async () => {
    prisma.message.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/messages/unread-count ============

describe('GET /api/messages/unread-count', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockClient);
  });

  test('200 — retourne le nombre de messages non lus', async () => {
    prisma.message.count.mockResolvedValue(3);

    const res = await request(app)
      .get('/api/messages/unread-count')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(prisma.message.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ receiverId: CLIENT_ID, read: false }),
      })
    );
  });

  test('200 — aucun message non lu (count=0)', async () => {
    prisma.message.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/messages/unread-count')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/messages/unread-count');
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du count', async () => {
    prisma.message.count.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/messages/unread-count')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/messages/:userId ============

describe('GET /api/messages/:userId', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockClient);
    prisma.message.findMany.mockResolvedValue([
      { id: 'm1', senderId: CLIENT_ID, receiverId: PRO_USER_ID, content: 'Hi', read: true, createdAt: new Date() },
      { id: 'm2', senderId: PRO_USER_ID, receiverId: CLIENT_ID, content: 'Ho', read: false, createdAt: new Date() },
    ]);
    prisma.message.count.mockResolvedValue(2);
    prisma.message.updateMany.mockResolvedValue({ count: 1 });
  });

  test('200 — retourne les messages de la conversation dans l\'ordre chronologique', async () => {
    const res = await request(app)
      .get(`/api/messages/${PRO_USER_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('200 — marque les messages reçus comme lus', async () => {
    await request(app)
      .get(`/api/messages/${PRO_USER_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          senderId: PRO_USER_ID,
          receiverId: CLIENT_ID,
          read: false,
        }),
        data: { read: true },
      })
    );
  });

  test('200 — respecte le paramètre limit', async () => {
    await request(app)
      .get(`/api/messages/${PRO_USER_ID}?limit=10`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });

  test('200 — conversation vide retourne []', async () => {
    prisma.message.findMany.mockResolvedValue([]);
    prisma.message.count.mockResolvedValue(0);

    const res = await request(app)
      .get(`/api/messages/${PRO_USER_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app).get(`/api/messages/${PRO_USER_ID}`);
    expect(res.status).toBe(401);
  });

  test('500 — erreur DB lors du findMany', async () => {
    prisma.message.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get(`/api/messages/${PRO_USER_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /api/messages/upload-attachment ============

describe('POST /api/messages/upload-attachment', () => {
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(mockClient);
    uploadBuffer.mockResolvedValue('https://res.cloudinary.com/test/attachment.jpg');
    mockInjectedFile = null; // réinitialise entre tests
  });

  afterEach(() => {
    mockInjectedFile = null;
  });

  test('200 — upload une image JPEG avec succès', async () => {
    mockInjectedFile = {
      buffer: Buffer.from('fake-image'),
      mimetype: 'image/jpeg',
      originalname: 'photo.jpg',
    };

    const res = await request(app)
      .post('/api/messages/upload-attachment')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('url');
    expect(res.body.type).toBe('image');
    expect(res.body.name).toBe('photo.jpg');
  });

  test('200 — upload un PDF avec type=pdf', async () => {
    mockInjectedFile = {
      buffer: Buffer.from('fake-pdf'),
      mimetype: 'application/pdf',
      originalname: 'document.pdf',
    };

    const res = await request(app)
      .post('/api/messages/upload-attachment')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('pdf');
  });

  test('200 — upload une image PNG avec type=image', async () => {
    mockInjectedFile = {
      buffer: Buffer.from('fake-png'),
      mimetype: 'image/png',
      originalname: 'image.png',
    };

    const res = await request(app)
      .post('/api/messages/upload-attachment')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('image');
  });

  test('400 — aucun fichier fourni (req.file absent)', async () => {
    // mockInjectedFile reste null → pas de req.file injecté

    const res = await request(app)
      .post('/api/messages/upload-attachment')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Fichier requis/i);
  });

  test('400 — type MIME non autorisé (video/mp4)', async () => {
    mockInjectedFile = {
      buffer: Buffer.from('fake-video'),
      mimetype: 'video/mp4',
      originalname: 'video.mp4',
    };

    const res = await request(app)
      .post('/api/messages/upload-attachment')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Type de fichier non autorisé/i);
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .post('/api/messages/upload-attachment');

    expect(res.status).toBe(401);
  });

  test('500 — erreur lors de l\'upload Cloudinary', async () => {
    mockInjectedFile = {
      buffer: Buffer.from('fake-image'),
      mimetype: 'image/png',
      originalname: 'photo.png',
    };
    uploadBuffer.mockRejectedValue(new Error('Cloudinary error'));

    const res = await request(app)
      .post('/api/messages/upload-attachment')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});
