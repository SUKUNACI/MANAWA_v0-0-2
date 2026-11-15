const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { createVideoRoom, deleteVideoRoom } = require('../utils/daily');
const { sendPushNotification } = require('../config/pushNotifications');
const VideoCallModule = require('../modules/videoCall');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requetes, reessayez dans une minute' },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requetes, reessayez dans une minute' },
});

const videoCall = new VideoCallModule(prisma, createVideoRoom, deleteVideoRoom, sendPushNotification);

// GET /api/video-calls
router.get('/', readLimiter, requireAuth, async (req, res, next) => {
  try {
    const result = await videoCall.listActiveCalls(req.user.id);
    res.json(result);
  } catch (err) {
    logger.error('GET /api/video-calls failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la recuperation des appels', code: 'VIDEO_CALLS_FETCH_ERROR' });
  }
});

// POST /api/video-calls
router.post('/', writeLimiter, requireAuth,
  [
    body('participantId').trim().notEmpty().withMessage('participantId requis'),
    body('projectId').optional().trim().notEmpty(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const result = await videoCall.initiateCall(req.user.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      logger.error('POST /api/video-calls failed', { initiatorId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de l initiation de l appel', code: 'VIDEO_CALL_CREATION_ERROR' });
    }
  }
);

// GET /api/video-calls/active
router.get('/active', requireAuth, async (req, res, next) => {
  try {
    const calls = await videoCall.getActivePendingCalls(req.user.id);
    res.json(calls);
  } catch (err) {
    logger.error('GET /api/video-calls/active failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la recuperation des appels actifs', code: 'ACTIVE_CALLS_FETCH_ERROR' });
  }
});

// GET /api/video-calls/history
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const result = await videoCall.getHistory(req.user.id, { page, limit });
    res.json(result);
  } catch (err) {
    logger.error('GET /api/video-calls/history failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la recuperation de l historique', code: 'CALL_HISTORY_FETCH_ERROR' });
  }
});

// PATCH /api/video-calls/:id/join
router.patch('/:id/join', requireAuth, async (req, res, next) => {
  try {
    const result = await videoCall.joinCall(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    logger.error('PATCH /api/video-calls/:id/join failed', { callId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la jointure de l appel', code: 'CALL_JOIN_ERROR' });
  }
});

// PATCH /api/video-calls/:id/end
router.patch('/:id/end', requireAuth, async (req, res, next) => {
  try {
    const result = await videoCall.endCall(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    logger.error('PATCH /api/video-calls/:id/end failed', { callId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la terminaison de l appel', code: 'CALL_END_ERROR' });
  }
});

module.exports = router;
