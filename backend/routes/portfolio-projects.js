const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const upload = require('../config/upload');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { verifyMagicBytes } = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');

const router = express.Router();

// Rate limiters
// 10 réalisations max par heure, 30 commentaires max par heure
const createPortfolioLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de réalisations créées, réessayez dans une heure' },
});

const createCommentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de commentaires postés, réessayez dans une heure' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const likeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // 50 likes per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de likes, réessayez dans une minute' },
});

// GET /api/portfolio-projects — feed public
router.get('/', readLimiter,
  [
    ...validatePageBasedPaginationQuery(),
    query('trade').optional().trim().isLength({ max: 100 }).withMessage('trade too long'),
    query('professionalId').optional().trim().notEmpty(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { limit, skip, offset } = applyPageBasedPagination(req.query, 'portfolio-projects');
    const { trade, professionalId } = req.query;

    // userId optionnel pour savoir si l'utilisateur a liké
    const authHeader = req.headers.authorization;
    let userId = null;
    if (authHeader) {
      try {
        const jwt = require('jsonwebtoken');
        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
      } catch {}
    }

    const where = {};
    if (trade) where.tradeCategory = { contains: trade, mode: 'insensitive' };
    if (professionalId) where.professionalId = professionalId;

    const [projects, total] = await Promise.all([
      prisma.portfolioProject.findMany({
        where,
        include: {
          professional: {
            include: { user: { select: { firstName: true, lastName: true, avatarUrl: true, city: true } } },
          },
          images: { orderBy: { sortOrder: 'asc' } },
          comments: {
            orderBy: { createdAt: 'desc' },
            include: { author: { select: { firstName: true, lastName: true, avatarUrl: true } } },
          },
          _count: { select: { comments: true, likes: true } },
          likes: userId ? { where: { userId }, select: { id: true } } : false,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.portfolioProject.count({ where }),
    ]);

    const result = projects.map(p => {
      const ratings = p.comments.filter(c => c.rating).map(c => c.rating);
      const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : 0;
      return {
        ...p,
        averageRating: avgRating,
        likeCount: p._count.likes,
        commentCount: p._count.comments,
        likedByMe: userId ? (p.likes?.length > 0) : false,
        likes: undefined,
        _count: undefined,
      };
    });

    res.json(buildPaginatedResponse(result, limit, offset, total));
  } catch (err) {
    next(err);
  }
});

// GET /api/portfolio-projects/:id — détail avec tous les commentaires + réponses imbriquées
router.get('/:id', readLimiter,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const project = await prisma.portfolioProject.findUnique({
      where: { id: req.params.id },
      include: {
        professional: { include: { user: { select: { firstName: true, lastName: true, avatarUrl: true, email: true, city: true } } } },
        images: { orderBy: { sortOrder: 'asc' } },
        comments: {
          where: { parentId: null },
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
            replies: {
              orderBy: { createdAt: 'asc' },
              include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
            },
          },
        },
      },
    });

    if (!project) return res.status(404).json({ error: 'Réalisation non trouvée' });

    const allComments = project.comments;
    const avgRating = allComments.length > 0
      ? (allComments.reduce((sum, c) => sum + (c.rating || 0), 0) / allComments.length)
      : 0;

    res.json({ ...project, averageRating: Math.round(avgRating * 10) / 10 });
  } catch (err) {
    next(err);
  }
});

