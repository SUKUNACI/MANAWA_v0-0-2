# Webhook System Implementation Guide

## Overview

The MANAWA backend webhook system enables real-time notifications to external services when business events occur. Webhooks use HMAC-SHA256 signing for security and include automatic retry logic with exponential backoff.

## Files Created

### Core Utilities
- **`/utils/webhooks.js`** - Core webhook dispatcher with retry logic
  - `registerWebhook(url, secret, events)` - Register a new webhook
  - `unregisterWebhook(webhookId)` - Remove a webhook
  - `triggerWebhook(event, payload)` - Trigger an event to all subscribed webhooks
  - `retryFailedWebhooks()` - Retry pending/failed webhooks (for cron jobs)
  - `getWebhooks(options)` - List all webhooks
  - `getWebhookLogs(webhookId, options)` - Get delivery logs
  - `sendTestWebhook(webhookId)` - Send test payload to verify configuration

- **`/utils/webhook-triggers.js`** - Integration points for all events
  - Contains ready-to-use trigger functions for each event type
  - Documents where each trigger should be placed in existing routes

### Admin Routes
- **`/routes/webhooks-admin.js`** - Admin panel for webhook management
  - `GET /api/admin/webhooks` - List all webhooks
  - `GET /api/admin/webhooks/events` - Get available event types
  - `POST /api/admin/webhooks` - Register new webhook
  - `GET /api/admin/webhooks/:id` - Get webhook details with logs
  - `PUT /api/admin/webhooks/:id` - Update webhook configuration
  - `DELETE /api/admin/webhooks/:id` - Remove webhook
  - `PATCH /api/admin/webhooks/:id/activate` - Activate/deactivate webhook
  - `POST /api/admin/webhooks/:id/test` - Send test webhook
  - `GET /api/admin/webhooks/:id/logs` - Get delivery logs (paginated)

### Database Schema
Updated `/prisma/schema.prisma` with:
- **Webhook model** - Stores webhook configurations
  - `id` - Unique identifier (UUID)
  - `url` - Endpoint URL to receive webhooks
  - `secret` - HMAC secret for signing payloads
  - `events` - Array of subscribed event types
  - `isActive` - Enable/disable webhook without deletion
  - `createdAt`, `updatedAt` - Timestamps

- **WebhookLog model** - Tracks all webhook deliveries
  - `id` - Unique identifier (UUID)
  - `webhookId` - Reference to webhook
  - `event` - Event type that triggered delivery
  - `payload` - Full event payload (JSON)
  - `status` - "success" | "failed" | "pending"
  - `response` - Response from receiving endpoint
  - `attempt` - Current attempt number (1-3)
  - `nextRetryAt` - Scheduled retry time (for pending status)
  - `createdAt` - Timestamp

## Database Migration

Run the Prisma migration to create the new tables:

```bash
npm run migrate
```

This will:
1. Create the `Webhook` table
2. Create the `WebhookLog` table
3. Create necessary indexes for performance

## Available Events

The system supports the following event types:

### Booking Events
- **`booking.created`** - When a new booking is created
- **`booking.updated`** - When booking status changes
- **`booking.cancelled`** - When a booking is cancelled

### Payment Events
- **`payment.completed`** - When a payment succeeds
- **`payment.failed`** - When a payment fails

### Quote Events
- **`quote.created`** - When a new quote is created
- **`quote.accepted`** - When client accepts a quote
- **`quote.refused`** - When client refuses a quote

### User Events
- **`user.registered`** - When a new user registers
- **`user.verified`** - When user email is verified

### Project Events
- **`project.created`** - When a new project is posted
- **`project.completed`** - When a project is marked completed

## Integration with Existing Routes

To emit webhook events, add trigger calls to existing route handlers. See examples below:

### Example 1: Booking Creation

In `/routes/bookings.js`, after creating a booking:

```javascript
const { triggerBookingCreated } = require('../utils/webhook-triggers');

// After creating the booking
const booking = await prisma.booking.create({ data: {...} });

// Get related data
const client = await prisma.user.findUnique({ where: { id: booking.clientId } });
const professional = await prisma.user.findUnique({ where: { id: booking.professionalId } });

// Trigger webhook (non-blocking)
triggerBookingCreated(booking, client, professional).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.json({ success: true, data: booking });
```

