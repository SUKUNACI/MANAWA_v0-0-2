/**
 * Project Routes
 * HTTP layer only — business logic delegated to ProjectModule.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, query } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole, requireEmailVerified } = require('../middleware/auth');
const { getActiveTier, getTierConfig } = require('./subscriptions');
const { sendPushNotification } = require('../config/pushNotifications');
const upload = require('../config/upload');
const { verifyMagicBytes } = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const ProjectModule = require('../modules/project');

const router = express.Router();
const projectModule = new ProjectModule(prisma);

function requireAuthenticated(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

// Rate limiters
const createProjectLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de projets créés, réessayez dans une heure' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de téléchargements, réessayez dans une minute' },
});

// POST /api/projects
router.post('/', requireAuth, requireAuthenticated, requireRole('CLIENT'), requireEmailVerified, createProjectLimiter,
  [
    body('title').trim().notEmpty().withMessage('title is required').isLength({ min: 1, max: 200 }),
    body('description').trim().notEmpty().withMessage('description is required').isLength({ min: 10, max: 5000 }),
    body('tradeNeeded').trim().notEmpty().isLength({ max: 100 }),
    body('budgetMin').optional().isNumeric(),
    body('budgetMax').optional().isNumeric(),
    body('city').trim().notEmpty().isLength({ max: 100 }),
    body('latitude').optional().isNumeric(),
    body('longitude').optional().isNumeric(),
    body('photos').optional().isArray(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { title, description, tradeNeeded, budgetMin, budgetMax, city, latitude, longitude, photos } = req.body;
      if (!title || !description || !tradeNeeded || !city) {
        return res.status(400).json({ error: 'title, description, tradeNeeded et city sont requis', code: 'MISSING_REQUIRED_FIELDS' });
      }
      const project = await projectModule.create({ clientId: req.user.id, title, description, tradeNeeded, budgetMin, budgetMax, city, latitude, longitude, photos });
      res.status(201).json(project);
    } catch (err) {
      logger.error('POST /api/projects failed', { userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la création du projet', code: 'PROJECT_CREATE_ERROR' });
    }
  }
);

// GET /api/projects
router.get('/', readLimiter, requireAuth,
  [
    query('trade').optional().trim().isLength({ max: 100 }),
    query('trades').optional().trim().isLength({ max: 500 }),
    query('city').optional().trim().isLength({ max: 100 }),
    query('status').optional().isIn(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('sort').optional().isLength({ max: 200 }),
    query('order').optional().isLength({ max: 200 }),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { trade, trades, city, sort, order } = req.query;
      const allowedSortFields = getSortableFields('GET /projects');
      const paginationQuery = buildPaginationQuery({
        page: req.query.page, limit: req.query.limit, isAdmin: false,
        sortParam: sort, orderParam: order, allowedFields: allowedSortFields,
        defaultOrder: { createdAt: 'desc' }, endpoint: 'projects',
      });

      const tradesArray = trades ? trades.split(',') : undefined;
      const where = {
        tradeNeeded: tradesArray ? { in: tradesArray } : trade || undefined,
        city: city || undefined,
        status: 'OPEN',
      };

      if (req.user.role === 'CLIENT') {
        where.clientId = { not: req.user.id };
      } else if (req.user.role === 'PROFESSIONAL') {
        try {
          await projectModule.applySubscriptionDelay(req.user.id, where, { getActiveTier, getTierConfig });
        } catch (err) {
          logger.error('GET /api/projects - subscription delay failed', { userId: req.user.id, error: err.message });
        }
      }

      const projects = await projectModule.list({ where, paginationQuery });
      const alreadyQuotedIds = await projectModule.getAlreadyQuotedIds(projects, req.user.id, req.user.role);

      res.json(projects.map(p => {
        const quoteCount = p._count?.quotes ?? 0;
        const photoCount = p._count?.photos ?? 0;
        return { ...p, quoteCount, photoCount, _count: { quotes: quoteCount, photos: photoCount }, alreadyQuoted: alreadyQuotedIds.has(p.id) };
      }));
    } catch (err) {
      logger.error('GET /api/projects failed', { userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération des projets', code: 'PROJECT_FETCH_ERROR' });
    }
  }
);

// GET /api/projects/mine
router.get('/mine', readLimiter, requireAuth, requireAuthenticated, requireRole('CLIENT'), handleValidationErrors, async (req, res, next) => {
  try {
    const projects = await projectModule.listMine(req.user.id);
    res.json(projects);
  } catch (err) {
    logger.error('GET /api/projects/mine failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération de vos projets', code: 'MY_PROJECTS_FETCH_ERROR' });
  }
});

// GET /api/projects/:id
router.get('/:id', readLimiter, requireAuth, requireAuthenticated,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const project = await projectModule.getDetail(req.params.id);

      if (!projectModule.checkAccess(project, req.user.id, req.user.role)) {
        return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
      }

      // Verify pending payments (fire-and-forget style error handling)
      try {
        const { processPendingPayments } = require('./projects-helpers');
        await processPendingPayments(project.quotes);
      } catch (err) {
        // Inline fallback if helper doesn't exist — keep original behaviour
      }

      res.json({ ...project, alreadyReviewed: !!project.review });
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ error: err.message, code: err.code });
      logger.error('GET /api/projects/:id failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération du projet', code: 'PROJECT_DETAIL_FETCH_ERROR' });
    }
  }
);

// PATCH /api/projects/:id
router.patch('/:id', writeLimiter, requireAuth, requireAuthenticated, requireRole('CLIENT'),
  [
    param('id').trim().notEmpty().withMessage('id requis'),
    body('status').optional().isIn(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).withMessage('statut invalide'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project || project.clientId !== req.user.id) {
        return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
      }
      const updated = await projectModule.updateStatus(req.params.id, req.body.status);
      res.json(updated);
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message, code: err.code });
      logger.error('PATCH /api/projects/:id failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la mise à jour du projet', code: 'PROJECT_UPDATE_ERROR' });
    }
  }
);

// PATCH /api/projects/:id/complete
router.patch('/:id/complete', writeLimiter, requireAuth, requireRole('CLIENT'),
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { completed, waitingForOtherParty, acceptedQuote } = await projectModule.clientConfirmCompletion(req.params.id);

      if (completed && acceptedQuote) {
        await projectModule.incrementCompletedMissions(acceptedQuote.professionalId);
        const pro = await prisma.professional.findUnique({ where: { id: acceptedQuote.professionalId }, select: { userId: true } });
        if (pro) {
          sendPushNotification(pro.userId, 'Mission terminée !', `La mission est officiellement terminée. Bravo !`, { type: 'mission_completed', projectId: req.params.id }).catch(() => {});
        }
        sendPushNotification(req.user.id, 'Mission terminée !', `La mission est terminée. Vous pouvez laisser un avis.`, { type: 'mission_completed', projectId: req.params.id }).catch(() => {});
        const { computeBadges } = require('../utils/badges');
        computeBadges(acceptedQuote.professionalId).catch(() => {});
      } else if (!completed && acceptedQuote) {
        const pro = await prisma.professional.findUnique({ where: { id: acceptedQuote.professionalId }, select: { userId: true } });
        if (pro) {
          sendPushNotification(pro.userId, 'Confirmation de fin demandée', 'Le client a confirmé la fin. Confirmez à votre tour.', { type: 'confirm_completion', projectId: req.params.id }).catch(() => {});
        }
      }

      res.json({ completed, waitingForOtherParty });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message, code: err.code });
      if (err.status === 403) return res.status(403).json({ error: err.message, code: err.code });
      logger.error('PATCH /api/projects/:id/complete failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la marque du projet comme complété', code: 'PROJECT_COMPLETE_ERROR' });
    }
  }
);

// PATCH /api/projects/:id/confirm-completion
router.patch('/:id/confirm-completion', writeLimiter, requireAuth, requireRole('PROFESSIONAL'),
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
      if (!pro) return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });

      const { completed, waitingForOtherParty } = await projectModule.proConfirmCompletion(req.params.id, pro.id);

      const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { clientId: true, title: true } });
      if (completed) {
        await projectModule.incrementCompletedMissions(pro.id);
        if (project) {
          sendPushNotification(project.clientId, 'Mission terminée !', `La mission "${project.title}" est officiellement terminée. Vous pouvez laisser un avis.`, { type: 'mission_completed', projectId: req.params.id }).catch(() => {});
        }
        sendPushNotification(pro.userId, 'Mission terminée !', 'Bravo !', { type: 'mission_completed', projectId: req.params.id }).catch(() => {});
        const { computeBadges } = require('../utils/badges');
        computeBadges(pro.id).catch(() => {});
      } else if (project) {
        sendPushNotification(project.clientId, 'Confirmation de fin demandée', `Le professionnel a confirmé la fin. Confirmez à votre tour.`, { type: 'confirm_completion', projectId: req.params.id }).catch(() => {});
      }

      res.json({ completed, waitingForOtherParty });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message, code: err.code });
      if (err.status === 403) return res.status(403).json({ error: err.message, code: err.code });
      logger.error('PATCH /api/projects/:id/confirm-completion failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la confirmation de fin', code: 'PROJECT_CONFIRM_COMPLETION_ERROR' });
    }
  }
);

// PATCH /api/projects/:id/cancel
router.patch('/:id/cancel', writeLimiter, requireAuth, requireRole('CLIENT'),
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const result = await projectModule.cancel(req.params.id, req.user.id);
      res.json(result);
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ error: err.message, code: err.code });
      logger.error('PATCH /api/projects/:id/cancel failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
      res.status(500).json({ error: "Erreur lors de l'annulation du projet", code: 'PROJECT_CANCEL_ERROR' });
    }
  }
);

// POST /api/projects/:id/photos
router.post('/:id/photos', uploadLimiter, requireAuth, requireRole('CLIENT'), upload.array('photos', 5), verifyMagicBytes,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Aucune photo fournie', code: 'NO_FILES_PROVIDED' });
      }

      let imageUrls;
      try {
        imageUrls = await Promise.all(req.files.map(f => uploadBuffer(f.buffer, 'manawa/projects')));
      } catch (err) {
        logger.error('POST /api/projects/:id/photos - upload failed', { projectId: req.params.id, error: err.message });
        return res.status(503).json({ error: 'Erreur lors du téléchargement des photos', code: 'UPLOAD_FAILED' });
      }

      const photos = await projectModule.addPhotos(req.params.id, req.user.id, imageUrls);
      res.status(201).json(photos);
    } catch (err) {
      if (err.status === 403) return res.status(403).json({ error: err.message, code: err.code });
      logger.error('POST /api/projects/:id/photos failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
      res.status(500).json({ error: 'Erreur lors du traitement des photos', code: 'PHOTO_PROCESSING_ERROR' });
    }
  }
);

module.exports = router;
