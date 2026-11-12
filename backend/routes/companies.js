const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, query, validationResult } = require('express-validator');
const prisma = require('../config/db');
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

// GET /api/companies - List all companies
router.get('/', adminLimiter, requireAuth, requirePermission('companies'),
  [
    ...validatePageBasedPaginationQuery(),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('search too long'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { search } = req.query;
    const { limit, skip, offset } = applyPageBasedPagination(req.query, 'companies');

    let where = {};
    if (search) {
      where = {
        OR: [
          { companyName: { contains: search, mode: 'insensitive' } },
          { contact: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [companies, total] = await Promise.all([
      prisma.professional.findMany({
        where: {
          ...where,
          accountType: 'ENTREPRISE',
          companyName: { not: null },
        },
        select: {
          id: true,
          companyName: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          trades: true,
          trustScore: true,
          createdAt: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.professional.count({
        where: {
          ...where,
          accountType: 'ENTREPRISE',
          companyName: { not: null },
        },
      }),
    ]);

    res.json(buildPaginatedResponse(companies, limit, offset, total));
  } catch (err) {
    next(err);
  }
});

// GET /api/companies/:id - Get company detail
router.get('/:id', requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const company = await prisma.professional.findUnique({
      where: { id: req.params.id },
      include: {
        user: true,
        reviews: { take: 5 },
      },
    });

    if (!company) return res.status(404).json({ error: 'Entreprise introuvable' });

    res.json(company);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
