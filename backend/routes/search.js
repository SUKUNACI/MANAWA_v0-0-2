const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { validateFilters, applyFilters } = require('../utils/filter-helper');

const router = express.Router();

// Rate limiters
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes de recherche, réessayez dans une minute' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 5;

function clampLimit(raw) {
  const n = parseInt(raw) || DEFAULT_LIMIT;
  return Math.min(Math.max(1, n), MAX_LIMIT);
}

function clampPage(raw) {
  return Math.max(1, parseInt(raw) || 1);
}

// ---------------------------------------------------------------------------
// Recherche pros
// ---------------------------------------------------------------------------

async function searchProfessionals(q, { skip = 0, take = DEFAULT_LIMIT, filters = {} } = {}) {
  let where = {
    user: { deletedAt: null },
    OR: [
      { user: { firstName: { contains: q, mode: 'insensitive' } } },
      { user: { lastName: { contains: q, mode: 'insensitive' } } },
      { trade: { contains: q, mode: 'insensitive' } },
      { trades: { has: q } },
      { description: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { user: { city: { contains: q, mode: 'insensitive' } } },
    ],
  };

  // Q65: Apply filters
  where = applyFilters('professionals', where, filters);

  return prisma.professional.findMany({
    where,
    select: {
      id: true,
      userId: true,
      trade: true,
      trades: true,
      companyName: true,
      averageRating: true,
      reviewCount: true,
      verifiedByAdmin: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          avatarUrl: true,
          city: true,
        },
      },
      subscription: {
        select: { tier: true },
      },
    },
    skip,
    take,
  });
}

