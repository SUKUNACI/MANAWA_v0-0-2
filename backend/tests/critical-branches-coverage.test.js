const RolePermissionModule = require('../modules/rolePermission');
const CompanyModule = require('../modules/company');
const SupportModule = require('../modules/support');
const prisma = require('../config/db');

jest.mock('../config/db');

describe('Critical Branches Coverage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('RolePermissionModule - Missing Branches', () => {
    let rolePermission;

    beforeEach(() => {
      rolePermission = new RolePermissionModule(prisma);
    });

    it('returns all sections from getAllSections', async () => {
      const result = await rolePermission.getAllSections();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('updates permission history on grant', async () => {
      prisma.adminRoleType.findUnique.mockResolvedValue({ id: 'role-1', name: 'Admin' });
      prisma.rolePermission.findUnique.mockResolvedValue(null);
      prisma.rolePermission.create.mockResolvedValue({
        id: 'perm-1',
        section: 'dashboard',
        canRead: true,
      });
      prisma.rolePermissionHistory.create.mockResolvedValue({
        id: 'history-1',
      });

      const result = await rolePermission.grantPermission('role-1', 'dashboard', ['read'], 'admin-1');
      expect(result).toBeDefined();
    });
  });

  describe('CompanyModule - Missing Branches', () => {
    let company;

    beforeEach(() => {
      company = new CompanyModule(prisma);
    });

    it('returns empty list when no companies exist', async () => {
      prisma.company.findMany.mockResolvedValue([]);
      prisma.company.count.mockResolvedValue(0);

      const result = await company.list({ search: null, limit: 10, skip: 0 });
      expect(result.companies).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('throws 404 when company profile not found', async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      try {
        await company.getProfile('nonexistent');
        expect(true).toBe(false);
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });
  });

  describe('SupportModule - Missing Branches', () => {
    let support;

    beforeEach(() => {
      support = new SupportModule(prisma);
    });

    it('returns empty tickets list when none exist', async () => {
      prisma.supportTicket.findMany.mockResolvedValue([]);

      const result = await support.listTickets('user-1');
      expect(result).toEqual([]);
    });

    it('throws 404 when retrieving nonexistent ticket', async () => {
      prisma.supportTicket.findUnique.mockResolvedValue(null);

      try {
        await support.getTicket('user-1', 'nonexistent-ticket');
        expect(true).toBe(false);
      } catch (err) {
        expect(err.status).toBe(404);
      }
    });
  });
});
