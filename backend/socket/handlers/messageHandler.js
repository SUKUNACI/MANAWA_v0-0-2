/**
 * Messaging Real-time Event Handlers
 * Manages real-time chat, typing indicators, and message receipts
 */

const { SOCKET_EVENTS, ROOM_PATTERNS } = require('../../utils/socket-events');
const logger = require('../../utils/logger');
const prisma = require('../../config/db');

/**
 * Register messaging event handlers on socket connection
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
function registerMessageHandlers(socket, io) {
  /**
   * Handle new message broadcast
   * Persists to database and broadcasts to conversation room
   */
  socket.on(SOCKET_EVENTS.MESSAGE_NEW, async (data) => {
    try {
      const { conversationId, text, metadata } = data;
      const senderId = socket.userId;

      if (!conversationId || !text) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }

      // Verify user is part of conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          participantIds: true,
          id: true,
        },
      });

      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found' });
        return;
      }

      const participantIds = Array.isArray(conversation.participantIds)
        ? conversation.participantIds
        : [];

      if (!participantIds.includes(senderId)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      // Save message to database
      const message = await prisma.message.create({
        data: {
          conversationId,
          senderId,
          text,
          metadata: metadata ? JSON.stringify(metadata) : null,
          createdAt: new Date(),
        },
      });

      const messagePayload = {
        id: message.id,
        conversationId,
        senderId,
        text,
        metadata: metadata || null,
        timestamp: message.createdAt,
        delivered: true,
      };

      // Broadcast to conversation room
      io.to(ROOM_PATTERNS.CONVERSATION_ROOM(conversationId)).emit(
        SOCKET_EVENTS.MESSAGE_NEW,
        messagePayload
      );

      logger.info('Message sent', {
        messageId: message.id,
        conversationId,
        senderId,
      });
    } catch (err) {
      logger.error('Error sending message', { error: err.message });
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  /**
   * Handle typing indicator
   * Broadcasting without persistence (ephemeral)
   */
  socket.on(SOCKET_EVENTS.MESSAGE_TYPING, async (data) => {
    try {
      const { conversationId, isTyping } = data;
      const userId = socket.userId;

      if (!conversationId) {
        socket.emit('error', { message: 'Missing conversationId' });
        return;
      }

      // Verify user is part of conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { participantIds: true },
      });

      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found' });
        return;
      }

      const participantIds = Array.isArray(conversation.participantIds)
        ? conversation.participantIds
        : [];

      if (!participantIds.includes(userId)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      const typingPayload = {
        conversationId,
        userId,
        isTyping: isTyping === true,
        timestamp: new Date(),
      };

      // Broadcast to all in conversation except sender
      socket.to(ROOM_PATTERNS.CONVERSATION_ROOM(conversationId)).emit(
        SOCKET_EVENTS.MESSAGE_TYPING,
        typingPayload
      );

      logger.debug('Typing indicator sent', { conversationId, userId, isTyping });
    } catch (err) {
      logger.error('Error sending typing indicator', { error: err.message });
    }
  });

  /**
   * Handle message read receipt
   */
  socket.on(SOCKET_EVENTS.MESSAGE_SEEN, async (data) => {
    try {
      const { messageId, conversationId } = data;
      const userId = socket.userId;

      if (!messageId || !conversationId) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }

      // Verify user is part of conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { participantIds: true },
      });

      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found' });
        return;
      }

      const participantIds = Array.isArray(conversation.participantIds)
        ? conversation.participantIds
        : [];

      if (!participantIds.includes(userId)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      // Update message seen status
      await prisma.message.update({
        where: { id: messageId },
        data: {
          seenBy: {
            push: userId,
          },
          seenAt: new Date(),
        },
      });

      const seenPayload = {
        messageId,
        conversationId,
        seenBy: userId,
        timestamp: new Date(),
      };

      // Broadcast to conversation
      io.to(ROOM_PATTERNS.CONVERSATION_ROOM(conversationId)).emit(
        SOCKET_EVENTS.MESSAGE_SEEN,
        seenPayload
      );

      logger.debug('Message marked as seen', { messageId, userId });
    } catch (err) {
      logger.error('Error marking message seen', { error: err.message });
    }
  });

  /**
   * Handle message delivery confirmation
   */
  socket.on(SOCKET_EVENTS.MESSAGE_DELIVERED, async (data) => {
    try {
      const { messageId, conversationId } = data;

      if (!messageId || !conversationId) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }

      const deliveredPayload = {
        messageId,
        conversationId,
        delivered: true,
        timestamp: new Date(),
      };

      // Broadcast to sender (original sender wants confirmation)
      socket.emit(SOCKET_EVENTS.MESSAGE_DELIVERED, deliveredPayload);

      logger.debug('Message delivered', { messageId });
    } catch (err) {
      logger.error('Error confirming delivery', { error: err.message });
    }
  });
}

/**
 * Join user to conversation room for real-time updates
 */
async function joinConversationRoom(socket, conversationId) {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { participantIds: true },
    });

    if (!conversation) return;

    const participantIds = Array.isArray(conversation.participantIds)
      ? conversation.participantIds
      : [];

    if (participantIds.includes(socket.userId)) {
      const room = ROOM_PATTERNS.CONVERSATION_ROOM(conversationId);
      socket.join(room);
      logger.debug('User joined conversation room', {
        userId: socket.userId,
        conversationId,
      });
    }
  } catch (err) {
    logger.error('Error joining conversation room', { error: err.message });
  }
}

/**
 * Leave conversation room
 */
function leaveConversationRoom(socket, conversationId) {
  const room = ROOM_PATTERNS.CONVERSATION_ROOM(conversationId);
  socket.leave(room);
  logger.debug('User left conversation room', {
    userId: socket.userId,
    conversationId,
  });
}

module.exports = {
  registerMessageHandlers,
  joinConversationRoom,
  leaveConversationRoom,
};
