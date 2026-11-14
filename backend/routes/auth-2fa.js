/**
 * 2FA (TOTP) Authentication Routes
 * HTTP layer only — business logic delegated to TwoFactorModule.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const TwoFactorModule = require('../modules/twoFactor');

const router = express.Router();
const twoFactor = new TwoFactorModule(prisma);

/**
 * POST /api/v1/auth/2fa/setup
 * Initiate 2FA setup — returns setupToken, QR code, and backup codes.
 */
router.post('/setup', requireAuth, async (req, res) => {
  try {
    const result = await twoFactor.setup(req.user.id);
    res.json({
      ...result,
      message: "Scannez le code QR avec une application d'authentification (Google Authenticator, Authy, Microsoft Authenticator, etc.)",
    });
  } catch (err) {
    logger.error('Error in 2FA setup', { userId: req.user?.id, error: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur lors de la configuration 2FA', code: 'SETUP_ERROR' });
  }
});

/**
 * POST /api/v1/auth/2fa/enable
 * Enable 2FA after the user verifies the setup token with a valid TOTP code.
 */
router.post(
  '/enable',
  requireAuth,
  [body('setupToken').notEmpty().trim(), body('totpCode').notEmpty().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { setupToken, totpCode } = req.body;
      const result = await twoFactor.enable(req.user.id, setupToken, totpCode);
      res.status(201).json({ message: '2FA activé avec succès', ...result });
    } catch (err) {
      logger.error('Error enabling 2FA', { userId: req.user?.id, error: err.message });
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: "Erreur lors de l'activation de 2FA", code: 'ENABLE_ERROR' });
    }
  }
);

/**
 * POST /api/v1/auth/2fa/verify
 * Verify TOTP or backup code as the second authentication factor during login.
 */
router.post(
  '/verify',
  [
    body('userId').notEmpty().isUUID(),
    body('totpCode').optional().trim().matches(/^\d{6}$/),
    body('backupCode').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { userId, totpCode, backupCode } = req.body;
      const result = await twoFactor.verify(userId, { totpCode, backupCode });
      res.json({ message: 'Authentification à 2 facteurs réussie', ...result });
    } catch (err) {
      logger.error('Error verifying 2FA', { userId: req.body?.userId, error: err.message });
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Erreur lors de la vérification 2FA', code: 'VERIFY_ERROR' });
    }
  }
);

/**
 * POST /api/v1/auth/2fa/backup-codes
 * Regenerate backup codes (requires current TOTP code for re-authentication).
 */
router.post(
  '/backup-codes',
  requireAuth,
  [body('totpCode').notEmpty().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { backupCodes } = await twoFactor.regenerateBackupCodes(req.user.id, req.body.totpCode);
      res.json({
        message: 'Codes de secours régénérés avec succès',
        backupCodes,
        warning: "Conservez ces codes dans un endroit sûr. Chaque code ne peut être utilisé qu'une fois.",
      });
    } catch (err) {
      logger.error('Error getting backup codes', { userId: req.user?.id, error: err.message });
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Erreur lors de la récupération des codes de secours', code: 'BACKUP_CODES_ERROR' });
    }
  }
);

/**
 * POST /api/v1/auth/2fa/disable
 * Disable 2FA (requires password and current TOTP code).
 */
router.post(
  '/disable',
  requireAuth,
  [body('password').notEmpty(), body('totpCode').notEmpty().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { password, totpCode } = req.body;
      await twoFactor.disable(req.user.id, password, totpCode);
      res.json({ message: '2FA désactivé avec succès' });
    } catch (err) {
      logger.error('Error disabling 2FA', { userId: req.user?.id, error: err.message });
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Erreur lors de la désactivation de 2FA', code: 'DISABLE_ERROR' });
    }
  }
);

/**
 * GET /api/v1/auth/2fa/status
 * Get 2FA status for the authenticated user.
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await twoFactor.getStatus(req.user.id);
    res.json(status);
  } catch (err) {
    logger.error('Error getting 2FA status', { userId: req.user?.id, error: err.message });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération du statut 2FA', code: 'STATUS_ERROR' });
  }
});

module.exports = router;
