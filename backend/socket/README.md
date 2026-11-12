# Socket.IO Real-time System

Complete WebSocket implementation for MANAWA backend with real-time messaging, notifications, presence tracking, and payment updates.

## Architecture

```
socket/
├── manager.js              # Central orchestration
├── handlers/
│   ├── bookingHandler.js   # Booking real-time updates
│   ├── messageHandler.js   # Chat/messaging
│   ├── notificationHandler.js # Push alerts
│   ├── presenceHandler.js  # User online/offline
│   └── paymentHandler.js   # Payment status updates
└── middleware/
    ├── socketAuth.js       # JWT authentication
    ├── socketRateLimit.js  # Rate limiting
    └── socketLogger.js     # Event logging & monitoring
```

## Event Types

### Booking Events
- `booking.update` - Reservation status change
- `booking.confirm` - Booking confirmation
- `booking.cancel` - Booking cancellation
- `booking.completed` - Booking marked complete

### Messaging Events
- `message.new` - New chat message
- `message.typing` - User typing indicator
- `message.seen` - Message read receipt
- `message.delivered` - Message delivery confirmation

### Notification Events
- `notification.push` - Real-time alert
- `notification.read` - Mark as read
- `notification.clear` - Clear all notifications

### Presence Events
- `user.online` - User came online
- `user.offline` - User went offline

### Payment Events
- `payment.pending` - Payment initiated
- `payment.success` - Payment completed
- `payment.failed` - Payment failed
- `payment.status` - Generic status update

## Room Structure

Rooms are organized by domain for efficient broadcasting:

```
user:{userId}                    # User-specific updates
booking:{bookingId}              # Booking participants
conversation:{conversationId}    # Chat participants
notifications:{userId}           # User notifications
presence:global                  # Global presence tracking
payment:{paymentId}              # Payment watchers
```

## Client Usage

### Connect to Socket.IO

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  auth: {
    token: 'your_jwt_token'
  }
});

socket.on('connect', () => {
  console.log('Connected to real-time system');
});
```

### Subscribe to Rooms

```javascript
// Subscribe to booking updates
socket.emit('subscribe:booking', { bookingId: 'booking-123' });

// Subscribe to conversation messages
socket.emit('subscribe:conversation', { conversationId: 'conv-456' });

// Unsubscribe when done
socket.emit('unsubscribe:booking', { bookingId: 'booking-123' });
```

### Listen to Events

```javascript
// Booking updates
socket.on('booking.update', (data) => {
  console.log('Booking updated:', data);
  // { bookingId, status, previousStatus, timestamp, updatedBy }
});

// New message
socket.on('message.new', (message) => {
  console.log('New message:', message);
  // { id, conversationId, senderId, text, timestamp, delivered }
});

// Typing indicator
socket.on('message.typing', (data) => {
  console.log('User typing:', data);
  // { conversationId, userId, isTyping, timestamp }
});

// Payment updates
socket.on('payment.success', (data) => {
  console.log('Payment successful:', data);
  // { paymentId, status, amount, reference, timestamp }
});

// Notifications
socket.on('notification.push', (notification) => {
  console.log('New notification:', notification);
  // { id, type, title, message, actionUrl, timestamp }
});

// Presence
socket.on('user.online', (data) => {
  console.log('User online:', data);
  // { userId, status, timestamp }
});
```

### Send Events

```javascript
// Send message
socket.emit('message.new', {
  conversationId: 'conv-456',
  text: 'Hello!',
  metadata: { type: 'text' }
});

// Send typing indicator
socket.emit('message.typing', {
  conversationId: 'conv-456',
  isTyping: true
});

// Mark message as seen
socket.emit('message.seen', {
  messageId: 'msg-789',
  conversationId: 'conv-456'
});

// Update booking
socket.emit('booking.update', {
  bookingId: 'booking-123',
  status: 'confirmed'
});

// Send heartbeat
socket.emit('ping');
socket.on('pong', (data) => {
  console.log('Pong:', data.timestamp);
});
```

## Server-Side Usage (API Routes)

### Push Notifications from Routes

```javascript
// In your route handler
const express = require('express');
const router = express.Router();

