'use strict';

const logger = require('../utils/logger');

/**
 * Message Module — Send, list conversations, fetch thread, mark as read, upload attachment
 */

const ATTACHMENT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

class MessageModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // ---- Send ----

  /**
   * Validate sender–receiver relationship and persist the message.
   * Relationship rules: CLIENT ↔ PROFESSIONAL only, via shared quote or existing conversation.
   * ADMINs may contact anyone.
   */
  async send({ senderId, senderRole, receiverId, content, attachmentUrl, attachmentType }) {
    if (!content || content.trim().length === 0) {
      throw Object.assign(new Error('Message cannot be empty'), { status: 400 });
    }
    if (content.length > 5000) {
      throw Object.assign(new Error('Message too long (max 5000 chars)'), { status: 400 });
    }
    if (content.includes('\x00') || content.includes('\0')) {
      throw Object.assign(new Error('Invalid content'), { status: 400 });
    }

    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, suspended: true, role: true },
    });
    if (!receiver) throw Object.assign(new Error('Destinataire introuvable'), { status: 404 });
    if (receiver.suspended) throw Object.assign(new Error('Ce compte est suspendu'), { status: 403 });

    if (senderRole !== 'ADMIN' && receiver.role !== 'ADMIN') {
      await this._assertClientProRelationship(senderId, senderRole, receiverId, receiver.role);
    }

    const message = await this.prisma.message.create({
      data: {
        senderId,
        receiverId,
        content: content.trim(),
        ...(attachmentUrl ? { attachmentUrl, attachmentType: attachmentType || null } : {}),
      },
    });

    logger.info('[MessageModule] Message sent', { senderId, receiverId, messageId: message.id });
    return message;
  }

  async _assertClientProRelationship(senderId, senderRole, receiverId, receiverRole) {
    if (
      (senderRole === 'CLIENT' && receiverRole !== 'PROFESSIONAL') ||
      (senderRole === 'PROFESSIONAL' && receiverRole !== 'CLIENT')
    ) {
      throw Object.assign(new Error('Messagerie réservée aux échanges client-professionnel'), { status: 403 });
    }

    const clientId = senderRole === 'CLIENT' ? senderId : receiverId;
    const proUserId = senderRole === 'PROFESSIONAL' ? senderId : receiverId;

    const pro = await this.prisma.professional.findUnique({ where: { userId: proUserId }, select: { id: true } });
    if (!pro) throw Object.assign(new Error('Aucune relation avec ce professionnel'), { status: 403 });

    const [hasRelation, existingConversation] = await Promise.all([
      this.prisma.quote.findFirst({
        where: { professionalId: pro.id, project: { clientId } },
        select: { id: true },
      }),
      this.prisma.message.findFirst({
        where: {
          OR: [
            { senderId, receiverId },
            { senderId: receiverId, receiverId: senderId },
          ],
        },
        select: { id: true },
      }),
    ]);

    if (!hasRelation && !existingConversation) {
      throw Object.assign(
        new Error("Vous ne pouvez contacter ce professionnel qu'après avoir soumis un projet"),
        { status: 403 }
      );
    }
  }

  // ---- Conversations list ----

  async listConversations(userId) {
    const messages = await this.prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        receiver: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const conversations = new Map();
    for (const m of messages) {
      const otherUser = m.senderId === userId ? m.receiver : m.sender;
      if (!conversations.has(otherUser.id)) {
        conversations.set(otherUser.id, { otherUser, lastMessage: m });
      }
    }
    return Array.from(conversations.values());
  }

  // ---- Unread count ----

  async getUnreadCount(userId) {
    return this.prisma.message.count({ where: { receiverId: userId, read: false } });
  }

  // ---- Thread (paginated) ----

  async getThread(userId, otherUserId, { limit, skip }) {
    const [messages] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: userId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      // Mark messages as read in parallel with the fetch
      this.prisma.message.updateMany({
        where: { senderId: otherUserId, receiverId: userId, read: false },
        data: { read: true },
      }),
    ]);

    return messages.reverse();
  }

  // ---- Sender info (for push notification) ----

  async getSenderName(senderId) {
    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { firstName: true, lastName: true },
    });
    return sender ? `${sender.firstName} ${sender.lastName}` : 'Quelqu\'un';
  }

  // ---- Attachment validation ----

  isAllowedMime(mimeType) {
    return ATTACHMENT_MIMES.has(mimeType);
  }

  resolveAttachmentType(mimeType) {
    return mimeType === 'application/pdf' ? 'pdf' : 'image';
  }
}

module.exports = MessageModule;
