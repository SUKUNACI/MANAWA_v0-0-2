/**
 * 2FA (TOTP) Authentication Routes
 * HTTP layer only — business logic delegated to TwoFactorModule.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
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

// Rate limit 2FA verify — 10 attempts per 15 min per IP to slow brute-force on TOTP codes
const twoFAVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives de vérification 2FA, réessayez dans 15 minutes', code: 'TOO_MANY_2FA_ATTEMPTS' },
});

/**
 * POST /api/v1/auth/2fa/verify
 * Verify TOTP or backup code as the second authentication factor during login.
 * Requires a valid twoFAToken (short-lived JWT, type 2fa_login) issued during first-factor login.
 * The user identity is extracted from the JWT — the body userId field is intentionally ignored.
 */
router.post(
  '/verify',
  twoFAVerifyLimiter,
  [
    body('twoFAToken').notEmpty().withMessage('twoFAToken requis'),
    body('totpCode').optional().trim().matches(/^\d{6}$/),
    body('backupCode').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { twoFAToken, totpCode, backupCode } = req.body;

      let decoded;
      try {
        decoded = jwt.verify(twoFAToken, process.env.JWT_SECRET);
      } catch (jwtErr) {
        const isExpired = jwtErr.name === 'TokenExpiredError';
        return res.status(401).json({
          error: isExpired ? 'Token 2FA expiré' : 'Token 2FA invalide',
          code: isExpired ? '2FA_TOKEN_EXPIRED' : '2FA_TOKEN_INVALID',
        });
      }

      if (decoded.type !== '2fa_login') {
        return res.status(401).json({ error: 'Token 2FA invalide', code: '2FA_TOKEN_INVALID' });
      }

      // If the caller supplies a userId in the body, it must match the JWT.
      // The JWT remains the authoritative identity source — body.userId never overrides it.
      if (req.body.userId !== undefined && req.body.userId !== decoded.userId) {
        return res.status(401).json({ error: 'Token 2FA invalide', code: '2FA_TOKEN_MISMATCH' });
      }

      const userId = decoded.userId;
      const result = await twoFactor.verify(userId, { totpCode, backupCode });
      res.json({ message: 'Authentification à 2 facteurs réussie', ...result });
    } catch (err) {
      logger.error('Error verifying 2FA', { error: err.message });
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
// Exported for test teardown — allows resetting the rate-limit counter between unit tests.
module.exports.twoFAVerifyLimiter = twoFAVerifyLimiter;
