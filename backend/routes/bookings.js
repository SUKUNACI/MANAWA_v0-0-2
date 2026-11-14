'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, query, body } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery } = require('../utils/pagination-helper');
const BookingModule = require('../modules/booking');

const router = express.Router();
const bookingModule = new BookingModule(prisma);

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
      const { reason, notifyByEmail } = req.body;
      const booking = await bookingModule.cancel(req.params.id, { reason, notifyByEmail });
      res.json({ success: true, booking });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
