/**
 * Socket.IO Integration Examples
 * Shows how to use real-time events from API routes, workers, and jobs
 */

/**
 * EXAMPLE 1: Push booking update from route
 *
 * Used when confirming/cancelling/completing bookings
 */
async function exampleBookingUpdate(req, res, next) {
  try {
    const { bookingId } = req.params;
    const io = req.app.get('io');

    // Update booking in database
    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'confirmed' },
    });

    // Push real-time update to booking room
    // All users in this booking (client + pro) will receive it
    io.to(`booking:${bookingId}`).emit('booking.update', {
      bookingId,
      status: 'confirmed',
      previousStatus: 'pending',
      updatedBy: req.user.id,
      timestamp: new Date(),
    });

    // Also notify via user rooms for double coverage
    io.to(`user:${booking.clientId}`).emit('booking.update', {
      bookingId,
      status: 'confirmed',
      timestamp: new Date(),
    });

    res.json({ success: true, booking });
  } catch (err) {
    next(err);
  }
}

/**
 * EXAMPLE 2: Broadcast new message to conversation
 *
 * Used when message is created
 */
async function exampleSendMessage(req, res, next) {
  try {
    const { conversationId, text } = req.body;
    const userId = req.user.id;
    const io = req.app.get('io');

    // Verify user is in conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { participantIds: true },
    });

    const participants = Array.isArray(conversation.participantIds)
      ? conversation.participantIds
      : [];

    if (!participants.includes(userId)) {
      return res.status(403).json({ error: 'Not part of conversation' });
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        text,
        createdAt: new Date(),
      },
    });

    // Broadcast to conversation room
    io.to(`conversation:${conversationId}`).emit('message.new', {
      id: message.id,
      conversationId,
      senderId: userId,
      text,
      timestamp: message.createdAt,
      delivered: true,
    });

    res.json({ success: true, message });
  } catch (err) {
    next(err);
  }
}

/**
 * EXAMPLE 3: Push notification to user
 *
 * Used for real-time alerts (booking requests, messages, payments, etc.)
 */
async function examplePushNotification(req, res, next) {
  try {
    const io = req.app.get('io');
    const userId = req.body.userId;

    // Save notification to database
    const notification = await prisma.notification.create({
      data: {
        userId,
        type: 'BOOKING_REQUEST',
        title: 'Nouvelle demande de réservation',
        message: 'Un client souhaite réserver votre service',
        actionUrl: '/bookings/pending',
        read: false,
      },
    });

    // Push notification in real-time
    io.to(`notifications:${userId}`).emit('notification.push', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      actionUrl: notification.actionUrl,
      timestamp: new Date(),
    });

    res.json({ success: true, notification });
  } catch (err) {
    next(err);
  }
}

/**
 * EXAMPLE 4: Broadcast payment status from webhook
 *
 * Used when payment gateway sends status update
 */
