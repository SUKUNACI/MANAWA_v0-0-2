'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Auth Module — Registration, login, token management, admin sessions
 */

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class AuthModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // ---- Token helpers ----

  generateAccessToken(user) {
    return jwt.sign(
      {
        id: user.id,
        role: user.role,
        email: user.email,
        adminLevel: user.adminLevel || null,
        adminPermissions: user.adminPermissions || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    );
  }

  async generateRefreshToken(userId) {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.prisma.refreshToken.create({ data: { token, userId, expiresAt } });
    return token;
  }

  // ---- Registration ----

  async register({ email, password, firstName, lastName, role, phone, city, trades, accountType, companyName }) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw Object.assign(new Error('Cet email est déjà utilisé'), { status: 409, code: 'EMAIL_EXISTS' });

    const tradesArray = Array.isArray(trades) && trades.length > 0 ? trades.slice(0, 3) : ['Non spécifié'];
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
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
            ? {
                create: {
                  trade: tradesArray[0],
                  trades: tradesArray,
                  accountType: accountType || 'INDEPENDENT',
                  companyName: accountType === 'ENTREPRISE' ? companyName : undefined,
                },
              }
            : undefined,
      },
      include: { professional: true },
    });

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);
    const { passwordHash: _, ...userSafe } = user;

    logger.info('[AuthModule] User registered', { userId: user.id, role });
    return { user: userSafe, token: accessToken, refreshToken };
  }

  // ---- Login ----

  /**
   * Verify credentials and determine next step (2FA or full tokens).
   * Brute-force tracking is handled in the route layer (middleware).
   */
  async login(email, password) {
    const emailLower = email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: emailLower } });

    if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404, code: 'USER_NOT_FOUND' });
    if (user.deletedAt) throw Object.assign(new Error('Compte supprimé'), { status: 403, code: 'ACCOUNT_DELETED' });
    if (user.suspended) throw Object.assign(new Error('Compte suspendu'), { status: 403, code: 'ACCOUNT_SUSPENDED' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw Object.assign(new Error('Mot de passe incorrect'), { status: 401, code: 'INVALID_PASSWORD' });

    // 2FA required — return a short-lived token for the second step
    if (user.twoFAEnabled) {
      const twoFAToken = jwt.sign(
        { userId: user.id, type: '2fa_login' },
        process.env.JWT_SECRET,
        { expiresIn: '10m' }
      );
      const { passwordHash: _, ...userSafe } = user;
      return { requiresTwoFA: true, twoFAToken, user: userSafe };
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);
    const { passwordHash: _, ...userSafe } = user;

    return { user: userSafe, token: accessToken, refreshToken };
  }

  // ---- Refresh ----

  async refresh(refreshToken) {
    if (!refreshToken) throw Object.assign(new Error('refreshToken requis'), { status: 400 });

    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw Object.assign(new Error('Refresh token invalide ou expiré'), { status: 401 });
    }

    if (stored.user.deletedAt) {
      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw Object.assign(new Error('Compte supprimé'), { status: 401 });
    }

    if (stored.user.suspended) {
      throw Object.assign(new Error('Compte suspendu'), { status: 403 });
    }

    // Token rotation
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    const newAccessToken = this.generateAccessToken(stored.user);
    const newRefreshToken = await this.generateRefreshToken(stored.user.id);

    return { token: newAccessToken, refreshToken: newRefreshToken };
  }

  // ---- Logout ----

  async logout(refreshToken) {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
  }

  // ---- Admin session (cookie-based) ----

  async createAdminSession(token) {
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw Object.assign(new Error('Token invalide'), { status: 401 });
    }

    if (decoded.role !== 'ADMIN') throw Object.assign(new Error('Accès refusé'), { status: 403 });

    const issuedAt = decoded.iat ? new Date(decoded.iat * 1000) : null;
    if (!issuedAt || (Date.now() - issuedAt) > 60 * 60 * 1000) {
      throw Object.assign(new Error('Token invalide ou trop ancien'), { status: 401 });
    }

    const user = await this.prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) throw Object.assign(new Error('Utilisateur non trouvé'), { status: 404 });
    if (user.deletedAt) throw Object.assign(new Error('Compte supprimé'), { status: 403 });
    if (user.suspended) throw Object.assign(new Error('Compte suspendu'), { status: 403 });
    if (user.role !== 'ADMIN') throw Object.assign(new Error('Accès refusé — rôle insuffisant'), { status: 403 });

    if (decoded.adminLevel === 'SUPER' && user.adminLevel !== 'SUPER') {
      throw Object.assign(new Error('Accès refusé — niveau administrateur insuffisant'), { status: 403 });
    }

    try {
      await this.prisma.user.update({ where: { id: decoded.id }, data: { lastLoginAt: new Date() } });
    } catch (err) {
      logger.warn('[AuthModule] Could not update lastLoginAt', { error: err.message });
    }

    const csrfToken = crypto.randomBytes(32).toString('hex');
    return { user, token, csrfToken };
  }

  async verifyAdminSession(token) {
    if (!token) throw Object.assign(new Error('Non authentifié'), { status: 401 });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw Object.assign(new Error('Session expirée'), { status: 401 });
    }

    if (decoded.role !== 'ADMIN') throw Object.assign(new Error('Accès refusé'), { status: 403 });

    const user = await this.prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, adminLevel: true, adminPermissions: true, suspended: true, deletedAt: true },
    });

    if (!user || user.deletedAt) throw Object.assign(new Error('Utilisateur introuvable'), { status: 401 });
    if (user.suspended) throw Object.assign(new Error('Compte suspendu'), { status: 403 });

    return { user, token };
  }

  async renewAdminSession(token) {
    if (!token) throw Object.assign(new Error('Non authentifié'), { status: 401 });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw Object.assign(new Error('Session expirée'), { status: 401 });
    }

    if (decoded.role !== 'ADMIN') throw Object.assign(new Error('Accès refusé'), { status: 403 });

    const user = await this.prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, role: true, email: true, suspended: true, adminLevel: true, adminPermissions: true },
    });

    if (!user || user.suspended) throw Object.assign(new Error('Accès refusé'), { status: 403 });

    const newToken = this.generateAccessToken(user);
    const csrfToken = crypto.randomBytes(32).toString('hex');
    return { token: newToken, csrfToken };
  }

  // ---- Account unlock (admin action) ----

  async unlockAccount(email, bruteForceMiddleware) {
    const emailLower = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: emailLower },
      select: { id: true, email: true },
    });
    if (!user) throw Object.assign(new Error('Utilisateur non trouvé'), { status: 404 });

    await bruteForceMiddleware.clearLockout(emailLower);
    await bruteForceMiddleware.clearFailedAttempts(emailLower);

    logger.info('[AuthModule] Account unlocked', { email: emailLower });
    return { email: emailLower };
  }
}

module.exports = AuthModule;
