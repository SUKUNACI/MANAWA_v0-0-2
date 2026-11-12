/**
 * Presence Real-time Event Handlers
 * Manages user online/offline status and tracking
 */

const { SOCKET_EVENTS, ROOM_PATTERNS } = require('../../utils/socket-events');
const logger = require('../../utils/logger');
const redis = require('../../config/redis');

// In-memory fallback (when Redis is unavailable)
const onlineUsersMap = new Map();

/**
 * Register presence event handlers on socket connection
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
function registerPresenceHandlers(socket, io) {
  /**
   * Track user as online
   */
  socket.on(SOCKET_EVENTS.USER_ONLINE, async () => {
    try {
      const userId = socket.userId;

      // Store in Redis with TTL
      await setUserOnline(userId, socket.id);

      const onlinePayload = {
        userId,
        status: 'online',
        timestamp: new Date(),
      };

      // Broadcast to global presence room
      io.to(ROOM_PATTERNS.PRESENCE_ROOM()).emit(SOCKET_EVENTS.USER_ONLINE, onlinePayload);

      logger.info('User came online', { userId, socketId: socket.id });
    } catch (err) {
      logger.error('Error handling user online', { error: err.message });
    }
  });

  /**
   * Track user as offline
   */
  socket.on(SOCKET_EVENTS.USER_OFFLINE, async () => {
    try {
      const userId = socket.userId;

      await setUserOffline(userId);

      const offlinePayload = {
        userId,
        status: 'offline',
        timestamp: new Date(),
      };

      // Broadcast to global presence room
      io.to(ROOM_PATTERNS.PRESENCE_ROOM()).emit(SOCKET_EVENTS.USER_OFFLINE, offlinePayload);

      logger.info('User went offline', { userId });
    } catch (err) {
      logger.error('Error handling user offline', { error: err.message });
    }
  });
}

/**
 * Handle user going online on connection
 */
async function handleUserConnect(socket, io) {
  try {
    const userId = socket.userId;

    // Set user as online
    await setUserOnline(userId, socket.id);

    const onlinePayload = {
      userId,
      status: 'online',
      timestamp: new Date(),
    };

    // Broadcast to all connected clients
    io.to(ROOM_PATTERNS.PRESENCE_ROOM()).emit(SOCKET_EVENTS.USER_ONLINE, onlinePayload);

    logger.info('User connected', { userId, socketId: socket.id });
  } catch (err) {
    logger.error('Error handling user connect', { error: err.message });
  }
}

/**
 * Handle user going offline on disconnect
 */
async function handleUserDisconnect(socket, io) {
  try {
    const userId = socket.userId;

    // Check if user has other active connections
    const hasOtherConnections = await checkUserHasOtherConnections(userId, socket.id);

    if (!hasOtherConnections) {
      // User is completely offline
      await setUserOffline(userId);

      const offlinePayload = {
        userId,
        status: 'offline',
        timestamp: new Date(),
      };

      io.to(ROOM_PATTERNS.PRESENCE_ROOM()).emit(SOCKET_EVENTS.USER_OFFLINE, offlinePayload);

      logger.info('User disconnected completely', { userId });
    } else {
      logger.debug('User has other connections', { userId });
    }
  } catch (err) {
    logger.error('Error handling user disconnect', { error: err.message });
  }
}

/**
 * Set user as online in Redis/Map
 */
async function setUserOnline(userId, socketId) {
  try {
    // Try Redis first
    const redisClient = redis.getClient();
    if (redisClient) {
      const key = `user:online:${userId}`;
      await redisClient.set(key, socketId, 'EX', 24 * 60 * 60); // 24h TTL
    } else {
      // Fallback to in-memory map
      onlineUsersMap.set(userId, { socketId, timestamp: Date.now() });
    }
  } catch (err) {
    logger.warn('Error setting user online', { error: err.message, userId });
    // Fallback to in-memory
    onlineUsersMap.set(userId, { socketId, timestamp: Date.now() });
  }
}

