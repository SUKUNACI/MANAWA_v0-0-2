# Socket.IO Quick Reference Guide

## Architecture Overview

```
Socket.IO Real-Time System for MANAWA
├── Authentication: JWT tokens on connect
├── Authorization: Per-resource access control
├── Rate Limiting: Per-user, per-event limits
├── Rooms: Domain-based broadcasting
└── Storage: Redis with in-memory fallback
```

## Event Categories

### 1. Booking Events
```javascript
// Client listens
socket.on('booking.update', (data) => {
  // { bookingId, status, previousStatus, updatedBy, timestamp }
});

// Server emits
io.to(`booking:${bookingId}`).emit('booking.update', {
  bookingId, status, previousStatus, updatedBy, timestamp
});
```

### 2. Messaging Events
```javascript
// Send message
socket.emit('message.new', {
  conversationId, text, metadata
});

// Listen for typing
socket.on('message.typing', (data) => {
  // { conversationId, userId, isTyping, timestamp }
});

// Mark as seen
socket.emit('message.seen', {
  messageId, conversationId
});
```

### 3. Notification Events
```javascript
// Push notification
io.to(`notifications:${userId}`).emit('notification.push', {
  id, type, title, message, actionUrl, timestamp
});

// Mark as read
socket.emit('notification.read', { notificationId });

// Clear all
socket.emit('notification.clear', {});
```

### 4. Presence Events
```javascript
// User came online
io.to('presence:global').emit('user.online', {
  userId, status: 'online', timestamp
});

// User went offline
io.to('presence:global').emit('user.offline', {
  userId, status: 'offline', timestamp
});
```

### 5. Payment Events
```javascript
// Payment status update
io.to(`user:${userId}`).emit('payment.status', {
  paymentId, status, amount, timestamp
});

// Payment success
io.to(`user:${userId}`).emit('payment.success', {
  paymentId, status: 'success', amount, reference, timestamp
});

// Payment failed
io.to(`user:${userId}`).emit('payment.failed', {
  paymentId, status: 'failed', reason, timestamp
});
```

## Room Management

### Subscribe to Room
```javascript
socket.emit('subscribe:booking', { bookingId });
socket.emit('subscribe:conversation', { conversationId });
```

### Unsubscribe from Room
```javascript
socket.emit('unsubscribe:booking', { bookingId });
socket.emit('unsubscribe:conversation', { conversationId });
```

### Room Names
| Room | Pattern | Users |
|------|---------|-------|
| Personal | `user:{userId}` | 1 |
| Booking | `booking:{bookingId}` | 2 |
| Chat | `conversation:{convId}` | 2+ |
| Alerts | `notifications:{userId}` | 1 |
| Presence | `presence:global` | All |

## Client Usage

### Connect
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  auth: { token: jwtToken },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

socket.on('connect', () => console.log('Connected'));
socket.on('disconnect', (reason) => console.log('Disconnected:', reason));
socket.on('error', (error) => console.error('Error:', error));
```

### Send Message
```javascript
socket.emit('message.new', {
  conversationId: 'conv-123',
  text: 'Hello!',
  metadata: { type: 'text' }
});
```

### Listen for Updates
```javascript
socket.on('booking.update', (update) => {
  console.log('Booking updated:', update.status);
});

socket.on('message.new', (message) => {
  console.log('New message:', message.text);
});

socket.on('notification.push', (notification) => {
  console.log('Alert:', notification.title);
});
```

### Heartbeat
```javascript
setInterval(() => {
  socket.emit('ping');
}, 30000);

socket.on('pong', (data) => {
  console.log('Connection alive');
});
```

## Server Usage

### In Routes
```javascript
router.post('/api/bookings/:id/confirm', async (req, res, next) => {
  const io = req.app.get('io');
  
  // Update booking
  const booking = await updateBooking(req.params.id);
  
  // Emit real-time update
  io.to(`booking:${booking.id}`).emit('booking.update', {
    bookingId: booking.id,
    status: 'confirmed',
    timestamp: new Date()
  });
  
  res.json({ success: true });
});
```

### In Worker Jobs
```javascript
const processPayments = async (io) => {
  const payments = await getPendingPayments();
  
  for (const payment of payments) {
    const result = await checkPaymentStatus(payment.geniuspayRef);
    
    if (result.succeeded) {
      io.to(`user:${payment.userId}`).emit('payment.success', {
        paymentId: payment.id,
        status: 'success',
        amount: payment.amount
      });
    }
  }
};
```

### In Webhooks
```javascript
app.post('/api/webhooks/payment', (req, res) => {
  const io = app.get('io');
  const { paymentId, status, userId } = req.body;
  
  io.to(`user:${userId}`).emit('payment.status', {
    paymentId,
    status,
    timestamp: new Date()
  });
  
  res.json({ received: true });
});
```

## Rate Limiting

### Configured Limits
| Event | Max/Min | Window |
|-------|---------|--------|
| message.new | 60 | 1 min |
| message.typing | 100 | 1 min |
| notification.push | 200 | 1 min |

### Error Response
```javascript
socket.on('error', (error) => {
  if (error.message.includes('Rate limit')) {
    console.log('Too many requests - please slow down');
  }
});
```

## Security

### Authentication
```javascript
// Required JWT token from:
// 1. socket.handshake.auth.token
// 2. socket.handshake.query.token
// 3. Authorization header

