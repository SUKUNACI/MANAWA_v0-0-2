'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

/**
 * TwoFactor Module — TOTP setup, verification, backup codes, enable/disable
 */

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class TwoFactorModule {
  constructor(prisma) {
    this.prisma = prisma;
    // Lazily required so this module can be loaded without crashing if utils are missing
    this._twoFAUtils = null;
    this._twoFAConfig = null;
  }

  get twoFAUtils() {
    if (!this._twoFAUtils) this._twoFAUtils = require('../utils/2fa');
    return this._twoFAUtils;
  }

  get twoFAConfig() {
    if (!this._twoFAConfig) this._twoFAConfig = require('../config/2fa');
    return this._twoFAConfig;
  }

  // ---- Setup ----

  /**
   * Initiate 2FA setup — returns setupToken, QR code, and plain-text backup codes.
   */
  async setup(userId) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, twoFAEnabled: true },
    });

    if (!user) throw Object.assign(new Error('Utilisateur non trouvé'), { status: 404 });
    if (user.twoFAEnabled) {
      throw Object.assign(new Error("2FA est déjà activé. Désactivez-le d'abord."), { status: 400 });
    }

    const { secret, qrCode, backupCodes, hashedBackupCodes } = await this.twoFAUtils.setup2FA(user.email);

    // Embed secret + hashed backup codes in a short-lived JWT (10 min)
    const setupToken = jwt.sign(
      { userId, secret, hashedBackupCodes, type: '2fa_setup' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    return { setupToken, qrCode, backupCodes };
  }

  // ---- Enable ----

  /**
   * Confirm and persist 2FA after the user scans the QR code and submits a valid TOTP.
   */
  async enable(userId, setupToken, totpCode) {
    let decoded;
    try {
      decoded = jwt.verify(setupToken, process.env.JWT_SECRET);
    } catch {
      throw Object.assign(new Error('Token de configuration expiré ou invalide'), { status: 401 });
    }

    if (decoded.type !== '2fa_setup' || decoded.userId !== userId) {
      throw Object.assign(new Error('Token invalide'), { status: 403 });
    }

    if (!this.twoFAUtils.verify2FAToken(totpCode, decoded.secret)) {
      throw Object.assign(new Error('Code TOTP invalide'), { status: 401 });
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFASecret: decoded.secret,
        twoFAEnabled: true,
        twoFABackupCodes: decoded.hashedBackupCodes,
        twoFAEnabledAt: new Date(),
      },
      select: { id: true, email: true, twoFAEnabled: true, twoFAEnabledAt: true },
    });

    logger.info('[TwoFactorModule] 2FA enabled', { userId });
    return { user, backupCodesRemaining: this.twoFAConfig.BACKUP_CODES_CONFIG.count };
  }

  // ---- Verify (login second step) ----

  /**
   * Verify TOTP or backup code after a successful first-factor login.
   * Returns full access + refresh tokens on success.
   */
  async verify(userId, { totpCode, backupCode } = {}) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, role: true, adminLevel: true, adminPermissions: true,
        twoFAEnabled: true, twoFASecret: true, twoFABackupCodes: true,
      },
    });

    if (!user) throw Object.assign(new Error('Utilisateur non trouvé'), { status: 404 });
    if (!user.twoFAEnabled) throw Object.assign(new Error('2FA non activé pour cet utilisateur'), { status: 400 });

    if (!totpCode && !backupCode) {
      throw Object.assign(new Error('Code TOTP ou code de secours requis'), { status: 400 });
    }

    let verified = false;
    let usedBackupCode = false;

    if (totpCode) {
      verified = this.twoFAUtils.verify2FAToken(totpCode, user.twoFASecret);
    } else {
      verified = this.twoFAUtils.verifyBackupCode(backupCode, user.twoFABackupCodes);
      usedBackupCode = true;
    }

    if (!verified) throw Object.assign(new Error('Code invalide'), { status: 401 });

    if (usedBackupCode) {
      const updatedCodes = this.twoFAUtils.useBackupCode(backupCode, user.twoFABackupCodes);
      await this.prisma.user.update({ where: { id: userId }, data: { twoFABackupCodes: updatedCodes } });
      logger.warn('[TwoFactorModule] Backup code used', { userId });
    }

    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

    const accessToken = jwt.sign(
      { id: user.id, role: user.role, email: user.email, adminLevel: user.adminLevel || null, adminPermissions: user.adminPermissions || null },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshTokenValue = crypto.randomBytes(64).toString('hex');
    await this.prisma.refreshToken.create({
      data: { token: refreshTokenValue, userId: user.id, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });

    logger.info('[TwoFactorModule] 2FA verification successful', { userId });

    return {
      token: accessToken,
      refreshToken: refreshTokenValue,
      user: { id: user.id, email: user.email, role: user.role },
      backupCodesRemaining: this.twoFAUtils.getRemainingBackupCodes(user.twoFABackupCodes),
    };
  }

  // ---- Regenerate backup codes ----

  async regenerateBackupCodes(userId, totpCode) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, twoFAEnabled: true, twoFASecret: true },
    });

    if (!user || !user.twoFAEnabled) throw Object.assign(new Error('2FA non activé'), { status: 400 });

    if (!this.twoFAUtils.verify2FAToken(totpCode, user.twoFASecret)) {
      throw Object.assign(new Error('Code TOTP invalide'), { status: 401 });
    }

    const { backupCodes, hashedBackupCodes } = await this.twoFAUtils.regenerateBackupCodes();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFABackupCodes: hashedBackupCodes } });

    logger.info('[TwoFactorModule] Backup codes regenerated', { userId });
    return { backupCodes };
  }

  // ---- Disable ----

  async disable(userId, password, totpCode) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, twoFAEnabled: true, twoFASecret: true },
    });

    if (!user) throw Object.assign(new Error('Utilisateur non trouvé'), { status: 404 });
    if (!user.twoFAEnabled) throw Object.assign(new Error("2FA n'est pas activé"), { status: 400 });

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) throw Object.assign(new Error('Mot de passe incorrect'), { status: 401 });

    if (!this.twoFAUtils.verify2FAToken(totpCode, user.twoFASecret)) {
      throw Object.assign(new Error('Code TOTP invalide'), { status: 401 });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFAEnabled: false, twoFASecret: null, twoFABackupCodes: null, twoFAEnabledAt: null },
    });

    logger.info('[TwoFactorModule] 2FA disabled', { userId });
  }

  // ---- Status ----

  async getStatus(userId) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, twoFAEnabled: true, twoFAEnabledAt: true, twoFABackupCodes: true },
    });

    if (!user) throw Object.assign(new Error('Utilisateur non trouvé'), { status: 404 });

    return {
      enabled: user.twoFAEnabled,
      enabledAt: user.twoFAEnabledAt,
      backupCodesRemaining: user.twoFAEnabled
        ? this.twoFAUtils.getRemainingBackupCodes(user.twoFABackupCodes)
        : 0,
    };
  }
}

module.exports = TwoFactorModule;
