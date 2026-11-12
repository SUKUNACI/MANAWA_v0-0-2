/**
 * 2FA (TOTP) Authentication Routes
 * Handles setup, verification, and management of two-factor authentication
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const twoFAUtils = require('../utils/2fa');
const twoFAConfig = require('../config/2fa');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/v1/auth/2fa/setup
 * Initiate 2FA setup for a user
 * Returns secret, QR code, and backup codes for the user to scan/save
 */
router.post('/setup', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, twoFAEnabled: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // If already enabled, must disable first
    if (user.twoFAEnabled) {
      return res.status(400).json({ error: '2FA est déjà activé. Désactivez-le d\'abord.' });
    }

    // Setup 2FA
    const { secret, qrCode, backupCodes, hashedBackupCodes } = await twoFAUtils.setup2FA(
      user.email
    );

    // Store temporary 2FA secret (not enabled yet)
    // Create a temporary token that expires in 10 minutes
    const setupToken = jwt.sign(
      {
        userId,
        secret,
        hashedBackupCodes,
        type: '2fa_setup',
      },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    res.json({
      setupToken,
      qrCode,
      backupCodes,
      message: 'Scannez le code QR avec une application d\'authentification (Google Authenticator, Authy, Microsoft Authenticator, etc.)',
    });
  } catch (error) {
    logger.error('Error in 2FA setup', { userId: req.user?.id, error: error.message });
    res.status(500).json({
      error: 'Erreur lors de la configuration 2FA',
      code: 'SETUP_ERROR',
    });
  }
});

/**
 * POST /api/v1/auth/2fa/enable
 * Enable 2FA after verifying the setup token and TOTP code
 */
router.post(
  '/enable',
  requireAuth,
  [body('setupToken').notEmpty().trim(), body('totpCode').notEmpty().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { setupToken, totpCode } = req.body;
      const userId = req.user.id;

      // Verify setup token
      let decoded;
      try {
        decoded = jwt.verify(setupToken, process.env.JWT_SECRET);
      } catch (error) {
        return res.status(401).json({ error: 'Token de configuration expiré ou invalide' });
      }

      if (decoded.type !== '2fa_setup' || decoded.userId !== userId) {
        return res.status(403).json({ error: 'Token invalide' });
      }

      // Verify TOTP code with the secret from setup token
      const isValid = twoFAUtils.verify2FAToken(totpCode, decoded.secret);
      if (!isValid) {
        return res.status(401).json({ error: 'Code TOTP invalide' });
      }

      // Update user to enable 2FA
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          twoFASecret: decoded.secret,
          twoFAEnabled: true,
          twoFABackupCodes: decoded.hashedBackupCodes,
          twoFAEnabledAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          twoFAEnabled: true,
          twoFAEnabledAt: true,
        },
      });

      // Log the action
      logger.info('2FA enabled for user', { userId });

      res.status(201).json({
        message: '2FA activé avec succès',
        user,
        backupCodesRemaining: twoFAConfig.BACKUP_CODES_CONFIG.count,
      });
    } catch (error) {
      logger.error('Error enabling 2FA', { userId: req.user?.id, error: error.message });
      res.status(500).json({
        error: 'Erreur lors de l\'activation de 2FA',
        code: 'ENABLE_ERROR',
      });
    }
  }
);

/**
 * POST /api/v1/auth/2fa/verify
 * Verify TOTP code during login (second authentication factor)
 * Body: { userId, totpCode or backupCode }
 */
router.post(
  '/verify',
  [
    body('userId').notEmpty().isUUID(),
    body('totpCode')
      .optional()
      .trim()
      .matches(/^\d{6}$/),
    body('backupCode').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId, totpCode, backupCode } = req.body;

      // Fetch user with 2FA secret
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          adminLevel: true,
          adminPermissions: true,
          twoFAEnabled: true,
          twoFASecret: true,
          twoFABackupCodes: true,
        },
      });

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      if (!user.twoFAEnabled) {
        return res.status(400).json({ error: '2FA non activé pour cet utilisateur' });
      }

      let verified = false;
      let usedBackupCode = false;

      // Try TOTP code first
      if (totpCode) {
        verified = twoFAUtils.verify2FAToken(totpCode, user.twoFASecret);
      } else if (backupCode) {
        // Try backup code
        verified = twoFAUtils.verifyBackupCode(backupCode, user.twoFABackupCodes);
        usedBackupCode = true;
      } else {
        return res.status(400).json({ error: 'Code TOTP ou code de secours requis' });
      }

      if (!verified) {
        return res.status(401).json({ error: 'Code invalide' });
      }

      // If backup code was used, mark it as used
      if (usedBackupCode) {
        const updatedBackupCodes = twoFAUtils.useBackupCode(backupCode, user.twoFABackupCodes);
        await prisma.user.update({
          where: { id: userId },
          data: { twoFABackupCodes: updatedBackupCodes },
        });

        logger.warn('Backup code used for 2FA', { userId });
      }

      // Update last login
      await prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });

      // Generate new tokens
      const accessToken = jwt.sign(
        {
          id: user.id,
          role: user.role,
          email: user.email,
          adminLevel: user.adminLevel || null,
          adminPermissions: user.adminPermissions || null,
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      // Generate refresh token
      const refreshTokenValue = require('crypto').randomBytes(64).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await prisma.refreshToken.create({
        data: {
          token: refreshTokenValue,
          userId: user.id,
          expiresAt,
        },
      });

      logger.info('2FA verification successful', { userId });

      res.json({
        message: 'Authentification à 2 facteurs réussie',
        token: accessToken,
        refreshToken: refreshTokenValue,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        backupCodesRemaining: twoFAUtils.getRemainingBackupCodes(user.twoFABackupCodes),
      });
    } catch (error) {
      logger.error('Error verifying 2FA', { userId: req.body?.userId, error: error.message });
      res.status(500).json({
        error: 'Erreur lors de la vérification 2FA',
        code: 'VERIFY_ERROR',
      });
    }
  }
);

