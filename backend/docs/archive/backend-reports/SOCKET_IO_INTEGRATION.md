# Socket.IO Real-Time System - Integration Guide

## Overview

Complete WebSocket implementation for real-time features in MANAWA backend:
- Real-time booking updates
- Live chat messaging with typing indicators
- Push notifications
- User presence tracking (online/offline)
- Payment status updates
- Rate limiting and authentication

**Total Implementation: 2,218 lines of code across 9 files**

## File Structure

```
backend/
├── utils/
│   └── socket-events.js              (96 lines) - Event definitions and constants
├── socket/
│   ├── manager.js                    (201 lines) - Central orchestration
│   ├── README.md                     - Complete documentation
│   ├── examples.js                   - Integration examples
│   ├── handlers/
│   │   ├── bookingHandler.js         (231 lines) - Booking real-time updates
│   │   ├── messageHandler.js         (281 lines) - Chat and messaging
│   │   ├── notificationHandler.js    (245 lines) - Push notifications
│   │   ├── presenceHandler.js        (289 lines) - Online/offline tracking
│   │   └── paymentHandler.js         (300 lines) - Payment updates
│   └── middleware/
│       ├── socketAuth.js             (169 lines) - JWT authentication
│       ├── socketRateLimit.js        (174 lines) - Rate limiting per event
│       └── socketLogger.js           (232 lines) - Event logging & monitoring
└── index.js                          - Modified for Socket.IO integration
```

## Quick Start

### 1. Import and Initialize (Already Done)

```javascript
// In index.js - socket initialization is now integrated
const { initializeSocket } = require('./socket/manager');
initializeSocket(io);
```

### 2. Use in API Routes

```javascript
const express = require('express');
const router = express.Router();

router.post('/api/bookings/:id/confirm', async (req, res, next) => {
  try {
    const { id: bookingId } = req.params;
    const io = req.app.get('io');

    // Update booking
    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'confirmed' },
    });

    // Push real-time update
    io.to(`booking:${bookingId}`).emit('booking.update', {
      bookingId,
      status: 'confirmed',
      timestamp: new Date(),
    });

    res.json({ success: true, booking });
  } catch (err) {
    next(err);
  }
});
```

### 3. Client Connection

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  auth: { token: jwtToken },
});

socket.on('connect', () => console.log('Connected'));
socket.on('disconnect', () => console.log('Disconnected'));

// Subscribe to events
socket.emit('subscribe:booking', { bookingId: 'booking-123' });
socket.on('booking.update', (data) => {
  console.log('Booking updated:', data);
});
```

## Event System

### Available Events

#### Booking Events
```javascript
io.to(`booking:${bookingId}`).emit('booking.update', {
  bookingId, status, previousStatus, updatedBy, timestamp
});

io.to(`booking:${bookingId}`).emit('booking.confirm', {
  bookingId, confirmedBy, timestamp
});

io.to(`booking:${bookingId}`).emit('booking.cancel', {
  bookingId, cancelledBy, reason, timestamp
});

io.to(`booking:${bookingId}`).emit('booking.completed', {
  bookingId, completedBy, completionNote, timestamp
});
```

#### Messaging Events
```javascript
io.to(`conversation:${convId}`).emit('message.new', {
  id, conversationId, senderId, text, metadata, timestamp, delivered
});

socket.to(`conversation:${convId}`).emit('message.typing', {
  conversationId, userId, isTyping, timestamp
});

io.to(`conversation:${convId}`).emit('message.seen', {
  messageId, conversationId, seenBy, timestamp
});

socket.emit('message.delivered', {
  messageId, conversationId, delivered, timestamp
});
```

#### Notification Events
```javascript
io.to(`notifications:${userId}`).emit('notification.push', {
  id, type, title, message, actionUrl, metadata, timestamp
});

io.to(`notifications:${userId}`).emit('notification.read', {
  notificationId, read, timestamp
});

io.to(`notifications:${userId}`).emit('notification.clear', {
  clearedCount, timestamp
});
```

#### Presence Events
```javascript
io.to('presence:global').emit('user.online', {
  userId, status, timestamp
});

io.to('presence:global').emit('user.offline', {
  userId, status, timestamp
});
```

#### Payment Events
```javascript
io.to(`user:${userId}`).emit('payment.pending', {
  paymentId, status, timestamp
});

io.to(`user:${userId}`).emit('payment.success', {
  paymentId, status, amount, reference, timestamp
});

io.to(`user:${userId}`).emit('payment.failed', {
  paymentId, status, reason, timestamp
});

io.to(`user:${userId}`).emit('payment.status', {
  paymentId, status, previousStatus, metadata, timestamp
});
```

## Room Strategy

### Room Types

| Room | Purpose | Users |
|------|---------|-------|
| `user:{userId}` | Personal updates | 1 user |
| `booking:{bookingId}` | Booking participants | 2 users (client + pro) |
| `conversation:{convId}` | Chat participants | 2+ users |
| `notifications:{userId}` | User alerts | 1 user |
| `presence:global` | Global presence | All connected users |
| `payment:{paymentId}` | Payment tracking | 1+ users |

### Room Management

```javascript
// Client-side subscription
socket.emit('subscribe:booking', { bookingId: 'booking-123' });
socket.emit('subscribe:conversation', { conversationId: 'conv-456' });

// Server-side room joining
socket.join(`booking:${bookingId}`);
socket.join(`notifications:${userId}`);

