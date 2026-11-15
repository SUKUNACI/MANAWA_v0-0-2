const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const ReviewModule = require('../modules/review');
const prisma = require('../config/db');

const router = express.Router();
const review = new ReviewModule(prisma);

const createReviewLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyGenerator: (req) => req.user?.id || req.ip, standardHeaders: true, legacyHeaders: false, message: { error: "Trop d'avis postés, réessayez dans une heure" } });

// POST /api/reviews
router.post('/', requireAuth, requireRole('CLIENT'), createReviewLimiter,
  [
    body('professionalId').trim().notEmpty().withMessage('professionalId requis'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('rating must be 1-5'),
    body('projectId').trim().notEmpty().withMessage('projectId requis'),
    body('comment').optional().trim().isLength({ max: 1000 }).withMessage('comment max 1000 chars'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { professionalId, rating, comment, projectId } = req.body;
    const result = await review.create({ authorId: req.user.id, professionalId, projectId, rating, comment });
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/reviews/professional/:id
router.get('/professional/:id', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const result = await review.listForProfessional(req.params.id, { page, limit });
    res.json(result.reviews);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
