const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const { requireAuth, requireRole, requireEmailVerified } = require('../middleware/auth');
const { getActiveTier, getTierConfig } = require('./subscriptions');
const { sendPushNotification } = require('../config/pushNotifications');
const geniuspay = require('../utils/geniuspay');
const upload = require('../config/upload');
const { verifyMagicBytes } = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');

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

// Helper: Build project include for GET /:id
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

// Helper: Process all pending payments for quotes
async function processPendingPayments(quotes) {
  for (const quote of quotes) {
    for (const payment of quote.payments) {
      const verification = await verifyPendingPayment(payment);
      if (verification) {
        payment.status = await updatePaymentStatus(payment, verification);
      }
    }
  }
}

// Helper: Check project access permissions
function checkProjectAccess(project, userId, userRole) {
  const isOwner = project.clientId === userId;
  const isInvolvedPro = project.quotes.some(q => q.professional?.user?.id === userId);
  const isAdmin = userRole === 'ADMIN';
  return isOwner || isInvolvedPro || isAdmin;
}

// Helper: Mark already quoted projects for professional
async function markAlreadyQuotedProjects(projects, userId, userRole) {
  const alreadyQuotedIds = new Set();

  if (userRole !== 'PROFESSIONAL') {
    return alreadyQuotedIds;
  }

  const pro = await prisma.professional.findUnique({ where: { userId } });
  if (!pro) {
    return alreadyQuotedIds;
  }

  const existingQuotes = await prisma.quote.findMany({
    where: { professionalId: pro.id, projectId: { in: projects.map(p => p.id) } },
    select: { projectId: true },
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

// 10 projets max par heure par utilisateur
const createProjectLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Trop de projets créés, réessayez dans une heure' },
});

// POST /api/projects
router.post('/', requireAuth, requireRole('CLIENT'), requireEmailVerified, createProjectLimiter, async (req, res, next) => {
  try {
    const { title, description, tradeNeeded, budgetMin, budgetMax, city, latitude, longitude, photos } = req.body;

    if (!title || !description || !tradeNeeded || !city) {
      return res.status(400).json({ error: 'title, description, tradeNeeded et city sont requis' });
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
    next(err);
  }
});

// GET /api/projects
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { trade, trades, city, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const tradesArray = trades ? trades.split(',') : undefined;

    const where = {
      tradeNeeded: tradesArray ? { in: tradesArray } : trade || undefined,
      city: city || undefined,
      status: 'OPEN',
    };

    if (req.user.role === 'CLIENT') {
      where.clientId = { not: req.user.id };
    } else if (req.user.role === 'PROFESSIONAL') {
      await applySubscriptionDelay(req.user.id, where);
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        photos: true,
        client: { select: { firstName: true, lastName: true, city: true } },
        _count: { select: { quotes: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    });

    const alreadyQuotedIds = await markAlreadyQuotedProjects(projects, req.user.id, req.user.role);

    res.json(projects.map(p => ({
      ...p,
      quoteCount: p._count.quotes,
      _count: undefined,
      alreadyQuoted: alreadyQuotedIds.has(p.id),
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/mine
router.get('/mine', requireAuth, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      where: { clientId: req.user.id },
      include: getMyProjectInclude(),
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: getProjectDetailInclude(),
    });

    if (!project) {
      return res.status(404).json({ error: 'Projet introuvable' });
    }

    if (!checkProjectAccess(project, req.user.id, req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    await processPendingPayments(project.quotes);

    res.json({ ...project, alreadyReviewed: !!project.review });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id
router.patch('/:id', requireAuth, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project || project.clientId !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const allowedStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
    if (req.body.status && !allowedStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const updated = await prisma.project.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id/complete
router.patch('/:id/complete', requireAuth, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { quotes: { where: { status: 'ACCEPTED' } } },
    });
    if (!project || project.clientId !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
    if (project.status !== 'IN_PROGRESS') return res.status(400).json({ error: 'Ce projet doit être en cours pour être marqué comme terminé' });

    const bothConfirmed = project.proConfirmedCompletion;
    await prisma.project.update({
      where: { id: req.params.id },
      data: { clientConfirmedCompletion: true, status: bothConfirmed ? 'COMPLETED' : 'IN_PROGRESS' },
    });

    const acceptedQuote = project.quotes[0];
    if (bothConfirmed && acceptedQuote) {
      await prisma.professional.update({ where: { id: acceptedQuote.professionalId }, data: { completedMissionsCount: { increment: 1 } } });
      const pro = await prisma.professional.findUnique({ where: { id: acceptedQuote.professionalId }, select: { userId: true } });
      if (pro) sendPushNotification(pro.userId, 'Mission terminée !', `La mission "${project.title}" est officiellement terminée. Bravo !`, { type: 'mission_completed', projectId: project.id });
      sendPushNotification(project.clientId, 'Mission terminée !', `La mission "${project.title}" est terminée. Vous pouvez laisser un avis.`, { type: 'mission_completed', projectId: project.id });
      // Recalcul badges (fire-and-forget) — peut débloquer FIRST_MISSION, TEN_MISSIONS, FIFTY_MISSIONS
      const { computeBadges } = require('../utils/badges');
      computeBadges(acceptedQuote.professionalId).catch(() => {});
    } else if (!bothConfirmed && acceptedQuote) {
      const pro = await prisma.professional.findUnique({ where: { id: acceptedQuote.professionalId }, select: { userId: true } });
      if (pro) sendPushNotification(pro.userId, 'Confirmation de fin demandée', `Le client a confirmé la fin de "${project.title}". Confirmez à votre tour.`, { type: 'confirm_completion', projectId: project.id });
    }

    res.json({ completed: bothConfirmed, waitingForOtherParty: !bothConfirmed });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id/confirm-completion
router.patch('/:id/confirm-completion', requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { quotes: { where: { status: 'ACCEPTED', professionalId: pro.id } } },
    });
    if (!project || project.quotes.length === 0) return res.status(403).json({ error: 'Accès refusé' });
    if (project.status !== 'IN_PROGRESS') return res.status(400).json({ error: 'Ce projet doit être en cours' });

    const bothConfirmed = project.clientConfirmedCompletion;
    await prisma.project.update({
      where: { id: req.params.id },
      data: { proConfirmedCompletion: true, status: bothConfirmed ? 'COMPLETED' : 'IN_PROGRESS' },
    });

    if (bothConfirmed) {
      await prisma.professional.update({ where: { id: pro.id }, data: { completedMissionsCount: { increment: 1 } } });
      sendPushNotification(project.clientId, 'Mission terminée !', `La mission "${project.title}" est officiellement terminée. Vous pouvez laisser un avis.`, { type: 'mission_completed', projectId: project.id });
      sendPushNotification(pro.userId, 'Mission terminée !', `La mission "${project.title}" est terminée. Bravo !`, { type: 'mission_completed', projectId: project.id });
      // Recalcul badges (fire-and-forget) — peut débloquer FIRST_MISSION, TEN_MISSIONS, FIFTY_MISSIONS
      const { computeBadges } = require('../utils/badges');
      computeBadges(pro.id).catch(() => {});
    } else {
      sendPushNotification(project.clientId, 'Confirmation de fin demandée', `Le professionnel a confirmé la fin de "${project.title}". Confirmez à votre tour.`, { type: 'confirm_completion', projectId: project.id });
    }

    res.json({ completed: bothConfirmed, waitingForOtherParty: !bothConfirmed });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id/cancel
router.patch('/:id/cancel', requireAuth, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { quotes: { where: { status: 'ACCEPTED' } } },
    });
    if (!project || project.clientId !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

    const wasInProgress = project.status === 'IN_PROGRESS';
    await prisma.project.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });

    const acceptedQuote = project.quotes[0];
    if (wasInProgress && acceptedQuote) {
      await prisma.professional.update({
        where: { id: acceptedQuote.professionalId },
        data: { cancelledMissionsCount: { increment: 1 } },
      });
    }
    res.json({ cancelled: true });
  } catch (err) {
    next(err);
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
router.post('/:id/photos', requireAuth, requireRole('CLIENT'), upload.array('photos', 5), verifyMagicBytes, async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project || project.clientId !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucune photo fournie' });
    }

    const imageUrls = await uploadProjectPhotos(req.files);
    const photos = await createPhotoRecords(project.id, imageUrls);

    res.status(201).json(photos);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
