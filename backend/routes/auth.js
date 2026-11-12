const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { requireAuth, requireRole } = require('../middleware/auth');
const bruteForceMiddleware = require('../middleware/bruteForceMiddleware');
const bruteForceConfig = require('../config/brute-force');

const router = express.Router();

// Helper to log admin actions
async function writeAdminLog(req, action, targetType, targetId, metadata) {
  try {
    await prisma.adminLog.create({
      data: {
        adminId: req.user?.id || 'system',
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        ipAddress: req.ip || null,
      },
    });
  } catch (err) {
    logger.error('Failed to write admin log', { action, targetType, targetId, error: err.message });
  }
}

const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 jours en ms

function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, adminLevel: user.adminLevel || null, adminPermissions: user.adminPermissions || null },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

async function generateRefreshToken(userId) {
  const token = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL);
  await prisma.refreshToken.create({ data: { token, userId, expiresAt } });
  return token;
}

// Rate limit par IP (register + login)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes' },
});

// Rate limit par compte (login uniquement) — 5 échecs max avant blocage 1h
const accountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `account:${req.body?.email?.toLowerCase() || req.ip}`,
  skipSuccessfulRequests: true,
  message: { error: 'Trop de tentatives sur ce compte, réessayez dans 1 heure' },
});

// POST /api/auth/register
router.post(
  '/register',
  authLimiter,
  [
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    body('firstName').notEmpty().trim().matches(/^[^<>&"'/\\]+$/).withMessage('Prénom invalide'),
    body('lastName').notEmpty().trim().matches(/^[^<>&"'/\\]+$/).withMessage('Nom invalide'),
    body('role').isIn(['CLIENT', 'PROFESSIONAL']),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password, firstName, lastName, role, phone, city, trades, accountType, companyName } = req.body;

      if (!['CLIENT', 'PROFESSIONAL'].includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide. Valeurs acceptées : CLIENT, PROFESSIONAL' });
      }

      const tradesArray = Array.isArray(trades) && trades.length > 0 ? trades.slice(0, 3) : ['Non spécifié'];

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          phone,
          city,
          role,
          professional:
            role === 'PROFESSIONAL'
              ? { create: { trade: tradesArray[0], trades: tradesArray, accountType: accountType || 'INDEPENDENT', companyName: accountType === 'ENTREPRISE' ? companyName : undefined } }
              : undefined,
        },
        include: { professional: true },
      });

      const accessToken  = generateAccessToken(user);
      const refreshToken = await generateRefreshToken(user.id);

      const { passwordHash: _, ...userSafe } = user;
      res.status(201).json({ user: userSafe, token: accessToken, refreshToken });
    } catch (err) {
      logger.error('Register error', {
        email: req.body?.email,
        error: err.message,
        code: err.code,
        stack: err.stack,
      });
      const requestId = `req-${Date.now()}`;
      if (err.message.includes('Unique constraint')) {
        return res.status(409).json({
          error: 'Email already exists',
          code: 'EMAIL_EXISTS',
          requestId,
        });
      }
      res.status(500).json({
        error: 'Erreur interne du serveur',
        code: err.code || 'UNKNOWN_ERROR',
        requestId,
      });
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
  authLimiter,
  accountLimiter,
  bruteForceMiddleware.bruteForceCheckMiddleware(),
  [body('email').isEmail(), body('password').notEmpty()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password } = req.body;
      const emailLower = email.toLowerCase();
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent');

      // Use findFirst WITHOUT select to get all columns that exist
      const user = await prisma.user.findFirst({
        where: { email: emailLower },
      });
      if (!user) {
        // Failed attempt - track it
        const attemptCount = await bruteForceMiddleware.trackFailedLogin(emailLower);
        await bruteForceMiddleware.logLoginAttempt(null, emailLower, 'failed', ipAddress, userAgent, {
          reason: 'user_not_found',
        });

        // Check if max attempts exceeded
        if (attemptCount >= bruteForceConfig.maxAttempts) {
          await bruteForceMiddleware.lockAccount(emailLower);
          return res.status(401).json({ error: bruteForceConfig.messages.loginFailed });
        }

        const remaining = bruteForceConfig.maxAttempts - attemptCount;
        res.setHeader(bruteForceConfig.headers.attemptsRemaining, remaining);

        return res.status(401).json({
          error: bruteForceConfig.messages.loginFailed,
          attemptsRemaining: remaining,
        });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        // Failed attempt - track it
        const attemptCount = await bruteForceMiddleware.trackFailedLogin(emailLower);
        await bruteForceMiddleware.logLoginAttempt(user.id, emailLower, 'failed', ipAddress, userAgent, {
          reason: 'invalid_password',
        });

        // Check if max attempts exceeded
        if (attemptCount >= bruteForceConfig.maxAttempts) {
          await bruteForceMiddleware.lockAccount(emailLower);
          logger.error('[Login] Account locked due to max failed attempts', { email: emailLower });
          return res.status(401).json({ error: bruteForceConfig.messages.loginFailed });
        }

        const remaining = bruteForceConfig.maxAttempts - attemptCount;
        res.setHeader(bruteForceConfig.headers.attemptsRemaining, remaining);

        return res.status(401).json({
          error: bruteForceConfig.messages.loginFailed,
          attemptsRemaining: remaining,
        });
      }

      // Successful login - clear failed attempts and log success
      await bruteForceMiddleware.clearFailedAttempts(emailLower);
      await bruteForceMiddleware.logLoginAttempt(user.id, emailLower, 'success', ipAddress, userAgent);

      // Check if 2FA is enabled
      if (user.twoFAEnabled) {
        // Generate temporary token for 2FA verification (expires in 10 minutes)
        const twoFAToken = jwt.sign(
          { userId: user.id, type: '2fa_login' },
          process.env.JWT_SECRET,
          { expiresIn: '10m' }
        );

        const { passwordHash: _, ...userSafe } = user;
        return res.status(200).json({
          requiresTwoFA: true,
          twoFAToken,
          user: userSafe,
          message: 'Authentification à 2 facteurs requise',
        });
      }

      const accessToken  = generateAccessToken(user);
      const refreshToken = await generateRefreshToken(user.id);

      const { passwordHash: _, ...userSafe } = user;
      res.json({ user: userSafe, token: accessToken, refreshToken });
    } catch (err) {
      logger.error('Login error', {
        email: req.body?.email,
        error: err.message,
        code: err.code,
        stack: err.stack,
      });
      const requestId = `req-${Date.now()}`;
      res.status(500).json({
        error: 'Erreur interne du serveur',
        code: err.code || 'UNKNOWN_ERROR',
        requestId,
      });
    }
  }
);