router.post('/api/bookings/:id/confirm', async (req, res, next) => {
  try {
    // ... update booking logic
    
    // Push real-time update via Socket.IO
    const io = req.app.get('io');
    io.to(`booking:${bookingId}`).emit('booking.update', {
      bookingId,
      status: 'confirmed',
      timestamp: new Date()
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

### Use Socket Utilities

```javascript
// Get socket utilities from manager
const { getSocketUtilities } = require('./socket/manager');

// In index.js after creating io
app.set('io', io);
const socketUtils = getSocketUtilities(io);

// Now use utilities in routes
router.post('/api/messages', (req, res) => {
  // ... create message logic
  
  // Notify via socket
  socketUtils.notifyNewMessage(conversationId, messageData);
  
  res.json({ success: true });
});
```

### Notify User from Worker Jobs

```javascript
// In job workers/cron tasks
const io = require('./app').get('io');

async function processPayment(paymentId) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  
  // Process payment...
  
  // Notify user via Socket.IO
  io.to(`user:${payment.userId}`).emit('payment.success', {
    paymentId,
    status: 'succeeded',
    amount: payment.amount,
    timestamp: new Date()
  });
}
```

## Authentication

All socket connections require JWT token in one of these formats:

```javascript
// Option 1: Via auth property
socket.handshake.auth.token

// Option 2: Via query param
socket.handshake.query.token

// Option 3: Via Authorization header
socket.request.headers.authorization (Bearer token)
```

Tokens are validated against:
- JWT signature
- User exists in database
- User is not suspended
- User is not deleted

Invalid tokens result in connection rejection with error message.

## Rate Limiting

Rate limits per event (prevents abuse):

| Event | Limit | Window |
|-------|-------|--------|
| message.new | 60 | 1 min |
| message.typing | 100 | 1 min |
| notification.push | 200 | 1 min |

Exceeded limits emit error event:
```javascript
socket.on('error', (err) => {
  if (err.message.includes('Rate limit')) {
    console.log('Too many requests');
  }
});
```

## Logging & Monitoring

All socket events are logged for debugging:

```bash
# View socket logs
tail -f logs/app.log | grep Socket
```

Monitor statistics:

```javascript
// Get current stats
const stats = io.engine.clientsCount;
console.log(`Connected clients: ${stats}`);
```

Enable verbose logging:

```bash
# In .env
SOCKET_LOG_ALL=true
DEBUG=true
```

## Error Handling

Socket errors are emitted to client:

```javascript
socket.on('error', (error) => {
  console.error('Socket error:', error.message);
  // Reconnect logic
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  if (error.data?.content?.message === 'Authentication error') {
    // Redirect to login
  }
});
```

## Performance Considerations

1. **Room sizes**: Limit messages sent to large rooms
2. **Message size**: Max 1MB per message (configurable)
3. **Connection pooling**: Use Redis adapter for multiple servers
4. **Cleanup**: Old rate limit entries cleaned every 5 minutes
5. **Presence**: User presence tracked via Redis with 24h TTL

## Redis Integration

For distributed deployments, Socket.IO uses Redis adapter:

```javascript
// Automatically used when Redis is available
// Falls back to in-memory store if Redis unavailable
```

Redis keys used:
- `user:online:{userId}` - User online status (24h TTL)
- `ratelimit:{eventName}:{userId}` - Rate limit counter (per window)

## Troubleshooting

### Connection Refused
- Check JWT token validity
- Verify user exists and not suspended
- Check CORS configuration in index.js

### Messages Not Delivering
- Verify user subscribed to correct room
- Check room name matches event broadcast
- Enable socket logs for debugging

### High Memory Usage
- Check for memory leaks in rate limit store
- Verify Redis connection is working
- Monitor online user list size

### Slow Delivery
- Check network latency
- Monitor Socket.IO server load
- Consider horizontal scaling with Redis adapter

## Integration Checklist

- [x] Socket events defined in `utils/socket-events.js`
- [x] Handlers created for all event types
- [x] Authentication middleware implemented
- [x] Rate limiting configured per event
- [x] Logging and monitoring setup
- [x] Room management for scalability
- [x] Error handling and recovery
- [x] Client connection examples
- [x] Server integration patterns
- [x] Redis fallback support

## Future Enhancements

1. **Message Queue**: Add persistent message queue for offline users
2. **Typing Debounce**: Optimize typing indicator frequency
3. **Compression**: Enable Socket.IO compression for large payloads
4. **Private Encryption**: E2E encryption for messages
5. **Voice/Video**: Add WebRTC for voice/video calls
6. **Bot Integration**: Support bot messages and automation
7. **File Transfer**: Real-time file upload/download via Socket.IO
8. **Analytics**: Track event metrics and user behavior
