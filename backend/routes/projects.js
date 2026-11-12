const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole, requireEmailVerified } = require('../middleware/auth');
const { getActiveTier, getTierConfig } = require('./subscriptions');
const { sendPushNotification } = require('../config/pushNotifications');
const geniuspay = require('../utils/geniuspay');
const upload = require('../config/upload');
const { verifyMagicBytes } = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

const router = express.Router();

// ============ HELPER FUNCTIONS ============

// Helper: Build project include for GET /mine
function getMyProjectInclude() {
  return {
    photos: true,
    quotes: {
      include: {
        professional: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, city: true } },
          },
        },
      },
    },
  };
}

// OPTIMIZATION #32: Lazy Loading vs Eager Loading - Split base + optional nested loads
// Use this for GET /api/projects/:id (detail view with all relations)
function getProjectDetailInclude() {
  return {
    photos: true,
    client: { select: { firstName: true, lastName: true, city: true, phone: true } },
    quotes: {
      include: {
        professional: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
          },
        },
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { select: { id: true, status: true, isDeposit: true, geniuspayRef: true } },
      },
      orderBy: { version: 'desc' },
    },
    review: true,
  };
}

// OPTIMIZATION #32: Lazy Loading - Minimal query for list views (GET /api/projects)
function getProjectListSelect() {
  return {
    id: true,
    title: true,
    description: true,
    budget: true,
    status: true,
    city: true,
    createdAt: true,
    clientId: true,
    category: true,
    // Don't include photos, quotes, or other relations - load on demand
  };
}

// Helper: Verify pending payment with GeniusPay
async function verifyPendingPayment(payment) {
  if (payment.status !== 'pending' || !payment.geniuspayRef) {
    return null;
  }

  try {
    const gpResponse = await geniuspay.getPayment(payment.geniuspayRef);
    const gpData = gpResponse?.data || gpResponse;

    if (gpData?.status !== 'completed' && gpData?.status !== 'success') {
      return null;
    }

    const receivedAmount = gpData?.amount || gpData?.paid_amount;
    if (receivedAmount === undefined) {
      return null;
    }

    const amountMismatch = Math.abs(receivedAmount - payment.amount) > 1;
    return {
      amountMismatch,
      receivedAmount,
      gpStatus: gpData?.status,
    };
  } catch {
    return null;
  }
}

// Helper: Update payment status based on verification
async function updatePaymentStatus(payment, verification) {
  if (verification.amountMismatch) {
    const logger = require('../utils/logger');
    logger.warn(`Payment amount mismatch detected for payment ${payment.id}`);
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'failed',
        metadata: JSON.stringify({
          reason: 'amount_mismatch',
          expected: payment.amount,
          received: verification.receivedAmount,
        }),
      },
    });
    return 'failed';
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'succeeded', completedAt: new Date() },
  });
  return 'succeeded';
}

// OPTIMIZATION #31: Fix N+1 - Batch payment verification instead of nested loop
async function processPendingPayments(quotes) {
  // Collect all pending payments from all quotes in one pass
  const pendingPayments = [];
  for (const quote of quotes) {
    for (const payment of quote.payments) {
      if (payment.status === 'pending') {
        pendingPayments.push(payment);
      }
    }
  }

  // Verify all pending payments in parallel, not sequentially
  const verifications = await Promise.all(
    pendingPayments.map(p => verifyPendingPayment(p))
  );

  // Update all statuses in parallel
  const updates = pendingPayments
    .map((payment, i) => {
      if (verifications[i]) {
        return updatePaymentStatus(payment, verifications[i]);
      }
      return null;
    })
    .filter(Boolean);

  await Promise.all(updates);
}

// Helper: Check project access permissions
function checkProjectAccess(project, userId, userRole) {
  const isOwner = project.clientId === userId;
  const isInvolvedPro = project.quotes.some(q => q.professional?.user?.id === userId);
  const isAdmin = userRole === 'ADMIN';
  return isOwner || isInvolvedPro || isAdmin;
}

// OPTIMIZATION #31: Fix N+1 - Use select for minimal data instead of full query
async function markAlreadyQuotedProjects(projects, userId, userRole) {
  const alreadyQuotedIds = new Set();

  if (userRole !== 'PROFESSIONAL') {
    return alreadyQuotedIds;
  }

  const pro = await prisma.professional.findUnique({
    where: { userId },
    select: { id: true }, // Only need ID, not full professional data
  });
  if (!pro) {
    return alreadyQuotedIds;
  }

  // Use select to limit fields returned - only what we need
  const existingQuotes = await prisma.quote.findMany({
    where: { professionalId: pro.id, projectId: { in: projects.map(p => p.id) } },
    select: { projectId: true }, // Minimal data only
  });

  return new Set(existingQuotes.map(q => q.projectId));
}

