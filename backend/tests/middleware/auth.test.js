/**
 * Comprehensive middleware/auth.js tests
 * Coverage target: 80%+
 *
 * Test suite includes:
 * - requireAuth() - Bearer token validation
 * - requireAdminAuth() - Cookie-based admin auth
 * - requireRole() - Role-based access control
 * - requirePermission() - Permission-based access control
 * - requireSuperAdmin() - Super admin check
 * - requireRoleAccess() - Role slug validation
 * - requireEmailVerified() - Email verification check
 * - optionalAuth() - Optional Bearer token validation
 * - Security edge cases and error handling
 */

const jwt = require('jsonwebtoken');

// Mock Prisma BEFORE importing middleware
jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}), { virtual: true });

// Mock logger
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}), { virtual: true });

const prisma = require('../../config/db');
const logger = require('../../utils/logger');
const {
  requireAuth,
  requireAdminAuth,
  requireRole,
  requirePermission,
  requireSuperAdmin,
  requireRoleAccess,
  requireEmailVerified,
  optionalAuth,
} = require('../../middleware/auth');

// Setup test utilities
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

/**
 * Generate a valid JWT token
 */
function generateToken(payload, options = {}) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '1d',
    ...options,
  });
}

/**
 * Generate an expired JWT token
 */
function generateExpiredToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '-1d' });
}

/**
 * Generate a token signed with wrong secret
 */
function generateTokenWrongSecret(payload) {
  return jwt.sign(payload, 'wrong-secret-key', { expiresIn: '1d' });
}

/**
 * Create mock Express req/res/next
 */
