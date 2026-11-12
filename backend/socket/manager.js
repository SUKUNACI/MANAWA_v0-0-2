/**
 * Socket.IO Manager
 * Central orchestration of all socket handlers, middleware, and room management
 */

const { socketAuthMiddleware } = require('./middleware/socketAuth');
const { initializeSocketLogging, logSocketStatistics } = require('./middleware/socketLogger');
const { registerBookingHandlers, joinBookingRoom, leaveBookingRoom } = require('./handlers/bookingHandler');
const { registerMessageHandlers, joinConversationRoom, leaveConversationRoom } = require('./handlers/messageHandler');
const { registerNotificationHandlers, joinNotificationRoom } = require('./handlers/notificationHandler');
const {
  registerPresenceHandlers,
  handleUserConnect,
  handleUserDisconnect,
  joinPresenceRoom,
} = require('./handlers/presenceHandler');
const { registerPaymentHandlers } = require('./handlers/paymentHandler');
const logger = require('../utils/logger');

/**
 * Initialize Socket.IO server
 * @param {Server} io - Socket.IO server instance
 */
function initializeSocket(io) {
  // Apply authentication middleware
  io.use(socketAuthMiddleware);

  // Handle connections
  io.on('connection', async (socket) => {
    try {
      // Initialize logging
      initializeSocketLogging(socket, io);

      // Register all event handlers
      registerBookingHandlers(socket, io);
      registerMessageHandlers(socket, io);
      registerNotificationHandlers(socket, io);
      registerPresenceHandlers(socket, io);
      registerPaymentHandlers(socket, io);

      // Join default rooms
      joinPresenceRoom(socket);
      joinNotificationRoom(socket);

      // Handle user coming online
      await handleUserConnect(socket, io);

      /**
       * Subscription endpoints
       * Clients can subscribe to specific rooms/channels
       */
      socket.on('subscribe:booking', async (data) => {
        const { bookingId } = data;
        if (bookingId) {
          await joinBookingRoom(socket, bookingId);
        }
      });

      socket.on('unsubscribe:booking', (data) => {
        const { bookingId } = data;
        if (bookingId) {
          leaveBookingRoom(socket, bookingId);
        }
      });

      socket.on('subscribe:conversation', async (data) => {
        const { conversationId } = data;
        if (conversationId) {
          await joinConversationRoom(socket, conversationId);
        }
      });

      socket.on('unsubscribe:conversation', (data) => {
        const { conversationId } = data;
        if (conversationId) {
          leaveConversationRoom(socket, conversationId);
        }
      });

      /**
       * Heartbeat/ping to keep connection alive
       */
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date() });
      });

      /**
       * Get current online status
       */
      socket.on('get:online_status', (data) => {
        socket.emit('online_status', {
          userId: socket.userId,
          online: true,
          timestamp: new Date(),
        });
      });

      // Handle disconnection
      socket.on('disconnect', async () => {
        await handleUserDisconnect(socket, io);
      });
    } catch (err) {
      logger.error('Socket connection error', {
        socketId: socket.id,
        error: err.message,
      });
      socket.emit('error', { message: 'Connection initialization failed' });
    }
  });

  // Log socket statistics periodically
  logSocketStatistics(io);

  logger.info('Socket.IO initialized', {
    maxHttpBufferSize: io.maxHttpBufferSize,
    transports: io.transports,
  });

  return io;
}

/**
 * Get Socket.IO utilities for use in routes/workers
 * These can be called from API handlers to push real-time updates
 */
function getSocketUtilities(io) {
  return {
    // Booking utilities
    notifyBookingUpdate: async (bookingId, update) => {
      io.to(`booking:${bookingId}`).emit('booking.update', update);
    },

    // Message utilities
    notifyNewMessage: async (conversationId, message) => {
      io.to(`conversation:${conversationId}`).emit('message.new', message);
    },

    // Notification utilities
    notifyUser: async (userId, notification) => {
      io.to(`notifications:${userId}`).emit('notification.push', notification);
    },

    // Presence utilities
    broadcastUserStatus: async (userId, status) => {
      io.to('presence:global').emit(
        status === 'online' ? 'user.online' : 'user.offline',
        { userId, status, timestamp: new Date() }
      );
    },

    // Payment utilities
    notifyPaymentUpdate: async (userId, paymentUpdate) => {
      io.to(`user:${userId}`).emit('payment.status', paymentUpdate);
    },

    // Broadcast to user room
    toUserRoom: (userId) => io.to(`user:${userId}`),

    // Broadcast to booking room
    toBookingRoom: (bookingId) => io.to(`booking:${bookingId}`),

    // Broadcast to conversation room
    toConversationRoom: (conversationId) => io.to(`conversation:${conversationId}`),

    // Get statistics
    getStats: () => ({
      totalConnections: io.engine.clientsCount,
      totalSockets: Object.keys(io.sockets.sockets).length,
    }),
  };
}

/**
 * Create Socket.IO server instance
 * Called from index.js
 */
function createSocketServer(server, options = {}) {
  const { Server } = require('socket.io');

  const defaultOptions = {
    cors: {
      origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
        : ['http://localhost:8081', 'http://localhost:19006'],
      credentials: true,
    },
    maxHttpBufferSize: 1e6, // 1MB
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 60000,
  };

  const io = new Server(server, { ...defaultOptions, ...options });
  return initializeSocket(io);
}

module.exports = {
  initializeSocket,
  getSocketUtilities,
  createSocketServer,
};
