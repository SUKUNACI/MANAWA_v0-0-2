const express = require('express');
const prisma = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/finances - Financial summary and transactions
router.get('/', requireAuth, requirePermission('finances'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, startDate, endDate, status } = req.query;
    const skip = (page - 1) * limit;

    let where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    if (status) where.status = status;

    const payments = await prisma.payment.findMany({
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
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.payment.count({ where });

    // Calculate summary
    const summary = await prisma.payment.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
    });

    res.json({
      transactions: payments,
      summary: {
        totalAmount: summary._sum.amount || 0,
        transactionCount: summary._count,
      },
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

// GET /api/finances/summary - Quick financial overview
router.get('/summary', requireAuth, requirePermission('finances'), async (req, res, next) => {
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
      prisma.payment.count({ where: { status: 'PENDING' } }),
      prisma.payment.count({ where: { status: 'COMPLETED' } }),
    ]);

    res.json({
      totalRevenue: totalRevenue._sum.amount || 0,
      monthlyRevenue: monthlyRevenue._sum.amount || 0,
      pendingPayments,
      completedPayments,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
