const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const upload = require('../config/upload');
const { verifyMagicBytes } = require('../config/upload');
const { uploadBuffer } = require('../config/cloudinary');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');
const UserModule = require('../modules/user');
const AuditLogModule = require('../modules/AuditLogModule');

const router = express.Router();
const userModule = new UserModule(prisma);

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

router.patch('/me',
  requireAuth,
  [
    body('firstName').optional().trim().notEmpty().withMessage('Prénom requis').isLength({ max: 50 }).withMessage('Prénom max 50 caractères').matches(/^[^<>&"'/\\]+$/).withMessage('Prénom invalide'),
    body('lastName').optional().trim().notEmpty().withMessage('Nom requis').isLength({ max: 50 }).withMessage('Nom max 50 caractères').matches(/^[^<>&"'/\\]+$/).withMessage('Nom invalide'),
    body('phone').optional({ nullable: true }).trim().matches(/^\+?[0-9\s\-().]{6,20}$/).withMessage('Téléphone invalide'),
    body('city').optional({ nullable: true }).trim().isLength({ max: 100 }).withMessage('Ville max 100 caractères').escape(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const result = await userModule.updateProfile(req.user.id, req.body, req.user.role);

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent');

      // Audit log — profile update
      await AuditLogModule.createAuditLog({
        action: 'PROFILE_UPDATE',
        resourceType: 'USER',
        resourceId: req.user.id,
        userId: req.user.id,
        ipAddress,
        userAgent,
        metadata: { changedFields: Object.keys(req.body) },
      }).catch((err) => logger.error('Audit log failed for PROFILE_UPDATE', { error: err.message }));

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

router.get('/me/recently-viewed', requireAuth, async (req, res, next) => {
  try {
    const result = await userModule.getRecentlyViewed(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// OPTIMIZATION #31: Fix N+1 - Simplify includes and use select for minimal fields
router.get('/me/following', requireAuth, async (req, res, next) => {
  try {
    const result = await userModule.getFollowing(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/me/avatar', requireAuth, upload.single('avatar'), verifyMagicBytes, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo requise' });
    const avatarUrl = await uploadBuffer(req.file.buffer, 'manawa/avatars');
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl }, include: { professional: true } });

    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    // Audit log — avatar upload
    await AuditLogModule.createAuditLog({
      action: 'AVATAR_UPLOAD',
      resourceType: 'USER',
      resourceId: req.user.id,
      userId: req.user.id,
      ipAddress,
      userAgent,
      metadata: { fileName: req.file.originalname, size: req.file.size },
    }).catch((err) => logger.error('Audit log failed for AVATAR_UPLOAD', { error: err.message }));

    const { passwordHash: _, ...userSafe } = user;
    res.json(userSafe);
  } catch (err) {
    next(err);
  }
});

router.delete('/me',
  requireAuth,
  [body('password').notEmpty().withMessage('Mot de passe requis')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const result = await userModule.deleteAccount(req.user.id, req.body.password);

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent');

      // Audit log — account deleted
      await AuditLogModule.createAuditLog({
        action: 'ACCOUNT_DELETE',
        resourceType: 'USER',
        resourceId: req.user.id,
        userId: req.user.id,
        ipAddress,
        userAgent,
        metadata: { reason: 'user_requested' },
      }).catch((err) => logger.error('Audit log failed for ACCOUNT_DELETE', { error: err.message }));

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

router.patch('/me/password',
  requireAuth,
  [
    body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
    body('newPassword').isLength({ min: 8 }).withMessage('au moins 8 caractères'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const result = await userModule.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent');

      // Audit log — password changed
      await AuditLogModule.createAuditLog({
        action: 'PASSWORD_CHANGE',
        resourceType: 'USER',
        resourceId: req.user.id,
        userId: req.user.id,
        ipAddress,
        userAgent,
        metadata: { reason: 'user_change' },
      }).catch((err) => logger.error('Audit log failed for PASSWORD_CHANGE', { error: err.message }));

      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

module.exports = router;
