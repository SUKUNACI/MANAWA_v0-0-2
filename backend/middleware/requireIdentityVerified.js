'use strict';

/**
 * Middleware: requireIdentityVerified
 *
 * Rejects PROFESSIONAL requests when the professional's identity is not yet
 * approved (verifiedByAdmin === false).  CLIENT accounts are always passed
 * through — they are not subject to the identity-verification rule.
 *
 * Returns a 403 with a status-specific message so the frontend can surface
 * the right call to action.
 *
 * Usage — place after requireAuth and requireRole('PROFESSIONAL'):
 *   router.post('/', requireAuth, requireRole('PROFESSIONAL'), requireIdentityVerified, handler)
 */

const prisma = require('../config/db');
const logger = require('../utils/logger');

const STATUS_MESSAGES = {
  NOT_SUBMITTED: "Vous devez soumettre votre pièce d'identité avant d'effectuer cette action. Rendez-vous dans Compte → Vérification d'identité.",
  PENDING:       "Votre identité est en cours de vérification. Vous pourrez agir dès validation par notre équipe.",
  REJECTED:      "Votre pièce d'identité a été rejetée. Veuillez soumettre un nouveau document dans Compte → Vérification d'identité.",
};

async function requireIdentityVerified(req, res, next) {
  if (!req.user || req.user.role !== 'PROFESSIONAL') {
    return next();
  }

  let pro;
  try {
    pro = await prisma.professional.findUnique({
      where: { userId: req.user.id },
      select: { verifiedByAdmin: true, identityStatus: true },
    });
  } catch (err) {
    logger.error('[requireIdentityVerified] DB lookup failed', { userId: req.user.id, error: err.message });
    return res.status(500).json({ error: "Erreur lors de la vérification de l'identité", code: 'IDENTITY_CHECK_ERROR' });
  }

  if (!pro) {
    return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
  }

  if (!pro.verifiedByAdmin) {
    const msg = STATUS_MESSAGES[pro.identityStatus] || "Votre identité doit être vérifiée avant d'effectuer cette action.";
    return res.status(403).json({
      error: msg,
      code: 'IDENTITY_NOT_VERIFIED',
      identityStatus: pro.identityStatus,
    });
  }

  next();
}

module.exports = { requireIdentityVerified };
