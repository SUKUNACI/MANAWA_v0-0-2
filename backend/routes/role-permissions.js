const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { param, body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { handleValidationErrors } = require('../middleware/validateInput');

const router = express.Router();

// Rate limiters
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// Middleware d'authentification pour cette route (plus permissif que requireAuth)
router.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token requis' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  // Vérifier que c'est un admin SUPER ou SECURITY_ADMIN
  if (!req.user || (req.user.adminLevel !== 'SUPER' && req.user.adminRoleType?.slug !== 'security-admin')) {
    return res.status(403).json({ error: 'Accès refusé — seul SUPER_ADMIN ou SECURITY_ADMIN peut modifier les permissions' });
  }

  next();
});

// ============================================
// GET /api/role-permissions/all-sections
// Liste toutes les sections disponibles
// ============================================
router.get('/all-sections', handleValidationErrors, async (req, res, next) => {
  try {
    const sections = [
      { name: 'reviews', description: 'Gestion des avis' },
      { name: 'disputes', description: 'Gestion des litiges' },
      { name: 'messaging', description: 'Messagerie' },
      { name: 'analytics', description: 'Analytique' },
      { name: 'dashboard', description: 'Tableau de bord' },
      { name: 'admin-logs', description: 'Logs administrateur' },
      { name: 'security', description: 'Sécurité' },
      { name: 'support-tickets', description: 'Tickets de support' },
      { name: 'payments', description: 'Paiements' },
      { name: 'subscriptions', description: 'Abonnements' },
      { name: 'invoices', description: 'Factures' },
      { name: 'refunds', description: 'Remboursements' },
      { name: 'financial-reports', description: 'Rapports financiers' },
      { name: 'projects', description: 'Projets' },
      { name: 'portfolio', description: 'Portfolio' },
      { name: 'promos', description: 'Promotions' },
      { name: 'categories', description: 'Catégories' },
      { name: 'featured-listings', description: 'Annonces en vedette' },
      { name: 'professionals', description: 'Professionnels' },
      { name: 'verification', description: 'Vérification' },
      { name: 'licenses', description: 'Licences' },
      { name: 'performance', description: 'Performance' },
      { name: 'blacklist', description: 'Liste noire' },
      { name: 'clients', description: 'Clients' },
      { name: 'identity-verification', description: 'Vérification d\'identité' },
      { name: 'communication', description: 'Communication' },
      { name: 'investigation', description: 'Investigation' },
      { name: 'legal-compliance', description: 'Conformité légale' },
      { name: 'data-privacy', description: 'Confidentialité des données' },
      { name: 'regulatory-reports', description: 'Rapports réglementaires' },
      { name: 'document-verification', description: 'Vérification de documents' },
      { name: 'security-audit', description: 'Audit de sécurité' },
    ];

    res.json({ sections });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /api/role-permissions/:roleId
// Récupère les permissions actuelles d'un rôle
// ============================================
router.get('/:roleId',
  [
    param('roleId').trim().notEmpty().withMessage('roleId requis'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
  try {
    const { roleId } = req.params;

    const role = await prisma.adminRoleType.findUnique({
      where: { id: roleId },
      include: { permissions: true }
    });
    if (!role) return res.status(404).json({ error: 'Rôle non trouvé' });

    // Mapper les permissions avec descriptions
    const ALL_SECTIONS = {
      'reviews': 'Gestion des avis',
      'disputes': 'Gestion des litiges',
      'messaging': 'Messagerie',
      'analytics': 'Analytique',
      'dashboard': 'Tableau de bord',
      'admin-logs': 'Logs administrateur',
      'security': 'Sécurité',
      'support-tickets': 'Tickets de support',
      'payments': 'Paiements',
      'subscriptions': 'Abonnements',
      'invoices': 'Factures',
      'refunds': 'Remboursements',
      'financial-reports': 'Rapports financiers',
      'projects': 'Projets',
      'portfolio': 'Portfolio',
      'promos': 'Promotions',
      'categories': 'Catégories',
      'featured-listings': 'Annonces en vedette',
      'professionals': 'Professionnels',
      'verification': 'Vérification',
      'licenses': 'Licences',
      'performance': 'Performance',
      'blacklist': 'Liste noire',
      'clients': 'Clients',
      'identity-verification': 'Vérification d\'identité',
      'communication': 'Communication',
      'investigation': 'Investigation',
      'legal-compliance': 'Conformité légale',
      'data-privacy': 'Confidentialité des données',
      'regulatory-reports': 'Rapports réglementaires',
      'document-verification': 'Vérification de documents',
      'security-audit': 'Audit de sécurité',
    };

    const sections = role.permissions.map(p => ({
      name: p.section,
      description: ALL_SECTIONS[p.section] || p.section,
      canCreate: p.canCreate,
      canRead: p.canRead,
      canUpdate: p.canUpdate,
      canDelete: p.canDelete,
    }));

    res.json({
      roleId,
      roleName: role.name,
      slug: role.slug,
      sections,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/role-permissions/grant
// Ajoute une permission à un rôle
// Body: { roleId, section, actions: ['read', 'create', ...] }
// ============================================
router.post('/grant', async (req, res, next) => {
  try {
    const { roleId, section, actions } = req.body;
    const changedByAdminId = req.user.id;

    // Validation
    if (!roleId || !section || !Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: 'roleId, section, et actions[] sont requis' });
    }

    const validActions = ['create', 'read', 'update', 'delete'];
    if (!actions.every(a => validActions.includes(a))) {
      return res.status(400).json({ error: `Actions valides: ${validActions.join(', ')}` });
    }

    // Vérifier que le rôle existe
    const role = await prisma.adminRoleType.findUnique({ where: { id: roleId } });
    if (!role) return res.status(404).json({ error: 'Rôle non trouvé' });

    // Récupérer les permissions actuelles
    const currentPerm = await prisma.rolePermission.findUnique({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } }
    });

    const previousPermissions = currentPerm ? {
      canCreate: currentPerm.canCreate,
      canRead: currentPerm.canRead,
      canUpdate: currentPerm.canUpdate,
      canDelete: currentPerm.canDelete,
    } : { canCreate: false, canRead: false, canUpdate: false, canDelete: false };

    const newPermissions = {
      canCreate: actions.includes('create') || (currentPerm?.canCreate ?? false),
      canRead: actions.includes('read') || (currentPerm?.canRead ?? false),
      canUpdate: actions.includes('update') || (currentPerm?.canUpdate ?? false),
      canDelete: actions.includes('delete') || (currentPerm?.canDelete ?? false),
    };

    // Sauvegarder dans RolePermission
    await prisma.rolePermission.upsert({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } },
      create: { adminRoleTypeId: roleId, section, ...newPermissions },
      update: newPermissions,
    });

    // Logger dans RolePermissionHistory
    await prisma.rolePermissionHistory.create({
      data: {
        adminRoleTypeId: roleId,
        changedByAdminId,
        section,
        previousPermissions: JSON.stringify(previousPermissions),
        newPermissions: JSON.stringify(newPermissions),
        action: 'GRANT',
      },
    });

    res.json({
      success: true,
      message: `Permission '${section}' accordée au rôle`,
      roleId,
      section,
      actions,
      grantedAt: new Date().toISOString(),
      grantedBy: changedByAdminId,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/role-permissions/revoke
// Retire une permission d'un rôle
// Body: { roleId, section, actions: ['update', ...] }
// ============================================
router.post('/revoke', async (req, res, next) => {
  try {
    const { roleId, section, actions } = req.body;
    const changedByAdminId = req.user.id;

    // Validation
    if (!roleId || !section || !Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: 'roleId, section, et actions[] sont requis' });
    }

    const validActions = ['create', 'read', 'update', 'delete'];
    if (!actions.every(a => validActions.includes(a))) {
      return res.status(400).json({ error: `Actions valides: ${validActions.join(', ')}` });
    }

    // Récupérer les permissions actuelles
    const currentPerm = await prisma.rolePermission.findUnique({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } }
    });
    if (!currentPerm) return res.status(404).json({ error: 'Pas de permission trouvée pour cette section' });

    const previousPermissions = {
      canCreate: currentPerm.canCreate,
      canRead: currentPerm.canRead,
      canUpdate: currentPerm.canUpdate,
      canDelete: currentPerm.canDelete,
    };

    // Vérifier qu'on retire pas TOUT
    const newPermissions = {
      canCreate: currentPerm.canCreate && !actions.includes('create'),
      canRead: currentPerm.canRead && !actions.includes('read'),
      canUpdate: currentPerm.canUpdate && !actions.includes('update'),
      canDelete: currentPerm.canDelete && !actions.includes('delete'),
    };

    if (!Object.values(newPermissions).some(v => v === true)) {
      return res.status(400).json({ error: 'Au moins une action doit rester autorisée pour cette section' });
    }

    // Mettre à jour RolePermission
    await prisma.rolePermission.update({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } },
      data: newPermissions,
    });

    // Logger
    await prisma.rolePermissionHistory.create({
      data: {
        adminRoleTypeId: roleId,
        changedByAdminId,
        section,
        previousPermissions: JSON.stringify(previousPermissions),
        newPermissions: JSON.stringify(newPermissions),
        action: 'REVOKE',
      },
    });

    res.json({
      success: true,
      message: `Permission '${section}' retirée du rôle`,
      roleId,
      section,
      actionsRevoked: actions,
      revokedAt: new Date().toISOString(),
      revokedBy: changedByAdminId,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /api/role-permissions/history/:roleId
// Récupère l'historique des changements de permissions
// ============================================
router.get('/history/:roleId', async (req, res, next) => {
  try {
    const { roleId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const total = await prisma.rolePermissionHistory.count({ where: { adminRoleTypeId: roleId } });

    // Ensure array bounds
    if (skip >= total && page > 1) {
      return res.json({ roleId, history: [], total, page, totalPages: Math.ceil(total / limit) });
    }

    const history = await prisma.rolePermissionHistory.findMany({
      where: { adminRoleTypeId: roleId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    // Enrichir avec infos de l'admin qui a fait le changement
    const changedByIds = [...new Set(history.map(h => h.changedByAdminId))];
    const admins = await prisma.user.findMany({
      where: { id: { in: changedByIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const adminMap = Object.fromEntries(admins.map(a => [a.id, a]));

    const enrichedHistory = history.map(h => ({
      id: h.id,
      section: h.section,
      action: h.action,
      reason: h.reason,
      previousPermissions: h.previousPermissions ? JSON.parse(h.previousPermissions) : null,
      newPermissions: h.newPermissions ? JSON.parse(h.newPermissions) : null,
      changedByAdminId: h.changedByAdminId,
      changedBy: adminMap[h.changedByAdminId] || null,
      createdAt: h.createdAt ? (typeof h.createdAt === 'string' ? h.createdAt : h.createdAt.toISOString()) : null,
    }));

    res.json({
      roleId,
      history: enrichedHistory,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /api/role-permissions/rollback/:roleId/:historyId
// Revient à une version antérieure des permissions
// Body: { reason?: string }
// ============================================
router.post('/rollback/:roleId/:historyId', async (req, res, next) => {
  try {
    const { roleId, historyId } = req.params;
    const { reason } = req.body || {};
    const changedByAdminId = req.user.id;

    // Récupérer l'entrée history
    const historyEntry = await prisma.rolePermissionHistory.findUnique({
      where: { id: historyId }
    });
    if (!historyEntry) return res.status(404).json({ error: 'Entrée historique non trouvée' });
    if (historyEntry.adminRoleTypeId !== roleId) return res.status(400).json({ error: 'Cette entrée n\'appartient pas à ce rôle' });

    // Restaurer les permissions (previousPermissions)
    const restoredPerms = JSON.parse(historyEntry.previousPermissions);
    const currentPerm = await prisma.rolePermission.findUnique({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section: historyEntry.section } }
    });

    const currentPermsBeforeRollback = currentPerm ? {
      canCreate: currentPerm.canCreate,
      canRead: currentPerm.canRead,
      canUpdate: currentPerm.canUpdate,
      canDelete: currentPerm.canDelete,
    } : { canCreate: false, canRead: false, canUpdate: false, canDelete: false };

    // Mettre à jour les permissions
    await prisma.rolePermission.upsert({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section: historyEntry.section } },
      create: { adminRoleTypeId: roleId, section: historyEntry.section, ...restoredPerms },
      update: restoredPerms,
    });

    // Logger le rollback comme un nouveau changement
    await prisma.rolePermissionHistory.create({
      data: {
        adminRoleTypeId: roleId,
        changedByAdminId,
        section: historyEntry.section,
        previousPermissions: JSON.stringify(currentPermsBeforeRollback),
        newPermissions: JSON.stringify(restoredPerms),
        action: 'ROLLBACK',
        reason: `Rollback de ${historyId.substring(0, 8)}. ${reason || 'Annulation d\'un changement'}`,
      },
    });

    res.json({
      success: true,
      message: 'Permissions restaurées à une version antérieure',
      roleId,
      historyId,
      section: historyEntry.section,
      rolledBackAt: new Date().toISOString(),
      rolledBackBy: changedByAdminId,
      restoredPermissions: restoredPerms,
      reason,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
