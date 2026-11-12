/**
 * Socket.IO Authentication Middleware
 * Verifies JWT tokens on socket connection
 */

const jwt = require('jsonwebtoken');
const prisma = require('../../config/db');
const logger = require('../../utils/logger');

/**
 * Middleware to authenticate socket connection via JWT
 * Extracts token from handshake auth or query params
 * Sets socket.userId for authorized connections
 */
async function socketAuthMiddleware(socket, next) {
  try {
    // Try to get token from multiple sources
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      socket.request.headers?.authorization?.split(' ')[1];

    if (!token) {
      logger.warn('Socket connection attempt without token', {
        socketId: socket.id,
        ip: socket.handshake.address,
      });
      return next(new Error('Authentication error: Token required'));
    }

    // Verify JWT signature
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      logger.warn('Invalid JWT token for socket', {
        socketId: socket.id,
        error: err.message,
      });
      return next(new Error('Authentication error: Invalid token'));
    }

    // Validate user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        suspended: true,
        deletedAt: true,
        role: true,
      },
    });

    if (!user) {
      logger.warn('Socket auth: User not found', {
        socketId: socket.id,
        userId: decoded.id,
      });
      return next(new Error('Authentication error: User not found'));
    }

    if (user.deletedAt) {
      logger.warn('Socket auth: User account deleted', {
        socketId: socket.id,
        userId: decoded.id,
      });
      return next(new Error('Authentication error: User account deleted'));
    }

    if (user.suspended) {
      logger.warn('Socket auth: User account suspended', {
        socketId: socket.id,
        userId: decoded.id,
      });
      return next(new Error('Authentication error: User account suspended'));
    }

    // Attach user info to socket
    socket.userId = user.id;
    socket.userEmail = user.email;
    socket.userRole = user.role;

    logger.info('Socket authenticated successfully', {
      socketId: socket.id,
      userId: user.id,
      email: user.email,
    });

    next();
  } catch (err) {
    logger.error('Socket authentication middleware error', {
      error: err.message,
      socketId: socket.id,
    });
    next(new Error('Authentication error: Server error'));
  }
}

/**
 * Verify user authorization for specific resource
 * Used to check if user has permission to access booking, conversation, etc.
 */
async function verifyResourceAccess(socket, resourceType, resourceId) {
  try {
    const userId = socket.userId;

    switch (resourceType) {
      case 'booking': {
        const booking = await prisma.booking.findUnique({
          where: { id: resourceId },
          select: { clientId: true, professionalId: true },
        });
        return booking && (booking.clientId === userId || booking.professionalId === userId);
      }

      case 'conversation': {
        const conversation = await prisma.conversation.findUnique({
          where: { id: resourceId },
          select: { participantIds: true },
        });
        if (!conversation) return false;
        const participants = Array.isArray(conversation.participantIds)
          ? conversation.participantIds
          : [];
        return participants.includes(userId);
      }

      case 'payment': {
        const payment = await prisma.payment.findUnique({
          where: { id: resourceId },
          select: { userId: true },
        });
        return payment && payment.userId === userId;
      }

      case 'notification': {
        const notification = await prisma.notification.findUnique({
          where: { id: resourceId },
          select: { userId: true },
        });
        return notification && notification.userId === userId;
      }

      default:
        return false;
    }
  } catch (err) {
    logger.error('Error verifying resource access', {
      error: err.message,
      resourceType,
      resourceId,
    });
    return false;
  }
}

/**
 * Verify user is admin (for admin-only socket rooms)
 */
function verifyAdminRole(socket) {
  return socket.userRole === 'ADMIN' || socket.userRole === 'SUPER_ADMIN';
}

module.exports = {
  socketAuthMiddleware,
  verifyResourceAccess,
  verifyAdminRole,
};
