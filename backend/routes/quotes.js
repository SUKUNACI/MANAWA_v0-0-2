const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const { sendPushNotification } = require('../config/pushNotifications');
const generateQuotePdf = require('../utils/generateQuotePdf');
const { generateQuotePdfBuffer } = require('../utils/generateQuotePdf');
const { getActiveTier, getTierConfig } = require('./subscriptions');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

const router = express.Router();

// Rate limiters
// 20 devis max par heure par professionnel
const createQuoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de devis envoyés, réessayez dans une heure' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// POST /api/quotes — Créer un devis (simple ou détaillé)
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

    const quoteMode = mode === 'DETAILED' ? 'DETAILED' : 'SIMPLE';

    if (quoteMode === 'SIMPLE' && !amount) {
      return res.status(400).json({ error: 'Le montant est requis pour un devis simple', code: 'AMOUNT_REQUIRED' });
    }

    if (quoteMode === 'DETAILED' && (!items || items.length === 0)) {
      return res.status(400).json({ error: 'Au moins une ligne est requise pour un devis détaillé', code: 'ITEMS_REQUIRED' });
    }

    let pro;
    try {
      pro = await prisma.professional.findUnique({ where: { userId: req.user.id }, include: { subscription: true } });
    } catch (err) {
      logger.error('POST /api/quotes - professional lookup failed', { userId: req.user.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
    }

    if (!pro) {
      return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
    }

    if (!pro.verifiedByAdmin) {
      return res.status(403).json({ error: "Votre identité doit être vérifiée avant de pouvoir envoyer un devis. Rendez-vous dans Compte → Vérification d'identité.", code: 'IDENTITY_NOT_VERIFIED' });
    }

    const quoteTier = getActiveTier(pro.subscription, pro);
    const quoteTierCfg = getTierConfig(quoteTier);
    if (quoteTierCfg.maxQuotesPerMonth !== null) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      let quotesThisMonth;
      try {
        quotesThisMonth = await prisma.quote.count({
          where: { professionalId: pro.id, createdAt: { gte: startOfMonth } },
        });
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

    const existingPending = await prisma.quote.findFirst({
      where: { projectId, professionalId: pro.id, status: 'PENDING' },
    });
    if (existingPending) {
      return res.status(409).json({ error: "Vous avez déjà un devis en attente sur ce projet. Attendez la réponse du client ou annulez-le d'abord.", code: 'PENDING_QUOTE_EXISTS' });
    }

    // Calculer le montant total pour les devis détaillés
    let totalAmount = amount;
    if (quoteMode === 'DETAILED') {
      totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    }

    // Calculer la date d'expiration
    const days = validityDays || 15;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const quote = await prisma.quote.create({
      data: {
        projectId,
        professionalId: pro.id,
        mode: quoteMode,
        amount: totalAmount,
        description,
        validityDays: days,
        expiresAt,
        items: quoteMode === 'DETAILED' ? {
          create: items.map((item, index) => ({
            category: item.category || 'OTHER',
            label: item.label,
            quantity: item.quantity || 1,
            unit: item.unit || null,
            unitPrice: item.unitPrice,
            total: (item.quantity || 1) * item.unitPrice,
            sortOrder: index,
          })),
        } : undefined,
      },
      include: { items: true },
    });

    // Générer le PDF en arrière-plan
    const fullQuote = await prisma.quote.findUnique({
      where: { id: quote.id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        professional: { include: { user: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
        project: { include: { client: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
      },
    });
    generateQuotePdf(fullQuote, fullQuote.professional, fullQuote.project)
      .then(pdfUrl => prisma.quote.update({ where: { id: quote.id }, data: { pdfUrl } }))
      .catch(err => logger.error('POST /api/quotes - PDF generation failed', { quoteId: quote.id, error: err.message }));

    // Notifier le client
    const projectData = fullQuote.project;
    if (projectData) {
      sendPushNotification(projectData.clientId, 'Nouveau devis reçu', `Un professionnel a envoyé un devis de ${totalAmount.toLocaleString()} FCFA pour "${projectData.title}"`, { type: 'new_quote', projectId }).catch(err => {
        logger.error('POST /api/quotes - push notification failed', { projectId, error: err.message });
      });
    }

    // Recalcul badges (fire-and-forget) — peut débloquer FIRST_QUOTE
    const { computeBadges } = require('../utils/badges');
    computeBadges(pro.id).catch(() => {});

    res.status(201).json(quote);
  } catch (err) {
    logger.error('POST /api/quotes failed', { userId: req.user.id, projectId: req.body.projectId, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la création du devis', code: 'QUOTE_CREATE_ERROR' });
  }
});

// POST /api/quotes/:id/revise — Créer une révision (V2, V3...) d'un devis existant
router.post('/:id/revise', writeLimiter, requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const { amount, description, mode, items, validityDays } = req.body;
    let pro;
    try {
      pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    } catch (err) {
      logger.error('POST /api/quotes/:id/revise - professional lookup failed', { userId: req.user.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
    }

    if (!pro) {
      return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
    }

    // Trouver le devis original (ou la dernière version)
    const parentQuote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { items: true, project: true },
    });

    if (!parentQuote) return res.status(404).json({ error: 'Devis introuvable', code: 'QUOTE_NOT_FOUND' });
    if (parentQuote.professionalId !== pro.id) return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    if (!['PENDING', 'REFUSED'].includes(parentQuote.status)) {
      return res.status(400).json({ error: 'Seul un devis en attente ou refusé peut être révisé', code: 'INVALID_QUOTE_STATUS' });
    }

    const quoteMode = mode || parentQuote.mode;
    const newDescription = description || parentQuote.description;

    // Calculer le montant
    let totalAmount;
    if (quoteMode === 'DETAILED' && items && items.length > 0) {
      totalAmount = items.reduce((sum, item) => sum + ((item.quantity || 1) * item.unitPrice), 0);
    } else if (amount) {
      totalAmount = amount;
    } else {
      totalAmount = parentQuote.amount;
    }

    // Calculer la date d'expiration
    const days = validityDays || parentQuote.validityDays || 15;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    // Trouver la version la plus haute pour ce projet/pro
    const latestVersion = await prisma.quote.findFirst({
      where: { projectId: parentQuote.projectId, professionalId: pro.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const newVersion = (latestVersion?.version || 1) + 1;

    // Marquer l'ancien devis comme REVISED
    await prisma.quote.update({
      where: { id: parentQuote.id },
      data: { status: 'REVISED' },
    });

    // Créer la nouvelle version
    const newQuote = await prisma.quote.create({
      data: {
        projectId: parentQuote.projectId,
        professionalId: pro.id,
        mode: quoteMode,
        amount: totalAmount,
        description: newDescription,
        version: newVersion,
        parentQuoteId: parentQuote.id,
        validityDays: days,
        expiresAt,
        items: quoteMode === 'DETAILED' && items && items.length > 0 ? {
          create: items.map((item, index) => ({
            category: item.category || 'OTHER',
            label: item.label,
            quantity: item.quantity || 1,
            unit: item.unit || null,
            unitPrice: item.unitPrice,
            total: (item.quantity || 1) * item.unitPrice,
            sortOrder: index,
          })),
        } : undefined,
      },
      include: { items: true },
    });

    // Générer le PDF en arrière-plan
    const fullRevision = await prisma.quote.findUnique({
      where: { id: newQuote.id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        professional: { include: { user: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
        project: { include: { client: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
      },
    });
    generateQuotePdf(fullRevision, fullRevision.professional, fullRevision.project)
      .then(pdfUrl => prisma.quote.update({ where: { id: newQuote.id }, data: { pdfUrl } }))
      .catch(err => logger.error('POST /api/quotes/:id/revise - PDF generation failed', { quoteId: newQuote.id, error: err.message }));

    // Notifier le client de la révision
    sendPushNotification(parentQuote.project.clientId, 'Devis révisé', `Le professionnel a envoyé une version ${newVersion} du devis pour "${parentQuote.project.title}"`, { type: 'quote_revised', projectId: parentQuote.projectId }).catch(err => {
      logger.error('POST /api/quotes/:id/revise - push notification failed', { quoteId: newQuote.id, error: err.message });
    });

    res.status(201).json(newQuote);
  } catch (err) {
    logger.error('POST /api/quotes/:id/revise failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la révision du devis', code: 'QUOTE_REVISE_ERROR' });
  }
});

// GET /api/quotes/:id/history — Historique des versions d'un devis
router.get('/:id/history', requireAuth, async (req, res, next) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { project: { select: { clientId: true } }, professional: { include: { user: { select: { id: true } } } } },
    });
    if (!quote) return res.status(404).json({ error: 'Devis introuvable', code: 'QUOTE_NOT_FOUND' });

    const isClient = quote.project.clientId === req.user.id;
    const isPro = quote.professional.user?.id === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isClient && !isPro && !isAdmin) {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    const history = await prisma.quote.findMany({
      where: { projectId: quote.projectId, professionalId: quote.professionalId },
      include: { items: true },
      orderBy: { version: 'desc' },
    });

    res.json(history);
  } catch (err) {
    logger.error('GET /api/quotes/:id/history failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération de l\'historique', code: 'QUOTE_HISTORY_ERROR' });
  }
});

// GET /api/quotes/mine — Mes devis (professionnel) - SPÉCIFIQUE (AVANT /:id)
router.get('/mine', requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    let pro;
    try {
      pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    } catch (err) {
      logger.error('GET /api/quotes/mine - professional lookup failed', { userId: req.user.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
    }

    if (!pro) {
      return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
    }

    const quotes = await prisma.quote.findMany({
      where: { professionalId: pro.id },
      include: { project: true, items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(quotes);
  } catch (err) {
    logger.error('GET /api/quotes/mine failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération de vos devis', code: 'MY_QUOTES_FETCH_ERROR' });
  }
});

// GET /api/quotes/:id — Détail d'un devis avec ses lignes
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        professional: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } } },
        project: { select: { id: true, title: true, clientId: true } },
        revisions: { orderBy: { version: 'asc' }, select: { id: true, version: true, amount: true, status: true, createdAt: true } },
      },
    });

    if (!quote) return res.status(404).json({ error: 'Devis introuvable', code: 'QUOTE_NOT_FOUND' });

    const isClient = quote.project.clientId === req.user.id;
    const isPro = quote.professional.user?.id === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isClient && !isPro && !isAdmin) {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    res.json(quote);
  } catch (err) {
    logger.error('GET /api/quotes/:id failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération du devis', code: 'QUOTE_DETAIL_FETCH_ERROR' });
  }
});

