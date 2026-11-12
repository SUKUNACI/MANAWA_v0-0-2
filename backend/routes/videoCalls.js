const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { param, body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { sendPushNotification } = require('../config/pushNotifications');
const { createVideoRoom, deleteVideoRoom } = require('../utils/daily');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

const router = express.Router();

// Rate limiters
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// GET /api/video-calls — List active and recent video calls
router.get('/', requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const activeCalls = await prisma.videoCall.findMany({
      where: {
        OR: [{ initiatorId: userId }, { participantId: userId }],
        endedAt: null,
      },
      include: {
        initiator: { select: { id: true, firstName: true, lastName: true, email: true } },
        participant: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      take: 10,
    });

    res.json({ activeCalls, count: activeCalls.length });
  } catch (err) {
    logger.error('GET /api/video-calls failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération des appels', code: 'VIDEO_CALLS_FETCH_ERROR' });
  }
});

// POST /api/video-calls — initier un appel vidéo
router.post('/', requireAuth,
  [
    body('participantId').trim().notEmpty().withMessage('participantId requis'),
    body('projectId').optional().trim().notEmpty(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { participantId, projectId } = req.body;
    const initiatorId = req.user.id;

    if (!participantId) {
      return res.status(400).json({ error: 'participantId est requis', code: 'MISSING_PARTICIPANT_ID' });
    }
    if (participantId === initiatorId) {
      return res.status(400).json({ error: 'Vous ne pouvez pas appeler vous-même', code: 'CANNOT_CALL_SELF' });
    }

    // Vérifier que le participant existe
    const participant = await prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true, firstName: true, lastName: true, suspended: true, deletedAt: true },
    });
    if (!participant || participant.deletedAt) {
      return res.status(404).json({ error: 'Participant introuvable', code: 'PARTICIPANT_NOT_FOUND' });
    }
    if (participant.suspended) {
      return res.status(403).json({ error: 'Ce compte est suspendu', code: 'ACCOUNT_SUSPENDED' });
    }

    // Vérifier que DAILY_API_KEY est configuré
    if (!process.env.DAILY_API_KEY) {
      return res.status(503).json({ error: 'Le service d\'appel vidéo n\'est pas configuré. Contactez l\'administrateur.', code: 'VIDEO_SERVICE_NOT_CONFIGURED' });
    }

    // Nom de room unique : mnw-{8 premiers chars d'un uuid}
    const roomName = `mnw-${uuidv4().replace(/-/g, '').substring(0, 8)}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // +1 heure

    // Créer la room Daily.co
    let roomData;
    try {
      roomData = await createVideoRoom(roomName, 60);
    } catch (err) {
      logger.error('POST /api/video-calls - Daily.co room creation failed', { initiatorId, participantId, error: err.message });
      return res.status(502).json({ error: 'Impossible de créer la salle vidéo. Réessayez dans un instant.', code: 'ROOM_CREATION_FAILED' });
    }

    if (!roomData || !roomData.url) {
      logger.error('POST /api/video-calls - invalid room data response', { initiatorId, participantId });
      return res.status(502).json({ error: 'Réponse invalide du service vidéo.', code: 'INVALID_ROOM_RESPONSE' });
    }

    const roomUrl = roomData.url;

    // Créer l'enregistrement en DB
    const videoCall = await prisma.videoCall.create({
      data: {
        roomName,
        roomUrl,
        initiatorId,
        participantId,
        status: 'PENDING',
        projectId: projectId || null,
        expiresAt,
      },
    });

    // Récupérer le nom de l'initiateur pour la notification
    let initiatorName = 'Quelqu\'un';
    try {
      const initiator = await prisma.user.findUnique({
        where: { id: initiatorId },
        select: { firstName: true, lastName: true },
      });
      if (initiator) {
        initiatorName = `${initiator.firstName} ${initiator.lastName}`;
      }
    } catch (err) {
      logger.error('POST /api/video-calls - initiator lookup failed', { initiatorId, error: err.message });
    }

    // Envoyer push notification au participant (fire-and-forget)
    sendPushNotification(
      participantId,
      `📹 Appel vidéo de ${initiatorName}`,
      'Rejoignez la consultation maintenant',
      { type: 'video_call', roomUrl, callId: videoCall.id }
    ).catch(err => logger.error('POST /api/video-calls - push notification failed', { callId: videoCall.id, error: err.message }));

    return res.status(201).json({
      callId: videoCall.id,
      roomUrl,
      roomName,
      expiresAt,
    });
  } catch (err) {
    logger.error('POST /api/video-calls failed', { initiatorId: req.user.id, participantId: req.body.participantId, error: err.message });
    res.status(500).json({ error: 'Erreur lors de l\'initiation de l\'appel', code: 'VIDEO_CALL_CREATION_ERROR' });
  }
});

// GET /api/video-calls/active — appels actifs/pending du user (non expirés)
router.get('/active', requireAuth, async (req, res, next) => {
  try {
    const calls = await prisma.videoCall.findMany({
      where: {
        OR: [
          { initiatorId: req.user.id },
          { participantId: req.user.id },
        ],
        status: { in: ['PENDING', 'ACTIVE'] },
        expiresAt: { gt: new Date() },
      },
      include: {
        initiator: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        participant: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(calls);
  } catch (err) {
    logger.error('GET /api/video-calls/active failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération des appels actifs', code: 'ACTIVE_CALLS_FETCH_ERROR' });
  }
});

// GET /api/video-calls/history — historique paginé
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);

    const [calls, total] = await Promise.all([
      prisma.videoCall.findMany({
        where: {
          OR: [
            { initiatorId: req.user.id },
            { participantId: req.user.id },
          ],
        },
        include: {
          initiator: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          participant: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      prisma.videoCall.count({
        where: {
          OR: [
            { initiatorId: req.user.id },
            { participantId: req.user.id },
          ],
        },
      }),
    ]);

    return res.json({
      calls,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error('GET /api/video-calls/history failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération de l\'historique', code: 'CALL_HISTORY_FETCH_ERROR' });
  }
});

// PATCH /api/video-calls/:id/join — participant rejoint l'appel
router.patch('/:id/join', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const videoCall = await prisma.videoCall.findUnique({ where: { id } });
    if (!videoCall) {
      return res.status(404).json({ error: 'Appel introuvable', code: 'CALL_NOT_FOUND' });
    }

    // Seul le participant peut rejoindre
    if (videoCall.participantId !== req.user.id) {
      return res.status(403).json({ error: 'Vous n\'êtes pas le participant de cet appel', code: 'ACCESS_DENIED' });
    }

    if (videoCall.status === 'ENDED' || videoCall.status === 'MISSED') {
      return res.status(400).json({ error: 'Cet appel est terminé', code: 'CALL_ENDED' });
    }

    if (new Date() > videoCall.expiresAt) {
      return res.status(400).json({ error: 'Cet appel a expiré', code: 'CALL_EXPIRED' });
    }

    const updated = await prisma.videoCall.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        startedAt: videoCall.startedAt || new Date(),
      },
    });

    return res.json({ roomUrl: updated.roomUrl, callId: updated.id, status: updated.status });
  } catch (err) {
    logger.error('PATCH /api/video-calls/:id/join failed', { callId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la jointure de l\'appel', code: 'CALL_JOIN_ERROR' });
  }
});

// PATCH /api/video-calls/:id/end — terminer l'appel
router.patch('/:id/end', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const videoCall = await prisma.videoCall.findUnique({ where: { id } });
    if (!videoCall) {
      return res.status(404).json({ error: 'Appel introuvable', code: 'CALL_NOT_FOUND' });
    }

    // Initiateur ou participant peut terminer l'appel
    if (videoCall.initiatorId !== req.user.id && videoCall.participantId !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne participez pas à cet appel', code: 'ACCESS_DENIED' });
    }

    if (videoCall.status === 'ENDED') {
      return res.status(400).json({ error: 'Cet appel est déjà terminé', code: 'CALL_ALREADY_ENDED' });
    }

    await prisma.videoCall.update({
      where: { id },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
      },
    });

    // Supprimer la room Daily.co en arrière-plan (fire-and-forget)
    deleteVideoRoom(videoCall.roomName).catch(err =>
      logger.error('PATCH /api/video-calls/:id/end - Daily.co room deletion failed', { callId: id, error: err.message })
    );

    return res.json({ success: true, message: 'Appel terminé' });
  } catch (err) {
    logger.error('PATCH /api/video-calls/:id/end failed', { callId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la terminaison de l\'appel', code: 'CALL_END_ERROR' });
  }
});

module.exports = router;