// POST /api/portfolio-projects — créer une réalisation (pro uniquement)
router.post('/', requireAuth, requireRole('PROFESSIONAL'), createPortfolioLimiter, upload.array('images', 10), verifyMagicBytes,
  [
    body('title').trim().notEmpty().isLength({ min: 1, max: 200 }).withMessage('title required, max 200 chars'),
    body('description').trim().notEmpty().isLength({ min: 1, max: 5000 }).withMessage('description required, max 5000 chars'),
    body('tradeCategory').optional().trim().isLength({ max: 100 }).withMessage('tradeCategory too long'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { title, description, tradeCategory } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'Titre et description requis' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Au moins une image requise' });

    const pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    if (!pro) return res.status(403).json({ error: 'Profil pro non trouvé' });

    const imageUrls = await Promise.all(
      req.files.map((f) => uploadBuffer(f.buffer, 'manawa/portfolio-projects'))
    );

    const project = await prisma.portfolioProject.create({
      data: {
        professionalId: pro.id,
        title,
        description,
        tradeCategory: tradeCategory || pro.trade,
        images: {
          create: imageUrls.map((imageUrl, idx) => ({ imageUrl, sortOrder: idx })),
        },
      },
      include: { images: true, comments: true, professional: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/portfolio-projects/:id — modifier une réalisation (propriétaire)
router.patch('/:id', readLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
    body('title').optional().trim().isLength({ min: 1, max: 200 }).withMessage('title max 200 chars'),
    body('description').optional().trim().isLength({ min: 1, max: 5000 }).withMessage('description max 5000 chars'),
    body('tradeCategory').optional().trim().isLength({ max: 100 }).withMessage('tradeCategory too long'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { title, description, tradeCategory } = req.body;
    const project = await prisma.portfolioProject.findUnique({
      where: { id: req.params.id },
      include: { professional: true },
    });

    if (!project) return res.status(404).json({ error: 'Réalisation non trouvée' });
    if (project.professional.userId !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

    const updated = await prisma.portfolioProject.update({
      where: { id: req.params.id },
      data: { title, description, tradeCategory, updatedAt: new Date() },
      include: { images: true, comments: true, professional: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/portfolio-projects/:id — supprimer une réalisation (propriétaire)
router.delete('/:id', readLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const project = await prisma.portfolioProject.findUnique({
      where: { id: req.params.id },
      include: { professional: true },
    });

    if (!project) return res.status(404).json({ error: 'Réalisation non trouvée' });
    if (project.professional.userId !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

    await prisma.portfolioProject.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/portfolio-projects/:id/like — liker / unliker
router.post('/:id/like', likeLimiter, requireAuth,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const existing = await prisma.portfolioProjectLike.findUnique({
      where: { userId_portfolioProjectId: { userId: req.user.id, portfolioProjectId: req.params.id } },
    });
    if (existing) {
      await prisma.portfolioProjectLike.delete({ where: { id: existing.id } });
      return res.json({ liked: false });
    }
    await prisma.portfolioProjectLike.create({
      data: { userId: req.user.id, portfolioProjectId: req.params.id },
    });
    res.json({ liked: true });
  } catch (err) { next(err); }
});

// POST /api/portfolio-projects/:id/comments — ajouter un commentaire ou une réponse
router.post('/:id/comments', requireAuth, createCommentLimiter,
  [
    param('id').trim().notEmpty().withMessage('id requis'),
    body('content').trim().notEmpty().isLength({ min: 1, max: 2000 }).withMessage('content required, max 2000 chars'),
    body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('rating must be 1-5'),
    body('parentId').optional().trim().notEmpty(),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { content, rating, parentId } = req.body;
    if (!content || content.trim().length === 0) return res.status(400).json({ error: 'Commentaire requis' });
    if (rating && (rating < 1 || rating > 5)) return res.status(400).json({ error: 'Note entre 1 et 5' });

    const project = await prisma.portfolioProject.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Réalisation non trouvée' });

    if (parentId) {
      const parent = await prisma.portfolioComment.findUnique({ where: { id: parentId } });
      if (!parent || parent.portfolioProjectId !== req.params.id) {
        return res.status(400).json({ error: 'Commentaire parent invalide' });
      }
    }

    const comment = await prisma.portfolioComment.create({
      data: {
        portfolioProjectId: req.params.id,
        authorId: req.user.id,
        content,
        rating: rating ? parseInt(rating) : null,
        parentId: parentId || null,
      },
      include: { author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });

    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/portfolio-projects/:projectId/comments/:commentId — supprimer un commentaire
router.delete('/:projectId/comments/:commentId', readLimiter, requireAuth,
  [
    param('projectId').trim().notEmpty().withMessage('projectId requis'),
    param('commentId').trim().notEmpty().withMessage('commentId requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const comment = await prisma.portfolioComment.findUnique({ where: { id: req.params.commentId } });
    if (!comment) return res.status(404).json({ error: 'Commentaire non trouvé' });

    if (comment.portfolioProjectId !== req.params.projectId) {
      return res.status(404).json({ error: 'Commentaire non trouvé' });
    }

    if (comment.authorId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    await prisma.portfolioComment.delete({ where: { id: req.params.commentId } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
