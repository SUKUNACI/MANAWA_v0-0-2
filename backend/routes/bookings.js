'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, query, body } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery } = require('../utils/pagination-helper');
const BookingModule = require('../modules/booking');

const router = express.Router();
const bookingModule = new BookingModule(prisma);

const timeFormatRegex = /^\d{2}:\d{2}$/;

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

      const where = {};
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

      const { bookings, total, page, pageCount } = await bookingModule.listBookings({
        where,
        skip,
        take: limit,
      });

      res.json({
        bookings,
        pagination: { page: Math.floor(offset / limit) + 1, limit, total, totalPages: pageCount },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/bookings — Create a booking from an accepted quote
router.post(
  '/',
  writeLimiter,
  requireAuth,
  requireRole("CLIENT"),
  [
    body('quoteId').isUUID().withMessage('quoteId must be a valid UUID'),
    body('date').trim().notEmpty().withMessage('date is required').custom((val) => {
      const d = new Date(val);
      if (isNaN(d.getTime())) throw new Error('date must be a valid date');
      return true;
    }),
    body('startTime').matches(timeFormatRegex).withMessage('startTime must be HH:MM format'),
    body('endTime').matches(timeFormatRegex).withMessage('endTime must be HH:MM format'),
    body('note').optional().trim().isLength({ max: 500 }).withMessage('note must be max 500 characters'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { quoteId, date, startTime, endTime, note } = req.body;

      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: { project: { select: { clientId: true } }, professional: { select: { id: true, verifiedByAdmin: true } } },
      });

      if (!quote) {
        return res.status(404).json({ error: 'Devis introuvable', code: 'QUOTE_NOT_FOUND' });
      }

      if (quote.project.clientId !== req.user.id) {
        return res.status(403).json({ code: 'FORBIDDEN' });
      }

      if (quote.status !== 'ACCEPTED') {
        return res.status(409).json({ error: 'Le devis doit être accepté', code: 'QUOTE_NOT_ACCEPTED' });
      }

      if (!quote.professional.verifiedByAdmin) {
        return res.status(409).json({ error: 'Professionnel non vérifié', code: 'PROFESSIONAL_NOT_VERIFIED' });
      }

      if (startTime >= endTime) {
        return res.status(400).json({ code: 'INVALID_TIME_RANGE' });
      }

      const dateObj = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (dateObj < today) {
        return res.status(400).json({ code: 'DATE_IN_PAST' });
      }

      const existing = await prisma.booking.findUnique({ where: { quoteId } });
      if (existing) {
        return res.status(409).json({ code: 'BOOKING_ALREADY_EXISTS' });
      }

      try {
        const booking = await bookingModule.createFromQuote({
          quoteId,
          clientId: req.user.id,
          professionalId: quote.professional.id,
          projectId: quote.projectId,
          date,
          startTime,
          endTime,
          note,
        });

        return res.status(201).json(booking);
      } catch (err) {
        if (err.code === 'P2002' && err.meta?.target?.includes('quoteId')) {
          return res.status(409).json({ code: 'BOOKING_ALREADY_EXISTS' });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/bookings/:id - Get booking detail
router.get('/:id', requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const booking = await bookingModule.getDetail(req.params.id);
      if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
      res.json(booking);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/bookings/:id/cancel - Cancel booking
router.patch('/:id/cancel', writeLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
    body('reason').optional().trim().isLength({ max: 500 }).withMessage('reason too long'),
    body('notifyByEmail').optional().isBoolean().withMessage('notifyByEmail must be boolean'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const existing = await bookingModule.findForCancel(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Réservation introuvable' });

      // Statuts terminaux — fail-closed
      if (existing.status === 'COMPLETED') {
        return res.status(409).json({ error: "Impossible d'annuler une réservation déjà terminée", code: 'BOOKING_COMPLETED' });
      }
      if (existing.status === 'CANCELLED') {
        return res.status(409).json({ error: 'La réservation est déjà annulée', code: 'BOOKING_ALREADY_CANCELLED' });
      }

      const caller = req.user;

      if (caller.role === 'CLIENT') {
        if (existing.clientId !== caller.id) {
          return res.status(403).json({ error: "Accès refusé — vous n'êtes pas propriétaire de cette réservation", code: 'FORBIDDEN' });
        }
      } else if (caller.role === 'PROFESSIONAL') {
        // professionalId on Booking = Professional.id, not Professional.userId
        const professional = await prisma.professional.findUnique({
          where: { userId: caller.id },
          select: { id: true },
        });
        if (!professional || existing.professionalId !== professional.id) {
          return res.status(403).json({ error: "Accès refusé — cette réservation ne vous est pas associée", code: 'FORBIDDEN' });
        }
      } else if (caller.role === 'ADMIN') {
        // FONDATEUR uniquement (adminLevel: 'FOUNDER') — T1.06 non implémenté, bloqué D4/D5
        // Dès que T1.06 sera livré, remplacer ce bloc par :
        //   if (caller.adminLevel !== 'FOUNDER') → 403
        //   if (!reason?.trim()) → 400 motif obligatoire
        //   await AuditLogModule.createAuditLog({ action: 'BOOKING_CANCEL_FOUNDER', ... })
        return res.status(403).json({ error: 'Accès refusé — seul le FONDATEUR peut annuler une réservation tierce', code: 'FORBIDDEN' });
      } else {
        return res.status(403).json({ error: 'Accès refusé', code: 'FORBIDDEN' });
      }

      const { reason, notifyByEmail } = req.body;
      const booking = await bookingModule.cancel(req.params.id, { reason, notifyByEmail });
      res.json({ success: true, booking });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