const socket = io(url, {
  auth: { token: 'Bearer ...' }
});
```

### Authorization
```javascript
// All handlers verify user ownership
if (booking.clientId !== socket.userId && 
    booking.professionalId !== socket.userId) {
  socket.emit('error', { message: 'Unauthorized' });
}
```

## Monitoring

### Enable Logging
```bash
# In .env file
DEBUG=true
SOCKET_LOG_ALL=true
```

### View Logs
```bash
tail -f logs/app.log | grep Socket
```

### Get Statistics
```javascript
const stats = {
  connected: io.engine.clientsCount,
  sockets: Object.keys(io.sockets.sockets).length,
  rooms: io.sockets.adapter.rooms.size
};
```

## Error Handling

### Connection Errors
```javascript
socket.on('connect_error', (error) => {
  if (error.data?.content?.message?.includes('Authentication')) {
    // Redirect to login
    window.location.href = '/login';
  }
});
```

### Event Errors
```javascript
socket.on('error', (error) => {
  console.error('Socket error:', error.message);
  
  if (error.includes('Rate limit')) {
    // Too many requests
  } else if (error.includes('Unauthorized')) {
    // No permission
  } else if (error.includes('Not found')) {
    // Resource doesn't exist
  }
});
```

### Reconnection
```javascript
socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') {
    // Server disconnected - authentication likely failed
    socket.connect();
  } else {
    // Network error - will auto-reconnect
  }
});
```

## File Reference

| File | Purpose | Lines |
|------|---------|-------|
| socket-events.js | Event definitions | 96 |
| manager.js | Central orchestration | 201 |
| bookingHandler.js | Booking events | 231 |
| messageHandler.js | Chat events | 281 |
| notificationHandler.js | Alerts | 245 |
| presenceHandler.js | Online/offline | 289 |
| paymentHandler.js | Payment updates | 300 |
| socketAuth.js | JWT authentication | 169 |
| socketRateLimit.js | Rate limiting | 174 |
| socketLogger.js | Logging & monitoring | 232 |
| examples.js | Usage examples | ~300 |

**Total: 2,218 lines of code**

## Common Patterns

### Pattern 1: Real-time Notification
```javascript
// Frontend
socket.on('notification.push', (notif) => {
  showAlert(notif.title, notif.message);
});

// Backend
io.to(`notifications:${userId}`).emit('notification.push', {
  type: 'INFO',
  title: 'Réservation confirmée',
  message: 'Votre réservation a été acceptée'
});
```

### Pattern 2: Live Chat
```javascript
// Frontend
socket.emit('message.new', {
  conversationId: 'conv-123',
  text: userInput
});

socket.on('message.new', (message) => {
  addMessageToChat(message);
});

// Backend (already handled by messageHandler)
```

### Pattern 3: Status Tracking
```javascript
// Frontend
socket.on('booking.update', (update) => {
  updateUI(update.status);
});

// Backend
io.to(`booking:${bookingId}`).emit('booking.update', {
  status: 'completed',
  updatedBy: userId
});
```

## Best Practices

1. Always use JWT tokens for authentication
2. Subscribe to specific rooms, not broadcast to all users
3. Verify user ownership before emitting
4. Use rate limiting to prevent abuse
5. Log important events for debugging
6. Handle disconnections gracefully
7. Implement reconnection logic on client
8. Monitor memory usage with many connections
9. Use Redis for distributed deployments
10. Add tests for all event handlers

## Deployment Checklist

- [ ] JWT_SECRET configured
- [ ] CORS_ORIGINS configured
- [ ] Redis connection verified (or fallback working)
- [ ] Event handlers registered
- [ ] Rate limiting configured
- [ ] Logging enabled
- [ ] Error handling tested
- [ ] Performance tested
- [ ] Security reviewed
- [ ] Monitoring setup
- [ ] Tests added (80%+ coverage)

## Support Resources

- Full docs: `/socket/README.md`
- Integration guide: `/SOCKET_IO_INTEGRATION.md`
- Examples: `/socket/examples.js`
- Summary: `/SOCKET_IO_SUMMARY.txt`

---

**Last Updated**: 2026-11-12  
**Status**: Production Ready  
**Coverage**: 17 event types across 5 domains