function createMockContext() {
  const req = {
    headers: {},
    cookies: {},
    user: null,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

// ────────────────────────────────────────────────────────────────────────────
// ═ REQUIRE AUTH TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - requireAuth()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe('✅ Valid authentication', () => {
    test('passes with valid Bearer token and existing user', async () => {
      const { req, res, next } = createMockContext();
      const userId = 'user-123';
      const token = generateToken({ id: userId });
      req.headers.authorization = `Bearer ${token}`;

      const mockUser = {
        id: userId,
        role: 'CLIENT',
        email: 'user@test.com',
        suspended: false,
        deletedAt: null,
        adminLevel: 'STANDARD',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: null },
      };
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({
        id: userId,
        role: 'CLIENT',
        email: 'user@test.com',
        adminLevel: 'STANDARD',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleSlug: null,
      });
    });

    test('sets req.user with all available fields', async () => {
      const { req, res, next } = createMockContext();
      const userId = 'admin-456';
      const token = generateToken({ id: userId });
      req.headers.authorization = `Bearer ${token}`;

      const mockUser = {
        id: userId,
        role: 'ADMIN',
        email: 'admin@test.com',
        suspended: false,
        deletedAt: null,
        adminLevel: 'SUPER',
        adminPermissions: '["section1","section2"]',
        adminRoleTypeId: 'role-789',
        adminRoleType: { slug: 'super-admin' },
      };
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await requireAuth(req, res, next);

      expect(req.user.adminLevel).toBe('SUPER');
      expect(req.user.adminRoleSlug).toBe('super-admin');
      expect(req.user.adminRoleTypeId).toBe('role-789');
    });
  });

  describe('❌ Missing authorization header', () => {
    test('rejects request without Authorization header', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = undefined;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects request with empty Authorization header', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = '';

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects request with malformed Authorization header (no Bearer prefix)', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'user-1' });
      req.headers.authorization = `Token ${token}`;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects request with missing token after Bearer', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = 'Bearer ';

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects request with only Bearer keyword', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = 'Bearer';

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('❌ Invalid or expired tokens', () => {
    test('rejects expired token', async () => {
      const { req, res, next } = createMockContext();
      const token = generateExpiredToken({ id: 'user-1' });
      req.headers.authorization = `Bearer ${token}`;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/invalide|expiré/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects token with wrong signature', async () => {
      const { req, res, next } = createMockContext();
      const token = generateTokenWrongSecret({ id: 'user-1' });
      req.headers.authorization = `Bearer ${token}`;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects completely invalid token', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = 'Bearer not-a-valid-token-at-all';

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects tampered token (modified payload)', async () => {
      const { req, res, next } = createMockContext();
      const validToken = generateToken({ id: 'user-1', role: 'CLIENT' });
      const [header, payload, signature] = validToken.split('.');
      const modifiedPayload = Buffer.from(
        JSON.stringify({ id: 'hacker-user', role: 'ADMIN' })
      ).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const tamperedToken = `${header}.${modifiedPayload}.${signature}`;
      req.headers.authorization = `Bearer ${tamperedToken}`;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('❌ User not found or deleted', () => {
    test('rejects when user not found in database', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'nonexistent-user' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue(null);

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/introuvable/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when user account is deleted (deletedAt set)', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'deleted-user' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue({
        id: 'deleted-user',
        role: 'CLIENT',
        email: 'deleted@test.com',
        suspended: false,
        deletedAt: new Date('2024-01-01'),
        adminLevel: 'STANDARD',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: null },
      });

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when user account is suspended', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'suspended-user' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue({
        id: 'suspended-user',
        role: 'CLIENT',
        email: 'suspended@test.com',
        suspended: true,
        deletedAt: null,
        adminLevel: 'STANDARD',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: null },
      });

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/suspendu/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('❌ Database errors', () => {
    test('rejects when JWT_SECRET is missing', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'user-1' });
      req.headers.authorization = `Bearer ${token}`;

      delete process.env.JWT_SECRET;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('handles database query errors gracefully', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'user-1' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockRejectedValue(new Error('DB Connection failed'));

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ═ REQUIRE ADMIN AUTH (COOKIE) TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - requireAdminAuth()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe('✅ Valid admin authentication', () => {
    test('passes with valid adminToken cookie', async () => {
      const { req, res, next } = createMockContext();
      const adminId = 'admin-123';
      const token = generateToken({ id: adminId });
      req.cookies.adminToken = token;

      prisma.user.findUnique.mockResolvedValue({
        id: adminId,
        role: 'ADMIN',
        email: 'admin@test.com',
        suspended: false,
        deletedAt: null,
        adminLevel: 'SUPER',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: 'super-admin' },
      });

      await requireAdminAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({
        id: adminId,
        role: 'ADMIN',
        email: 'admin@test.com',
        adminLevel: 'SUPER',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleSlug: 'super-admin',
      });
    });
  });

  describe('❌ Missing or invalid cookie', () => {
    test('rejects when adminToken cookie missing', async () => {
      const { req, res, next } = createMockContext();
      req.cookies = {};

      await requireAdminAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/authentifié/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when adminToken is undefined', async () => {
      const { req, res, next } = createMockContext();
      req.cookies.adminToken = undefined;

      await requireAdminAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects with expired token', async () => {
      const { req, res, next } = createMockContext();
      const expiredToken = generateExpiredToken({ id: 'admin-1' });
      req.cookies.adminToken = expiredToken;

      await requireAdminAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects with invalid token signature', async () => {
      const { req, res, next } = createMockContext();
      const invalidToken = generateTokenWrongSecret({ id: 'admin-1' });
      req.cookies.adminToken = invalidToken;

      await requireAdminAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('❌ User not found or suspended', () => {
    test('rejects when admin user not found', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'nonexistent-admin' });
      req.cookies.adminToken = token;

      prisma.user.findUnique.mockResolvedValue(null);

      await requireAdminAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/introuvable/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when admin is suspended', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'suspended-admin' });
      req.cookies.adminToken = token;

      prisma.user.findUnique.mockResolvedValue({
        id: 'suspended-admin',
        role: 'ADMIN',
        email: 'suspended@test.com',
        suspended: true,
        deletedAt: null,
        adminLevel: 'STANDARD',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: null },
      });

      await requireAdminAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/suspendu/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when admin is deleted', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'deleted-admin' });
      req.cookies.adminToken = token;

      prisma.user.findUnique.mockResolvedValue({
        id: 'deleted-admin',
        role: 'ADMIN',
        email: 'deleted@test.com',
        suspended: false,
        deletedAt: new Date('2024-01-01'),
        adminLevel: 'STANDARD',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: null },
      });

      await requireAdminAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ═ REQUIRE ROLE TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - requireRole()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('✅ Valid role-based access', () => {
    test('passes when user has required role', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1', role: 'ADMIN' };

      const middleware = requireRole('ADMIN');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes when user role matches one of multiple allowed roles', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-2', role: 'MODERATOR' };

      const middleware = requireRole('ADMIN', 'MODERATOR', 'SUPER');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes with multiple roles where first matches', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-3', role: 'ADMIN' };

      const middleware = requireRole('ADMIN', 'MODERATOR');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes with multiple roles where last matches', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-4', role: 'SUPER' };

      const middleware = requireRole('ADMIN', 'MODERATOR', 'SUPER');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('❌ Unauthorized access', () => {
    test('rejects when user has different role', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1', role: 'CLIENT' };

      const middleware = requireRole('ADMIN');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/refusé|rôle/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when user role not in allowed list', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1', role: 'CLIENT' };

      const middleware = requireRole('ADMIN', 'MODERATOR', 'SUPER');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when user is not authenticated (no req.user)', () => {
      const { req, res, next } = createMockContext();
      req.user = null;

      const middleware = requireRole('ADMIN');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when req.user exists but role is missing', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1' }; // no role property

      const middleware = requireRole('ADMIN');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('is case-sensitive for role comparison', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1', role: 'admin' }; // lowercase

      const middleware = requireRole('ADMIN'); // uppercase
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('✅ Edge cases', () => {
    test('passes with single role function', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1', role: 'ADMIN' };

      const middleware = requireRole('ADMIN');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes with many roles (5+)', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1', role: 'ROLE3' };

      const middleware = requireRole('ROLE1', 'ROLE2', 'ROLE3', 'ROLE4', 'ROLE5');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ═ REQUIRE PERMISSION TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - requirePermission()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('✅ Valid permissions', () => {
    test('passes when user has required permission', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '["users", "roles", "permissions"]',
      };

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes for SUPER admin regardless of permissions', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'super-admin',
        adminLevel: 'SUPER',
        adminPermissions: null, // null is fine for SUPER
      };

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes when permission exists in array', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '["dashboard", "reports", "export"]',
      };

      const middleware = requirePermission('export');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes for SUPER with any section', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'super-admin',
        adminLevel: 'SUPER',
        adminPermissions: '[]',
      };

      const middleware = requirePermission('hypothetical-section');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('❌ Access denied - invalid permissions', () => {
    test('rejects when user lacks permission', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '["roles", "permissions"]',
      };

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/autorisé|refusé/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when adminPermissions is null for non-SUPER', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: null,
      };

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/permission|super admin/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when adminPermissions is empty array', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '[]',
      };

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when permissions are in wrong case (case-sensitive)', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '["Users"]', // Capital U
      };

      const middleware = requirePermission('users'); // lowercase u
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('❌ Malformed permission data', () => {
    test('rejects when adminPermissions is not valid JSON', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: 'not-json-{invalid}',
      };

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/invalide|super admin/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when adminPermissions is not an array', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '{"users": true}', // object, not array
      };

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/format|invalide/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when adminPermissions is a string instead of JSON', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: 'users,roles,permissions', // CSV, not JSON
      };

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('❌ Unauthenticated access', () => {
    test('rejects when user is not authenticated', () => {
      const { req, res, next } = createMockContext();
      req.user = null;

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/authentifié/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when req.user is undefined', () => {
      const { req, res, next } = createMockContext();
      req.user = undefined;

      const middleware = requirePermission('users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('✅ Complex permission scenarios', () => {
    test('passes with multiple permissions including requested one', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '["dashboard","users","roles","export","reports","analytics"]',
      };

      const middleware = requirePermission('reports');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes with permission name containing hyphens', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '["user-management","role-admin"]',
      };

      const middleware = requirePermission('user-management');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes with permission name containing underscores', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'user-1',
        adminLevel: 'STANDARD',
        adminPermissions: '["user_management","role_admin"]',
      };

      const middleware = requirePermission('user_management');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ═ REQUIRE SUPER ADMIN TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - requireSuperAdmin()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('✅ Valid super admin access', () => {
    test('passes for SUPER admin', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'super-admin-1', adminLevel: 'SUPER' };

      requireSuperAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('❌ Insufficient permissions', () => {
    test('rejects STANDARD admin', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'admin-1', adminLevel: 'STANDARD' };

      requireSuperAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/super|réservé/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when adminLevel is lowercase', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'admin-1', adminLevel: 'super' }; // lowercase

      requireSuperAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when adminLevel is missing', () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'admin-1' }; // no adminLevel

      requireSuperAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when req.user is null (not authenticated)', () => {
      const { req, res, next } = createMockContext();
      req.user = null;

      requireSuperAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/authentifié/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ═ REQUIRE ROLE ACCESS TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - requireRoleAccess()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('✅ Valid role-based access', () => {
    test('passes for SUPER admin (always has access)', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'super-admin',
        adminLevel: 'SUPER',
        adminRoleSlug: 'super-admin',
      };

      const middleware = requireRoleAccess('editor', 'moderator');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes for STANDARD admin without role slug', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'admin-1',
        adminLevel: 'STANDARD',
        adminRoleSlug: null,
      };

      const middleware = requireRoleAccess('editor', 'moderator');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes when role slug matches allowed roles', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'role-admin-1',
        adminLevel: 'STANDARD',
        adminRoleSlug: 'editor',
      };

      const middleware = requireRoleAccess('editor', 'moderator');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes when role slug is last in allowed list', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'role-admin-1',
        adminLevel: 'STANDARD',
        adminRoleSlug: 'moderator',
      };

      const middleware = requireRoleAccess('admin', 'editor', 'moderator');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('passes with single allowed role', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'role-admin-1',
        adminLevel: 'STANDARD',
        adminRoleSlug: 'editor',
      };

      const middleware = requireRoleAccess('editor');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('❌ Access denied', () => {
    test('rejects role slug not in allowed list', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'role-admin-1',
        adminLevel: 'STANDARD',
        adminRoleSlug: 'viewer',
      };

      const middleware = requireRoleAccess('editor', 'moderator');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/refusé|rôle/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when role slug is case-sensitive mismatch', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'role-admin-1',
        adminLevel: 'STANDARD',
        adminRoleSlug: 'Editor', // Capital E
      };

      const middleware = requireRoleAccess('editor'); // lowercase e
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when user not authenticated', () => {
      const { req, res, next } = createMockContext();
      req.user = null;

      const middleware = requireRoleAccess('editor', 'moderator');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/authentifié/i) })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('✅ Edge cases', () => {
    test('passes with multiple allowed slugs', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'role-admin-1',
        adminLevel: 'STANDARD',
        adminRoleSlug: 'moderator',
      };

      const middleware = requireRoleAccess('admin', 'editor', 'moderator', 'viewer', 'analyst');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('handles role slugs with hyphens', () => {
      const { req, res, next } = createMockContext();
      req.user = {
        id: 'role-admin-1',
        adminLevel: 'STANDARD',
        adminRoleSlug: 'super-moderator',
      };

      const middleware = requireRoleAccess('super-moderator', 'admin-editor');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ═ REQUIRE EMAIL VERIFIED TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - requireEmailVerified()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('✅ Email verified', () => {
    test('passes when email is verified', async () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1' };

      prisma.user.findUnique.mockResolvedValue({
        emailVerified: true,
      });

      await requireEmailVerified(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('❌ Email not verified', () => {
    test('rejects when email is not verified', async () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1' };

      prisma.user.findUnique.mockResolvedValue({
        emailVerified: false,
      });

      await requireEmailVerified(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringMatching(/vérifier|email/i),
          code: 'EMAIL_NOT_VERIFIED',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when user not found', async () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'nonexistent' };

      prisma.user.findUnique.mockResolvedValue(null);

      await requireEmailVerified(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when emailVerified is null', async () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1' };

      prisma.user.findUnique.mockResolvedValue({
        emailVerified: null,
      });

      await requireEmailVerified(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when emailVerified is undefined', async () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1' };

      prisma.user.findUnique.mockResolvedValue({
        emailVerified: undefined,
      });

      await requireEmailVerified(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('❌ Database errors', () => {
    test('throws database query errors (no error handling)', async () => {
      const { req, res, next } = createMockContext();
      req.user = { id: 'user-1' };

      prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

      // The middleware doesn't have try-catch, so errors propagate to caller
      await expect(requireEmailVerified(req, res, next)).rejects.toThrow('DB error');
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ═ OPTIONAL AUTH TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - optionalAuth()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe('✅ Valid token provided', () => {
    test('sets req.user with valid token', async () => {
      const { req, res, next } = createMockContext();
      const userId = 'user-123';
      const token = generateToken({ id: userId });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        role: 'CLIENT',
        email: 'user@test.com',
        suspended: false,
        adminLevel: 'STANDARD',
      });

      await optionalAuth(req, res, next);

      expect(req.user).toEqual({
        id: userId,
        role: 'CLIENT',
        email: 'user@test.com',
        adminLevel: 'STANDARD',
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('continues even if user is suspended (skips suspended check)', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'user-1' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'CLIENT',
        email: 'user@test.com',
        suspended: true, // suspended
        adminLevel: 'STANDARD',
      });

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeNull(); // Not set because user is suspended
    });
  });

  describe('✅ No token provided (optional)', () => {
    test('continues without Authorization header', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = undefined;

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeNull();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('continues with empty Authorization header', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = '';

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeNull();
    });

    test('continues with non-Bearer Authorization', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = 'Basic user:pass';

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeNull();
    });
  });

  describe('❌ Invalid token (still continues)', () => {
    test('continues with expired token (logs error)', async () => {
      const { req, res, next } = createMockContext();
      const expiredToken = generateExpiredToken({ id: 'user-1' });
      req.headers.authorization = `Bearer ${expiredToken}`;

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/Optional auth|validation failed/i),
        expect.any(Object)
      );
      expect(req.user).toBeNull();
    });

    test('continues with invalid token signature', async () => {
      const { req, res, next } = createMockContext();
      const invalidToken = generateTokenWrongSecret({ id: 'user-1' });
      req.headers.authorization = `Bearer ${invalidToken}`;

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeNull();
    });

    test('continues with malformed token', async () => {
      const { req, res, next } = createMockContext();
      req.headers.authorization = 'Bearer not-a-token-at-all';

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeNull();
    });

    test('logs debug error on token validation failure', async () => {
      const { req, res, next } = createMockContext();
      const expiredToken = generateExpiredToken({ id: 'user-1' });
      req.headers.authorization = `Bearer ${expiredToken}`;

      await optionalAuth(req, res, next);

      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('❌ Database errors (still continues)', () => {
    test('continues when user not found in database', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'nonexistent' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue(null);

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeNull();
    });

    test('continues on database query error', async () => {
      const { req, res, next } = createMockContext();
      const token = generateToken({ id: 'user-1' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockRejectedValue(new Error('DB connection failed'));

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeNull();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ═ INTEGRATION & SECURITY TESTS ═
// ────────────────────────────────────────────────────────────────────────────

describe('middleware/auth.js - Integration & Security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe('🔒 Authorization escalation prevention', () => {
    test('prevents privilege escalation via token claim modification', async () => {
      const { req, res, next } = createMockContext();
      // Token claims SUPER, but DB has STANDARD
      const token = generateToken({ id: 'user-1', adminLevel: 'SUPER' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'CLIENT',
        email: 'user@test.com',
        suspended: false,
        deletedAt: null,
        adminLevel: 'STANDARD', // Real value from DB
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: null },
      });

      await requireAuth(req, res, next);

      // Should use DB value, not token claim
      expect(req.user.adminLevel).toBe('STANDARD');
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('rejects suspension flag change via token tampering', async () => {
      const { req, res, next } = createMockContext();
      // Token claims not suspended
      const token = generateToken({ id: 'user-1', suspended: false });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'CLIENT',
        email: 'user@test.com',
        suspended: true, // Real suspension from DB
        deletedAt: null,
        adminLevel: 'STANDARD',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: null },
      });

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects role escalation via token claim', async () => {
      const { req, res, next } = createMockContext();
      // Token claims ADMIN, but DB has CLIENT
      const token = generateToken({ id: 'user-1', role: 'ADMIN' });
      req.headers.authorization = `Bearer ${token}`;

      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        role: 'CLIENT', // Real role from DB
        email: 'user@test.com',
        suspended: false,
        deletedAt: null,
        adminLevel: 'STANDARD',
        adminPermissions: null,
        adminRoleTypeId: null,
        adminRoleType: { slug: null },
      });

      await requireAuth(req, res, next);

      expect(req.user.role).toBe('CLIENT'); // Uses DB value
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔒 Defense against JWT attacks', () => {
    test('rejects JWT with algorithm change attack (HS256 -> none)', async () => {
      const { req, res, next } = createMockContext();
      // Attempt: change algorithm to 'none'
      const fakeToken = 'eyJhbGciOiJub25lIn0.eyJpZCI6IjEyMyJ9.';
      req.headers.authorization = `Bearer ${fakeToken}`;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects JWT with modified payload', async () => {
      const { req, res, next } = createMockContext();
      const validToken = generateToken({ id: 'user-1', role: 'CLIENT' });
      const [header, payload, signature] = validToken.split('.');

      // Modify the role to ADMIN
      const modifiedPayload = Buffer.from(
        JSON.stringify({ id: 'user-1', role: 'ADMIN' })
      ).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

      const tamperedToken = `${header}.${modifiedPayload}.${signature}`;
      req.headers.authorization = `Bearer ${tamperedToken}`;

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('🔒 Concurrency & state isolation', () => {
    test('each request has isolated req.user state', async () => {
      const req1 = { headers: {}, cookies: {}, user: null };
      const res1 = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next1 = jest.fn();

      const req2 = { headers: {}, cookies: {}, user: null };
      const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next2 = jest.fn();

      const token1 = generateToken({ id: 'user-1' });
      const token2 = generateToken({ id: 'user-2' });
      req1.headers.authorization = `Bearer ${token1}`;
      req2.headers.authorization = `Bearer ${token2}`;

      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          role: 'CLIENT',
          email: 'user1@test.com',
          suspended: false,
          deletedAt: null,
          adminLevel: 'STANDARD',
          adminPermissions: null,
          adminRoleTypeId: null,
          adminRoleType: { slug: null },
        })
        .mockResolvedValueOnce({
          id: 'user-2',
          role: 'PROFESSIONAL',
          email: 'user2@test.com',
          suspended: false,
          deletedAt: null,
          adminLevel: 'STANDARD',
          adminPermissions: null,
          adminRoleTypeId: null,
          adminRoleType: { slug: null },
        });

      await requireAuth(req1, res1, next1);
      await requireAuth(req2, res2, next2);

      expect(req1.user.id).toBe('user-1');
      expect(req1.user.role).toBe('CLIENT');
      expect(req2.user.id).toBe('user-2');
      expect(req2.user.role).toBe('PROFESSIONAL');
      expect(next1).toHaveBeenCalledTimes(1);
      expect(next2).toHaveBeenCalledTimes(1);
    });
  });
});
