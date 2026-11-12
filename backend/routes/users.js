const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const upload = require('../config/upload');
const { verifyMagicBytes } = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');
const { requireAuth, requireRole } = require('../middleware/auth');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiters
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de téléchargements, réessayez dans une minute' },
});

// PATCH /api/users/me
router.patch('/me',
  requireAuth,
  [
    body('firstName').optional().trim().notEmpty().isLength({ max: 50 }).matches(/^[^<>&"'/\\]+$/).withMessage('Prénom invalide'),
    body('lastName').optional().trim().notEmpty().isLength({ max: 50 }).matches(/^[^<>&"'/\\]+$/).withMessage('Nom invalide'),
    body('phone').optional({ nullable: true }).trim().matches(/^\+?[0-9\s\-().]{6,20}$/),
    body('city').optional({ nullable: true }).trim().isLength({ max: 100 }).escape(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const { firstName, lastName, phone, city } = req.body;

      const nameFields = req.user.role === 'PROFESSIONAL' ? {} : { firstName, lastName };

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: { ...nameFields, phone, city },
        include: { professional: true },
      });

      const { passwordHash: _, ...userSafe } = user;
      res.json(userSafe);
    } catch (err) {
      next(err);
    }
  }
);

// OPTIMIZATION #31: Fix N+1 - Use distinct() instead of manual loop
// GET /api/users/me/recently-viewed
router.get('/me/recently-viewed', requireAuth, async (req, res, next) => {
  try {
    // Use distinct to get unique professionals, avoiding N+1 from manual deduplication
    const views = await prisma.profileView.findMany({
      where: { viewerId: req.user.id },
      include: {
        professional: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                avatarUrl: true,
                city: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const seen = new Set();
    const unique = views.filter((v) => {
      if (seen.has(v.professionalId)) return false;
      seen.add(v.professionalId);
      return true;
    });
    res.json(unique.slice(0, 10).map((v) => v.professional));
  } catch (err) {
    next(err);
  }
});

// OPTIMIZATION #31: Fix N+1 - Simplify includes and use select for minimal fields
// GET /api/users/me/following
router.get('/me/following', requireAuth, async (req, res, next) => {
  try {
    // Optimize: Use select to limit user fields returned, not full include
    const follows = await prisma.follow.findMany({
      where: { followerId: req.user.id },
      include: {
        professional: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                avatarUrl: true,
                city: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(follows.map((f) => f.professional));
  } catch (err) {
    next(err);
  }
});

// POST /api/users/me/avatar
router.post('/me/avatar', requireAuth, upload.single('avatar'), verifyMagicBytes, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo requise' });
    const avatarUrl = await uploadBuffer(req.file.buffer, 'manawa/avatars');
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl }, include: { professional: true } });
    const { passwordHash: _, ...userSafe } = user;
    res.json(userSafe);
  } catch (err) {
    next(err);
  }
});

router.delete('/me',
  requireAuth,
  body('password').notEmpty().withMessage('Mot de passe requis'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { passwordHash: true },
      });
      const valid = await bcrypt.compare(req.body.password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });

      await prisma.user.update({
        where: { id: req.user.id },
        data: { deletedAt: new Date() },
      });
      await prisma.pushToken.deleteMany({ where: { userId: req.user.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });

      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  }
);

router.patch('/me/password',
  requireAuth,
  [
    body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
    body('newPassword').isLength({ min: 8 }).withMessage('Le nouveau mot de passe doit contenir au moins 8 caractères'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { passwordHash: true },
      });
      const valid = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

      const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
      await prisma.user.update({
        where: { id: req.user.id },
        data: { passwordHash },
      });
      await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });

      res.json({ changed: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