// Helper: Apply subscription delay to projects query
async function applySubscriptionDelay(userId, where) {
  const pro = await prisma.professional.findUnique({
    where: { userId },
    include: { subscription: true },
  });

  if (!pro) {
    return;
  }

  const projectsTier = getActiveTier(pro?.subscription, pro);
  const delayMs = getTierConfig(projectsTier).projectsDelayMs;

  if (delayMs > 0) {
    where.createdAt = { lte: new Date(Date.now() - delayMs) };
  }
}

// Rate limiters
// 10 projets max par heure par utilisateur
const createProjectLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de projets créés, réessayez dans une heure' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 uploads per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de téléchargements, réessayez dans une minute' },
});

// POST /api/projects
router.post('/', requireAuth, requireRole('CLIENT'), requireEmailVerified, createProjectLimiter,
  [
    body('title').trim().notEmpty().isLength({ min: 5, max: 200 }).withMessage('title required, 5-200 chars'),
    body('description').trim().notEmpty().isLength({ min: 20, max: 5000 }).withMessage('description required, 20-5000 chars'),
    body('tradeNeeded').trim().notEmpty().isLength({ max: 100 }).withMessage('tradeNeeded required'),
    body('budgetMin').optional().isNumeric().withMessage('budgetMin must be numeric'),
    body('budgetMax').optional().isNumeric().withMessage('budgetMax must be numeric'),
    body('city').trim().notEmpty().isLength({ max: 100 }).withMessage('city required'),
    body('latitude').optional().isNumeric(),
    body('longitude').optional().isNumeric(),
    body('photos').optional().isArray().withMessage('photos must be array'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { title, description, tradeNeeded, budgetMin, budgetMax, city, latitude, longitude, photos } = req.body;

    if (!title || !description || !tradeNeeded || !city) {
      return res.status(400).json({ error: 'title, description, tradeNeeded et city sont requis', code: 'MISSING_REQUIRED_FIELDS' });
    }

    const project = await prisma.project.create({
      data: {
        clientId: req.user.id,
        title,
        description,
        tradeNeeded,
        budgetMin,
        budgetMax,
        city,
        latitude,
        longitude,
        photos: photos ? { create: photos.map((url) => ({ imageUrl: url })) } : undefined,
      },
      include: { photos: true },
    });

    res.status(201).json(project);
  } catch (err) {
    logger.error('POST /api/projects failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la création du projet', code: 'PROJECT_CREATE_ERROR' });
  }
});

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
    const { trade, trades, city, status, sort, order } = req.query;
    const allowedSortFields = getSortableFields('GET /projects');

    // Q63 + Q64: Build pagination and sorting query
    // Q61: Use centralized pagination config (max 20 items for projects list)
    const paginationQuery = buildPaginationQuery({
      page: req.query.page,
      limit: req.query.limit,
      isAdmin: false,
      sortParam: sort,
      orderParam: order,
      allowedFields: allowedSortFields,
      defaultOrder: { createdAt: 'desc' },
      endpoint: 'projects',
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
        await applySubscriptionDelay(req.user.id, where);
      } catch (err) {
        logger.error('GET /api/projects - subscription delay failed', { userId: req.user.id, error: err.message });
      }
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        photos: true,
        client: { select: { firstName: true, lastName: true, city: true } },
        _count: { select: { quotes: true } },
      },
      ...paginationQuery,
    });

    const alreadyQuotedIds = await markAlreadyQuotedProjects(projects, req.user.id, req.user.role);

    res.json(projects.map(p => ({
      ...p,
      quoteCount: p._count.quotes,
      _count: undefined,
      alreadyQuoted: alreadyQuotedIds.has(p.id),
    })));
  } catch (err) {
    logger.error('GET /api/projects failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération des projets', code: 'PROJECT_FETCH_ERROR' });
  }
});

// GET /api/projects/mine
router.get('/mine', readLimiter, requireAuth, requireRole('CLIENT'), handleValidationErrors, async (req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      where: { clientId: req.user.id },
      include: getMyProjectInclude(),
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(projects);
  } catch (err) {
    logger.error('GET /api/projects/mine failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération de vos projets', code: 'MY_PROJECTS_FETCH_ERROR' });
  }
});

// GET /api/projects/:id
router.get('/:id', readLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: getProjectDetailInclude(),
    });

    if (!project) {
      return res.status(404).json({ error: 'Projet introuvable', code: 'PROJECT_NOT_FOUND' });
    }

    if (!checkProjectAccess(project, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    try {
      await processPendingPayments(project.quotes);
    } catch (err) {
      logger.error('GET /api/projects/:id - payment processing failed', { projectId: req.params.id, error: err.message });
    }

    res.json({ ...project, alreadyReviewed: !!project.review });
  } catch (err) {
    logger.error('GET /api/projects/:id failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération du projet', code: 'PROJECT_DETAIL_FETCH_ERROR' });
  }
});