async function countProfessionals(q, filters = {}) {
  let where = {
    user: { deletedAt: null },
    OR: [
      { user: { firstName: { contains: q, mode: 'insensitive' } } },
      { user: { lastName: { contains: q, mode: 'insensitive' } } },
      { trade: { contains: q, mode: 'insensitive' } },
      { trades: { has: q } },
      { description: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { user: { city: { contains: q, mode: 'insensitive' } } },
    ],
  };

  // Q65: Apply filters
  where = applyFilters('professionals', where, filters);

  return prisma.professional.count({ where });
}

// ---------------------------------------------------------------------------
// Recherche réalisations (portfolio)
// ---------------------------------------------------------------------------

async function searchPortfolio(q, { skip = 0, take = DEFAULT_LIMIT } = {}) {
  return prisma.portfolioProject.findMany({
    where: {
      professional: { user: { deletedAt: null } },
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tradeCategory: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      tradeCategory: true,
      images: {
        select: { imageUrl: true },
        orderBy: { sortOrder: 'asc' },
        take: 3,
      },
      professional: {
        select: {
          id: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
    skip,
    take,
  });
}

async function countPortfolio(q) {
  return prisma.portfolioProject.count({
    where: {
      professional: { user: { deletedAt: null } },
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tradeCategory: { contains: q, mode: 'insensitive' } },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Recherche forfaits
// ---------------------------------------------------------------------------

async function searchPackages(q, { skip = 0, take = DEFAULT_LIMIT, filters = {} } = {}) {
  let where = {
    active: true,
    professional: { user: { deletedAt: null } },
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
    ],
  };

  // Q65: Apply filters
  where = applyFilters('packages', where, filters);

  return prisma.servicePackage.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      price: true,
      duration: true,
      category: true,
      images: true,
      ordersCount: true,
      professional: {
        select: {
          id: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
    skip,
    take,
  });
}

async function countPackages(q, filters = {}) {
  let where = {
    active: true,
    professional: { user: { deletedAt: null } },
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
    ],
  };

  // Q65: Apply filters
  where = applyFilters('packages', where, filters);

  return prisma.servicePackage.count({ where });
}

// ---------------------------------------------------------------------------
// Historique — helpers AppConfig
// ---------------------------------------------------------------------------

const HISTORY_SIZE = 10;

function historyKey(userId) {
  return `search_history_${userId}`;
}

async function getHistory(userId) {
  const row = await prisma.appConfig.findUnique({ where: { key: historyKey(userId) } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveHistory(userId, q) {
  const key = historyKey(userId);
  const existing = await getHistory(userId);
  // Dédoublonner + mettre le nouveau terme en tête
  const updated = [q, ...existing.filter(t => t !== q)].slice(0, HISTORY_SIZE);
  await prisma.appConfig.upsert({
    where: { key },
    create: { key, value: JSON.stringify(updated), description: `Historique recherches utilisateur ${userId}` },
    update: { value: JSON.stringify(updated) },
  });
  return updated;
}

async function clearHistory(userId) {
  const key = historyKey(userId);
  await prisma.appConfig.deleteMany({ where: { key } });
}

// ---------------------------------------------------------------------------
// Helper: Parse filters from query params
// Support: ?filters[minPrice]=100&filters[maxPrice]=500 or ?minPrice=100&maxPrice=500
// ---------------------------------------------------------------------------
function parseFiltersFromQuery(req) {
  const filters = {};

  // Support format filters[key]=value
  if (req.query.filters && typeof req.query.filters === 'object') {
    Object.assign(filters, req.query.filters);
  }

  // Support format direct: key=value
  const filterKeys = ['minRating', 'maxRating', 'minPrice', 'maxPrice', 'city', 'verifiedOnly'];
  for (const key of filterKeys) {
    if (req.query[key] !== undefined) {
      filters[key] = req.query[key];
    }
  }

  return filters;
}

// ---------------------------------------------------------------------------
// GET /api/search?q=&type=&page=&limit=&filters[]=
// Q65: Support filtering options
// ---------------------------------------------------------------------------
router.get('/', searchLimiter, optionalAuth,
  [
    query('q').trim().notEmpty().isLength({ min: 2, max: 200 }).withMessage('q required, 2-200 chars'),
    query('type').optional().isIn(['all', 'professionals', 'portfolio', 'packages']).withMessage('invalid type'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be >= 1'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { q, type = 'all', page, limit } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Le terme de recherche doit contenir au moins 2 caractères' });
    }

    const term = q.trim();
    const validTypes = ['all', 'professionals', 'portfolio', 'packages'];

    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Type invalide. Valeurs acceptées : ${validTypes.join(', ')}` });
    }

    const take = clampLimit(limit);
    const pageNum = clampPage(page);
    const skip = (pageNum - 1) * take;

    // Q65: Parse and validate filters
    const rawFilters = parseFiltersFromQuery(req);
    const professionalFilters = validateFilters('professionals', rawFilters);
    const packageFilters = validateFilters('packages', rawFilters);

    if (professionalFilters.errors.length > 0 || packageFilters.errors.length > 0) {
      const allErrors = [...professionalFilters.errors, ...packageFilters.errors];
      return res.status(400).json({ error: 'Filtres invalides', details: allErrors });
    }

    if (type === 'all') {
      // Recherche parallèle dans les 3 entités — pas de pagination, juste les N premiers
      const [professionals, portfolio, packages] = await Promise.all([
        searchProfessionals(term, { skip: 0, take, filters: professionalFilters.validated }),
        searchPortfolio(term, { skip: 0, take }),
        searchPackages(term, { skip: 0, take, filters: packageFilters.validated }),
      ]);

      return res.json({
        query: term,
        filters: rawFilters,
        professionals,
        portfolio,
        packages,
        total: professionals.length + portfolio.length + packages.length,
      });
    }

    if (type === 'professionals') {
      const [results, total] = await Promise.all([
        searchProfessionals(term, { skip, take, filters: professionalFilters.validated }),
        countProfessionals(term, professionalFilters.validated),
      ]);
      return res.json({
        query: term,
        filters: rawFilters,
        professionals: results,
        pagination: {
          page: pageNum,
          limit: take,
          total,
          totalPages: Math.ceil(total / take),
        },
      });
    }

    if (type === 'portfolio') {
      const [results, total] = await Promise.all([
        searchPortfolio(term, { skip, take }),
        countPortfolio(term),
      ]);
      return res.json({
        query: term,
        filters: rawFilters,
        portfolio: results,
        pagination: {
          page: pageNum,
          limit: take,
          total,
          totalPages: Math.ceil(total / take),
        },
      });
    }

    if (type === 'packages') {
      const [results, total] = await Promise.all([
        searchPackages(term, { skip, take, filters: packageFilters.validated }),
        countPackages(term, packageFilters.validated),
      ]);
      return res.json({
        query: term,
        filters: rawFilters,
        packages: results,
        pagination: {
          page: pageNum,
          limit: take,
          total,
          totalPages: Math.ceil(total / take),
        },
      });
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/search/history — enregistre une recherche (si user connecté)
// ---------------------------------------------------------------------------
router.post('/history', searchLimiter, optionalAuth, async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise pour sauvegarder l\'historique' });
    }

    const { q } = req.body;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Le terme de recherche doit contenir au moins 2 caractères' });
    }

    const history = await saveHistory(req.user.id, q.trim());
    res.json({ success: true, history });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/search/history — retourne l'historique
// ---------------------------------------------------------------------------
router.get('/history', searchLimiter, requireAuth, async (req, res, next) => {
  try {
    const history = await getHistory(req.user.id);
    res.json({ history });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/search/history — vide l'historique
// ---------------------------------------------------------------------------
router.delete('/history', searchLimiter, requireAuth, async (req, res, next) => {
  try {
    await clearHistory(req.user.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
