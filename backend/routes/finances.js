const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');

const router = express.Router();

// Rate limiters
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// GET /api/finances - Financial summary and transactions
router.get('/', adminLimiter, requireAuth, requirePermission('finances'),
  [
    query('startDate').optional().isISO8601().withMessage('invalid startDate format'),
    query('endDate').optional().isISO8601().withMessage('invalid endDate format'),
    query('status').optional().isIn(['PENDING', 'COMPLETED', 'FAILED']).withMessage('invalid status'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { startDate, endDate, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit) : 50;
    const skip = (page - 1) * limit;
    const offset = skip;

    let where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    if (status) where.status = status;

    const [payments, total, summary] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          quote: {
            include: {
              project: true,
              professional: {
                include: {
                  user: {
                    select: {
                      email: true,
                      firstName: true,
                      lastName: true,
                    },
                  },
                },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    res.json({
      transactions: payments,
      pagination: {
        page: Math.floor(offset / limit) + 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalAmount: summary._sum.amount || 0,
        transactionCount: summary._count,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/finances/summary - Quick financial overview
router.get('/summary', requireAuth, requirePermission('finances'), handleValidationErrors, async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalRevenue, monthlyRevenue, pendingPayments, completedPayments] = await Promise.all([
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'COMPLETED' },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'COMPLETED',
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
      prisma.payment.aggregate({ _count: true, where: { status: 'PENDING' } }),
      prisma.payment.aggregate({ _count: true, where: { status: 'COMPLETED' } }),
    ]);

    res.json({
      totalRevenue: totalRevenue._sum.amount || 0,
      monthlyRevenue: monthlyRevenue._sum.amount || 0,
      pendingPayments: pendingPayments._count,
      completedPayments: completedPayments._count,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