async function examplePaymentWebhook(req, res, next) {
  try {
    const io = req.app.get('io');
    const { paymentId, status, amount, reference } = req.body;

    // Update payment in database
    const payment = await prisma.payment.update({
      where: { id: paymentId },
      data: { status },
    });

    // Push payment update to user's room
    io.to(`user:${payment.userId}`).emit('payment.status', {
      paymentId,
      status,
      amount,
      reference,
      timestamp: new Date(),
    });

    // Also broadcast to admin dashboard
    io.to('admin:payments').emit('payment.status', {
      paymentId,
      status,
      userId: payment.userId,
      amount,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * EXAMPLE 5: Multi-user notification (broadcast)
 *
 * Used for system-wide announcements or bulk notifications
 */
async function exampleBroadcastNotification(req, res, next) {
  try {
    const io = req.app.get('io');
    const { userIds, title, message } = req.body;

    // Send to each user individually
    for (const userId of userIds) {
      io.to(`notifications:${userId}`).emit('notification.push', {
        type: 'SYSTEM',
        title,
        message,
        timestamp: new Date(),
      });
    }

    res.json({ success: true, notified: userIds.length });
  } catch (err) {
    next(err);
  }
}

/**
 * EXAMPLE 6: Real-time presence tracking
 *
 * Used to track who's online in professional profile view
 */
async function exampleUpdatePresence(req, res, next) {
  try {
    const io = req.app.get('io');
    const userId = req.user.id;
    const status = req.body.status; // 'online' or 'offline'

    // Broadcast status to global presence room
    io.to('presence:global').emit(`user.${status}`, {
      userId,
      status,
      timestamp: new Date(),
    });

    // Also notify specific users following this professional
    const followers = await prisma.userFollow.findMany({
      where: { followingId: userId },
      select: { followerId: true },
    });

    for (const follow of followers) {
      io.to(`user:${follow.followerId}`).emit(`user.${status}`, {
        userId,
        status,
      });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * EXAMPLE 7: Real-time statistics dashboard
 *
 * Used for admin dashboards to get live updates
 */
async function exampleDashboardStats(req, res, next) {
  try {
    const io = req.app.get('io');

    // Get current statistics
    const stats = {
      connectedUsers: io.engine.clientsCount,
      totalSockets: Object.keys(io.sockets.sockets).length,
      timestamp: new Date(),
    };

    // Send to admin dashboard room
    io.to('admin:dashboard').emit('dashboard.stats', stats);

    res.json(stats);
  } catch (err) {
    next(err);
  }
}

/**
 * EXAMPLE 8: Handle subscription request from frontend
 *
 * Shows how frontend subscribes to rooms
 */
async function exampleClientSubscription() {
  const socket = io('http://localhost:4000', {
    auth: { token: userToken },
  });

  // Subscribe to booking updates
  socket.emit('subscribe:booking', { bookingId: 'booking-123' });

  // Subscribe to conversation messages
  socket.emit('subscribe:conversation', { conversationId: 'conv-456' });

  // Listen for updates
  socket.on('booking.update', (data) => {
    console.log('Booking updated:', data);
    // Update UI with new booking status
  });

  socket.on('message.new', (message) => {
    console.log('New message:', message);
    // Add message to chat UI
  });

  // Send message
  socket.emit('message.new', {
    conversationId: 'conv-456',
    text: 'Hello!',
  });

  // Unsubscribe when done
  socket.emit('unsubscribe:booking', { bookingId: 'booking-123' });
}

/**
 * EXAMPLE 9: Worker job pushing updates
 *
 * Used in background jobs/cron tasks
 */
async function exampleWorkerJob() {
  // This runs in a job worker
  const processPendingBookings = async () => {
    const io = getIOInstance(); // Get from app context

    const pendingBookings = await prisma.booking.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // > 24h old
      },
    });

    for (const booking of pendingBookings) {
      // Auto-expire old pending bookings
      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'expired' },
      });

      // Notify both parties
      io.to(`booking:${booking.id}`).emit('booking.update', {
        bookingId: booking.id,
        status: 'expired',
        reason: 'Auto-expired after 24 hours',
        timestamp: new Date(),
      });

      // Push notification
      io.to(`notifications:${booking.clientId}`).emit('notification.push', {
        type: 'BOOKING_EXPIRED',
        title: 'Réservation expirée',
        message: 'Votre réservation a expiré',
      });
    }
  };
}

/**
 * EXAMPLE 10: Error handling in socket events
 *
 * Shows proper error handling patterns
 */
function exampleErrorHandling() {
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    if (error.data?.content?.message?.includes('Authentication')) {
      // Redirect to login
      window.location.href = '/login';
    }
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error.message);
    if (error.message.includes('Rate limit')) {
      console.log('Too many requests, please slow down');
      // Show user-friendly message
    } else if (error.message.includes('Unauthorized')) {
      console.log('You do not have permission for this action');
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    if (reason === 'io server disconnect') {
      // Server closed connection (auth fail, ban, etc)
      socket.connect();
    } else if (reason === 'io client namespace disconnect') {
      // Client closed connection intentionally
    } else {
      // Network error - will auto-reconnect
      console.log('Network error, reconnecting...');
    }
  });
}

module.exports = {
  exampleBookingUpdate,
  exampleSendMessage,
  examplePushNotification,
  examplePaymentWebhook,
  exampleBroadcastNotification,
  exampleUpdatePresence,
  exampleDashboardStats,
  exampleClientSubscription,
  exampleWorkerJob,
  exampleErrorHandling,
};
