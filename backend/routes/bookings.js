const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, query, body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');

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

// GET /api/bookings - List all bookings
router.get('/', readLimiter, requireAuth,
  [
    ...validatePageBasedPaginationQuery(),
    query('status').optional().isIn(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).withMessage('invalid status'),
    query('professionalId').optional().trim().notEmpty(),
    query('dateFrom').optional().isISO8601().withMessage('invalid dateFrom format'),
    query('dateTo').optional().isISO8601().withMessage('invalid dateTo format'),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('search too long'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { status, professionalId, dateFrom, dateTo, search } = req.query;
    const { limit, skip, offset } = applyPageBasedPagination(req.query, 'bookings');

    let where = {};

    if (status) where.status = status;
    if (professionalId) where.professionalId = professionalId;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
        { professional: { user: { firstName: { contains: search, mode: 'insensitive' } } } },
        { professional: { user: { lastName: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          client: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          professional: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          project: true,
        },
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      prisma.booking.count({ where }),
    ]);

    res.json(buildPaginatedResponse(bookings, limit, offset, total));
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/:id - Get booking detail
router.get('/:id', requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        professional: {
          include: {
            user: true,
          },
        },
        project: true,
        auditLog: true,
      },
    });

    if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });

    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/bookings/:id/cancel - Cancel booking
router.patch('/:id/cancel', requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
    body('reason').optional().trim().isLength({ max: 500 }).withMessage('reason too long'),
    body('notifyByEmail').optional().isBoolean().withMessage('notifyByEmail must be boolean'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { reason, notifyByEmail } = req.body;

    const booking = await prisma.booking.update({
      where: { id: req.params.id },
      data: {
        status: 'CANCELLED',
        cancellationReason: reason || null,
        cancelledAt: new Date(),
      },
      include: {
        client: true,
        professional: { include: { user: true } },
      },
    });

    if (notifyByEmail) {
      // TODO: Send email notification to client and professional
    }

    res.json({ success: true, booking });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