// PATCH /api/projects/:id
router.patch('/:id', writeLimiter, requireAuth, requireRole('CLIENT'),
  [
    param('id').trim().notEmpty().withMessage('id requis'),
    body('status').optional().isIn(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).withMessage('invalid status'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project || project.clientId !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    const allowedStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
    if (req.body.status && !allowedStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: 'Statut invalide', code: 'INVALID_STATUS' });
    }

    const updated = await prisma.project.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
    });
    res.json(updated);
  } catch (err) {
    logger.error('PATCH /api/projects/:id failed', { projectId: req.params.id, userId: req.user.id, status: req.body.status, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la mise à jour du projet', code: 'PROJECT_UPDATE_ERROR' });
  }
});

// PATCH /api/projects/:id/complete
router.patch('/:id/complete', writeLimiter, requireAuth, requireRole('CLIENT'),
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { quotes: { where: { status: 'ACCEPTED' } } },
    });
    if (!project || project.clientId !== req.user.id) return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    if (project.status !== 'IN_PROGRESS') return res.status(400).json({ error: 'Ce projet doit être en cours pour être marqué comme terminé', code: 'INVALID_PROJECT_STATUS' });

    const bothConfirmed = project.proConfirmedCompletion;
    await prisma.project.update({
      where: { id: req.params.id },
      data: { clientConfirmedCompletion: true, status: bothConfirmed ? 'COMPLETED' : 'IN_PROGRESS' },
    });

    const acceptedQuote = project.quotes[0];
    if (bothConfirmed && acceptedQuote) {
      try {
        await prisma.professional.update({ where: { id: acceptedQuote.professionalId }, data: { completedMissionsCount: { increment: 1 } } });
      } catch (err) {
        logger.error('PATCH /api/projects/:id/complete - failed to update missions count', { projectId: req.params.id, error: err.message });
      }
      const pro = await prisma.professional.findUnique({ where: { id: acceptedQuote.professionalId }, select: { userId: true } });
      if (pro) {
        try {
          sendPushNotification(pro.userId, 'Mission terminée !', `La mission "${project.title}" est officiellement terminée. Bravo !`, { type: 'mission_completed', projectId: project.id });
        } catch (err) {
          logger.error('PATCH /api/projects/:id/complete - failed to send pro notification', { projectId: req.params.id, error: err.message });
        }
      }
      try {
        sendPushNotification(project.clientId, 'Mission terminée !', `La mission "${project.title}" est terminée. Vous pouvez laisser un avis.`, { type: 'mission_completed', projectId: project.id });
      } catch (err) {
        logger.error('PATCH /api/projects/:id/complete - failed to send client notification', { projectId: req.params.id, error: err.message });
      }
      // Recalcul badges (fire-and-forget) — peut débloquer FIRST_MISSION, TEN_MISSIONS, FIFTY_MISSIONS
      const { computeBadges } = require('../utils/badges');
      computeBadges(acceptedQuote.professionalId).catch(() => {});
    } else if (!bothConfirmed && acceptedQuote) {
      const pro = await prisma.professional.findUnique({ where: { id: acceptedQuote.professionalId }, select: { userId: true } });
      if (pro) {
        try {
          sendPushNotification(pro.userId, 'Confirmation de fin demandée', `Le client a confirmé la fin de "${project.title}". Confirmez à votre tour.`, { type: 'confirm_completion', projectId: project.id });
        } catch (err) {
          logger.error('PATCH /api/projects/:id/complete - failed to send pending notification', { projectId: req.params.id, error: err.message });
        }
      }
    }

    res.json({ completed: bothConfirmed, waitingForOtherParty: !bothConfirmed });
  } catch (err) {
    logger.error('PATCH /api/projects/:id/complete failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la marque du projet comme complété', code: 'PROJECT_COMPLETE_ERROR' });
  }
});

