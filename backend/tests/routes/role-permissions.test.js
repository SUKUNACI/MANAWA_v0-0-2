/**
 * Tests pour routes/role-permissions.js
 * Endpoints:
 *   GET  /all-sections
 *   GET  /:roleId
 *   POST /grant
 *   POST /revoke
 *   GET  /history/:roleId
 *   POST /rollback/:roleId/:historyId
 *
 * Authentification: middleware interne basé sur jwt.verify + adminLevel/adminRoleType.
 * Accès réservé à SUPER_ADMIN (adminLevel === 'SUPER') ou SECURITY_ADMIN (adminRoleType.slug === 'security-admin')
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// ─── MOCKS ─────────────────────────────────────────────────────────────────────

jest.mock('../../config/db', () => ({
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

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 50 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue([]),
}));

// ─── SETUP ─────────────────────────────────────────────────────────────────────

const prisma = require('../../config/db');

function makeSuperAdminToken(id = 'admin-super-1') {
  return jwt.sign(
    { id, adminLevel: 'SUPER', email: 'super@test.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeSecurityAdminToken(id = 'admin-security-1') {
  return jwt.sign(
    { id, adminRoleType: { slug: 'security-admin' }, email: 'security@test.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeRegularAdminToken(id = 'admin-regular-1') {
  return jwt.sign(
    { id, adminLevel: 'STANDARD', email: 'regular@test.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeExpiredToken(id = 'admin-expired-1') {
  return jwt.sign(
    { id, adminLevel: 'SUPER' },
    process.env.JWT_SECRET,
    { expiresIn: '-1h' }
  );
}

let app;

beforeAll(() => {
  app = express();
  app.use(express.json());

  const rolePermissionsRoutes = require('../../routes/role-permissions');
  app.use('/api/role-permissions', rolePermissionsRoutes);
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── DONNÉES DE TEST ───────────────────────────────────────────────────────────

const ROLE_ID = 'role-moderator-123';
const HISTORY_ID = 'hist-entry-456';
const ADMIN_ID = 'admin-super-1';

const mockRole = {
  id: ROLE_ID,
  name: 'Modérateur',
  slug: 'moderator',
  permissions: [
    { section: 'reviews', canCreate: true, canRead: true, canUpdate: true, canDelete: false },
    { section: 'disputes', canCreate: false, canRead: true, canUpdate: false, canDelete: false },
  ],
};

const mockFullPermission = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
};

// ─── GET /api/role-permissions/all-sections ────────────────────────────────────

describe('GET /api/role-permissions/all-sections', () => {
  test('200 — retourne la liste de toutes les sections (SUPER_ADMIN)', async () => {
    const res = await request(app)
      .get('/api/role-permissions/all-sections')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sections');
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.sections.length).toBeGreaterThan(0);
  });

  test('200 — chaque section a name et description', async () => {
    const res = await request(app)
      .get('/api/role-permissions/all-sections')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    const section = res.body.sections[0];
    expect(section).toHaveProperty('name');
    expect(section).toHaveProperty('description');
    expect(typeof section.name).toBe('string');
    expect(typeof section.description).toBe('string');
  });

  test('200 — SECURITY_ADMIN peut accéder aux sections', async () => {
    const res = await request(app)
      .get('/api/role-permissions/all-sections')
      .set('Authorization', `Bearer ${makeSecurityAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.sections.length).toBeGreaterThan(0);
  });

  test('200 — contient les sections attendues (reviews, disputes, analytics)', async () => {
    const res = await request(app)
      .get('/api/role-permissions/all-sections')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    const names = res.body.sections.map((s) => s.name);
    expect(names).toContain('reviews');
    expect(names).toContain('disputes');
    expect(names).toContain('analytics');
  });

  test('401 — sans token Authorization', async () => {
    const res = await request(app)
      .get('/api/role-permissions/all-sections');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Token requis/i);
  });

  test('401 — token invalide', async () => {
    const res = await request(app)
      .get('/api/role-permissions/all-sections')
      .set('Authorization', 'Bearer token.invalide.xxx');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide|expiré/i);
  });

  test('401 — token expiré', async () => {
    const res = await request(app)
      .get('/api/role-permissions/all-sections')
      .set('Authorization', `Bearer ${makeExpiredToken()}`);

    expect(res.status).toBe(401);
  });

  test('403 — admin sans niveau SUPER ni security-admin', async () => {
    const res = await request(app)
      .get('/api/role-permissions/all-sections')
      .set('Authorization', `Bearer ${makeRegularAdminToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Accès refusé/i);
  });
});

// ─── GET /api/role-permissions/:roleId ────────────────────────────────────────

describe('GET /api/role-permissions/:roleId', () => {
  test('200 — retourne les permissions du rôle', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue(mockRole);

    const res = await request(app)
      .get(`/api/role-permissions/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.roleId).toBe(ROLE_ID);
    expect(res.body.roleName).toBe('Modérateur');
    expect(res.body.slug).toBe('moderator');
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.sections.length).toBe(2);
  });

  test('200 — chaque section contient les 4 propriétés CRUD', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue(mockRole);

    const res = await request(app)
      .get(`/api/role-permissions/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    const section = res.body.sections[0];
    expect(section).toHaveProperty('canCreate');
    expect(section).toHaveProperty('canRead');
    expect(section).toHaveProperty('canUpdate');
    expect(section).toHaveProperty('canDelete');
    expect(section).toHaveProperty('name');
    expect(section).toHaveProperty('description');
  });

  test('200 — SECURITY_ADMIN peut consulter un rôle', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue(mockRole);

    const res = await request(app)
      .get(`/api/role-permissions/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeSecurityAdminToken()}`);

    expect(res.status).toBe(200);
  });

  test('200 — rôle avec aucune permission retourne sections vide', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue({
      ...mockRole,
      permissions: [],
    });

    const res = await request(app)
      .get(`/api/role-permissions/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.sections).toEqual([]);
  });

  test('404 — rôle inexistant', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/role-permissions/role-inexistant-999')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Rôle non trouvé/i);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .get(`/api/role-permissions/${ROLE_ID}`);

    expect(res.status).toBe(401);
  });

  test('403 — admin ordinaire refusé', async () => {
    const res = await request(app)
      .get(`/api/role-permissions/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeRegularAdminToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/role-permissions/grant ─────────────────────────────────────────

describe('POST /api/role-permissions/grant', () => {
  const validGrantBody = {
    roleId: ROLE_ID,
    section: 'reviews',
    actions: ['create', 'read', 'update'],
  };

  test('200 — accorde des permissions à un rôle', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue({ id: ROLE_ID, name: 'Modérateur' });
    prisma.rolePermission.findUnique.mockResolvedValue(null);
    prisma.rolePermission.upsert.mockResolvedValue({ adminRoleTypeId: ROLE_ID, section: 'reviews' });
    prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-new' });

    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeSuperAdminToken(ADMIN_ID)}`)
      .send(validGrantBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.roleId).toBe(ROLE_ID);
    expect(res.body.section).toBe('reviews');
    expect(res.body.actions).toEqual(['create', 'read', 'update']);
    expect(res.body).toHaveProperty('grantedAt');
    expect(res.body.grantedBy).toBe(ADMIN_ID);
  });

  test('200 — SECURITY_ADMIN peut accorder des permissions', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue({ id: ROLE_ID });
    prisma.rolePermission.findUnique.mockResolvedValue(null);
    prisma.rolePermission.upsert.mockResolvedValue({});
    prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-new' });

    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeSecurityAdminToken()}`)
      .send(validGrantBody);

    expect(res.status).toBe(200);
  });

  test('200 — merge avec permissions existantes (upsert)', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue({ id: ROLE_ID });
    prisma.rolePermission.findUnique.mockResolvedValue({
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });
    prisma.rolePermission.upsert.mockResolvedValue({});
    prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-new' });

    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ roleId: ROLE_ID, section: 'reviews', actions: ['create'] });

    expect(res.status).toBe(200);
    expect(prisma.rolePermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ canCreate: true, canRead: true }),
      })
    );
  });

  test('400 — actions invalides refusées', async () => {
    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ roleId: ROLE_ID, section: 'reviews', actions: ['super-create', 'admin-read'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Actions valides/i);
  });

  test('400 — actions tableau vide', async () => {
    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ roleId: ROLE_ID, section: 'reviews', actions: [] });

    expect(res.status).toBe(400);
  });

  test('400 — roleId manquant', async () => {
    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ section: 'reviews', actions: ['read'] });

    expect(res.status).toBe(400);
  });

  test('400 — section manquante', async () => {
    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ roleId: ROLE_ID, actions: ['read'] });

    expect(res.status).toBe(400);
  });

  test('404 — rôle inexistant', async () => {
    prisma.adminRoleType.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send(validGrantBody);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Rôle non trouvé/i);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/role-permissions/grant')
      .send(validGrantBody);

    expect(res.status).toBe(401);
  });

  test('403 — admin ordinaire refusé', async () => {
    const res = await request(app)
      .post('/api/role-permissions/grant')
      .set('Authorization', `Bearer ${makeRegularAdminToken()}`)
      .send(validGrantBody);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/role-permissions/revoke ────────────────────────────────────────

describe('POST /api/role-permissions/revoke', () => {
  const validRevokeBody = {
    roleId: ROLE_ID,
    section: 'reviews',
    actions: ['delete'],
  };

  test('200 — retire une permission d\'un rôle', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue(mockFullPermission);
    prisma.rolePermission.update.mockResolvedValue({ adminRoleTypeId: ROLE_ID });
    prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-rev' });

    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .set('Authorization', `Bearer ${makeSuperAdminToken(ADMIN_ID)}`)
      .send(validRevokeBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.roleId).toBe(ROLE_ID);
    expect(res.body.section).toBe('reviews');
    expect(res.body.actionsRevoked).toEqual(['delete']);
    expect(res.body).toHaveProperty('revokedAt');
    expect(res.body.revokedBy).toBe(ADMIN_ID);
  });

  test('200 — SECURITY_ADMIN peut révoquer des permissions', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue(mockFullPermission);
    prisma.rolePermission.update.mockResolvedValue({});
    prisma.rolePermissionHistory.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .set('Authorization', `Bearer ${makeSecurityAdminToken()}`)
      .send(validRevokeBody);

    expect(res.status).toBe(200);
  });

  test('400 — tente de révoquer la dernière permission restante', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue({
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });

    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ roleId: ROLE_ID, section: 'reviews', actions: ['read'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Au moins une action/i);
  });

  test('400 — actions invalides', async () => {
    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ roleId: ROLE_ID, section: 'reviews', actions: ['manage-all'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Actions valides/i);
  });

  test('400 — actions tableau vide', async () => {
    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ roleId: ROLE_ID, section: 'reviews', actions: [] });

    expect(res.status).toBe(400);
  });

  test('400 — roleId manquant', async () => {
    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ section: 'reviews', actions: ['delete'] });

    expect(res.status).toBe(400);
  });

  test('404 — permission inexistante pour cette section', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send(validRevokeBody);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Pas de permission trouvée/i);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .send(validRevokeBody);

    expect(res.status).toBe(401);
  });

  test('403 — admin ordinaire refusé', async () => {
    const res = await request(app)
      .post('/api/role-permissions/revoke')
      .set('Authorization', `Bearer ${makeRegularAdminToken()}`)
      .send(validRevokeBody);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/role-permissions/history/:roleId ────────────────────────────────

describe('GET /api/role-permissions/history/:roleId', () => {
  const mockHistoryEntry = {
    id: HISTORY_ID,
    section: 'reviews',
    action: 'GRANT',
    reason: null,
    previousPermissions: '{"canCreate":false,"canRead":false,"canUpdate":false,"canDelete":false}',
    newPermissions: '{"canCreate":true,"canRead":true,"canUpdate":false,"canDelete":false}',
    changedByAdminId: ADMIN_ID,
    createdAt: new Date().toISOString(),
  };

  test('200 — retourne l\'historique paginé d\'un rôle', async () => {
    prisma.rolePermissionHistory.count.mockResolvedValue(1);
    prisma.rolePermissionHistory.findMany.mockResolvedValue([mockHistoryEntry]);
    prisma.user.findMany.mockResolvedValue([
      { id: ADMIN_ID, firstName: 'Super', lastName: 'Admin', email: 'super@test.com' },
    ]);

    const res = await request(app)
      .get(`/api/role-permissions/history/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.roleId).toBe(ROLE_ID);
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBe(1);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('totalPages');
  });

  test('200 — enrichit avec les infos de l\'admin qui a fait le changement', async () => {
    prisma.rolePermissionHistory.count.mockResolvedValue(1);
    prisma.rolePermissionHistory.findMany.mockResolvedValue([mockHistoryEntry]);
    prisma.user.findMany.mockResolvedValue([
      { id: ADMIN_ID, firstName: 'Super', lastName: 'Admin', email: 'super@test.com' },
    ]);

    const res = await request(app)
      .get(`/api/role-permissions/history/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    const entry = res.body.history[0];
    expect(entry.changedBy).toBeDefined();
    expect(entry.changedBy.firstName).toBe('Super');
  });

  test('200 — previousPermissions et newPermissions parsés en objet', async () => {
    prisma.rolePermissionHistory.count.mockResolvedValue(1);
    prisma.rolePermissionHistory.findMany.mockResolvedValue([mockHistoryEntry]);
    prisma.user.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/role-permissions/history/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    const entry = res.body.history[0];
    expect(typeof entry.previousPermissions).toBe('object');
    expect(typeof entry.newPermissions).toBe('object');
  });

  test('200 — pagination page=2, totalPages calculé', async () => {
    prisma.rolePermissionHistory.count.mockResolvedValue(100);
    prisma.rolePermissionHistory.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/role-permissions/history/${ROLE_ID}?page=2&limit=10`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.totalPages).toBe(10);
  });

  test('200 — page au-delà du total retourne history vide', async () => {
    prisma.rolePermissionHistory.count.mockResolvedValue(5);
    prisma.rolePermissionHistory.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/role-permissions/history/${ROLE_ID}?page=10&limit=50`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
  });

  test('200 — historique vide si aucun changement', async () => {
    prisma.rolePermissionHistory.count.mockResolvedValue(0);
    prisma.rolePermissionHistory.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/role-permissions/history/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .get(`/api/role-permissions/history/${ROLE_ID}`);

    expect(res.status).toBe(401);
  });

  test('403 — admin ordinaire refusé', async () => {
    const res = await request(app)
      .get(`/api/role-permissions/history/${ROLE_ID}`)
      .set('Authorization', `Bearer ${makeRegularAdminToken()}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/role-permissions/rollback/:roleId/:historyId ───────────────────

describe('POST /api/role-permissions/rollback/:roleId/:historyId', () => {
  const mockHistoryEntry = {
    id: HISTORY_ID,
    adminRoleTypeId: ROLE_ID,
    section: 'reviews',
    previousPermissions: '{"canCreate":false,"canRead":true,"canUpdate":false,"canDelete":false}',
    newPermissions: '{"canCreate":true,"canRead":true,"canUpdate":false,"canDelete":false}',
  };

  const currentPerm = {
    canCreate: true,
    canRead: true,
    canUpdate: false,
    canDelete: false,
  };

  test('200 — rollback vers une version précédente des permissions', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue(mockHistoryEntry);
    prisma.rolePermission.findUnique.mockResolvedValue(currentPerm);
    prisma.rolePermission.upsert.mockResolvedValue({});
    prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-rollback-1' });

    const res = await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/${HISTORY_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken(ADMIN_ID)}`)
      .send({ reason: 'Annulation du changement accidentel' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.roleId).toBe(ROLE_ID);
    expect(res.body.historyId).toBe(HISTORY_ID);
    expect(res.body).toHaveProperty('rolledBackAt');
    expect(res.body.rolledBackBy).toBe(ADMIN_ID);
    expect(res.body.reason).toBe('Annulation du changement accidentel');
  });

  test('200 — rollback sans raison fournie (body vide)', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue(mockHistoryEntry);
    prisma.rolePermission.findUnique.mockResolvedValue(currentPerm);
    prisma.rolePermission.upsert.mockResolvedValue({});
    prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-rollback-2' });

    const res = await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/${HISTORY_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('restoredPermissions');
    expect(typeof res.body.restoredPermissions).toBe('object');
  });

  test('200 — SECURITY_ADMIN peut effectuer un rollback', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue(mockHistoryEntry);
    prisma.rolePermission.findUnique.mockResolvedValue(currentPerm);
    prisma.rolePermission.upsert.mockResolvedValue({});
    prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-rollback-3' });

    const res = await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/${HISTORY_ID}`)
      .set('Authorization', `Bearer ${makeSecurityAdminToken()}`)
      .send({});

    expect(res.status).toBe(200);
  });

  test('200 — crée une entrée d\'historique avec action ROLLBACK', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue(mockHistoryEntry);
    prisma.rolePermission.findUnique.mockResolvedValue(currentPerm);
    prisma.rolePermission.upsert.mockResolvedValue({});
    prisma.rolePermissionHistory.create.mockResolvedValue({ id: 'hist-rollback-4' });

    await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/${HISTORY_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ reason: 'Rollback test' });

    expect(prisma.rolePermissionHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ROLLBACK' }),
      })
    );
  });

  test('200 — section du rollback correspond à la section de l\'entrée historique', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue(mockHistoryEntry);
    prisma.rolePermission.findUnique.mockResolvedValue(currentPerm);
    prisma.rolePermission.upsert.mockResolvedValue({});
    prisma.rolePermissionHistory.create.mockResolvedValue({});

    const res = await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/${HISTORY_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.section).toBe('reviews');
  });

  test('404 — entrée historique inexistante', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/hist-inexistant-999`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Entrée historique non trouvée/i);
  });

  test('400 — historyId n\'appartient pas au roleId fourni', async () => {
    prisma.rolePermissionHistory.findUnique.mockResolvedValue({
      ...mockHistoryEntry,
      adminRoleTypeId: 'autre-role-id',
    });

    const res = await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/${HISTORY_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/n'appartient pas/i);
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/${HISTORY_ID}`)
      .send({});

    expect(res.status).toBe(401);
  });

  test('403 — admin ordinaire refusé', async () => {
    const res = await request(app)
      .post(`/api/role-permissions/rollback/${ROLE_ID}/${HISTORY_ID}`)
      .set('Authorization', `Bearer ${makeRegularAdminToken()}`)
      .send({});

    expect(res.status).toBe(403);
  });
});