### Example 2: Payment Completion

In payment processing handler (after GeniusPay confirmation):

```javascript
const { triggerPaymentCompleted } = require('../utils/webhook-triggers');

// After payment status is updated to 'succeeded'
const payment = await prisma.payment.update({
  where: { id: paymentId },
  data: { status: 'succeeded', completedAt: new Date() }
});

// Get related data
const quote = await prisma.quote.findUnique({ where: { id: payment.quoteId } });
const professional = await prisma.professional.findUnique({
  where: { userId: quote.professionalId }
});
const client = await prisma.user.findUnique({ where: { id: quote.project.clientId } });

// Trigger webhook
triggerPaymentCompleted(payment, quote, professional, client).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});
```

### Example 3: Quote Acceptance

In `/routes/quotes.js`:

```javascript
const { triggerQuoteAccepted } = require('../utils/webhook-triggers');

// After quote status changes to ACCEPTED
const updatedQuote = await prisma.quote.update({
  where: { id: quoteId },
  data: { status: 'ACCEPTED' }
});

const professional = await prisma.professional.findUnique({
  where: { id: updatedQuote.professionalId }
});
const project = await prisma.project.findUnique({
  where: { id: updatedQuote.projectId }
});
const client = await prisma.user.findUnique({
  where: { id: project.clientId }
});

// Trigger webhook
triggerQuoteAccepted(updatedQuote, professional, project, client).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});
```

## Webhook Payload Structure

All webhooks are sent as POST requests with this structure:

```json
{
  "event": "booking.created",
  "timestamp": "2024-11-11T12:30:45.123Z",
  "data": {
    "bookingId": "uuid-here",
    "professionalId": "uuid-here",
    "clientId": "uuid-here",
    "date": "2024-11-15T00:00:00Z",
    "startTime": "09:00",
    "endTime": "11:00",
    "status": "PENDING",
    "projectId": "uuid-here",
    "createdAt": "2024-11-11T12:30:45.123Z",
    "client": {
      "id": "uuid-here",
      "email": "client@example.com",
      "firstName": "Jean",
      "lastName": "Dupont"
    },
    "professional": {
      "id": "uuid-here",
      "email": "pro@example.com",
      "firstName": "Marie",
      "lastName": "Martin"
    }
  }
}
```

## Security: HMAC Signature Verification

Each webhook request includes a signature header for verification:

```
X-Webhook-Signature: sha256=<hmac-hex-digest>
```

Receiving systems should verify the signature by:

1. Getting the signature from `X-Webhook-Signature` header
2. Computing HMAC-SHA256 of the raw request body using the webhook secret
3. Comparing the computed digest with the header value

### Example verification (Node.js):

```javascript
const crypto = require('crypto');

// In your webhook receiver endpoint
app.post('/webhooks/manawa', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const secret = process.env.MANAWA_WEBHOOK_SECRET;
  
  // Compute expected signature
  const payload = JSON.stringify(req.body);
  const computed = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Verify
  if (!crypto.timingSafeEqual(signature, computed)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process webhook
  console.log('Valid webhook received:', req.body.event);
  res.json({ received: true });
});
```

## Retry Logic

Failed webhooks are automatically retried with exponential backoff:

- **Attempt 1**: Immediate (0 seconds)
- **Attempt 2**: 5 seconds later
- **Attempt 3**: 10 seconds later
- **After 3 attempts**: Marked as failed

If a webhook fails, run the retry job (typically via cron):

```javascript
const { retryFailedWebhooks } = require('./utils/webhooks');

// In a cron job (e.g., every 5 minutes)
setInterval(async () => {
  try {
    const count = await retryFailedWebhooks();
    if (count > 0) {
      logger.info(`Retried ${count} webhooks`);
    }
  } catch (err) {
    logger.error('Retry job failed', { error: err.message });
  }
}, 5 * 60 * 1000); // Every 5 minutes
```

## Admin API Usage

### Register a Webhook

```bash
POST /api/admin/webhooks
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "url": "https://external-service.com/webhooks/manawa",
  "secret": "your-super-secret-minimum-16-chars",
  "events": ["booking.created", "payment.completed", "quote.accepted"]
}
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "webhook-uuid",
    "url": "https://external-service.com/webhooks/manawa",
    "events": ["booking.created", "payment.completed", "quote.accepted"],
    "isActive": true,
    "createdAt": "2024-11-11T12:30:45.123Z",
    "updatedAt": "2024-11-11T12:30:45.123Z"
  }
}
```

