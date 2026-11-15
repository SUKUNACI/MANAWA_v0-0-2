'use strict';

const logger = require('../utils/logger');

/**
 * SupportModule — Ticket lifecycle and message thread management
 */

const VALID_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
const XSS_PATTERN = /&lt;script|&lt;img|&lt;iframe|onerror|onload|onclick/i;
const SQL_PATTERN = /'; DROP|DELETE FROM|INSERT INTO|UNION SELECT/i;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_FIRST_MESSAGE_LENGTH = 2000;

class SupportModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async listTickets(userId) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  async createTicket(userId, { category, subject, message }) {
    if (!category || !subject || !message) {
      throw Object.assign(new Error('Catégorie, sujet et message sont requis'), { status: 400 });
    }
    const trimmedSubject = subject.trim();
    if (trimmedSubject.length < 5 || trimmedSubject.length > 200) {
      throw Object.assign(new Error('Le sujet doit contenir entre 5 et 200 caractères'), { status: 400 });
    }
    if (message.trim().length > MAX_FIRST_MESSAGE_LENGTH) {
      throw Object.assign(new Error(`Message trop long (max ${MAX_FIRST_MESSAGE_LENGTH} chars)`), { status: 400 });
    }
    this._validateMessageContent(message);

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        category,
        subject: trimmedSubject,
        messages: {
          create: { senderId: userId, content: message, isAdmin: false },
        },
      },
      include: { messages: true },
    });

    logger.info('[SupportModule] Ticket created', { userId, ticketId: ticket.id, category });
    return ticket;
  }

  async getTicket(ticketId, userId) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw Object.assign(new Error('Ticket non trouvé'), { status: 404 });
    return ticket;
  }

  async addMessage(ticketId, userId, content) {
    if (!content) throw Object.assign(new Error('Message requis'), { status: 400 });
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw Object.assign(new Error('Message trop long'), { status: 400 });
    }
    this._validateMessageContent(content);

    const ticket = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, userId } });
    if (!ticket) throw Object.assign(new Error('Ticket non trouvé'), { status: 404 });
    if (ticket.status === 'CLOSED') throw Object.assign(new Error('Ce ticket est fermé'), { status: 400 });

    const [msg] = await Promise.all([
      this.prisma.supportMessage.create({
        data: { ticketId: ticket.id, senderId: userId, content, isAdmin: false },
      }),
      this.prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'OPEN' } }),
    ]);

    logger.info('[SupportModule] Message added', { ticketId, userId, messageId: msg.id });
    return msg;
  }

  async updateStatus(ticketId, userId, status) {
    if (!VALID_STATUSES.has(status)) {
      throw Object.assign(new Error('Statut invalide'), { status: 400 });
    }
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, userId } });
    if (!ticket) throw Object.assign(new Error('Ticket non trouvé'), { status: 404 });

    const updated = await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
    logger.info('[SupportModule] Ticket status updated', { ticketId, userId, status });
    return updated;
  }

  _validateMessageContent(content) {
    if (XSS_PATTERN.test(content)) {
      throw Object.assign(new Error('Contenu invalide (XSS detected)'), { status: 400 });
    }
    if (SQL_PATTERN.test(content)) {
      throw Object.assign(new Error('Contenu invalide'), { status: 400 });
    }
    if (content.includes('\x00') || content.includes('\0')) {
      throw Object.assign(new Error('Contenu invalide'), { status: 400 });
    }
  }
}

module.exports = SupportModule;