// POST /api/auth/refresh — échange un refresh token contre un nouvel access token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken requis' });

    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await prisma.refreshToken.delete({ where: { id: stored.id } });
      return res.status(401).json({ error: 'Refresh token invalide ou expiré' });
    }

    if (stored.user.deletedAt) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      return res.status(401).json({ error: 'Compte supprimé' });
    }
    if (stored.user.suspended) {
      return res.status(403).json({ error: 'Compte suspendu' });
    }

    // Rotation : invalide l'ancien, génère un nouveau
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const newAccessToken  = generateAccessToken(stored.user);
    const newRefreshToken = await generateRefreshToken(stored.user.id);

    res.json({ token: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    logger.error('Refresh token error', {
      error: err.message,
      code: err.code,
      stack: err.stack,
    });
    const requestId = `req-${Date.now()}`;
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: err.code || 'UNKNOWN_ERROR',
      requestId,
    });
  }
});

// POST /api/auth/logout — révoque le refresh token
router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    res.clearCookie('adminToken');
    res.clearCookie('adminCsrf');
    res.json({ loggedOut: true });
  } catch (err) {
    logger.error('Logout error', {
      error: err.message,
      code: err.code,
    });
    const requestId = `req-${Date.now()}`;
    res.status(500).json({
      error: 'Erreur interne du serveur',
      code: err.code || 'UNKNOWN_ERROR',
      requestId,
    });
  }
});

