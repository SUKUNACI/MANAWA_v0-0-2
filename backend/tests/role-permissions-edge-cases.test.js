const RolePermissionModule = require('../modules/rolePermission');
const prisma = require('../config/db');

jest.mock('../config/db');

describe('RolePermissionModule — Edge Cases', () => {
  let rolePermission;

  beforeEach(() => {
    rolePermission = new RolePermissionModule(prisma);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('throws 400 when invalid action provided', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue({ id: 'role-1', name: 'Admin' });
    prisma.rolePermission.findUnique.mockResolvedValue(null);

    try {
      await rolePermission.grantPermission('role-1', 'dashboard', ['delete_all'], 'admin-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toContain('Actions valides');
    }
  });

  it('throws 404 when role not found on grant', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue(null);

    try {
      await rolePermission.grantPermission('nonexistent-role', 'dashboard', ['read'], 'admin-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(404);
      expect(err.message).toContain('Rôle non trouvé');
    }
  });

  it('throws 404 when permission not found on revoke', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue(null);

    try {
      await rolePermission.revokePermission('role-1', 'dashboard', ['read'], 'admin-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(404);
      expect(err.message).toContain('Pas de permission trouvée');
    }
  });

  it('throws 400 when revoking would leave zero permissions', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue({
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });

    try {
      await rolePermission.revokePermission('role-1', 'dashboard', ['read'], 'admin-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toContain('Au moins une action');
    }
  });

  it('throws 404 when history entry not found on rollback', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue(null);

    try {
      await rolePermission.rollbackPermissions('role-1', 'history-1', 'user error', 'admin-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(404);
      expect(err.message).toContain('Entrée historique non trouvée');
    }
  });

  it('throws 400 when history entry belongs to different role', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue({
      id: 'history-1',
      adminRoleTypeId: 'different-role',
      section: 'dashboard',
      previousPermissions: JSON.stringify({ canRead: false, canCreate: false, canUpdate: false, canDelete: false }),
    });

    try {
      await rolePermission.rollbackPermissions('role-1', 'history-1', 'user error', 'admin-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toContain('n\'appartient pas à ce rôle');
    }
  });
});
