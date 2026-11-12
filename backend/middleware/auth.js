const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

// Middleware pour authentifier via le cookie adminToken (utilisé par le backoffice)
async function requireAdminAuth(req, res, next) {
  const token = req.cookies?.adminToken;
  if (!token) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        id: true, role: true, email: true, suspended: true, deletedAt: true, adminLevel: true,
        adminPermissions: true, adminRoleTypeId: true,
        adminRoleType: { select: { slug: true } }
      }
    });
    if (!user || user.deletedAt) return res.status(401).json({ error: 'Utilisateur introuvable' });
    if (user.suspended) return res.status(403).json({ error: 'Votre compte a été suspendu' });
    req.user = {
      id: user.id, role: user.role, email: user.email, adminLevel: user.adminLevel,
      adminPermissions: user.adminPermissions || null,
      adminRoleTypeId: user.adminRoleTypeId || null,
      adminRoleSlug: user.adminRoleType?.slug || null
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        id: true, role: true, email: true, suspended: true, deletedAt: true, adminLevel: true,
        adminPermissions: true, adminRoleTypeId: true,
        adminRoleType: { select: { slug: true } }
      }
    });
    if (!user || user.deletedAt) return res.status(401).json({ error: 'Utilisateur introuvable' });
    if (user.suspended) return res.status(403).json({ error: 'Votre compte a été suspendu' });
    req.user = {
      id: user.id, role: user.role, email: user.email, adminLevel: user.adminLevel,
      adminPermissions: user.adminPermissions || null,
      adminRoleTypeId: user.adminRoleTypeId || null,
      adminRoleSlug: user.adminRoleType?.slug || null
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// Vérifie qu'un admin standard a bien la permission sur une section donnée.
// Les super admins ont toujours accès à tout.
function requirePermission(section) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (req.user.adminLevel === 'SUPER') return next(); // super admin = accès total
    if (!req.user.adminPermissions) return res.status(403).json({ error: 'Aucune permission définie — contactez le super admin' });
    try {
      const perms = JSON.parse(req.user.adminPermissions);
      if (!Array.isArray(perms)) return res.status(403).json({ error: 'Format de permissions invalide' });
      if (perms.includes(section)) return next();
      return res.status(403).json({ error: 'Accès non autorisé à la section : ' + section });
    } catch {
      return res.status(403).json({ error: 'Permissions invalides — contactez le super admin' });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé pour ce rôle' });
    }
    next();
  };
}

async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, role: true, email: true, suspended: true, adminLevel: true }
    });
    if (user && !user.suspended) {
      req.user = { id: user.id, role: user.role, email: user.email, adminLevel: user.adminLevel };
    }
  } catch (err) {
    const logger = require('../utils/logger');
    logger.debug('Optional auth token validation failed', { error: err.message });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    // Authenticate first if not already done, then re-check adminLevel
    return requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
      if (req.user.adminLevel !== 'SUPER') {
        return res.status(403).json({ error: 'Accès réservé au super administrateur' });
      }
      next();
    });
  }
  if (req.user.adminLevel !== 'SUPER') {
    return res.status(403).json({ error: 'Accès réservé au super administrateur' });
  }
  next();
}

// Middleware pour vérifier qu'un role-based n'accède que à ses sections autorisées
function requireRoleAccess(...allowedRoleSlugs) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });

    // Super admin = accès total
    if (req.user.adminLevel === 'SUPER') return next();

    // Admin standard = accès par permission (pas de restriction de rôle)
    if (!req.user.adminRoleSlug) return next();

    // Role-based = vérifier que le rôle est autorisé pour cette section
    if (allowedRoleSlugs.includes(req.user.adminRoleSlug)) return next();

    return res.status(403).json({ error: `Accès refusé pour le rôle: ${req.user.adminRoleSlug}` });
  };
}

async function requireEmailVerified(req, res, next) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { emailVerified: true } });
  if (user?.emailVerified === false) {
    return res.status(403).json({ error: 'Veuillez vérifier votre adresse email avant de continuer.', code: 'EMAIL_NOT_VERIFIED' });
  }
  next();
}

module.exports = { requireAuth, requireAdminAuth, requireRole, optionalAuth, requireSuperAdmin, requirePermission, requireEmailVerified, requireRoleAccess };
