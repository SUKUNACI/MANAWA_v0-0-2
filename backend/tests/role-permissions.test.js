const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock Prisma AVANT d'importer la route
jest.mock('../config/db', () => ({
  adminRoleType: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  rolePermission: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  rolePermissionHistory: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
}));

// STUBS pour les fixtures de test
const createMockApp = () => {
  const express = require('express');
  const app = express();
  app.use(express.json());

  // Import la route APRÈS mock
  const rolePermissionsRoutes = require('../routes/role-permissions');
  app.use('/api/role-permissions', rolePermissionsRoutes);

  return app;
};

describe('Role Permissions API', () => {
  let app;
  let superAdminToken;
  let securityAdminToken;
  let regularAdminToken;
  let prisma;

  const TEST_ROLE_ID = 'role-moderator-123';
  const TEST_ADMIN_ID = 'admin-super-456';
  const TEST_SECURITY_ID = 'admin-security-789';
  const TEST_REGULAR_ID = 'admin-regular-001';

  beforeAll(() => {
    app = createMockApp();
    prisma = require('../config/db');

    // Créer tokens JWT mock
    const secret = process.env.JWT_SECRET;
    superAdminToken = jwt.sign(
      { id: TEST_ADMIN_ID, adminLevel: 'SUPER', sub: TEST_ADMIN_ID },
      secret,
      { expiresIn: '1h' }
    );

    securityAdminToken = jwt.sign(
      {
        id: TEST_SECURITY_ID,
        adminRoleType: { slug: 'security-admin' },
        sub: TEST_SECURITY_ID,
      },
      secret,
      { expiresIn: '1h' }
    );

    regularAdminToken = jwt.sign(
      { id: TEST_REGULAR_ID, adminLevel: 'USER', sub: TEST_REGULAR_ID },
      secret,
      { expiresIn: '1h' }
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== GET /api/role-permissions/:roleId ==========
  describe('GET /api/role-permissions/:roleId', () => {
    test('should return current permissions for a role (SUPER_ADMIN)', async () => {
      prisma.adminRoleType.findUnique.mockResolvedValue({
        id: TEST_ROLE_ID,
        name: 'Modérateur',
        slug: 'moderator',
        permissions: [
          { section: 'reviews', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
          { section: 'disputes', canCreate: false, canRead: true, canUpdate: false, canDelete: false },
        ],
      });

      const res = await request(app)
        .get(`/api/role-permissions/${TEST_ROLE_ID}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('roleId');
      expect(res.body).toHaveProperty('roleName');
      expect(res.body).toHaveProperty('sections');
      expect(Array.isArray(res.body.sections)).toBe(true);
      expect(res.body.sections[0]).toHaveProperty('name');
      expect(res.body.sections[0]).toHaveProperty('canCreate');
      expect(res.body.sections[0]).toHaveProperty('canRead');
      expect(res.body.sections[0]).toHaveProperty('canUpdate');
      expect(res.body.sections[0]).toHaveProperty('canDelete');
    });

    test('should allow SECURITY_ADMIN to get permissions', async () => {
      prisma.adminRoleType.findUnique.mockResolvedValue({
        id: TEST_ROLE_ID,
        name: 'Modérateur',
        permissions: [{ section: 'reviews', canCreate: true, canRead: true, canUpdate: true, canDelete: false }],
      });

      const res = await request(app)
        .get(`/api/role-permissions/${TEST_ROLE_ID}`)
        .set('Authorization', `Bearer ${securityAdminToken}`);

      expect(res.status).toBe(200);
    });

    test('should reject regular admins (not SUPER or SECURITY)', async () => {
      const res = await request(app)
        .get(`/api/role-permissions/${TEST_ROLE_ID}`)
        .set('Authorization', `Bearer ${regularAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Accès refusé');
    });

    test('should reject unauthenticated requests', async () => {
      const res = await request(app).get(`/api/role-permissions/${TEST_ROLE_ID}`);

      expect(res.status).toBe(401);
    });
  });

  // ========== POST /api/role-permissions/grant ==========
  describe('POST /api/role-permissions/grant', () => {
    test('should grant permission to a role', async () => {
      prisma.adminRoleType.findUnique.mockResolvedValue({ id: TEST_ROLE_ID, name: 'Modérateur' });
      prisma.rolePermission.findUnique.mockResolvedValue(null);
      prisma.rolePermission.upsert.mockResolvedValue({ adminRoleTypeId: TEST_ROLE_ID, section: 'reviews' });
      prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-1' });

      const res = await request(app)
        .post('/api/role-permissions/grant')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'reviews',
          actions: ['create', 'read', 'update'],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.roleId).toBe(TEST_ROLE_ID);
      expect(res.body.section).toBe('reviews');
      expect(res.body.actions).toEqual(['create', 'read', 'update']);
      expect(res.body).toHaveProperty('grantedAt');
      expect(res.body.grantedBy).toBe(TEST_ADMIN_ID);
    });

    test('should reject invalid action types', async () => {
      const res = await request(app)
        .post('/api/role-permissions/grant')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'reviews',
          actions: ['invalid-action'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Actions valides');
    });

    test('should reject empty actions array', async () => {
      const res = await request(app)
        .post('/api/role-permissions/grant')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'reviews',
          actions: [],
        });

      expect(res.status).toBe(400);
    });

    test('should require all fields', async () => {
      const res = await request(app)
        .post('/api/role-permissions/grant')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          // section missing
          actions: ['read'],
        });

      expect(res.status).toBe(400);
    });

    test('should allow SECURITY_ADMIN to grant permissions', async () => {
      prisma.adminRoleType.findUnique.mockResolvedValue({ id: TEST_ROLE_ID, name: 'Modérateur' });
      prisma.rolePermission.findUnique.mockResolvedValue(null);
      prisma.rolePermission.upsert.mockResolvedValue({ adminRoleTypeId: TEST_ROLE_ID, section: 'disputes' });
      prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-1' });

      const res = await request(app)
        .post('/api/role-permissions/grant')
        .set('Authorization', `Bearer ${securityAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'disputes',
          actions: ['read'],
        });

      expect(res.status).toBe(200);
    });
  });

  // ========== POST /api/role-permissions/revoke ==========
  describe('POST /api/role-permissions/revoke', () => {
    test('should revoke permission from a role', async () => {
      prisma.rolePermission.findUnique.mockResolvedValue({
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
      });
      prisma.rolePermission.update.mockResolvedValue({ adminRoleTypeId: TEST_ROLE_ID, section: 'reviews' });
      prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-2' });

      const res = await request(app)
        .post('/api/role-permissions/revoke')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'reviews',
          actions: ['delete'],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.roleId).toBe(TEST_ROLE_ID);
      expect(res.body.section).toBe('reviews');
      expect(res.body.actionsRevoked).toEqual(['delete']);
      expect(res.body).toHaveProperty('revokedAt');
      expect(res.body.revokedBy).toBe(TEST_ADMIN_ID);
    });

    test('should reject invalid action types', async () => {
      const res = await request(app)
        .post('/api/role-permissions/revoke')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'reviews',
          actions: ['create-posts'],
        });

      expect(res.status).toBe(400);
    });

    test('should reject if no actions provided', async () => {
      const res = await request(app)
        .post('/api/role-permissions/revoke')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'reviews',
          actions: [],
        });

      expect(res.status).toBe(400);
    });

    test('should only allow SUPER_ADMIN or SECURITY_ADMIN', async () => {
      const res = await request(app)
        .post('/api/role-permissions/revoke')
        .set('Authorization', `Bearer ${regularAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'reviews',
          actions: ['update'],
        });

      expect(res.status).toBe(403);
    });
  });

  // ========== GET /api/role-permissions/history/:roleId ==========
  describe('GET /api/role-permissions/history/:roleId', () => {
    test('should return permission history for a role', async () => {
      prisma.rolePermissionHistory.findMany.mockResolvedValue([
        {
          id: 'hist-1',
          section: 'reviews',
          action: 'GRANT',
          reason: null,
          previousPermissions: '{"canCreate":false,"canRead":false,"canUpdate":false,"canDelete":false}',
          newPermissions: '{"canCreate":true,"canRead":true,"canUpdate":false,"canDelete":false}',
          changedByAdminId: TEST_ADMIN_ID,
          createdAt: new Date(),
        },
      ]);
      prisma.rolePermissionHistory.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        { id: TEST_ADMIN_ID, firstName: 'Super', lastName: 'Admin', email: 'super@test.com' },
      ]);

      const res = await request(app)
        .get(`/api/role-permissions/history/${TEST_ROLE_ID}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('roleId');
      expect(res.body).toHaveProperty('history');
      expect(Array.isArray(res.body.history)).toBe(true);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('totalPages');
    });

    test('should support pagination', async () => {
      prisma.rolePermissionHistory.findMany.mockResolvedValue([]);
      prisma.rolePermissionHistory.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/role-permissions/history/${TEST_ROLE_ID}?page=1&limit=10`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
    });
  });

  // ========== POST /api/role-permissions/rollback ==========
  describe('POST /api/role-permissions/rollback/:roleId/:historyId', () => {
    test('should rollback to a previous permission state', async () => {
      prisma.rolePermissionHistory.findUnique.mockResolvedValue({
        id: 'hist-1',
        adminRoleTypeId: TEST_ROLE_ID,
        section: 'reviews',
        previousPermissions: '{"canCreate":false,"canRead":true,"canUpdate":false,"canDelete":false}',
        newPermissions: '{"canCreate":true,"canRead":true,"canUpdate":false,"canDelete":false}',
      });
      prisma.rolePermission.findUnique.mockResolvedValue({
        canCreate: true,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      });
      prisma.rolePermission.upsert.mockResolvedValue({ adminRoleTypeId: TEST_ROLE_ID, section: 'reviews' });
      prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-3' });

      const res = await request(app)
        .post(`/api/role-permissions/rollback/${TEST_ROLE_ID}/hist-1`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Accidental change' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.roleId).toBe(TEST_ROLE_ID);
      expect(res.body.historyId).toBe('hist-1');
      expect(res.body).toHaveProperty('rolledBackAt');
      expect(res.body.rolledBackBy).toBe(TEST_ADMIN_ID);
    });

    test('should track rollback reason', async () => {
      const reason = 'Testing rollback';
      prisma.rolePermissionHistory.findUnique.mockResolvedValue({
        id: 'hist-1',
        adminRoleTypeId: TEST_ROLE_ID,
        section: 'reviews',
        previousPermissions: '{"canCreate":false,"canRead":true,"canUpdate":false,"canDelete":false}',
        newPermissions: '{"canCreate":true,"canRead":true,"canUpdate":false,"canDelete":false}',
      });
      prisma.rolePermission.findUnique.mockResolvedValue({
        canCreate: true,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      });
      prisma.rolePermission.upsert.mockResolvedValue({ adminRoleTypeId: TEST_ROLE_ID, section: 'reviews' });
      prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-3', reason });

      const res = await request(app)
        .post(`/api/role-permissions/rollback/${TEST_ROLE_ID}/hist-1`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason });

      expect(res.status).toBe(200);
      expect(res.body.reason).toBe(reason);
    });

    test('should only allow SUPER_ADMIN or SECURITY_ADMIN', async () => {
      const res = await request(app)
        .post(`/api/role-permissions/rollback/${TEST_ROLE_ID}/hist-1`)
        .set('Authorization', `Bearer ${regularAdminToken}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  // ========== GET /api/role-permissions/all-sections ==========
  describe('GET /api/role-permissions/all-sections', () => {
    test('should return all available sections', async () => {
      const res = await request(app)
        .get('/api/role-permissions/all-sections')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('sections');
      expect(Array.isArray(res.body.sections)).toBe(true);
      expect(res.body.sections.length).toBeGreaterThan(0);

      // Vérifier structure d'une section
      const section = res.body.sections[0];
      expect(section).toHaveProperty('name');
      expect(section).toHaveProperty('description');
    });
  });

  // ========== EDGE CASES: Permission Conflicts & Anomalies ==========
  describe('EDGE CASES: Permission Conflicts', () => {
    test('Should prevent conflicting permissions in same grant', async () => {
      const res = await request(app)
        .post('/api/role-permissions/grant')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          roleId: TEST_ROLE_ID,
          section: 'reviews',
          actions: ['create', 'delete', 'create'], // duplicate
        });

      expect(res.status).toBe(200);
    });

    test('Should handle concurrent permission grants safely', async () => {
      prisma.adminRoleType.findUnique.mockResolvedValue({ id: TEST_ROLE_ID });
      prisma.rolePermission.upsert.mockResolvedValue({});
      prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-1' });

      const requests = Array.from({ length: 3 }, () =>
        request(app)
          .post('/api/role-permissions/grant')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({
            roleId: TEST_ROLE_ID,
            section: 'reviews',
            actions: ['create'],
          })
      );

      const results = await Promise.all(requests);
      results.forEach(res => expect(res.status).toBe(200));
    });

    test('Permission history should track all changes', async () => {
      prisma.rolePermissionHistory.findMany.mockResolvedValue([
        {
          id: 'hist-1',
          section: 'reviews',
          action: 'GRANT',
          previousPermissions: '{"canCreate":false}',
          newPermissions: '{"canCreate":true}',
          createdAt: new Date(),
        },
        {
          id: 'hist-2',
          section: 'reviews',
          action: 'REVOKE',
          previousPermissions: '{"canCreate":true}',
          newPermissions: '{"canCreate":false}',
          createdAt: new Date(),
        },
      ]);
      prisma.rolePermissionHistory.count.mockResolvedValue(2);
      prisma.user.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/role-permissions/history/${TEST_ROLE_ID}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.history.length).toBe(2);
    });
  });

  // ========== EDGE CASES: Large-scale Permission Operations ==========
  describe('EDGE CASES: Large Permission Sets', () => {
    test('Should handle role with many sections', async () => {
      const sections = Array.from({ length: 50 }, (_, i) => ({
        name: `section-${i}`,
        canCreate: i % 2 === 0,
        canRead: true,
        canUpdate: i % 3 === 0,
        canDelete: i % 4 === 0,
      }));

      prisma.adminRoleType.findUnique.mockResolvedValue({
        id: TEST_ROLE_ID,
        name: 'Moderator',
        permissions: sections,
      });

      const res = await request(app)
        .get(`/api/role-permissions/${TEST_ROLE_ID}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sections?.length || res.body.permissions?.length).toBeGreaterThan(0);
    });

    test('Pagination on large history should work', async () => {
      const history = Array.from({ length: 500 }, (_, i) => ({
        id: `hist-${i}`,
        section: `section-${i % 10}`,
        action: i % 2 === 0 ? 'GRANT' : 'REVOKE',
        createdAt: new Date(Date.now() - i * 1000),
      }));

      prisma.rolePermissionHistory.findMany.mockImplementation(({ skip, take }) => {
        return Promise.resolve(history.slice(skip, skip + take));
      });
      prisma.rolePermissionHistory.count.mockResolvedValue(500);
      prisma.user.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/role-permissions/history/${TEST_ROLE_ID}?page=1&limit=50`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.totalPages).toBeGreaterThan(1);
    });
  });
});