/**
 * POST /api/v1/auth/2fa/backup-codes
 * Get current backup codes (requires re-authentication)
 * User must provide their 2FA code to view backup codes
 */
router.post(
  '/backup-codes',
  requireAuth,
  [body('totpCode').notEmpty().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { totpCode } = req.body;

      // Get user with 2FA info
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          twoFAEnabled: true,
          twoFASecret: true,
          twoFABackupCodes: true,
        },
      });

      if (!user || !user.twoFAEnabled) {
        return res.status(400).json({ error: '2FA non activé' });
      }

      // Verify TOTP code
      const isValid = twoFAUtils.verify2FAToken(totpCode, user.twoFASecret);
      if (!isValid) {
        return res.status(401).json({ error: 'Code TOTP invalide' });
      }

      // Regenerate backup codes
      const { backupCodes, hashedBackupCodes } = await twoFAUtils.regenerateBackupCodes();

      // Update in database
      await prisma.user.update({
        where: { id: userId },
        data: { twoFABackupCodes: hashedBackupCodes },
      });

      logger.info('Backup codes regenerated', { userId });

      res.json({
        message: 'Codes de secours régénérés avec succès',
        backupCodes,
        warning:
          'Conservez ces codes dans un endroit sûr. Chaque code ne peut être utilisé qu\'une fois.',
      });
    } catch (error) {
      logger.error('Error getting backup codes', { userId: req.user?.id, error: error.message });
      res.status(500).json({
        error: 'Erreur lors de la récupération des codes de secours',
        code: 'BACKUP_CODES_ERROR',
      });
    }
  }
);

/**
 * POST /api/v1/auth/2fa/disable
 * Disable 2FA (requires password confirmation)
 */
router.post(
  '/disable',
  requireAuth,
  [body('password').notEmpty(), body('totpCode').notEmpty().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { password, totpCode } = req.body;

      // Get user with password hash
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          passwordHash: true,
          twoFAEnabled: true,
          twoFASecret: true,
        },
      });

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      if (!user.twoFAEnabled) {
        return res.status(400).json({ error: '2FA n\'est pas activé' });
      }

      // Verify password
      const bcrypt = require('bcryptjs');
      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        return res.status(401).json({ error: 'Mot de passe incorrect' });
      }

      // Verify TOTP code
      const totpValid = twoFAUtils.verify2FAToken(totpCode, user.twoFASecret);
      if (!totpValid) {
        return res.status(401).json({ error: 'Code TOTP invalide' });
      }

      // Disable 2FA
      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFAEnabled: false,
          twoFASecret: null,
          twoFABackupCodes: null,
          twoFAEnabledAt: null,
        },
        select: {
          id: true,
          email: true,
          twoFAEnabled: true,
        },
      });

      logger.info('2FA disabled for user', { userId });

      res.json({
        message: '2FA désactivé avec succès',
      });
    } catch (error) {
      logger.error('Error disabling 2FA', { userId: req.user?.id, error: error.message });
      res.status(500).json({
        error: 'Erreur lors de la désactivation de 2FA',
        code: 'DISABLE_ERROR',
      });
    }
  }
);

/**
 * GET /api/v1/auth/2fa/status
 * Get 2FA status for authenticated user
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        twoFAEnabled: true,
        twoFAEnabledAt: true,
        twoFABackupCodes: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({
      enabled: user.twoFAEnabled,
      enabledAt: user.twoFAEnabledAt,
      backupCodesRemaining: user.twoFAEnabled
        ? twoFAUtils.getRemainingBackupCodes(user.twoFABackupCodes)
        : 0,
    });
  } catch (error) {
    logger.error('Error getting 2FA status', { userId: req.user?.id, error: error.message });
    res.status(500).json({
      error: 'Erreur lors de la récupération du statut 2FA',
      code: 'STATUS_ERROR',
    });
  }
});

module.exports = router;
