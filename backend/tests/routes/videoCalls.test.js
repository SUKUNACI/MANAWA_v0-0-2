const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  videoCall: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
}));

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ sent: false }),
}));

jest.mock('../../utils/daily', () => ({
  createVideoRoom: jest.fn(),
  deleteVideoRoom: jest.fn().mockResolvedValue({ deleted: true }),
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

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('aaaabbbbccccdddd1111222233334444'),
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
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
}));

const prisma = require('../../config/db');
const { createVideoRoom, deleteVideoRoom } = require('../../utils/daily');
const { sendPushNotification } = require('../../config/pushNotifications');
const videoCallsRouter = require('../../routes/videoCalls');

const app = express();
app.use(express.json());
app.use('/api/video-calls', videoCallsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ FIXTURES ============

const INITIATOR_ID = 'client-1';
const PARTICIPANT_ID = 'pro-user-1';
const CALL_ID = 'call-uuid-1';
const ROOM_URL = 'https://manawa.daily.co/mnw-aaaabbbb';
const ROOM_NAME = 'mnw-aaaabbbb';

const mockParticipant = {
  id: PARTICIPANT_ID,
  firstName: 'Jean',
  lastName: 'Pro',
  suspended: false,
  deletedAt: null,
};

const mockInitiator = {
  id: INITIATOR_ID,
  firstName: 'Marie',
  lastName: 'Client',
};

const mockVideoCall = {
  id: CALL_ID,
  roomName: ROOM_NAME,
  roomUrl: ROOM_URL,
  initiatorId: INITIATOR_ID,
  participantId: PARTICIPANT_ID,
  status: 'PENDING',
  projectId: null,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  startedAt: null,
  endedAt: null,
  createdAt: new Date(),
  initiator: mockInitiator,
  participant: mockParticipant,
};

// ============ GET / ============

describe('GET /api/video-calls', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/video-calls');
    expect(res.status).toBe(401);
  });

  test('200 — retourne les appels actifs de l\'utilisateur', async () => {
    prisma.videoCall.findMany.mockResolvedValue([mockVideoCall]);

    const res = await request(app)
      .get('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activeCalls');
    expect(res.body).toHaveProperty('count', 1);
    expect(Array.isArray(res.body.activeCalls)).toBe(true);
    expect(prisma.videoCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ initiatorId: INITIATOR_ID }, { participantId: INITIATOR_ID }],
          endedAt: null,
        }),
      })
    );
  });

  test('200 — liste vide si aucun appel actif', async () => {
    prisma.videoCall.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  test('500 — erreur DB', async () => {
    prisma.videoCall.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST / ============

describe('POST /api/video-calls', () => {
  beforeEach(() => {
    process.env.DAILY_API_KEY = 'test-daily-key';
  });

  afterEach(() => {
    delete process.env.DAILY_API_KEY;
  });

  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .post('/api/video-calls')
      .send({ participantId: PARTICIPANT_ID });
    expect(res.status).toBe(401);
  });

  test('400 — participantId manquant', async () => {
    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('400 — participantId vide', async () => {
    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: '' });
    expect(res.status).toBe(400);
  });

  test('400 — appeler soi-même est interdit', async () => {
    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: INITIATOR_ID });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANNOT_CALL_SELF');
  });

  test('404 — participant introuvable', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: 'inexistant' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PARTICIPANT_NOT_FOUND');
  });

  test('404 — participant supprimé (deletedAt non null)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockParticipant, deletedAt: new Date() });

    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: PARTICIPANT_ID });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PARTICIPANT_NOT_FOUND');
  });

  test('403 — participant suspendu', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockParticipant, suspended: true });

    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: PARTICIPANT_ID });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  test('503 — DAILY_API_KEY non configuré', async () => {
    delete process.env.DAILY_API_KEY;
    prisma.user.findUnique.mockResolvedValue(mockParticipant);

    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: PARTICIPANT_ID });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('VIDEO_SERVICE_NOT_CONFIGURED');
  });

  test('502 — échec de création de room Daily.co', async () => {
    prisma.user.findUnique.mockResolvedValue(mockParticipant);
    createVideoRoom.mockRejectedValue(new Error('Daily API error'));

    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: PARTICIPANT_ID });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('ROOM_CREATION_FAILED');
  });

  test('502 — room créée sans URL dans la réponse Daily.co', async () => {
    prisma.user.findUnique.mockResolvedValue(mockParticipant);
    createVideoRoom.mockResolvedValue({ name: ROOM_NAME }); // pas d'url

    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: PARTICIPANT_ID });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_ROOM_RESPONSE');
  });

  test('201 — crée un appel vidéo avec succès', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(mockParticipant)   // vérification participant
      .mockResolvedValueOnce(mockInitiator);    // récupération nom initiateur

    createVideoRoom.mockResolvedValue({ url: ROOM_URL, name: ROOM_NAME });
    prisma.videoCall.create.mockResolvedValue(mockVideoCall);

    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: PARTICIPANT_ID });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('callId', CALL_ID);
    expect(res.body).toHaveProperty('roomUrl', ROOM_URL);
    expect(res.body).toHaveProperty('roomName');
    expect(res.body).toHaveProperty('expiresAt');
    expect(prisma.videoCall.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          initiatorId: INITIATOR_ID,
          participantId: PARTICIPANT_ID,
          status: 'PENDING',
        }),
      })
    );
  });

  test('201 — crée un appel vidéo avec projectId optionnel', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(mockParticipant)
      .mockResolvedValueOnce(mockInitiator);

    createVideoRoom.mockResolvedValue({ url: ROOM_URL, name: ROOM_NAME });
    prisma.videoCall.create.mockResolvedValue({ ...mockVideoCall, projectId: 'proj-1' });

    const res = await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: PARTICIPANT_ID, projectId: 'proj-1' });

    expect(res.status).toBe(201);
    expect(prisma.videoCall.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: 'proj-1' }),
      })
    );
  });

  test('envoie une push notification au participant (fire-and-forget)', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(mockParticipant)
      .mockResolvedValueOnce(mockInitiator);

    createVideoRoom.mockResolvedValue({ url: ROOM_URL, name: ROOM_NAME });
    prisma.videoCall.create.mockResolvedValue(mockVideoCall);

    await request(app)
      .post('/api/video-calls')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`)
      .send({ participantId: PARTICIPANT_ID });

    expect(sendPushNotification).toHaveBeenCalledWith(
      PARTICIPANT_ID,
      expect.stringContaining('Appel vidéo'),
      expect.any(String),
      expect.objectContaining({ type: 'video_call', roomUrl: ROOM_URL })
    );
  });
});

// ============ GET /active ============

describe('GET /api/video-calls/active', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/video-calls/active');
    expect(res.status).toBe(401);
  });

  test('200 — retourne les appels PENDING et ACTIVE non expirés', async () => {
    prisma.videoCall.findMany.mockResolvedValue([mockVideoCall]);

    const res = await request(app)
      .get('/api/video-calls/active')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(prisma.videoCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDING', 'ACTIVE'] },
        }),
      })
    );
  });

  test('200 — liste vide si pas d\'appels actifs', async () => {
    prisma.videoCall.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/video-calls/active')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('500 — erreur DB', async () => {
    prisma.videoCall.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/video-calls/active')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /history ============

describe('GET /api/video-calls/history', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/video-calls/history');
    expect(res.status).toBe(401);
  });

  test('200 — retourne l\'historique paginé', async () => {
    prisma.videoCall.findMany.mockResolvedValue([mockVideoCall]);
    prisma.videoCall.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/video-calls/history')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('calls');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toHaveProperty('total', 1);
    expect(Array.isArray(res.body.calls)).toBe(true);
  });

  test('200 — pagine correctement avec page=2 et limit=5', async () => {
    prisma.videoCall.findMany.mockResolvedValue([]);
    prisma.videoCall.count.mockResolvedValue(10);

    const res = await request(app)
      .get('/api/video-calls/history?page=2&limit=5')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.limit).toBe(5);
    expect(prisma.videoCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 })
    );
  });

  test('200 — limite plafonnée à 50', async () => {
    prisma.videoCall.findMany.mockResolvedValue([]);
    prisma.videoCall.count.mockResolvedValue(0);

    await request(app)
      .get('/api/video-calls/history?limit=999')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(prisma.videoCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  test('500 — erreur DB', async () => {
    prisma.videoCall.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/video-calls/history')
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ PATCH /:id/join ============

describe('PATCH /api/video-calls/:id/join', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).patch(`/api/video-calls/${CALL_ID}/join`);
    expect(res.status).toBe(401);
  });

  test('404 — appel introuvable', async () => {
    prisma.videoCall.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/join`)
      .set('Authorization', `Bearer ${proToken(PARTICIPANT_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CALL_NOT_FOUND');
  });

  test('403 — seul le participant peut rejoindre (pas l\'initiateur)', async () => {
    prisma.videoCall.findUnique.mockResolvedValue(mockVideoCall);

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/join`)
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`); // initiateur, pas participant

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  test('400 — appel déjà terminé (status=ENDED)', async () => {
    prisma.videoCall.findUnique.mockResolvedValue({ ...mockVideoCall, status: 'ENDED' });

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/join`)
      .set('Authorization', `Bearer ${proToken(PARTICIPANT_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CALL_ENDED');
  });

  test('400 — appel manqué (status=MISSED)', async () => {
    prisma.videoCall.findUnique.mockResolvedValue({ ...mockVideoCall, status: 'MISSED' });

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/join`)
      .set('Authorization', `Bearer ${proToken(PARTICIPANT_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CALL_ENDED');
  });

  test('400 — appel expiré', async () => {
    prisma.videoCall.findUnique.mockResolvedValue({
      ...mockVideoCall,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/join`)
      .set('Authorization', `Bearer ${proToken(PARTICIPANT_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CALL_EXPIRED');
  });

  test('200 — participant rejoint l\'appel avec succès (PENDING → ACTIVE)', async () => {
    prisma.videoCall.findUnique.mockResolvedValue(mockVideoCall);
    prisma.videoCall.update.mockResolvedValue({
      ...mockVideoCall,
      status: 'ACTIVE',
      startedAt: new Date(),
    });

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/join`)
      .set('Authorization', `Bearer ${proToken(PARTICIPANT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('roomUrl', ROOM_URL);
    expect(res.body).toHaveProperty('callId', CALL_ID);
    expect(res.body.status).toBe('ACTIVE');
    expect(prisma.videoCall.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CALL_ID },
        data: expect.objectContaining({ status: 'ACTIVE' }),
      })
    );
  });

  test('500 — erreur DB', async () => {
    prisma.videoCall.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/join`)
      .set('Authorization', `Bearer ${proToken(PARTICIPANT_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ PATCH /:id/end ============

describe('PATCH /api/video-calls/:id/end', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).patch(`/api/video-calls/${CALL_ID}/end`);
    expect(res.status).toBe(401);
  });

  test('404 — appel introuvable', async () => {
    prisma.videoCall.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/end`)
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CALL_NOT_FOUND');
  });

  test('403 — un tiers ne peut pas terminer l\'appel', async () => {
    prisma.videoCall.findUnique.mockResolvedValue(mockVideoCall);

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/end`)
      .set('Authorization', `Bearer ${adminToken('admin-stranger')}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  test('400 — appel déjà terminé', async () => {
    prisma.videoCall.findUnique.mockResolvedValue({ ...mockVideoCall, status: 'ENDED' });

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/end`)
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CALL_ALREADY_ENDED');
  });

  test('200 — l\'initiateur peut terminer l\'appel', async () => {
    prisma.videoCall.findUnique.mockResolvedValue(mockVideoCall);
    prisma.videoCall.update.mockResolvedValue({ ...mockVideoCall, status: 'ENDED', endedAt: new Date() });

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/end`)
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/termin/i);
    expect(prisma.videoCall.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CALL_ID },
        data: expect.objectContaining({ status: 'ENDED', endedAt: expect.any(Date) }),
      })
    );
  });

  test('200 — le participant peut aussi terminer l\'appel', async () => {
    prisma.videoCall.findUnique.mockResolvedValue(mockVideoCall);
    prisma.videoCall.update.mockResolvedValue({ ...mockVideoCall, status: 'ENDED', endedAt: new Date() });

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/end`)
      .set('Authorization', `Bearer ${proToken(PARTICIPANT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('supprime la room Daily.co en arrière-plan', async () => {
    prisma.videoCall.findUnique.mockResolvedValue(mockVideoCall);
    prisma.videoCall.update.mockResolvedValue({ ...mockVideoCall, status: 'ENDED', endedAt: new Date() });

    await request(app)
      .patch(`/api/video-calls/${CALL_ID}/end`)
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    // Laisser les promises fire-and-forget se résoudre
    await new Promise(resolve => setImmediate(resolve));

    expect(deleteVideoRoom).toHaveBeenCalledWith(ROOM_NAME);
  });

  test('500 — erreur DB lors du findUnique', async () => {
    prisma.videoCall.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch(`/api/video-calls/${CALL_ID}/end`)
      .set('Authorization', `Bearer ${clientToken(INITIATOR_ID)}`);

    expect(res.status).toBe(500);
  });
});
