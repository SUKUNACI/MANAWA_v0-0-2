/**
 * Auth Routes
 * HTTP layer only — business logic delegated to AuthModule.
 */

const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { requireAuth, requireRole } = require('../middleware/auth');
const bruteForceMiddleware = require('../middleware/bruteForceMiddleware');
const bruteForceConfig = require('../config/brute-force');
const AuthModule = require('../modules/auth');

const router = express.Router();
const auth = new AuthModule(prisma);

// Rate limit per IP (register + login)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes' },
});

// Rate limit per account (login only) — 5 failures max before 1h block
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
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { role } = req.body;
      if (!['CLIENT', 'PROFESSIONAL'].includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide. Valeurs acceptées : CLIENT, PROFESSIONAL' });
      }

      const result = await auth.register(req.body);
      res.status(201).json(result);
    } catch (err) {
      logger.error('Register error', { email: req.body?.email, error: err.message, code: err.code, stack: err.stack });
      const requestId = `req-${Date.now()}`;
      if (err.status === 409 || err.message.includes('Unique constraint')) {
        return res.status(409).json({ error: err.message || 'Cet email est déjà utilisé', code: 'EMAIL_EXISTS', requestId });
      }
      res.status(500).json({ error: 'Erreur interne du serveur', code: err.code || 'UNKNOWN_ERROR', requestId });
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
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password } = req.body;
      const emailLower = email.toLowerCase();
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('user-agent');

      let result;
      try {
        result = await auth.login(emailLower, password);
      } catch (err) {
        const code = err.code;

        if (code === 'USER_NOT_FOUND' || code === 'INVALID_PASSWORD') {
          const attemptCount = await bruteForceMiddleware.trackFailedLogin(emailLower);
          await bruteForceMiddleware.logLoginAttempt(null, emailLower, 'failed', ipAddress, userAgent, {
            reason: code === 'USER_NOT_FOUND' ? 'user_not_found' : 'invalid_password',
          });

          if (attemptCount >= bruteForceConfig.maxAttempts) {
            await bruteForceMiddleware.lockAccount(emailLower);
            return res.status(401).json({ error: bruteForceConfig.messages.loginFailed });
          }

          const remaining = bruteForceConfig.maxAttempts - attemptCount;
          res.setHeader(bruteForceConfig.headers.attemptsRemaining, remaining);
          return res.status(401).json({ error: bruteForceConfig.messages.loginFailed, attemptsRemaining: remaining });
        }

        if (code === 'ACCOUNT_DELETED') return res.status(403).json({ error: 'Compte supprimé' });
        if (code === 'ACCOUNT_SUSPENDED') return res.status(403).json({ error: 'Compte suspendu' });

        throw err;
      }

      // Successful login — clear brute-force state
      await bruteForceMiddleware.clearFailedAttempts(emailLower);
      await bruteForceMiddleware.logLoginAttempt(result.user.id, emailLower, 'success', ipAddress, userAgent);

      if (result.requiresTwoFA) {
        return res.status(200).json({
          requiresTwoFA: true,
          twoFAToken: result.twoFAToken,
          user: result.user,
          message: 'Authentification à 2 facteurs requise',
        });
      }

      res.json(result);
    } catch (err) {
      logger.error('Login error', { email: req.body?.email, error: err.message, code: err.code, stack: err.stack });
      const requestId = `req-${Date.now()}`;
      res.status(500).json({ error: 'Erreur interne du serveur', code: err.code || 'UNKNOWN_ERROR', requestId });
    }
  }
);

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const result = await auth.refresh(req.body.refreshToken);
    res.json(result);
  } catch (err) {
    logger.error('Refresh token error', { error: err.message, code: err.code, stack: err.stack });
    const requestId = `req-${Date.now()}`;
    if (err.status && err.status < 500) {
      return res.status(err.status).json({ error: err.message, requestId });
    }
    res.status(500).json({ error: 'Erreur interne du serveur', code: err.code || 'UNKNOWN_ERROR', requestId });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    await auth.logout(req.body.refreshToken);
    res.clearCookie('adminToken');
    res.clearCookie('adminCsrf');
    res.json({ loggedOut: true });
  } catch (err) {
    logger.error('Logout error', { error: err.message, code: err.code });
    const requestId = `req-${Date.now()}`;
    res.status(500).json({ error: 'Erreur interne du serveur', code: err.code || 'UNKNOWN_ERROR', requestId });
  }
});

// POST /api/auth/admin-session
router.post('/admin-session', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token requis' });
  try {
    const { user, token: tok, csrfToken } = await auth.createAdminSession(token);
    const secure = process.env.NODE_ENV === 'production';
    if (!secure) {
      logger.warn('[Admin] Running in development mode - cookies are not secure. Enable HTTPS for production.');
    }
    res.cookie('adminToken', tok, { httpOnly: true, secure, sameSite: 'strict', maxAge: 15 * 60 * 1000 });
    res.cookie('adminCsrf', csrfToken, { httpOnly: true, secure, sameSite: 'strict', maxAge: 15 * 60 * 1000 });
    res.json({ user, token: tok, csrfToken });
  } catch (err) {
    logger.error('Admin session error', { error: err.message });
    res.status(err.status || 401).json({ error: err.message || 'Token invalide' });
  }
});

