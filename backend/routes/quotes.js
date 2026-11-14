/**
 * Quote Routes
 * HTTP layer only — business logic delegated to QuoteModule.
 */

const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { sendPushNotification } = require('../config/pushNotifications');
const generateQuotePdf = require('../utils/generateQuotePdf');
const { generateQuotePdfBuffer } = require('../utils/generateQuotePdf');
const { getActiveTier, getTierConfig } = require('./subscriptions');
const logger = require('../utils/logger');
const QuoteModule = require('../modules/quote');

const router = express.Router();
const quoteModule = new QuoteModule(prisma);

// Rate limiters
const createQuoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de devis envoyés, réessayez dans une heure' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// POST /api/quotes
router.post('/',
  requireAuth,
  requireRole('PROFESSIONAL'),
  createQuoteLimiter,
  body('projectId').notEmpty().trim(),
  body('description').notEmpty().trim().isLength({ max: 5000 }),
  body('amount').optional().isNumeric(),
  body('mode').optional().isIn(['SIMPLE', 'DETAILED']),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { projectId, amount, description, mode, items, validityDays } = req.body;
      if (!projectId || !description) {
        return res.status(400).json({ error: 'projectId et description sont requis', code: 'MISSING_REQUIRED_FIELDS' });
      }

      let pro;
      try {
        pro = await prisma.professional.findUnique({ where: { userId: req.user.id }, include: { subscription: true } });
      } catch (err) {
        logger.error('POST /api/quotes - professional lookup failed', { userId: req.user.id, error: err.message });
        return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
      }

      if (!pro) return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
      if (!pro.verifiedByAdmin) {
        return res.status(403).json({ error: "Votre identité doit être vérifiée avant de pouvoir envoyer un devis. Rendez-vous dans Compte → Vérification d'identité.", code: 'IDENTITY_NOT_VERIFIED' });
      }

      const quoteTier = getActiveTier(pro.subscription, pro);
      const quoteTierCfg = getTierConfig(quoteTier);
      if (quoteTierCfg.maxQuotesPerMonth !== null) {
        let quotesThisMonth;
        try {
          quotesThisMonth = await quoteModule.countThisMonth(pro.id);
        } catch (err) {
          logger.error('POST /api/quotes - quote count failed', { proId: pro.id, error: err.message });
          return res.status(500).json({ error: 'Erreur lors de la vérification du quota', code: 'QUOTA_CHECK_ERROR' });
        }
        if (quotesThisMonth >= quoteTierCfg.maxQuotesPerMonth) {
          return res.status(403).json({
            error: `Limite de ${quoteTierCfg.maxQuotesPerMonth} devis/mois atteinte pour l'abonnement ${quoteTierCfg.label}. Passez à Pro ou Élite pour des devis illimités.`,
            limitReached: true,
            maxQuotesPerMonth: quoteTierCfg.maxQuotesPerMonth,
            tier: quoteTier,
            code: 'QUOTA_EXCEEDED',
          });
        }
      }

      const quote = await quoteModule.create({ professionalId: pro.id, projectId, description, amount, mode, items, validityDays });

      // Generate PDF in the background
      const fullQuote = await quoteModule.getForPdf(quote.id);
      generateQuotePdf(fullQuote, fullQuote.professional, fullQuote.project)
        .then(pdfUrl => quoteModule.savePdfUrl(quote.id, pdfUrl))
        .catch(err => logger.error('POST /api/quotes - PDF generation failed', { quoteId: quote.id, error: err.message }));

      // Notify client
      if (fullQuote.project) {
        sendPushNotification(
          fullQuote.project.clientId,
          'Nouveau devis reçu',
          `Un professionnel a envoyé un devis de ${quote.amount?.toLocaleString()} FCFA pour "${fullQuote.project.title}"`,
          { type: 'new_quote', projectId }
        ).catch(err => logger.error('POST /api/quotes - push notification failed', { projectId, error: err.message }));
      }

      const { computeBadges } = require('../utils/badges');
      computeBadges(pro.id).catch(() => {});

      res.status(201).json(quote);
    } catch (err) {
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, code: err.code });
      logger.error('POST /api/quotes failed', { userId: req.user.id, projectId: req.body.projectId, error: err.message });
      res.status(500).json({ error: 'Erreur lors de la création du devis', code: 'QUOTE_CREATE_ERROR' });
    }
  }
);