// DELETE /api/quotes/:id — Annuler un devis en attente
router.delete('/:id', requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    let pro;
    try {
      pro = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    } catch (err) {
      logger.error('DELETE /api/quotes/:id - professional lookup failed', { userId: req.user.id, error: err.message });
      return res.status(500).json({ error: 'Erreur lors de la vérification du profil', code: 'PROFILE_LOOKUP_ERROR' });
    }

    if (!pro) {
      return res.status(404).json({ error: 'Profil professionnel introuvable', code: 'PRO_PROFILE_NOT_FOUND' });
    }

    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });

    if (!quote || quote.professionalId !== pro.id) return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    if (quote.status !== 'PENDING') return res.status(400).json({ error: 'Seul un devis en attente peut être annulé', code: 'INVALID_QUOTE_STATUS' });

    await prisma.quote.delete({ where: { id: req.params.id } });
    res.json({ cancelled: true });
  } catch (err) {
    logger.error('DELETE /api/quotes/:id failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de l\'annulation du devis', code: 'QUOTE_DELETE_ERROR' });
  }
});

// PATCH /api/quotes/:id — Accepter ou refuser un devis (client)
router.patch('/:id', requireAuth, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!['ACCEPTED', 'REFUSED'].includes(status)) {
      return res.status(400).json({ error: 'Le statut doit être ACCEPTED ou REFUSED', code: 'INVALID_STATUS' });
    }

    const existingQuote = await prisma.quote.findUnique({ where: { id: req.params.id }, include: { project: true } });
    if (!existingQuote) return res.status(404).json({ error: 'Devis introuvable', code: 'QUOTE_NOT_FOUND' });
    if (existingQuote.project.clientId !== req.user.id) return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    if (existingQuote.status !== 'PENDING') return res.status(400).json({ error: 'Ce devis a déjà été traité', code: 'QUOTE_ALREADY_PROCESSED' });

    // Vérifier si le devis est expiré
    if (existingQuote.expiresAt && new Date() > new Date(existingQuote.expiresAt)) {
      try {
        await prisma.quote.update({ where: { id: req.params.id }, data: { status: 'EXPIRED' } });
      } catch (err) {
        logger.error('PATCH /api/quotes/:id - failed to mark quote as expired', { quoteId: req.params.id, error: err.message });
      }
      return res.status(400).json({ error: 'Ce devis a expiré. Demandez au professionnel d\'en envoyer un nouveau.', code: 'QUOTE_EXPIRED' });
    }

    const quote = await prisma.quote.update({
      where: { id: req.params.id },
      data: { status },
    });

    if (status === 'ACCEPTED') {
      try {
        await prisma.project.update({
          where: { id: quote.projectId },
          data: { status: 'IN_PROGRESS' },
        });
      } catch (err) {
        logger.error('PATCH /api/quotes/:id - failed to update project status', { quoteId: req.params.id, projectId: quote.projectId, error: err.message });
      }
    }

    // Notifier le professionnel de la décision
    const pro = await prisma.professional.findUnique({ where: { id: existingQuote.professionalId }, select: { userId: true } });
    if (pro) {
      const title = status === 'ACCEPTED' ? 'Devis accepté !' : 'Devis refusé';
      const body = status === 'ACCEPTED'
        ? `Votre devis pour "${existingQuote.project.title}" a été accepté. La mission commence !`
        : `Votre devis pour "${existingQuote.project.title}" a été refusé.`;
      sendPushNotification(pro.userId, title, body, { type: 'quote_response', quoteId: quote.id, status }).catch(err => {
        logger.error('PATCH /api/quotes/:id - push notification failed', { quoteId: quote.id, error: err.message });
      });
    }

    res.json(quote);
  } catch (err) {
    logger.error('PATCH /api/quotes/:id failed', { quoteId: req.params.id, userId: req.user.id, status: req.body.status, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la réponse au devis', code: 'QUOTE_RESPONSE_ERROR' });
  }
});

