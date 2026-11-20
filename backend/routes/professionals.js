/**
 * Professional Routes
 * HTTP layer only — business logic delegated to ProfessionalModule.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const ProfessionalModule = require('../modules/professional');
const { hashDocumentNumber, encryptDocumentNumber } = require('../utils/identityCrypto');
const logger = require('../utils/logger');

const router = express.Router();
const profModule = new ProfessionalModule(prisma);

const identitySubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de tentatives de soumission, réessayez dans une heure' },
});

// GET /api/professionals — liste publique
router.get('/', async (req, res, next) => {
  try {
    const { city, trade, page, limit } = req.query;
    const professionals = await profModule.list({ city, trade, page, limit });
    res.json(professionals);
  } catch (err) {
    next(err);
  }
});

// GET /api/professionals/me/status — statut identité (PROFESSIONAL uniquement)
router.get('/me/status', requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const pro = await profModule.getMyStatus(req.user.id);
    res.json(pro);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// GET /api/professionals/:id — profil public d'un pro
router.get('/:id', async (req, res, next) => {
  try {
    const pro = await profModule.getById(req.params.id);
    res.json(pro);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// POST /api/professionals/:id/follow — toggle follow (auth requis)
router.post('/:id/follow', requireAuth, async (req, res, next) => {
  try {
    const result = await profModule.toggleFollow(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

/**
 * POST /api/professionals/me/identity
 *
 * Submit or update an identity document number.
 * - Hashes the number with HMAC-SHA256 (keyed) for uniqueness enforcement.
 * - Encrypts it with AES-256-GCM for authorised retrieval.
 * - Raw number is never stored, logged, or returned in any response.
 * - Sets identityStatus to PENDING (admin must approve).
 *
 * Rate-limited: 5 attempts / hour to slow down brute-force probing.
 *
 * Rules enforced:
 *   - A hash already in use by ANOTHER professional is rejected (duplicate document).
 *   - A professional can re-submit their own number (correction / renewal).
 *   - Only PROFESSIONAL role may call this endpoint.
 */
router.post('/me/identity',
  requireAuth,
  requireRole('PROFESSIONAL'),
  identitySubmitLimiter,
  [
    body('documentNumber')
      .trim()
      .notEmpty().withMessage('Numéro de pièce requis')
      .isLength({ min: 5, max: 30 }).withMessage('Numéro de pièce invalide (5-30 caractères)'),
    body('documentType')
      .optional()
      .isIn(['CNI', 'PASSEPORT', 'TITRE_SEJOUR', 'PERMIS']).withMessage('Type de document non reconnu'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
    }

    const { documentNumber, documentType } = req.body;

    let docHash;
    let docEncrypted;
    try {
      docHash = hashDocumentNumber(documentNumber);
      docEncrypted = encryptDocumentNumber(documentNumber);
    } catch (err) {
      logger.error('[POST /professionals/me/identity] Crypto error', { userId: req.user.id, error: err.message });
      return res.status(503).json({ error: 'Service temporairement indisponible', code: 'CRYPTO_UNAVAILABLE' });
    }

    let pro;
    try {
      pro = await prisma.professional.findUnique({
        where: { userId: req.user.id },
        select: { id: true, identityStatus: true, idDocumentHash: true },
      });
    } catch (err) {
      logger.error('[POST /professionals/me/identity] Profile lookup failed', { userId: req.user.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
    }

    if (!pro) {
      return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
    }

    // Check if the hash is already used by ANOTHER professional.
    if (docHash !== pro.idDocumentHash) {
      let conflict;
      try {
        conflict = await prisma.professional.findFirst({
          where: { idDocumentHash: docHash, id: { not: pro.id } },
          select: { id: true },
        });
      } catch (err) {
        logger.error('[POST /professionals/me/identity] Uniqueness check failed', { proId: pro.id, error: err.message });
        return res.status(500).json({ error: 'Erreur lors de la vérification d\'unicité', code: 'UNIQUENESS_CHECK_ERROR' });
      }

      if (conflict) {
        // Do NOT reveal which account holds the document.
        return res.status(409).json({
          error: 'Ce numéro de pièce d\'identité est déjà associé à un autre compte professionnel.',
          code: 'DOCUMENT_ALREADY_USED',
        });
      }
    }

    // Persist — raw number is NEVER written.
    try {
      await prisma.professional.update({
        where: { id: pro.id },
        data: {
          idDocumentHash: docHash,
          idDocumentNumberEncrypted: docEncrypted,
          idDocumentType: documentType || null,
          identityStatus: 'PENDING',
          verifiedByAdmin: false,
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation — concurrent submission with the same hash.
      // The partial index on idDocumentHash catches races that bypass the findFirst check.
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: "Ce numéro de pièce d'identité est déjà associé à un autre compte professionnel.",
          code: 'DOCUMENT_ALREADY_USED',
        });
      }
      logger.error('[POST /professionals/me/identity] Update failed', { proId: pro.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la soumission', code: 'IDENTITY_SUBMIT_ERROR' });
    }

    logger.info('[POST /professionals/me/identity] Document submitted', {
      proId: pro.id,
      documentType: documentType || 'unknown',
      // hash is logged (safe — keyed HMAC, not brute-forceable without the secret)
      documentHash: docHash.substring(0, 8) + '…',
    });

    return res.status(200).json({
      message: "Votre pièce d'identité a été soumise. Notre équipe la vérifiera dans les 24-48h.",
      identityStatus: 'PENDING',
    });
  }
);

module.exports = router;