// POST /api/auth/admin-session — pose un cookie httpOnly après login admin réussi
router.post('/admin-session', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token requis' });
  try {
    // Verify token was issued by this server (not forged)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé' });

    // CRITICAL: Verify token came from refresh mechanism (not directly created)
    // Check token expiry is reasonable (issued recently)
    const issuedAt = decoded.iat ? new Date(decoded.iat * 1000) : null;
    const now = new Date();
    if (!issuedAt || (now - issuedAt) > 1 * 60 * 60 * 1000) { // Token older than 1 hour is suspicious
      return res.status(401).json({ error: 'Token invalide ou trop ancien' });
    }

    // Fetch user data - verify account is still valid and not suspended
    const user = await prisma.user.findFirst({
      where: { id: decoded.id },
    });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (user.suspended) return res.status(403).json({ error: 'Compte suspendu' });

    // Try to update lastLoginAt but ignore errors
    try {
      await prisma.user.update({ where: { id: decoded.id }, data: { lastLoginAt: new Date() } });
    } catch (err) {
      logger.warn('Could not update lastLoginAt', { error: err.message });
    }

    const csrfToken = crypto.randomBytes(32).toString('hex');
    const secure = process.env.NODE_ENV === 'production';
    if (!secure) {
      logger.warn('[Admin] Running in development mode - cookies are not secure. Enable HTTPS for production.');
    }
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });
    res.cookie('adminCsrf', csrfToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });
    res.json({ user, token, csrfToken });
  } catch (err) {
    logger.error('Admin session error', { error: err.message });
    res.status(401).json({ error: 'Token invalide' });
  }
});

// GET /api/auth/admin-session — vérifie la session admin actuelle depuis le cookie
router.get('/admin-session', async (req, res) => {
  const token = req.cookies?.adminToken;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé' });

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, adminLevel: true, adminPermissions: true },
    });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    res.json({ user, token });
  } catch (err) {
    logger.error('Session verification failed', { error: err.message, stack: err.stack, ip: req.ip });
    res.status(401).json({ error: 'Session expirée' });
  }
});

// POST /api/auth/admin-renew — renouvelle le cookie adminToken depuis le cookie actuel
// Appelé silencieusement par le back-office toutes les 10 min pour éviter l'expiration
router.post('/admin-renew', async (req, res) => {
  const token = req.cookies?.adminToken;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé' });

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, role: true, email: true, suspended: true, adminLevel: true, adminPermissions: true },
    });
    if (!user || user.suspended) return res.status(403).json({ error: 'Accès refusé' });

    const newToken = generateAccessToken(user);
    const newCsrf = crypto.randomBytes(32).toString('hex');
    // ERROR #3: Always require secure flag
    const secure = process.env.NODE_ENV === 'production';
    res.cookie('adminToken', newToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });
    res.cookie('adminCsrf', newCsrf, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });
    res.json({ token: newToken, csrfToken: newCsrf });
  } catch (err) {
    logger.error('Admin session renewal error', { error: err.message });
    res.status(401).json({ error: 'Session expirée' });
  }
});

// DEBUG: Check which columns exist in User table
router.get('/debug/check-columns', async (req, res) => {
  try {
    // Try to fetch user with all expected columns
    const testCols = {
      id: true,
      email: true,
      passwordHash: true,
      firstName: true,
      lastName: true,
      role: true,
      emailVerified: true,
      suspended: true,
      adminLevel: true,
      deletedAt: true,
      lastLoginAt: true,
    };

    const user = await prisma.user.findFirst({
      select: testCols,
    });

    res.json({ ok: true, found: !!user, columns: Object.keys(testCols) });
  } catch (err) {
    // Analyze error to see which column is missing
    const match = err.message.match(/column "(.*)" does not exist/);
    const missingColumn = match ? match[1] : 'unknown';
    res.json({ ok: false, error: missingColumn, message: err.message.substring(0, 100) });
  }
});