### List All Webhooks

```bash
GET /api/admin/webhooks
Authorization: Bearer <admin-token>
```

### Get Webhook Details with Logs

```bash
GET /api/admin/webhooks/:id?logLimit=10&logOffset=0
Authorization: Bearer <admin-token>
```

### Update Webhook

```bash
PUT /api/admin/webhooks/:id
Authorization: Bearer <admin-token>

{
  "events": ["booking.created", "payment.completed"],
  "url": "https://new-url.com/webhooks"
}
```

### Send Test Webhook

```bash
POST /api/admin/webhooks/:id/test
Authorization: Bearer <admin-token>
```

Response:
```json
{
  "success": true,
  "data": {
    "success": true,
    "statusCode": 200,
    "responseBody": { "received": true },
    "logId": "log-uuid"
  }
}
```

### Get Webhook Logs

```bash
GET /api/admin/webhooks/:id/logs?limit=50&offset=0&status=failed
Authorization: Bearer <admin-token>
```

Response:
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "log-uuid",
        "event": "booking.created",
        "status": "success",
        "attempt": 1,
        "createdAt": "2024-11-11T12:30:45.123Z",
        "response": { "statusCode": 200, "body": {...} }
      }
    ],
    "pagination": {
      "total": 150,
      "limit": 50,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

## Next Steps

1. **Run database migration**: `npm run migrate`
2. **Add webhook triggers** to existing route handlers using the examples provided
3. **Set up a retry cron job** to handle failed deliveries
4. **Test webhooks** using the admin `/test` endpoint
5. **Document your webhook endpoints** to external partners

## Testing

### Unit Tests Example

```javascript
const { triggerWebhook, WEBHOOK_EVENTS } = require('../utils/webhooks');

describe('Webhooks', () => {
  it('should trigger booking.created event', async () => {
    const testData = {
      bookingId: 'test-id',
      professionalId: 'pro-id',
      clientId: 'client-id',
      date: new Date().toISOString(),
      startTime: '09:00',
      endTime: '11:00',
    };

    await triggerWebhook(WEBHOOK_EVENTS.BOOKING_CREATED, testData);

    // Verify webhook was recorded in database
    const logs = await prisma.webhookLog.findMany({
      where: { event: WEBHOOK_EVENTS.BOOKING_CREATED }
    });
    
    expect(logs.length).toBeGreaterThan(0);
  });
});
```

## Troubleshooting

### Webhook not being sent
- Check if webhook is `isActive: true`
- Verify the webhook is subscribed to the event type
- Check webhook logs for errors

### Signature verification failed
- Ensure secret matches exactly
- Verify raw JSON body is used (not parsed object)
- Use `timingSafeEqual` to prevent timing attacks

### Repeated failures
- Check if receiving endpoint is accessible
- Verify endpoint accepts POST requests
- Check response status code (must be 2xx for success)
- Look at `nextRetryAt` field to see when retry is scheduled

## Configuration

### Environment Variables

Add to `.env` (optional):

```
WEBHOOK_RETRY_ATTEMPTS=3          # Max retry attempts (1-5)
WEBHOOK_RETRY_INITIAL_DELAY=5000  # Initial delay in ms (1000-30000)
WEBHOOK_TIMEOUT=30000             # Request timeout in ms (5000-60000)
```

## Performance Considerations

- Webhook triggers are **non-blocking** (fire-and-forget)
- Deliveries happen in background without blocking the main request
- Database indexes on `webhookId`, `event`, `status`, and `createdAt` ensure fast queries
- The retry job should run every 5 minutes to handle failed deliveries
- Keep `WebhookLog` table pruned (delete logs older than 90 days)

## Security Best Practices

1. **Always verify signatures** on receiving end
2. **Use HTTPS** for webhook endpoints
3. **Use long secrets** (minimum 16 characters, preferably 32+)
4. **Rate limit** webhook receiving endpoints
5. **Log all deliveries** for audit trails
6. **Implement idempotency** to handle duplicate deliveries
7. **Set timeouts** on receiving endpoints (30 second max)
