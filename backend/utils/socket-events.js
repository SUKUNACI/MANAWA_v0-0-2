/**
 * Socket.IO Event Definitions and Constants
 * Centralizes all real-time event names and types for type safety
 */

// Event categories and their definitions
const SOCKET_EVENTS = {
  // Booking events
  BOOKING_UPDATE: 'booking.update',           // Real-time reservation changes
  BOOKING_CONFIRM: 'booking.confirm',         // Booking confirmation
  BOOKING_CANCEL: 'booking.cancel',           // Booking cancellation
  BOOKING_COMPLETED: 'booking.completed',     // Booking marked as complete

  // Messaging events
  MESSAGE_NEW: 'message.new',                 // New chat message
  MESSAGE_TYPING: 'message.typing',           // User is typing indicator
  MESSAGE_SEEN: 'message.seen',               // Message read receipt
  MESSAGE_DELIVERED: 'message.delivered',     // Message delivery confirmation

  // Notification events
  NOTIFICATION_PUSH: 'notification.push',     // Real-time notification alert
  NOTIFICATION_READ: 'notification.read',     // Notification marked as read
  NOTIFICATION_CLEAR: 'notification.clear',   // Notifications cleared

  // Presence events
  USER_ONLINE: 'user.online',                 // User came online
  USER_OFFLINE: 'user.offline',               // User went offline
  USER_TYPING: 'user.typing',                 // Typing indicator (alternative)
  USER_STOPPED_TYPING: 'user.stopped_typing', // User stopped typing

  // Payment events
  PAYMENT_STATUS: 'payment.status',           // Payment status update
  PAYMENT_PENDING: 'payment.pending',         // Payment initiated
  PAYMENT_SUCCESS: 'payment.success',         // Payment completed
  PAYMENT_FAILED: 'payment.failed',           // Payment failed

  // System events (reserved)
  CONNECT: 'connect',                         // Built-in: socket connected
  DISCONNECT: 'disconnect',                   // Built-in: socket disconnected
  ERROR: 'error',                             // Built-in: error event
};

// Room naming conventions
const ROOM_PATTERNS = {
  USER_ROOM: (userId) => `user:${userId}`,
  BOOKING_ROOM: (bookingId) => `booking:${bookingId}`,
  CONVERSATION_ROOM: (conversationId) => `conversation:${conversationId}`,
  NOTIFICATION_ROOM: (userId) => `notifications:${userId}`,
  PRESENCE_ROOM: () => 'presence:global',    // Global presence room
};

// Payload schemas for validation
const PAYLOAD_SCHEMAS = {
  MESSAGE: {
    conversationId: 'string',
    senderId: 'string',
    text: 'string',
    timestamp: 'number',
  },
  BOOKING: {
    bookingId: 'string',
    status: 'string',
    metadata: 'object',
  },
  NOTIFICATION: {
    userId: 'string',
    type: 'string',
    title: 'string',
    message: 'string',
  },
  TYPING: {
    conversationId: 'string',
    userId: 'string',
    isTyping: 'boolean',
  },
  PAYMENT: {
    paymentId: 'string',
    status: 'string',
    amount: 'number',
  },
};

// Rate limiting configuration per event
const RATE_LIMITS = {
  MESSAGE_NEW: { max: 60, windowMs: 60000 },        // 60 messages per minute
  MESSAGE_TYPING: { max: 100, windowMs: 60000 },    // 100 typing events per minute
  NOTIFICATION_PUSH: { max: 200, windowMs: 60000 }, // 200 notifications per minute
  USER_TYPING: { max: 100, windowMs: 60000 },       // 100 typing updates per minute
};

module.exports = {
  SOCKET_EVENTS,
  ROOM_PATTERNS,
  PAYLOAD_SCHEMAS,
  RATE_LIMITS,
};