// Unsubscribe
socket.emit('unsubscribe:booking', { bookingId: 'booking-123' });
socket.leave(`booking:${bookingId}`);
```

## Authentication & Security

### JWT Validation on Connect
- Token verified from `auth`, `query`, or `Authorization` header
- User existence checked in database
- Account suspension status verified
- User deletion status verified

### Authorization per Resource
```javascript
// All handlers verify user ownership before emitting
if (booking.clientId !== userId && booking.professionalId !== userId) {
  socket.emit('error', { message: 'Unauthorized' });
  return;
}
```

### Rate Limiting
| Event | Limit | Window |
|-------|-------|--------|
| message.new | 60 | 1 min |
| message.typing | 100 | 1 min |
| notification.push | 200 | 1 min |

Exceeded limits emit error event.

## Integration Patterns

### Pattern 1: Route Handler

```javascript
router.post('/api/messages', requireAuth, async (req, res, next) => {
  try {
    const message = await prisma.message.create({
      data: { conversationId, senderId: req.user.id, text },
    });

    const io = req.app.get('io');
    io.to(`conversation:${conversationId}`).emit('message.new', {
      id: message.id,
      senderId: req.user.id,
      text: message.text,
      timestamp: message.createdAt,
    });

    res.json({ success: true, message });
  } catch (err) {
    next(err);
  }
});
```

### Pattern 2: Worker Job

```javascript
const processPayments = async () => {
  const io = app.get('io');
  const pending = await prisma.payment.findMany({ where: { status: 'pending' } });

  for (const payment of pending) {
    const result = await checkPaymentStatus(payment.geniuspayRef);
    if (result.status === 'completed') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'succeeded' },
      });

      io.to(`user:${payment.userId}`).emit('payment.success', {
        paymentId: payment.id,
        status: 'succeeded',
      });
    }
  }
};
```

### Pattern 3: Webhook Handler

```javascript
app.post('/api/webhooks/payment', async (req, res) => {
  const io = app.get('io');
  const { paymentId, status } = req.body;

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status },
  });

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  io.to(`user:${payment.userId}`).emit('payment.status', {
    paymentId,
    status,
  });

  res.json({ received: true });
});
```

## Monitoring & Debugging

### Enable Verbose Logging

```bash
# In .env
DEBUG=true
SOCKET_LOG_ALL=true
```

### View Socket Statistics

```javascript
const stats = {
  connectedUsers: io.engine.clientsCount,
  totalSockets: Object.keys(io.sockets.sockets).length,
  rooms: io.sockets.adapter.rooms.size,
};
console.log(stats);
```

### Check Logs

```bash
tail -f logs/app.log | grep Socket
tail -f logs/app.log | grep 'Socket connected'
tail -f logs/app.log | grep 'Socket disconnected'
```

## Troubleshooting

### Issue: Connection Refused
**Solution**: Check JWT token validity
```javascript
// Verify token is passed correctly
const socket = io(url, { auth: { token: jwtToken } });
```

### Issue: Messages Not Delivering
**Solution**: Verify subscription
```javascript
// Subscribe before emitting
socket.emit('subscribe:booking', { bookingId });
// Then listen
socket.on('booking.update', handler);
```

### Issue: High Memory Usage
**Solution**: Check Redis connection
```javascript
// Verify Redis is running
redis-cli ping  # Should return PONG
```

### Issue: Rate Limit Errors
**Solution**: Reduce event frequency
```javascript
// Add debounce on client-side typing
const debounceTyping = debounce(() => {
  socket.emit('message.typing', { conversationId, isTyping: true });
}, 300);
```

## Testing Socket Events

### Manual Testing with Socket.IO Client

```bash
# Install socket.io-client-tools
npm install -g @socket.io/admin-ui

# Or use a test client
# https://socket.io/docs/tools/socket-io-client-tool/
```

### Unit Testing Example

```javascript
const io = require('socket.io');
const { initializeSocket } = require('./socket/manager');

describe('Socket.IO', () => {
  let ioServer, clientSocket;

  beforeAll((done) => {
    ioServer = new io.Server();
    initializeSocket(ioServer);
    clientSocket = io.connect('http://localhost:3000', {
      auth: { token: validJwt },
    });
    clientSocket.on('connect', done);
  });

  afterAll(() => {
    ioServer.close();
    clientSocket.close();
  });

  test('sends booking update', (done) => {
    clientSocket.on('booking.update', (data) => {
      expect(data.status).toBe('confirmed');
      done();
    });

    clientSocket.emit('subscribe:booking', { bookingId: 'test-123' });
    ioServer.to('booking:test-123').emit('booking.update', {
      bookingId: 'test-123',
      status: 'confirmed',
    });
  });
});
```

## Performance Tips

1. **Use rooms strategically** - Broadcast only to affected users
2. **Minimize payload size** - Send only necessary data
3. **Enable compression** - Already configured in manager.js
4. **Use Redis adapter** - Scales across multiple server instances
5. **Cleanup old connections** - Auto-disconnect after 1h inactivity

## Deployment Checklist

- [x] Socket.IO initialized in index.js
- [x] Authentication middleware applied
- [x] Rate limiting configured
- [x] Event handlers registered
- [x] Room management setup
- [x] Error handling implemented
- [x] Logging configured
- [x] Redis fallback enabled
- [x] Documentation complete
- [ ] Test coverage added (80%+ required)
- [ ] Performance tested under load
- [ ] Monitored in production
- [ ] Security audit completed

## Next Steps

1. **Add Socket.IO tests** (socket/__tests__/)
2. **Integrate with notification routes** (existing notification system)
3. **Add admin dashboard** for socket statistics
4. **Enable Redis adapter** for horizontal scaling
5. **Add rate limiting dashboard** to admin panel
6. **Setup monitoring alerts** for connection spikes
7. **Document client SDK** generation
8. **Add E2E tests** with real socket connections

## Support

For detailed documentation, see `/socket/README.md`
For integration examples, see `/socket/examples.js`

Questions? Issues? Create a task or documentation request.
