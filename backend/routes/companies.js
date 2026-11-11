const express = require('express');
const prisma = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/companies - List all companies
router.get('/', requireAuth, requirePermission('companies'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const skip = (page - 1) * limit;

    let where = {};
    if (search) {
      where = {
        OR: [
          { companyName: { contains: search, mode: 'insensitive' } },
          { contact: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const companies = await prisma.professional.findMany({
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
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.professional.count({
      where: {
        ...where,
        accountType: 'ENTREPRISE',
        companyName: { not: null },
      },
    });

    res.json({
      companies,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/companies/:id - Get company detail
router.get('/:id', requireAuth, async (req, res, next) => {
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
