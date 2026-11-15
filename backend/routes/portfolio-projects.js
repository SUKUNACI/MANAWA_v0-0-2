const express = require('express');
const rateLimit = require('express-rate-limit');
const { param, body, query } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const upload = require('../config/upload');
const { verifyMagicBytes } = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');
const { handleValidationErrors } = require('../middleware/validateInput');
const { applyPageBasedPagination, validatePageBasedPaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');
const PortfolioModule = require('../modules/portfolio');

const router = express.Router();
const portfolio = new PortfolioModule(prisma, uploadBuffer);

const createPortfolioLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de réalisations créées, réessayez dans une heure' } });
const createCommentLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de commentaires postés, réessayez dans une heure' } });
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' } });
const likeLimiter = rateLimit({ windowMs: 60 * 1000, max: 50, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de likes, réessayez dans une minute' } });

router.get('/', readLimiter,
  [...validatePageBasedPaginationQuery(), query('trade').optional().trim().isLength({ max: 100 }).withMessage('trade too long'), query('professionalId').optional().trim().notEmpty()],
  handleValidationErrors, async (req, res, next) => {
  try {
    const { limit, skip, offset } = applyPageBasedPagination(req.query, 'portfolio-projects');
    const { trade, professionalId } = req.query;
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader) { try { const jwt = require('jsonwebtoken'); const decoded = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET); userId = decoded.id; } catch {} }
    const result = await portfolio.list({ trade, professionalId, skip, limit, userId });
    res.json(buildPaginatedResponse(result.projects, limit, offset, result.total));
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.get('/:id', readLimiter, [param('id').trim().notEmpty().withMessage('id requis')], handleValidationErrors, async (req, res, next) => {
  try { const project = await portfolio.getDetail(req.params.id); res.json(project); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.post('/', requireAuth, requireRole('PROFESSIONAL'), createPortfolioLimiter, upload.array('images', 10), verifyMagicBytes,
  [body('title').trim().notEmpty().isLength({ min: 1, max: 200 }).withMessage('title required, max 200 chars'), body('description').trim().notEmpty().isLength({ min: 1, max: 5000 }).withMessage('description required, max 5000 chars'), body('tradeCategory').optional().trim().isLength({ max: 100 }).withMessage('tradeCategory too long')],
  handleValidationErrors, async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Au moins une image requise' });
    const { title, description, tradeCategory } = req.body;
    const project = await portfolio.create({ userId: req.user.id, title, description, tradeCategory, files: req.files.map(f => f.buffer) });
    res.status(201).json(project);
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});
router.patch('/:id', readLimiter, requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis'), body('title').optional().trim().isLength({ min: 1, max: 200 }).withMessage('title max 200 chars'), body('description').optional().trim().isLength({ min: 1, max: 5000 }).withMessage('description max 5000 chars'), body('tradeCategory').optional().trim().isLength({ max: 100 }).withMessage('tradeCategory too long')],
  handleValidationErrors, async (req, res, next) => {
  try {
    const { title, description, tradeCategory } = req.body;
    const updated = await portfolio.update(req.params.id, req.user.id, { title, description, tradeCategory });
    res.json(updated);
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.delete('/:id', readLimiter, requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors, async (req, res, next) => {
  try { const result = await portfolio.remove(req.params.id, req.user.id); res.json(result); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.post('/:id/like', likeLimiter, requireAuth,
  [param('id').trim().notEmpty().withMessage('id requis')],
  handleValidationErrors, async (req, res, next) => {
  try { const result = await portfolio.toggleLike(req.params.id, req.user.id); res.json(result); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.post('/:id/comments', requireAuth, createCommentLimiter,
  [param('id').trim().notEmpty().withMessage('id requis'), body('content').trim().notEmpty().isLength({ min: 1, max: 2000 }).withMessage('content required, max 2000 chars'), body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('rating must be 1-5'), body('parentId').optional().trim().notEmpty()],
  handleValidationErrors, async (req, res, next) => {
  try {
    const { content, rating, parentId } = req.body;
    const comment = await portfolio.addComment(req.params.id, req.user.id, { content, rating: rating ? parseInt(rating) : null, parentId });
    res.status(201).json(comment);
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

router.delete('/:projectId/comments/:commentId', readLimiter, requireAuth,
  [param('projectId').trim().notEmpty().withMessage('projectId requis'), param('commentId').trim().notEmpty().withMessage('commentId requis')],
  handleValidationErrors, async (req, res, next) => {
  try {
    const result = await portfolio.removeComment(req.params.projectId, req.params.commentId, req.user.id, req.user.role);
    res.json(result);
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
});

module.exports = router;