// POST /api/quotes/:id/revise
router.post('/:id/revise', writeLimiter, requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    let pro;
    try {
      pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    } catch (err) {
      logger.error('POST /api/quotes/:id/revise - professional lookup failed', { userId: req.user.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
    }
    if (!pro) return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });

    const { newQuote, project } = await quoteModule.revise(req.params.id, pro.id, req.body);

    // Generate PDF in the background
    const fullRevision = await quoteModule.getForPdf(newQuote.id);
    generateQuotePdf(fullRevision, fullRevision.professional, fullRevision.project)
      .then(pdfUrl => quoteModule.savePdfUrl(newQuote.id, pdfUrl))
      .catch(err => logger.error('POST /api/quotes/:id/revise - PDF generation failed', { quoteId: newQuote.id, error: err.message }));

    sendPushNotification(
      project.clientId,
      'Devis révisé',
      `Le professionnel a envoyé une nouvelle version du devis pour "${project.title}"`,
      { type: 'quote_revised', projectId: project.id }
    ).catch(err => logger.error('POST /api/quotes/:id/revise - push notification failed', { quoteId: newQuote.id, error: err.message }));

    res.status(201).json(newQuote);
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, code: err.code });
    logger.error('POST /api/quotes/:id/revise failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la révision du devis', code: 'QUOTE_REVISE_ERROR' });
  }
});

// GET /api/quotes/mine — BEFORE /:id
router.get('/mine', requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    let pro;
    try {
      pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    } catch (err) {
      logger.error('GET /api/quotes/mine - professional lookup failed', { userId: req.user.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
    }
    if (!pro) return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });

    const quotes = await quoteModule.listMine(pro.id);
    res.json(quotes);
  } catch (err) {
    logger.error('GET /api/quotes/mine failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération de vos devis', code: 'MY_QUOTES_FETCH_ERROR' });
  }
});

// GET /api/quotes/:id/history
router.get('/:id/history', requireAuth, async (req, res, next) => {
  try {
    const { quote, versions } = await quoteModule.getHistory(req.params.id);

    const isClient = quote.project.clientId === req.user.id;
    const isPro = quote.professional.user?.id === req.user.id;
    if (!isClient && !isPro && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    res.json(versions);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message, code: err.code });
    logger.error('GET /api/quotes/:id/history failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: "Erreur lors de la récupération de l'historique", code: 'QUOTE_HISTORY_ERROR' });
  }
});

// GET /api/quotes/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const quote = await quoteModule.getDetail(req.params.id);

    const isClient = quote.project.clientId === req.user.id;
    const isPro = quote.professional.user?.id === req.user.id;
    if (!isClient && !isPro && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    res.json(quote);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message, code: err.code });
    logger.error('GET /api/quotes/:id failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération du devis', code: 'QUOTE_DETAIL_FETCH_ERROR' });
  }
});

// DELETE /api/quotes/:id
router.delete('/:id', requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    let pro;
    try {
      pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    } catch (err) {
      logger.error('DELETE /api/quotes/:id - professional lookup failed', { userId: req.user.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
    }
    if (!pro) return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });

    const result = await quoteModule.cancel(req.params.id, pro.id);
    res.json(result);
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, code: err.code });
    logger.error('DELETE /api/quotes/:id failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: "Erreur lors de l'annulation du devis", code: 'QUOTE_DELETE_ERROR' });
  }
});

