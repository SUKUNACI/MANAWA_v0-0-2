'use strict';

const logger = require('../utils/logger');

/**
 * Quote Module — Creation, revision, acceptance/refusal, PDF generation, history
 */

class QuoteModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // ---- Create ----

  /**
   * Create a new quote (simple or detailed line-items).
   * Quota enforcement uses subscription tier from the caller.
   */
  async create({ professionalId, projectId, description, amount, mode = 'SIMPLE', items, validityDays }) {
    const quoteMode = mode === 'DETAILED' ? 'DETAILED' : 'SIMPLE';

    if (quoteMode === 'SIMPLE' && !amount) {
      throw Object.assign(new Error('Le montant est requis pour un devis simple'), { status: 400, code: 'AMOUNT_REQUIRED' });
    }
    if (quoteMode === 'DETAILED' && (!items || items.length === 0)) {
      throw Object.assign(new Error('Au moins une ligne est requise pour un devis détaillé'), { status: 400, code: 'ITEMS_REQUIRED' });
    }

    const existingPending = await this.prisma.quote.findFirst({
      where: { projectId, professionalId, status: 'PENDING' },
    });
    if (existingPending) {
      throw Object.assign(
        new Error("Vous avez déjà un devis en attente sur ce projet. Attendez la réponse du client ou annulez-le d'abord."),
        { status: 409, code: 'PENDING_QUOTE_EXISTS' }
      );
    }

    const totalAmount = quoteMode === 'DETAILED'
      ? items.reduce((sum, item) => sum + (item.quantity || 1) * item.unitPrice, 0)
      : amount;

    const days = validityDays || 15;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const quote = await this.prisma.quote.create({
      data: {
        projectId,
        professionalId,
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

    logger.info('[QuoteModule] Quote created', { quoteId: quote.id, professionalId, projectId });
    return quote;
  }

  // ---- Revision ----

  async revise(quoteId, professionalId, { amount, description, mode, items, validityDays } = {}) {
    const parentQuote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true, project: true },
    });

    if (!parentQuote) throw Object.assign(new Error('Devis introuvable'), { status: 404, code: 'QUOTE_NOT_FOUND' });
    if (parentQuote.professionalId !== professionalId) {
      throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
    }
    if (!['PENDING', 'REFUSED'].includes(parentQuote.status)) {
      throw Object.assign(new Error('Seul un devis en attente ou refusé peut être révisé'), { status: 400, code: 'INVALID_QUOTE_STATUS' });
    }

    const quoteMode = mode || parentQuote.mode;
    const newDescription = description || parentQuote.description;
    const days = validityDays || parentQuote.validityDays || 15;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    let totalAmount;
    if (quoteMode === 'DETAILED' && items && items.length > 0) {
      totalAmount = items.reduce((sum, item) => sum + ((item.quantity || 1) * item.unitPrice), 0);
    } else if (amount) {
      totalAmount = amount;
    } else {
      totalAmount = parentQuote.amount;
    }

    const latestVersion = await this.prisma.quote.findFirst({
      where: { projectId: parentQuote.projectId, professionalId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const newVersion = (latestVersion?.version || 1) + 1;

    await this.prisma.quote.update({ where: { id: parentQuote.id }, data: { status: 'REVISED' } });

    const newQuote = await this.prisma.quote.create({
      data: {
        projectId: parentQuote.projectId,
        professionalId,
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

    logger.info('[QuoteModule] Quote revised', { newQuoteId: newQuote.id, parentQuoteId: quoteId, version: newVersion });
    return { newQuote, project: parentQuote.project };
  }

  // ---- Detail ----

  async getDetail(quoteId) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        professional: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } } },
        project: { select: { id: true, title: true, clientId: true } },
        revisions: { orderBy: { version: 'asc' }, select: { id: true, version: true, amount: true, status: true, createdAt: true } },
      },
    });
    if (!quote) throw Object.assign(new Error('Devis introuvable'), { status: 404, code: 'QUOTE_NOT_FOUND' });
    return quote;
  }

  // ---- History ----

  async getHistory(quoteId) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        project: { select: { clientId: true } },
        professional: { include: { user: { select: { id: true } } } },
      },
    });
    if (!quote) throw Object.assign(new Error('Devis introuvable'), { status: 404, code: 'QUOTE_NOT_FOUND' });

    return {
      quote,
      versions: await this.prisma.quote.findMany({
        where: { projectId: quote.projectId, professionalId: quote.professionalId },
        include: { items: true },
        orderBy: { version: 'desc' },
      }),
    };
  }

  // ---- Professional: own quotes ----

  async listMine(professionalId) {
    return this.prisma.quote.findMany({
      where: { professionalId },
      include: { project: true, items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---- Client: respond (accept or refuse) ----

  async respond(quoteId, clientId, status) {
    if (!['ACCEPTED', 'REFUSED'].includes(status)) {
      throw Object.assign(new Error('Le statut doit être ACCEPTED ou REFUSED'), { status: 400, code: 'INVALID_STATUS' });
    }

    const existing = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { project: true },
    });
    if (!existing) throw Object.assign(new Error('Devis introuvable'), { status: 404, code: 'QUOTE_NOT_FOUND' });
    if (existing.project.clientId !== clientId) {
      throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
    }
    if (existing.status !== 'PENDING') {
      throw Object.assign(new Error('Ce devis a déjà été traité'), { status: 400, code: 'QUOTE_ALREADY_PROCESSED' });
    }

    if (existing.expiresAt && new Date() > new Date(existing.expiresAt)) {
      await this.prisma.quote.update({ where: { id: quoteId }, data: { status: 'EXPIRED' } }).catch(() => {});
      throw Object.assign(
        new Error("Ce devis a expiré. Demandez au professionnel d'en envoyer un nouveau."),
        { status: 400, code: 'QUOTE_EXPIRED' }
      );
    }

    const quote = await this.prisma.quote.update({ where: { id: quoteId }, data: { status } });

    if (status === 'ACCEPTED') {
      await this.prisma.project.update({ where: { id: quote.projectId }, data: { status: 'IN_PROGRESS' } }).catch(err => {
        logger.error('[QuoteModule] respond — failed to update project status', { quoteId, error: err.message });
      });
    }

    logger.info('[QuoteModule] Quote response', { quoteId, status });
    return { quote, professional: existing };
  }

  // ---- Cancel (professional) ----

  async cancel(quoteId, professionalId) {
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.professionalId !== professionalId) {
      throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
    }
    if (quote.status !== 'PENDING') {
      throw Object.assign(new Error('Seul un devis en attente peut être annulé'), { status: 400, code: 'INVALID_QUOTE_STATUS' });
    }

    await this.prisma.quote.delete({ where: { id: quoteId } });
    return { cancelled: true };
  }

  // ---- Full quote data for PDF generation ----

  async getForPdf(quoteId) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        professional: { include: { user: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
        project: { include: { client: { select: { firstName: true, lastName: true, email: true, phone: true, city: true } } } },
      },
    });
    if (!quote) throw Object.assign(new Error('Devis introuvable'), { status: 404, code: 'QUOTE_NOT_FOUND' });
    return quote;
  }

  async savePdfUrl(quoteId, pdfUrl) {
    return this.prisma.quote.update({ where: { id: quoteId }, data: { pdfUrl } });
  }

  // ---- Monthly quota check ----

  async countThisMonth(professionalId) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return this.prisma.quote.count({ where: { professionalId, createdAt: { gte: startOfMonth } } });
  }
}

module.exports = QuoteModule;