/**
 * Set user as offline
 */
async function setUserOffline(userId) {
  try {
    // Try Redis first
    const redisClient = redis.getClient();
    if (redisClient) {
      const key = `user:online:${userId}`;
      await redisClient.del(key);
    } else {
      // Fallback to in-memory map
      onlineUsersMap.delete(userId);
    }
  } catch (err) {
    logger.warn('Error setting user offline', { error: err.message, userId });
    // Fallback to in-memory
    onlineUsersMap.delete(userId);
  }
}

/**
 * Check if user is online
 */
async function isUserOnline(userId) {
  try {
    const redisClient = redis.getClient();
    if (redisClient) {
      const key = `user:online:${userId}`;
      const result = await redisClient.get(key);
      return result !== null;
    } else {
      // Fallback to in-memory map
      return onlineUsersMap.has(userId);
    }
  } catch (err) {
    logger.warn('Error checking user online status', { error: err.message, userId });
    return onlineUsersMap.has(userId);
  }
}

/**
 * Get all online users (count)
 */
async function getOnlineUsersCount() {
  try {
    const redisClient = redis.getClient();
    if (redisClient) {
      const keys = await redisClient.keys('user:online:*');
      return keys.length;
    } else {
      // Fallback to in-memory map
      return onlineUsersMap.size;
    }
  } catch (err) {
    logger.warn('Error getting online users count', { error: err.message });
    return onlineUsersMap.size;
  }
}

/**
 * Get list of all online users
 */
async function getOnlineUsers() {
  try {
    const redisClient = redis.getClient();
    if (redisClient) {
      const keys = await redisClient.keys('user:online:*');
      return keys.map(k => k.replace('user:online:', ''));
    } else {
      // Fallback to in-memory map
      return Array.from(onlineUsersMap.keys());
    }
  } catch (err) {
    logger.warn('Error getting online users list', { error: err.message });
    return Array.from(onlineUsersMap.keys());
  }
}

/**
 * Check if user has other active connections
 */
async function checkUserHasOtherConnections(userId, currentSocketId) {
  try {
    // In a distributed system, we'd check Redis for other active sockets
    // For simplicity, we assume if the key exists and doesn't match current socketId, there are others
    const redisClient = redis.getClient();
    if (redisClient) {
      const key = `user:online:${userId}`;
      const storedSocketId = await redisClient.get(key);
      return storedSocketId && storedSocketId !== currentSocketId;
    }
    return false; // Fallback: assume no other connections
  } catch (err) {
    logger.warn('Error checking other connections', { error: err.message });
    return false;
  }
}

/**
 * Join user to global presence room
 */
function joinPresenceRoom(socket) {
  const room = ROOM_PATTERNS.PRESENCE_ROOM();
  socket.join(room);
  logger.debug('User joined presence room', { userId: socket.userId });
}

/**
 * Broadcast user status to specific users
 */
async function broadcastUserStatus(io, targetUserIds, userId, status) {
  try {
    const payload = {
      userId,
      status,
      timestamp: new Date(),
    };

    for (const targetUserId of targetUserIds) {
      io.to(ROOM_PATTERNS.USER_ROOM(targetUserId)).emit(
        status === 'online' ? SOCKET_EVENTS.USER_ONLINE : SOCKET_EVENTS.USER_OFFLINE,
        payload
      );
    }

    logger.debug('User status broadcasted', { userId, status, count: targetUserIds.length });
  } catch (err) {
    logger.error('Error broadcasting user status', { error: err.message });
  }
}

module.exports = {
  registerPresenceHandlers,
  handleUserConnect,
  handleUserDisconnect,
  setUserOnline,
  setUserOffline,
  isUserOnline,
  getOnlineUsersCount,
  getOnlineUsers,
  joinPresenceRoom,
  broadcastUserStatus,
};
