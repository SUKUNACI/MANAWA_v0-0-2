const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendPushNotification } = require('../config/pushNotifications');
const { handleValidationErrors } = require('../middleware/validateInput');

const router = express.Router();

// Rate limiters
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

// Helper: Get payment with nested project and professional data
async function getPaymentWithDetails(paymentId) {
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      quote: {
        include: {
          project: { select: { clientId: true, title: true } },
          professional: {
            include: { user: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      },
    },
  });
}

// Helper: Validate dispute creation prerequisites
function validateDisputeCreation(payment, userId) {
  if (!payment) {
    return { valid: false, status: 404, error: 'Paiement introuvable' };
  }
  if (payment.quote.project.clientId !== userId) {
    return { valid: false, status: 403, error: 'Ce paiement ne vous appartient pas' };
  }
  if (payment.status !== 'succeeded') {
    return { valid: false, status: 400, error: 'Un litige ne peut être ouvert que sur un paiement confirmé' };
  }
  return { valid: true };
}

// Helper: Check if dispute already exists
async function checkExistingDispute(paymentId) {
  return prisma.dispute.findFirst({
    where: { paymentId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
  });
}

// Helper: Notify professional about opened dispute
async function notifyProfessionalDispute(dispute, payment) {
  const pro = payment.quote.professional;
  const proTokens = await prisma.pushToken.findMany({ where: { userId: pro.user.id } });
  if (proTokens.length > 0) {
    await sendPushNotification(
      proTokens.map(t => t.token),
      'Litige ouvert',
      `Un litige a été ouvert sur le projet "${payment.quote.project.title}"`,
      { type: 'DISPUTE_OPENED', disputeId: dispute.id }
    );
  }
}

// POST /api/disputes — ouvrir un litige sur un paiement
router.post('/', writeLimiter, requireAuth, requireRole('CLIENT'),
  [
    body('paymentId').trim().notEmpty().withMessage('paymentId requis'),
    body('reason').trim().notEmpty().isLength({ max: 100 }).withMessage('reason required and max 100 chars'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('description max 1000 chars'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { paymentId, reason, description } = req.body;

    if (!paymentId || !reason) {
      return res.status(400).json({ error: 'paymentId et reason sont requis' });
    }

    const payment = await getPaymentWithDetails(paymentId);
    const validation = validateDisputeCreation(payment, req.user.id);
    if (!validation.valid) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const existing = await checkExistingDispute(paymentId);
    if (existing) {
      return res.status(409).json({ error: 'Un litige est déjà ouvert sur ce paiement' });
    }

    const dispute = await prisma.dispute.create({
      data: {
        paymentId,
        clientId: req.user.id,
        reason,
        description: description || null,
        status: 'OPEN',
      },
    });

    await notifyProfessionalDispute(dispute, payment);
    res.status(201).json(dispute);
  } catch (err) {
    next(err);
  }
});

// Helper: Build dispute include for nested relations
function getDisputeInclude() {
  return {
    payment: {
      include: {
        quote: {
          include: {
            project: { select: { title: true } },
            professional: {
              include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } },
            },
          },
        },
      },
    },
  };
}

// GET /api/disputes/mine — litiges du client connecté
router.get('/mine', readLimiter, requireAuth, requireRole('CLIENT'), handleValidationErrors, async (req, res, next) => {
  try {
    const disputes = await prisma.dispute.findMany({
      where: { clientId: req.user.id },
      include: getDisputeInclude(),
      orderBy: { createdAt: 'desc' },
    });

    res.json(disputes);
  } catch (err) {
    next(err);
  }
});

// Helper: Build where clause for dispute access based on role
function buildDisputeWhereClause(userId, role, disputeId) {
  let whereClause = { id: disputeId };

  if (role === 'CLIENT') {
    whereClause.clientId = userId;
  } else if (role === 'PROFESSIONAL') {
    whereClause.payment = { quote: { professional: { userId } } };
  } else if (role !== 'ADMIN') {
    return null; // Indicates access denied
  }

  return whereClause;
}

// Helper: Build dispute detail include
function getDisputeDetailInclude() {
  return {
    payment: {
      include: {
        quote: {
          include: {
            project: { select: { title: true, clientId: true } },
            professional: {
              include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
            },
          },
        },
      },
    },
    client: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  };
}

// GET /api/disputes/:id — détail d'un litige
router.get('/:id', readLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const whereClause = buildDisputeWhereClause(req.user.id, req.user.role, req.params.id);
    if (whereClause === null) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const dispute = await prisma.dispute.findFirst({
      where: whereClause,
      include: getDisputeDetailInclude(),
    });

    if (!dispute) {
      return res.status(404).json({ error: 'Litige introuvable' });
    }

    res.json(dispute);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