// POST /api/quotes/:id/pdf — Générer le PDF du devis
router.post('/:id/pdf', requireAuth, async (req, res, next) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        professional: { include: { user: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
        project: { include: { client: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
      },
    });

    if (!quote) return res.status(404).json({ error: 'Devis introuvable', code: 'QUOTE_NOT_FOUND' });

    // Vérifier que l'utilisateur est le pro ou le client concerné
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

    // Sauvegarder l'URL du PDF dans le devis
    try {
      await prisma.quote.update({ where: { id: quote.id }, data: { pdfUrl } });
    } catch (err) {
      logger.error('POST /api/quotes/:id/pdf - failed to save PDF URL', { quoteId: quote.id, error: err.message });
    }

    res.json({ pdfUrl });
  } catch (err) {
    logger.error('POST /api/quotes/:id/pdf failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors du traitement du PDF', code: 'PDF_PROCESSING_ERROR' });
  }
});

// GET /api/quotes/:id/pdf — Stream le PDF au client (évite les restrictions ACL Cloudinary)
router.get('/:id/pdf', requireAuth, async (req, res, next) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        professional: { include: { user: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
        project: { include: { client: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
      },
    });

    if (!quote) return res.status(404).json({ error: 'Devis introuvable', code: 'QUOTE_NOT_FOUND' });

    const isProOwner = quote.professional.userId === req.user.id;
    const isClient = quote.project.clientId === req.user.id;
    if (!isProOwner && !isClient && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Accès refusé', code: 'ACCESS_DENIED' });
    }

    let pdfUrl = quote.pdfUrl;

    // Régénérer si pas de PDF ou si l'URL stockée est un ancien chemin local
    if (!pdfUrl || !pdfUrl.startsWith('http')) {
      try {
        pdfUrl = await generateQuotePdf(quote, quote.professional, quote.project);
      } catch (err) {
        logger.error('GET /api/quotes/:id/pdf - PDF generation failed', { quoteId: req.params.id, error: err.message });
        return res.status(503).json({ error: 'Erreur lors de la génération du PDF', code: 'PDF_GENERATION_ERROR' });
      }
      try {
        await prisma.quote.update({ where: { id: quote.id }, data: { pdfUrl } });
      } catch (err) {
        logger.error('GET /api/quotes/:id/pdf - failed to save PDF URL', { quoteId: quote.id, error: err.message });
      }
    }

    // Si mode stream demandé (?stream=1), générer le PDF en mémoire et l'envoyer directement
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
    logger.error('GET /api/quotes/:id/pdf failed', { quoteId: req.params.id, userId: req.user.id, error: err.message });
    res.status(500).json({ error: 'Erreur lors de la récupération du PDF', code: 'PDF_FETCH_ERROR' });
  }
});

module.exports = router;
