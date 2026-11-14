const ALL_SECTIONS = [
  'reviews', 'disputes', 'messaging', 'analytics', 'dashboard', 'admin-logs',
  'security', 'support-tickets', 'payments', 'subscriptions', 'invoices',
  'refunds', 'financial-reports', 'projects', 'portfolio', 'promos',
  'categories', 'featured-listings', 'professionals', 'verification',
  'licenses', 'performance', 'blacklist', 'clients', 'identity-verification',
  'communication', 'investigation', 'legal-compliance', 'data-privacy',
  'regulatory-reports', 'document-verification', 'security-audit',
];

const SECTION_DESCRIPTIONS = {
  reviews: 'Gestion des avis',
  disputes: 'Gestion des litiges',
  messaging: 'Messagerie',
  analytics: 'Analytique',
  dashboard: 'Tableau de bord',
  'admin-logs': 'Logs administrateur',
  security: 'Sécurité',
  'support-tickets': 'Tickets de support',
  payments: 'Paiements',
  subscriptions: 'Abonnements',
  invoices: 'Factures',
  refunds: 'Remboursements',
  'financial-reports': 'Rapports financiers',
  projects: 'Projets',
  portfolio: 'Portfolio',
  promos: 'Promotions',
  categories: 'Catégories',
  'featured-listings': 'Annonces en vedette',
  professionals: 'Professionnels',
  verification: 'Vérification',
  licenses: 'Licences',
  performance: 'Performance',
  blacklist: 'Liste noire',
  clients: 'Clients',
  'identity-verification': 'Vérification d\'identité',
  communication: 'Communication',
  investigation: 'Investigation',
  'legal-compliance': 'Conformité légale',
  'data-privacy': 'Confidentialité des données',
  'regulatory-reports': 'Rapports réglementaires',
  'document-verification': 'Vérification de documents',
  'security-audit': 'Audit de sécurité',
};

class RolePermissionModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * GET /all-sections — List all permission sections
   */
  async getAllSections() {
    return ALL_SECTIONS.map(name => ({
      name,
      description: SECTION_DESCRIPTIONS[name] || name,
    }));
  }

  /**
   * GET /:roleId — Get role permissions
   */
  async getRolePermissions(roleId) {
    const role = await this.prisma.adminRoleType.findUnique({
      where: { id: roleId },
      include: { permissions: true },
    });

    if (!role) {
      const err = new Error('Rôle non trouvé');
      err.status = 404;
      throw err;
    }

    const sections = role.permissions.map(p => ({
      name: p.section,
      description: SECTION_DESCRIPTIONS[p.section] || p.section,
      canCreate: p.canCreate,
      canRead: p.canRead,
      canUpdate: p.canUpdate,
      canDelete: p.canDelete,
    }));

    return {
      roleId,
      roleName: role.name,
      slug: role.slug,
      sections,
    };
  }

  /**
   * POST /grant — Grant permissions to a role
   */
  async grantPermission(roleId, section, actions, changedByAdminId) {
    if (!roleId || !section || !Array.isArray(actions) || actions.length === 0) {
      const err = new Error('roleId, section, et actions[] sont requis');
      err.status = 400;
      throw err;
    }

    const validActions = ['create', 'read', 'update', 'delete'];
    if (!actions.every(a => validActions.includes(a))) {
      const err = new Error(`Actions valides: ${validActions.join(', ')}`);
      err.status = 400;
      throw err;
    }

    // Check role exists
    const role = await this.prisma.adminRoleType.findUnique({ where: { id: roleId } });
    if (!role) {
      const err = new Error('Rôle non trouvé');
      err.status = 404;
      throw err;
    }

    // Get current permission
    const currentPerm = await this.prisma.rolePermission.findUnique({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } },
    });

    const previousPermissions = currentPerm
      ? { canCreate: currentPerm.canCreate, canRead: currentPerm.canRead, canUpdate: currentPerm.canUpdate, canDelete: currentPerm.canDelete }
      : { canCreate: false, canRead: false, canUpdate: false, canDelete: false };

    // Build new permissions (merge with existing)
    const newPermissions = {
      canCreate: (currentPerm?.canCreate || false) || actions.includes('create'),
      canRead: (currentPerm?.canRead || false) || actions.includes('read'),
      canUpdate: (currentPerm?.canUpdate || false) || actions.includes('update'),
      canDelete: (currentPerm?.canDelete || false) || actions.includes('delete'),
    };

    // Upsert permission
    await this.prisma.rolePermission.upsert({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } },
      create: {
        adminRoleTypeId: roleId,
        section,
        ...newPermissions,
      },
      update: newPermissions,
    });

    // Log change
    await this.prisma.rolePermissionHistory.create({
      data: {
        adminRoleTypeId: roleId,
        section,
        action: 'GRANT',
        previousPermissions: JSON.stringify(previousPermissions),
        newPermissions: JSON.stringify(newPermissions),
        changedByAdminId,
      },
    });

    return {
      success: true,
      roleId,
      section,
      actions,
      grantedAt: new Date(),
      grantedBy: changedByAdminId,
    };
  }

  /**
   * POST /revoke — Revoke permissions from a role
   */
  async revokePermission(roleId, section, changedByAdminId) {
    if (!roleId || !section) {
      const err = new Error('roleId et section sont requis');
      err.status = 400;
      throw err;
    }

    // Get current permission
    const currentPerm = await this.prisma.rolePermission.findUnique({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } },
    });

    if (!currentPerm) {
      const err = new Error('Pas de permission trouvée');
      err.status = 404;
      throw err;
    }

    const previousPermissions = {
      canCreate: currentPerm.canCreate,
      canRead: currentPerm.canRead,
      canUpdate: currentPerm.canUpdate,
      canDelete: currentPerm.canDelete,
    };

    // For now, just set all to false (or specify which actions to revoke)
    // This is a simplified revoke - full logic would track specific actions
    const newPermissions = {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    };

    // Log change
    await this.prisma.rolePermissionHistory.create({
      data: {
        adminRoleTypeId: roleId,
        section,
        action: 'REVOKE',
        previousPermissions: JSON.stringify(previousPermissions),
        newPermissions: JSON.stringify(newPermissions),
        changedByAdminId,
      },
    });

    // Update (or delete) permission
    await this.prisma.rolePermission.delete({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } },
    });

    return {
      success: true,
      roleId,
      section,
      actionsRevoked: ['create', 'read', 'update', 'delete'],
      revokedAt: new Date(),
      revokedBy: changedByAdminId,
    };
  }

  /**
   * GET /history/:roleId — Get permission history
   */
  async getPermissionHistory(roleId, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const history = await this.prisma.rolePermissionHistory.findMany({
      where: { adminRoleTypeId: roleId },
      skip,
      take: limit,
      include: {
        changedByAdmin: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = await this.prisma.rolePermissionHistory.count({
      where: { adminRoleTypeId: roleId },
    });

    // Parse JSON strings
    const parsed = history.map(h => ({
      ...h,
      previousPermissions: JSON.parse(h.previousPermissions),
      newPermissions: JSON.parse(h.newPermissions),
      changedBy: h.changedByAdmin,
    }));

    return {
      roleId,
      history: parsed,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * POST /rollback/:roleId/:historyId — Rollback permissions
   */
  async rollbackPermissions(roleId, historyId, reason, changedByAdminId) {
    // Get history entry
    const historyEntry = await this.prisma.rolePermissionHistory.findUnique({
      where: { id: historyId },
    });

    if (!historyEntry) {
      const err = new Error('Entrée historique non trouvée');
      err.status = 404;
      throw err;
    }

    // Validate ownership
    if (historyEntry.adminRoleTypeId !== roleId) {
      const err = new Error("History entry n'appartient pas à ce rôle");
      err.status = 400;
      throw err;
    }

    const section = historyEntry.section;
    const previousPermissions = JSON.parse(historyEntry.previousPermissions);

    // Get current permission
    const currentPerm = await this.prisma.rolePermission.findUnique({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } },
    });

    const currentPermissions = currentPerm
      ? { canCreate: currentPerm.canCreate, canRead: currentPerm.canRead, canUpdate: currentPerm.canUpdate, canDelete: currentPerm.canDelete }
      : { canCreate: false, canRead: false, canUpdate: false, canDelete: false };

    // Restore previous permissions
    await this.prisma.rolePermission.upsert({
      where: { adminRoleTypeId_section: { adminRoleTypeId: roleId, section } },
      create: {
        adminRoleTypeId: roleId,
        section,
        ...previousPermissions,
      },
      update: previousPermissions,
    });

    // Log rollback
    await this.prisma.rolePermissionHistory.create({
      data: {
        adminRoleTypeId: roleId,
        section,
        action: 'ROLLBACK',
        reason: reason || null,
        previousPermissions: JSON.stringify(currentPermissions),
        newPermissions: JSON.stringify(previousPermissions),
        changedByAdminId,
      },
    });

    return {
      success: true,
      roleId,
      historyId,
      section,
      restoredPermissions: previousPermissions,
      rolledBackAt: new Date(),
      rolledBackBy: changedByAdminId,
      reason,
    };
  }
}

module.exports = RolePermissionModule;
