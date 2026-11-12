/**
 * Notification Real-time Event Handlers
 * Manages real-time push alerts and notification delivery
 */

const { SOCKET_EVENTS, ROOM_PATTERNS } = require('../../utils/socket-events');
const logger = require('../../utils/logger');
const prisma = require('../../config/db');

/**
 * Register notification event handlers on socket connection
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
function registerNotificationHandlers(socket, io) {
  /**
   * Push real-time notification to user
   * Should be called from server-side (API routes, webhooks, job workers)
   */
  socket.on(SOCKET_EVENTS.NOTIFICATION_PUSH, async (data) => {
    try {
      const { recipientId, type, title, message, actionUrl, metadata } = data;

      // Verify authorization - only users can push to their own room
      // In practice, this should be called from server-side only
      if (recipientId !== socket.userId) {
        logger.warn('Unauthorized notification push attempt', {
          attemptedBy: socket.userId,
          targetUser: recipientId,
        });
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      // Validate notification data
      if (!type || !title || !message) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }

      // Save notification to database
      const notification = await prisma.notification.create({
        data: {
          userId: recipientId,
          type,
          title,
          message,
          actionUrl: actionUrl || null,
          metadata: metadata ? JSON.stringify(metadata) : null,
          read: false,
          createdAt: new Date(),
        },
      });

      const notificationPayload = {
        id: notification.id,
        type,
        title,
        message,
        actionUrl: actionUrl || null,
        metadata: metadata || null,
        read: false,
        timestamp: notification.createdAt,
      };

      // Send to user's notification room
      io.to(ROOM_PATTERNS.NOTIFICATION_ROOM(recipientId)).emit(
        SOCKET_EVENTS.NOTIFICATION_PUSH,
        notificationPayload
      );

      logger.info('Notification sent', {
        notificationId: notification.id,
        userId: recipientId,
        type,
      });
    } catch (err) {
      logger.error('Error sending notification', { error: err.message });
      socket.emit('error', { message: 'Failed to send notification' });
    }
  });

  /**
   * Mark notification as read
   */
  socket.on(SOCKET_EVENTS.NOTIFICATION_READ, async (data) => {
    try {
      const { notificationId } = data;
      const userId = socket.userId;

      if (!notificationId) {
        socket.emit('error', { message: 'Missing notificationId' });
        return;
      }

      // Verify notification belongs to user
      const notification = await prisma.notification.findUnique({
        where: { id: notificationId },
        select: { userId: true },
      });

      if (!notification || notification.userId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      // Update notification
      await prisma.notification.update({
        where: { id: notificationId },
        data: { read: true },
      });

      const readPayload = {
        notificationId,
        read: true,
        timestamp: new Date(),
      };

      // Broadcast to user's notification room
      io.to(ROOM_PATTERNS.NOTIFICATION_ROOM(userId)).emit(
        SOCKET_EVENTS.NOTIFICATION_READ,
        readPayload
      );

      logger.debug('Notification marked as read', { notificationId, userId });
    } catch (err) {
      logger.error('Error marking notification read', { error: err.message });
      socket.emit('error', { message: 'Failed to mark notification as read' });
    }
  });

  /**
   * Clear all notifications for user
   */
  socket.on(SOCKET_EVENTS.NOTIFICATION_CLEAR, async (data) => {
    try {
      const userId = socket.userId;

      // Delete all unread notifications for user
      const { count } = await prisma.notification.deleteMany({
        where: { userId, read: false },
      });

      const clearPayload = {
        clearedCount: count,
        timestamp: new Date(),
      };

      // Broadcast to user's notification room
      io.to(ROOM_PATTERNS.NOTIFICATION_ROOM(userId)).emit(
        SOCKET_EVENTS.NOTIFICATION_CLEAR,
        clearPayload
      );

      logger.info('Notifications cleared', { userId, count });
    } catch (err) {
      logger.error('Error clearing notifications', { error: err.message });
      socket.emit('error', { message: 'Failed to clear notifications' });
    }
  });
}

/**
 * Server-side method to push notification to user (called from routes/workers)
 * @param {Server} io - Socket.IO server instance
 * @param {string} userId - Target user ID
 * @param {Object} notification - Notification payload
 */
async function pushNotificationToUser(io, userId, notification) {
  try {
    const { type, title, message, actionUrl, metadata } = notification;

    // Validate
    if (!type || !title || !message) {
      throw new Error('Missing required notification fields');
    }

    // Save to database
    const saved = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        actionUrl: actionUrl || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        read: false,
        createdAt: new Date(),
      },
    });

    const payload = {
      id: saved.id,
      type,
      title,
      message,
      actionUrl: actionUrl || null,
      metadata: metadata || null,
      read: false,
      timestamp: saved.createdAt,
    };

    // Emit to user's notification room
    io.to(ROOM_PATTERNS.NOTIFICATION_ROOM(userId)).emit(
      SOCKET_EVENTS.NOTIFICATION_PUSH,
      payload
    );

    logger.info('Notification pushed to user', { userId, type });
    return saved;
  } catch (err) {
    logger.error('Error pushing notification', { error: err.message, userId });
    throw err;
  }
}

/**
 * Broadcast notification to multiple users
 */
async function broadcastNotification(io, userIds, notification) {
  try {
    for (const userId of userIds) {
      await pushNotificationToUser(io, userId, notification);
    }
    logger.info('Notification broadcasted', { count: userIds.length });
  } catch (err) {
    logger.error('Error broadcasting notification', { error: err.message });
  }
}

/**
 * Join user to notification room
 */
function joinNotificationRoom(socket) {
  const room = ROOM_PATTERNS.NOTIFICATION_ROOM(socket.userId);
  socket.join(room);
  logger.debug('User joined notification room', { userId: socket.userId });
}

module.exports = {
  registerNotificationHandlers,
  pushNotificationToUser,
  broadcastNotification,
  joinNotificationRoom,
};
