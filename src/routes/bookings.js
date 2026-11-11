const express = require('express');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/bookings - List all bookings
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status, professionalId, dateFrom, dateTo, search } = req.query;
    const skip = (page - 1) * limit;

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

    const bookings = await prisma.booking.findMany({
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
      take: parseInt(limit),
      orderBy: { date: 'desc' },
    });

    const total = await prisma.booking.count({ where });

    res.json({
      bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/:id - Get booking detail
router.get('/:id', requireAuth, async (req, res, next) => {
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
router.patch('/:id/cancel', requireAuth, async (req, res, next) => {
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