// TEMPORARY: Create admin user if missing (ADMIN + SUPER_ADMIN check required)
router.post('/setup-admin', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    // Verify the request is from a SUPER_ADMIN only
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { adminLevel: true },
    });

    if (user?.adminLevel !== 'SUPER') {
      return res.status(403).json({ error: 'Accès refusé. Réservé au super administrateur.' });
    }

    // Require explicit SUPER_ADMIN password from env
    const { superAdminSecret } = req.body;
    if (!superAdminSecret || superAdminSecret !== process.env.SUPER_ADMIN_SETUP_SECRET) {
      return res.status(403).json({ error: 'Secret super admin requis pour cette opération sensible' });
    }

    const adminEmail = 'app_manawa@proton.me';
    const password = '9ECE!f7305969@7DD86E';
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await prisma.$executeRaw`
      INSERT INTO "User" (id, email, "passwordHash", "firstName", "lastName", role, "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${adminEmail}, ${passwordHash}, ${'Admin'}, ${'MANAWA'}, 'ADMIN'::"UserRole", NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE email = ${adminEmail})
    `;

    await writeAdminLog(req, 'SETUP_ADMIN', 'User', 'SYSTEM', { result });
    res.json({ ok: true, message: `Admin setup complete (${result} row affected)` });
  } catch (err) {
    logger.error('Setup admin error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/unlock — Admin unlock account (requires verification)
router.post('/unlock', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { email, reason } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }

    const emailLower = email.toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: emailLower },
      select: { id: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Clear lockout and failed attempts
    await bruteForceMiddleware.clearLockout(emailLower);
    await bruteForceMiddleware.clearFailedAttempts(emailLower);

    // Log this action
    await writeAdminLog(req, 'ACCOUNT_UNLOCK', 'User', user.id, {
      email: emailLower,
      reason: reason || 'manual_unlock',
    });

    logger.info('[Admin] Account unlocked', { email: emailLower, adminId: req.user.id });

    res.json({
      ok: true,
      message: `Compte déverrouillé pour ${emailLower}`,
      email: emailLower,
    });
  } catch (err) {
    logger.error('Unlock account error', {
      email: req.body?.email,
      error: err.message,
    });
    res.status(500).json({
      error: 'Erreur lors du déverrouillage du compte',
      code: err.code || 'UNKNOWN_ERROR',
    });
  }
});

// GET /api/auth/login-history — View own login history
router.get('/login-history', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const history = await bruteForceMiddleware.getLoginHistory(req.user.id, limit);

    res.json({
      ok: true,
      attempts: history,
      count: history.length,
    });
  } catch (err) {
    logger.error('Get login history error', {
      userId: req.user.id,
      error: err.message,
    });
    res.status(500).json({
      error: 'Erreur lors de la récupération de l\'historique',
      code: err.code || 'UNKNOWN_ERROR',
    });
  }
});

// GET /api/admin/user/:id/security — Admin view security status
router.get('/admin/user/:id/security', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        lastLoginAt: true,
        suspended: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Get attempt counts and lockout status
    const attemptCount = await bruteForceMiddleware.getAttemptCount(user.email);
    const lockoutStatus = await bruteForceMiddleware.checkLockout(user.email);
    const loginHistory = await bruteForceMiddleware.getLoginHistory(id, 10);

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        lastLoginAt: user.lastLoginAt,
        suspended: user.suspended,
      },
      security: {
        failedAttempts: attemptCount,
        isLocked: lockoutStatus.isLocked,
        lockoutRemaining: lockoutStatus.remainingSeconds || 0,
        maxAttempts: bruteForceConfig.maxAttempts,
        lockoutDuration: bruteForceConfig.lockoutDurationSeconds,
      },
      recentAttempts: loginHistory.slice(0, 10),
    });
  } catch (err) {
    logger.error('Get security status error', {
      userId: req.params.id,
      error: err.message,
    });
    res.status(500).json({
      error: 'Erreur lors de la récupération du statut de sécurité',
      code: err.code || 'UNKNOWN_ERROR',
    });
  }
});

module.exports = router;
