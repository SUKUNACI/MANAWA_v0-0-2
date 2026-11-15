const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { param, body, validationResult } = require('express-validator');
const RolePermissionModule = require('../modules/rolePermission');
const prisma = require('../config/db');

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const router = express.Router();
const rolePermission = new RolePermissionModule(prisma);

router.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requis' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  if (!req.user || (req.user.adminLevel !== 'SUPER' && req.user.adminRoleType?.slug !== 'security-admin')) {
    return res.status(403).json({ error: 'Accès refusé — seul SUPER_ADMIN ou SECURITY_ADMIN peut modifier les permissions' });
  }

  next();
});

router.get('/all-sections', async (req, res, next) => {
  try {
    const result = await rolePermission.getAllSections();
    res.json({ sections: result });
  } catch (err) {
    next(err);
  }
});

router.get('/:roleId', [param('roleId').trim().notEmpty().withMessage('roleId requis')], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  try {
    const result = await rolePermission.getRolePermissions(req.params.roleId);
    res.json(result);
  } catch (err) {
    if (err.status) res.status(err.status).json({ error: err.message });
    else next(err);
  }
});

router.post('/grant', adminLimiter, [body('roleId').notEmpty().withMessage('roleId requis'), body('section').notEmpty().withMessage('section requise'), body('actions').isArray().withMessage('actions doit être un tableau')], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  try {
    const result = await rolePermission.grantPermission(req.body.roleId, req.body.section, req.body.actions, req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status) res.status(err.status).json({ error: err.message });
    else next(err);
  }
});

router.post('/revoke', adminLimiter, [body('roleId').notEmpty().withMessage('roleId requis'), body('section').notEmpty().withMessage('section requise'), body('actions').isArray().notEmpty().withMessage('actions doit être un tableau non vide')], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  try {
    const result = await rolePermission.revokePermission(req.body.roleId, req.body.section, req.body.actions, req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status) res.status(err.status).json({ error: err.message });
    else next(err);
  }
});

router.get('/history/:roleId', [param('roleId').notEmpty().withMessage('roleId requis')], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit) : 50;
    const result = await rolePermission.getPermissionHistory(req.params.roleId, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/rollback/:roleId/:historyId', adminLimiter, [param('roleId').notEmpty().withMessage('roleId requis'), param('historyId').notEmpty().withMessage('historyId requis'), body('reason').optional()], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  try {
    const result = await rolePermission.rollbackPermissions(req.params.roleId, req.params.historyId, req.body.reason || '', req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status) res.status(err.status).json({ error: err.message });
    else next(err);
  }
});

module.exports = router;
