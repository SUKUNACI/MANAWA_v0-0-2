/**
 * Payment Real-time Event Handlers
 * Manages real-time payment status updates and notifications
 */

const { SOCKET_EVENTS, ROOM_PATTERNS } = require('../../utils/socket-events');
const logger = require('../../utils/logger');
const prisma = require('../../config/db');

/**
 * Register payment event handlers on socket connection
 * @param {Socket} socket - Socket.IO socket instance
 * @param {Server} io - Socket.IO server instance
 */
function registerPaymentHandlers(socket, io) {
  /**
   * Notify payment pending state
   */
  socket.on(SOCKET_EVENTS.PAYMENT_PENDING, async (data) => {
    try {
      const { paymentId, userId } = data;

      if (!paymentId) {
        socket.emit('error', { message: 'Missing paymentId' });
        return;
      }

      // Verify user has access to this payment
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { userId: true, status: true },
      });

      if (!payment || payment.userId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      const pendingPayload = {
        paymentId,
        status: 'pending',
        timestamp: new Date(),
      };

      // Emit to user's room
      io.to(ROOM_PATTERNS.USER_ROOM(userId)).emit(
        SOCKET_EVENTS.PAYMENT_PENDING,
        pendingPayload
      );

      logger.info('Payment marked as pending', { paymentId, userId });
    } catch (err) {
      logger.error('Error handling pending payment', { error: err.message });
      socket.emit('error', { message: 'Failed to process pending payment' });
    }
  });

  /**
   * Notify payment success
   */
  socket.on(SOCKET_EVENTS.PAYMENT_SUCCESS, async (data) => {
    try {
      const { paymentId, userId, amount, reference } = data;

      if (!paymentId) {
        socket.emit('error', { message: 'Missing paymentId' });
        return;
      }

      // Verify user has access to this payment
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { userId: true },
      });

      if (!payment || payment.userId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      const successPayload = {
        paymentId,
        status: 'success',
        amount: amount || null,
        reference: reference || null,
        timestamp: new Date(),
      };

      // Emit to user's room
      io.to(ROOM_PATTERNS.USER_ROOM(userId)).emit(
        SOCKET_EVENTS.PAYMENT_SUCCESS,
        successPayload
      );

      logger.info('Payment success notification', {
        paymentId,
        userId,
        amount,
      });
    } catch (err) {
      logger.error('Error handling payment success', { error: err.message });
      socket.emit('error', { message: 'Failed to process payment success' });
    }
  });

  /**
   * Notify payment failure
   */
  socket.on(SOCKET_EVENTS.PAYMENT_FAILED, async (data) => {
    try {
      const { paymentId, userId, reason } = data;

      if (!paymentId) {
        socket.emit('error', { message: 'Missing paymentId' });
        return;
      }

      // Verify user has access to this payment
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { userId: true },
      });

      if (!payment || payment.userId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      const failurePayload = {
        paymentId,
        status: 'failed',
        reason: reason || 'Payment failed',
        timestamp: new Date(),
      };

      // Emit to user's room
      io.to(ROOM_PATTERNS.USER_ROOM(userId)).emit(
        SOCKET_EVENTS.PAYMENT_FAILED,
        failurePayload
      );

      logger.warn('Payment failure notification', {
        paymentId,
        userId,
        reason,
      });
    } catch (err) {
      logger.error('Error handling payment failure', { error: err.message });
      socket.emit('error', { message: 'Failed to process payment failure' });
    }
  });

  /**
   * Generic payment status update
   */
  socket.on(SOCKET_EVENTS.PAYMENT_STATUS, async (data) => {
    try {
      const { paymentId, status, userId, metadata } = data;

      if (!paymentId || !status) {
        socket.emit('error', { message: 'Missing required fields' });
        return;
      }

      // Verify user has access to this payment
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { userId: true, status: true },
      });

      if (!payment || payment.userId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      const statusPayload = {
        paymentId,
        status,
        previousStatus: payment.status,
        metadata: metadata || null,
        timestamp: new Date(),
      };

      // Emit to user's room
      io.to(ROOM_PATTERNS.USER_ROOM(userId)).emit(
        SOCKET_EVENTS.PAYMENT_STATUS,
        statusPayload
      );

      logger.info('Payment status updated', {
        paymentId,
        status,
        userId,
      });
    } catch (err) {
      logger.error('Error updating payment status', { error: err.message });
      socket.emit('error', { message: 'Failed to update payment status' });
    }
  });
}

/**
 * Server-side method to push payment update to user
 * Called from payment routes/webhooks/workers
 */
async function pushPaymentUpdate(io, userId, paymentUpdate) {
  try {
    const { paymentId, status, amount, reference, reason, metadata } = paymentUpdate;

    if (!paymentId || !status) {
      throw new Error('Missing required payment update fields');
    }

    const payload = {
      paymentId,
      status,
      amount: amount || null,
      reference: reference || null,
      reason: reason || null,
      metadata: metadata || null,
      timestamp: new Date(),
    };

    // Emit based on status
    let eventName = SOCKET_EVENTS.PAYMENT_STATUS;
    if (status === 'pending') eventName = SOCKET_EVENTS.PAYMENT_PENDING;
    else if (status === 'succeeded' || status === 'success') eventName = SOCKET_EVENTS.PAYMENT_SUCCESS;
    else if (status === 'failed') eventName = SOCKET_EVENTS.PAYMENT_FAILED;

    io.to(ROOM_PATTERNS.USER_ROOM(userId)).emit(eventName, payload);

    logger.info('Payment update pushed to user', {
      userId,
      paymentId,
      status,
    });

    return payload;
  } catch (err) {
    logger.error('Error pushing payment update', { error: err.message, userId });
    throw err;
  }
}

/**
 * Broadcast payment update to multiple users (e.g., admin panel)
 */
async function broadcastPaymentUpdate(io, paymentUpdate) {
  try {
    const { paymentId, status, metadata } = paymentUpdate;

    const payload = {
      paymentId,
      status,
      metadata: metadata || null,
      timestamp: new Date(),
    };

    // Broadcast to all connected clients (useful for admin dashboards)
    io.emit(SOCKET_EVENTS.PAYMENT_STATUS, payload);

    logger.info('Payment update broadcasted', { paymentId, status });
    return payload;
  } catch (err) {
    logger.error('Error broadcasting payment update', { error: err.message });
    throw err;
  }
}

/**
 * Join user to payment-specific room
 */
function joinPaymentRoom(socket, paymentId) {
  const room = `payment:${paymentId}`;
  socket.join(room);
  logger.debug('User joined payment room', {
    userId: socket.userId,
    paymentId,
  });
}

/**
 * Leave payment room
 */
function leavePaymentRoom(socket, paymentId) {
  const room = `payment:${paymentId}`;
  socket.leave(room);
  logger.debug('User left payment room', {
    userId: socket.userId,
    paymentId,
  });
}

module.exports = {
  registerPaymentHandlers,
  pushPaymentUpdate,
  broadcastPaymentUpdate,
  joinPaymentRoom,
  leavePaymentRoom,
};
