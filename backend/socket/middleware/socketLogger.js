/**
 * Socket.IO Event Logging Middleware
 * Logs all socket events for debugging and monitoring
 */

const logger = require('../../utils/logger');
const { SOCKET_EVENTS } = require('../../utils/socket-events');

// Configuration
const LOG_CONFIG = {
  logConnections: true,
  logDisconnections: true,
  logAllEvents: process.env.SOCKET_LOG_ALL === 'true',
  logErrors: true,
  excludeEvents: ['ping', 'pong', 'connect_error'], // Don't log these
};

/**
 * Initialize socket event logging on a socket
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
function initializeSocketLogging(socket, io) {
  const userId = socket.userId || 'unknown';
  const socketId = socket.id;

  // Log connection
  if (LOG_CONFIG.logConnections) {
    logger.info('Socket connected', {
      socketId,
      userId,
      address: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
    });
  }

  // Wrap emit to log outgoing events
  const originalEmit = socket.emit;
  socket.emit = function (eventName, ...args) {
    if (shouldLogEvent(eventName)) {
      logger.debug('Socket emit', {
        socketId,
        userId,
        eventName,
        dataSize: getDataSize(args[0]),
      });
    }
    return originalEmit.apply(this, arguments);
  };

  // Log incoming events
  socket.onAny((eventName, ...args) => {
    if (shouldLogEvent(eventName)) {
      logger.debug('Socket received', {
        socketId,
        userId,
        eventName,
        dataSize: getDataSize(args[0]),
      });
    }
  });

  // Log errors
  socket.on('error', (error) => {
    if (LOG_CONFIG.logErrors) {
      logger.error('Socket error', {
        socketId,
        userId,
        error: error.message,
        stack: error.stack,
      });
    }
  });

  // Log disconnection
  socket.on('disconnect', (reason) => {
    if (LOG_CONFIG.logDisconnections) {
      logger.info('Socket disconnected', {
        socketId,
        userId,
        reason,
      });
    }

    // Log other connected clients for debugging
    const connectedCount = io.engine.clientsCount;
    if (connectedCount % 100 === 0) {
      logger.info('Connected clients update', { count: connectedCount });
    }
  });
}

/**
 * Determine if an event should be logged
 */
function shouldLogEvent(eventName) {
  if (!LOG_CONFIG.logAllEvents) return false;
  if (LOG_CONFIG.excludeEvents.includes(eventName)) return false;
  return true;
}

/**
 * Get approximate data size for logging
 */
function getDataSize(data) {
  if (!data) return 0;
  try {
    return JSON.stringify(data).length;
  } catch {
    return 'unknown';
  }
}

/**
 * Create performance monitoring middleware
 * Tracks event processing time
 */
function createPerformanceMonitor(eventName) {
  return (socket, next) => {
    const startTime = Date.now();
    const originalCallback = next;

    socket.on(eventName, async (data, callback) => {
      const eventStartTime = Date.now();
      const wrappedCallback = (err) => {
        const duration = Date.now() - eventStartTime;
        if (duration > 1000) {
          // Log slow events
          logger.warn('Slow socket event', {
            eventName,
            duration,
            userId: socket.userId,
          });
        }
        if (callback) callback(err);
      };

      // Call the actual event handler with timing
      try {
        originalCallback(data, wrappedCallback);
      } catch (err) {
        logger.error('Socket event handler error', {
          eventName,
          error: err.message,
          userId: socket.userId,
        });
        wrappedCallback(err);
      }
    });
  };
}

/**
 * Log socket statistics at intervals
 */
function logSocketStatistics(io) {
  setInterval(() => {
    try {
      const stats = {
        totalConnections: io.engine.clientsCount,
        totalSockets: Object.keys(io.sockets.sockets).length,
        rooms: io.sockets.adapter.rooms ? io.sockets.adapter.rooms.size : 0,
        timestamp: new Date(),
      };

      logger.info('Socket statistics', stats);
    } catch (err) {
      logger.error('Error collecting socket statistics', { error: err.message });
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

/**
 * Format event log for readability
 */
function formatEventLog(eventName, data, direction = 'in') {
  const arrow = direction === 'in' ? '→' : '←';
  const size = JSON.stringify(data || {}).length;
  return `${arrow} ${eventName} (${size}B)`;
}

/**
 * Create audit log for security events
 */
async function auditSocketEvent(socket, eventName, data) {
  try {
    // Only audit security-related events
    const securityEvents = [
      SOCKET_EVENTS.BOOKING_UPDATE,
      SOCKET_EVENTS.PAYMENT_STATUS,
      SOCKET_EVENTS.NOTIFICATION_PUSH,
    ];

    if (securityEvents.includes(eventName)) {
      logger.info('Socket audit event', {
        socketId: socket.id,
        userId: socket.userId,
        eventName,
        timestamp: new Date(),
      });
    }
  } catch (err) {
    logger.error('Audit logging error', { error: err.message });
  }
}

/**
 * Log user activity summary at the end of session
 */
function logSessionSummary(socket, sessionData) {
  try {
    logger.info('Socket session closed', {
      socketId: socket.id,
      userId: socket.userId,
      duration: sessionData.duration,
      eventsCount: sessionData.eventsCount,
      errorsCount: sessionData.errorsCount,
    });
  } catch (err) {
    logger.error('Session summary logging error', { error: err.message });
  }
}

module.exports = {
  initializeSocketLogging,
  createPerformanceMonitor,
  logSocketStatistics,
  formatEventLog,
  auditSocketEvent,
  logSessionSummary,
  LOG_CONFIG,
};
