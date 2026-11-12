/**
 * Booking Real-time Event Handlers
 * Manages real-time updates for booking lifecycle events
 */

const { SOCKET_EVENTS, ROOM_PATTERNS } = require('../../utils/socket-events');
const logger = require('../../utils/logger');
const prisma = require('../../config/db');

/**
 * Register booking event handlers on socket connection
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
function registerBookingHandlers(socket, io) {
  /**
   * Notify relevant users of booking update
   * Emits to: client + professional + admin
   */
  socket.on(SOCKET_EVENTS.BOOKING_UPDATE, async (data) => {
    try {
      const { bookingId, status, userId } = data;

      if (!bookingId || !status) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }

      // Verify user has access to this booking
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          status: true,
          projectId: true,
        },
      });

      if (!booking) {
        socket.emit('error', { message: 'Booking not found' });
        return;
      }

      // Verify authorization
      const isAuthorized = booking.clientId === userId || booking.professionalId === userId;
      if (!isAuthorized) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      // Broadcast to booking room (all involved parties)
      const bookingRoom = ROOM_PATTERNS.BOOKING_ROOM(bookingId);
      const updatePayload = {
        bookingId,
        status,
        previousStatus: booking.status,
        timestamp: new Date(),
        updatedBy: userId,
      };

      io.to(bookingRoom).emit(SOCKET_EVENTS.BOOKING_UPDATE, updatePayload);

      // Also notify via user-specific rooms
      io.to(ROOM_PATTERNS.USER_ROOM(booking.clientId)).emit(
        SOCKET_EVENTS.BOOKING_UPDATE,
        updatePayload
      );
      io.to(ROOM_PATTERNS.USER_ROOM(booking.professionalId)).emit(
        SOCKET_EVENTS.BOOKING_UPDATE,
        updatePayload
      );

      logger.info('Booking updated via socket', {
        bookingId,
        status,
        userId,
      });
    } catch (err) {
      logger.error('Error handling booking update', { error: err.message });
      socket.emit('error', { message: 'Failed to update booking' });
    }
  });

  /**
   * Notify booking confirmation
   */
  socket.on(SOCKET_EVENTS.BOOKING_CONFIRM, async (data) => {
    try {
      const { bookingId, userId } = data;

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { clientId: true, professionalId: true },
      });

      if (!booking || (booking.clientId !== userId && booking.professionalId !== userId)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      const confirmPayload = {
        bookingId,
        confirmedBy: userId,
        timestamp: new Date(),
      };

      io.to(ROOM_PATTERNS.BOOKING_ROOM(bookingId)).emit(
        SOCKET_EVENTS.BOOKING_CONFIRM,
        confirmPayload
      );

      logger.info('Booking confirmed', { bookingId, userId });
    } catch (err) {
      logger.error('Error confirming booking', { error: err.message });
      socket.emit('error', { message: 'Failed to confirm booking' });
    }
  });

  /**
   * Notify booking cancellation
   */
  socket.on(SOCKET_EVENTS.BOOKING_CANCEL, async (data) => {
    try {
      const { bookingId, userId, reason } = data;

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { clientId: true, professionalId: true },
      });

      if (!booking || (booking.clientId !== userId && booking.professionalId !== userId)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      const cancelPayload = {
        bookingId,
        cancelledBy: userId,
        reason: reason || null,
        timestamp: new Date(),
      };

      io.to(ROOM_PATTERNS.BOOKING_ROOM(bookingId)).emit(
        SOCKET_EVENTS.BOOKING_CANCEL,
        cancelPayload
      );

      logger.info('Booking cancelled', { bookingId, userId, reason });
    } catch (err) {
      logger.error('Error cancelling booking', { error: err.message });
      socket.emit('error', { message: 'Failed to cancel booking' });
    }
  });

  /**
   * Notify booking completion
   */
  socket.on(SOCKET_EVENTS.BOOKING_COMPLETED, async (data) => {
    try {
      const { bookingId, userId, completionNote } = data;

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { clientId: true, professionalId: true },
      });

      if (!booking || (booking.clientId !== userId && booking.professionalId !== userId)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      const completePayload = {
        bookingId,
        completedBy: userId,
        completionNote: completionNote || null,
        timestamp: new Date(),
      };

      io.to(ROOM_PATTERNS.BOOKING_ROOM(bookingId)).emit(
        SOCKET_EVENTS.BOOKING_COMPLETED,
        completePayload
      );

      logger.info('Booking marked completed', { bookingId, userId });
    } catch (err) {
      logger.error('Error completing booking', { error: err.message });
      socket.emit('error', { message: 'Failed to complete booking' });
    }
  });
}

/**
 * Join user to booking-specific rooms
 * Called when user subscribes to booking updates
 */
async function joinBookingRoom(socket, bookingId) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { clientId: true, professionalId: true },
    });

    if (!booking) return;

    // Verify user access
    if (booking.clientId === socket.userId || booking.professionalId === socket.userId) {
      const room = ROOM_PATTERNS.BOOKING_ROOM(bookingId);
      socket.join(room);
      logger.debug('User joined booking room', { userId: socket.userId, bookingId });
    }
  } catch (err) {
    logger.error('Error joining booking room', { error: err.message });
  }
}

/**
 * Leave booking room when user unsubscribes
 */
function leaveBookingRoom(socket, bookingId) {
  const room = ROOM_PATTERNS.BOOKING_ROOM(bookingId);
  socket.leave(room);
  logger.debug('User left booking room', { userId: socket.userId, bookingId });
}

module.exports = {
  registerBookingHandlers,
  joinBookingRoom,
  leaveBookingRoom,
};