// PATCH /api/projects/:id/confirm-completion
router.patch('/:id/confirm-completion', writeLimiter, requireAuth, requireRole('PROFESSIONAL'),
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    if (!pro) {
      logger.error('PATCH /api/projects/:id/confirm-completion - professional not found', { userId: req.user.id });
      return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { quotes: { where: { status: 'ACCEPTED', professionalId: pro.id } } },
    });
    if (!project || project.quotes.length === 0) return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    if (project.status !== 'IN_PROGRESS') return res.status(400).json({ error: 'Ce projet doit être en cours', code: 'INVALID_PROJECT_STATUS' });

    const bothConfirmed = project.clientConfirmedCompletion;
    await prisma.project.update({
      where: { id: req.params.id },
      data: { proConfirmedCompletion: true, status: bothConfirmed ? 'COMPLETED' : 'IN_PROGRESS' },
    });

    if (bothConfirmed) {
      try {
        await prisma.professional.update({ where: { id: pro.id }, data: { completedMissionsCount: { increment: 1 } } });
      } catch (err) {
        logger.error('PATCH /api/projects/:id/confirm-completion - failed to update missions count', { projectId: req.params.id, error: err.message });
      }
      try {
        sendPushNotification(project.clientId, 'Mission terminée !', `La mission "${project.title}" est officiellement terminée. Vous pouvez laisser un avis.`, { type: 'mission_completed', projectId: project.id });
      } catch (err) {
        logger.error('PATCH /api/projects/:id/confirm-completion - failed to send client notification', { projectId: req.params.id, error: err.message });
      }
      try {
        sendPushNotification(pro.userId, 'Mission terminée !', `La mission "${project.title}" est terminée. Bravo !`, { type: 'mission_completed', projectId: project.id });
      } catch (err) {
        logger.error('PATCH /api/projects/:id/confirm-completion - failed to send pro notification', { projectId: req.params.id, error: err.message });
      }
      // Recalcul badges (fire-and-forget) — peut débloquer FIRST_MISSION, TEN_MISSIONS, FIFTY_MISSIONS
      const { computeBadges } = require('../utils/badges');
      computeBadges(pro.id).catch(() => {});
    } else {
      try {
        sendPushNotification(project.clientId, 'Confirmation de fin demandée', `Le professionnel a confirmé la fin de "${project.title}". Confirmez à votre tour.`, { type: 'confirm_completion', projectId: project.id });
      } catch (err) {
        logger.error('PATCH /api/projects/:id/confirm-completion - failed to send pending notification', { projectId: req.params.id, error: err.message });
      }
    }

    res.json({ completed: bothConfirmed, waitingForOtherParty: !bothConfirmed });
  } catch (err) {
    logger.error('PATCH /api/projects/:id/confirm-completion failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la confirmation de fin', code: 'PROJECT_CONFIRM_COMPLETION_ERROR' });
  }
});

// PATCH /api/projects/:id/cancel
router.patch('/:id/cancel', writeLimiter, requireAuth, requireRole('CLIENT'),
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { quotes: { where: { status: 'ACCEPTED' } } },
    });
    if (!project || project.clientId !== req.user.id) return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });

    const wasInProgress = project.status === 'IN_PROGRESS';
    await prisma.project.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });

    const acceptedQuote = project.quotes[0];
    if (wasInProgress && acceptedQuote) {
      try {
        await prisma.professional.update({
          where: { id: acceptedQuote.professionalId },
          data: { cancelledMissionsCount: { increment: 1 } },
        });
      } catch (err) {
        logger.error('PATCH /api/projects/:id/cancel - failed to update cancelled count', { projectId: req.params.id, error: err.message });
      }
    }
    res.json({ cancelled: true });
  } catch (err) {
    logger.error('PATCH /api/projects/:id/cancel failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de l\'annulation du projet', code: 'PROJECT_CANCEL_ERROR' });
  }
});

// Helper: Upload files to Cloudinary
async function uploadProjectPhotos(files) {
  return Promise.all(files.map((file) => uploadBuffer(file.buffer, 'manawa/projects')));
}

// Helper: Create photo records in database
async function createPhotoRecords(projectId, imageUrls) {
  return Promise.all(
    imageUrls.map((imageUrl) =>
      prisma.projectPhoto.create({
        data: { projectId, imageUrl },
      })
    )
  );
}

// POST /api/projects/:id/photos — Upload photos to an existing project
router.post('/:id/photos', uploadLimiter, requireAuth, requireRole('CLIENT'), upload.array('photos', 5), verifyMagicBytes,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project || project.clientId !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucune photo fournie', code: 'NO_FILES_PROVIDED' });
    }

    let imageUrls;
    try {
      imageUrls = await uploadProjectPhotos(req.files);
    } catch (err) {
      logger.error('POST /api/projects/:id/photos - upload failed', { projectId: req.params.id, error: err.message });
      return res.status(503).json({ error: 'Erreur lors du téléchargement des photos', code: 'UPLOAD_FAILED' });
    }

    let photos;
    try {
      photos = await createPhotoRecords(project.id, imageUrls);
    } catch (err) {
      logger.error('POST /api/projects/:id/photos - photo record creation failed', { projectId: req.params.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de l\'enregistrement des photos', code: 'PHOTO_RECORD_ERROR' });
    }

    res.status(201).json(photos);
  } catch (err) {
    logger.error('POST /api/projects/:id/photos failed', { projectId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors du traitement des photos', code: 'PHOTO_PROCESSING_ERROR' });
  }
});

module.exports = router;