// GET /api/auth/admin-session
router.get('/admin-session', async (req, res) => {
  const token = req.cookies?.adminToken;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const result = await auth.verifyAdminSession(token);
    res.json(result);
  } catch (err) {
    logger.error('Session verification failed', { error: err.message, stack: err.stack, ip: req.ip });
    res.status(err.status || 401).json({ error: err.message || 'Session expirée' });
  }
});

// POST /api/auth/admin-renew
router.post('/admin-renew', async (req, res) => {
  const token = req.cookies?.adminToken;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const { token: newToken, csrfToken } = await auth.renewAdminSession(token);
    res.cookie('adminToken', newToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 15 * 60 * 1000 });
    res.cookie('adminCsrf', csrfToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 15 * 60 * 1000 });
    res.json({ token: newToken, csrfToken });
  } catch (err) {
    logger.error('Admin session renewal error', { error: err.message });
    res.status(err.status || 401).json({ error: err.message || 'Session expirée' });
  }
});

// DEBUG: Check which columns exist in User table
router.get('/debug/check-columns', async (req, res) => {
  try {
    const testCols = {
      id: true, email: true, passwordHash: true, firstName: true, lastName: true,
      role: true, emailVerified: true, suspended: true, adminLevel: true, deletedAt: true, lastLoginAt: true,
    };
    const user = await prisma.user.findFirst({ select: testCols });
    res.json({ ok: true, found: !!user, columns: Object.keys(testCols) });
  } catch (err) {
    const match = err.message.match(/column "(.*)" does not exist/);
    const missingColumn = match ? match[1] : 'unknown';
    res.json({ ok: false, error: missingColumn, message: err.message.substring(0, 100) });
  }
});

// POST /api/auth/setup-admin
router.post('/setup-admin', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { adminLevel: true } });
    if (user?.adminLevel !== 'SUPER') {
      return res.status(403).json({ error: 'Accès refusé. Réservé au super administrateur.' });
    }

    const { superAdminSecret } = req.body;
    if (!superAdminSecret || superAdminSecret !== process.env.SUPER_ADMIN_SETUP_SECRET) {
      return res.status(403).json({ error: 'Secret super admin requis pour cette opération sensible' });
    }

    const bcrypt = require('bcryptjs');
    const adminEmail = 'app_manawa@proton.me';
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!password) return res.status(500).json({ error: 'INITIAL_ADMIN_PASSWORD env var not set' });
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await prisma.$executeRaw`
      INSERT INTO "User" (id, email, "passwordHash", "firstName", "lastName", role, "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ${adminEmail}, ${passwordHash}, ${'Admin'}, ${'MANAWA'}, 'ADMIN'::"UserRole", NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE email = ${adminEmail})
    `;

    res.json({ ok: true, message: `Admin setup complete (${result} row affected)` });
  } catch (err) {
    logger.error('Setup admin error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/unlock
router.post('/unlock', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { email, reason } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    const { email: unlockedEmail } = await auth.unlockAccount(email, bruteForceMiddleware);

    logger.info('[Admin] Account unlocked', { email: unlockedEmail, adminId: req.user.id });
    res.json({ ok: true, message: `Compte déverrouillé pour ${unlockedEmail}`, email: unlockedEmail });
  } catch (err) {
    logger.error('Unlock account error', { email: req.body?.email, error: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur lors du déverrouillage du compte', code: err.code || 'UNKNOWN_ERROR' });
  }
});

// GET /api/auth/login-history
router.get('/login-history', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const history = await bruteForceMiddleware.getLoginHistory(req.user.id, limit);
    res.json({ ok: true, attempts: history, count: history.length });
  } catch (err) {
    logger.error('Get login history error', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: "Erreur lors de la récupération de l'historique", code: err.code || 'UNKNOWN_ERROR' });
  }
});

// GET /api/auth/admin/user/:id/security
router.get('/admin/user/:id/security', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, lastLoginAt: true, suspended: true },
    });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const [attemptCount, lockoutStatus, loginHistory] = await Promise.all([
      bruteForceMiddleware.getAttemptCount(user.email),
      bruteForceMiddleware.checkLockout(user.email),
      bruteForceMiddleware.getLoginHistory(req.params.id, 10),
    ]);

    res.json({
      ok: true,
      user: { id: user.id, email: user.email, lastLoginAt: user.lastLoginAt, suspended: user.suspended },
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
    logger.error('Get security status error', { userId: req.params.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération du statut de sécurité', code: err.code || 'UNKNOWN_ERROR' });
  }
});

module.exports = router;
module.exports.accountLimiter = accountLimiter;