// PATCH /api/quotes/:id — accept or refuse (client)
router.patch('/:id', requireAuth, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { quote, professional: existing } = await quoteModule.respond(req.params.id, req.user.id, req.body.status);

    const pro = await prisma.professional.findUnique({ where: { id: existing.professionalId }, select: { userId: true } });
    if (pro) {
      const title = req.body.status === 'ACCEPTED' ? 'Devis accepté !' : 'Devis refusé';
      const msgBody = req.body.status === 'ACCEPTED'
        ? `Votre devis pour "${existing.project.title}" a été accepté. La mission commence !`
        : `Votre devis pour "${existing.project.title}" a été refusé.`;
      sendPushNotification(pro.userId, title, msgBody, { type: 'quote_response', quoteId: quote.id, status: req.body.status }).catch(err => {
        logger.error('PATCH /api/quotes/:id - push notification failed', { quoteId: quote.id, error: err.message });
      });
    }

    res.json(quote);
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, code: err.code });
    logger.error('PATCH /api/quotes/:id failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la réponse au devis', code: 'QUOTE_RESPONSE_ERROR' });
  }
});

// POST /api/quotes/:id/pdf
router.post('/:id/pdf', requireAuth, async (req, res, next) => {
  try {
    const quote = await quoteModule.getForPdf(req.params.id);

    const isProOwner = quote.professional.userId === req.user.id;
    const isClient = quote.project.clientId === req.user.id;
    if (!isProOwner && !isClient && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    let pdfUrl;
    try {
      pdfUrl = await generateQuotePdf(quote, quote.professional, quote.project);
    } catch (err) {
      logger.error('POST /api/quotes/:id/pdf - PDF generation failed', { quoteId: req.params.id, error: err.message });
      return res.status(503).json({ error: 'Erreur lors de la génération du PDF', code: 'PDF_GENERATION_ERROR' });
    }

    quoteModule.savePdfUrl(quote.id, pdfUrl).catch(err => {
      logger.error('POST /api/quotes/:id/pdf - failed to save PDF URL', { quoteId: quote.id, error: err.message });
    });

    res.json({ pdfUrl });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message, code: err.code });
    logger.error('POST /api/quotes/:id/pdf failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors du traitement du PDF', code: 'PDF_PROCESSING_ERROR' });
  }
});

// GET /api/quotes/:id/pdf
router.get('/:id/pdf', requireAuth, async (req, res, next) => {
  try {
    const quote = await quoteModule.getForPdf(req.params.id);

    const isProOwner = quote.professional.userId === req.user.id;
    const isClient = quote.project.clientId === req.user.id;
    if (!isProOwner && !isClient && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    let pdfUrl = quote.pdfUrl;

    if (!pdfUrl || !pdfUrl.startsWith('http')) {
      try {
        pdfUrl = await generateQuotePdf(quote, quote.professional, quote.project);
      } catch (err) {
        logger.error('GET /api/quotes/:id/pdf - PDF generation failed', { quoteId: req.params.id, error: err.message });
        return res.status(503).json({ error: 'Erreur lors de la génération du PDF', code: 'PDF_GENERATION_ERROR' });
      }
      quoteModule.savePdfUrl(quote.id, pdfUrl).catch(err => {
        logger.error('GET /api/quotes/:id/pdf - failed to save PDF URL', { quoteId: quote.id, error: err.message });
      });
    }

    if (req.query.stream === '1') {
      try {
        const buffer = await generateQuotePdfBuffer(quote, quote.professional, quote.project);
        const fileName = `devis-${quote.id.substring(0, 8)}-v${quote.version}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.end(buffer);
      } catch (err) {
        logger.error('GET /api/quotes/:id/pdf - stream generation failed', { quoteId: req.params.id, error: err.message });
        return res.status(503).json({ error: 'Erreur lors du streaming du PDF', code: 'PDF_STREAM_ERROR' });
      }
    }

    res.json({ pdfUrl });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message, code: err.code });
    logger.error('GET /api/quotes/:id/pdf failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération du PDF', code: 'PDF_FETCH_ERROR' });
  }
});

module.exports = router;
