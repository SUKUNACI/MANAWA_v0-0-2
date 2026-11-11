# Webhook System - Quick Start

Get the webhook system up and running in 5 minutes.

## 1. Database Migration (1 min)

```bash
cd backend
npm run migrate
```

This creates two new tables:
- `Webhook` - Stores webhook configurations
- `WebhookLog` - Tracks all deliveries and retries

## 2. Verify Admin Routes (1 min)

The webhook admin API is now available at `/api/admin/webhooks` (requires ADMIN role).

## 3. Create Your First Webhook (2 min)

Send a POST request to register a webhook:

```bash
curl -X POST http://localhost:3000/api/admin/webhooks \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-service.com/webhooks/manawa",
    "secret": "your-minimum-16-character-secret",
    "events": ["booking.created", "payment.completed"]
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "webhook-uuid",
    "url": "https://your-service.com/webhooks/manawa",
    "events": ["booking.created", "payment.completed"],
    "isActive": true,
    "createdAt": "2024-11-11T12:30:45.123Z"
  }
}
```

## 4. Send Test Webhook (1 min)

Test that your webhook endpoint is reachable:

```bash
curl -X POST http://localhost:3000/api/admin/webhooks/webhook-uuid/test \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

Response shows if the endpoint received the test event successfully.

## 5. Add Event Triggers to Routes (time varies)

Now add webhook triggers to your route handlers. Example for booking creation:

### In `/routes/bookings.js`:

```javascript
// At the top of the file
const { triggerBookingCreated } = require('../utils/webhook-triggers');

// In your POST /bookings handler, after creating the booking:
const booking = await prisma.booking.create({ data: {...} });

// Get related data
const client = await prisma.user.findUnique({ where: { id: booking.clientId } });
const professional = await prisma.user.findUnique({ where: { id: booking.professionalId } });

// Trigger webhook (non-blocking)
triggerBookingCreated(booking, client, professional).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

// Send response
res.json({ success: true, data: booking });
```

### Event Triggers to Add:

| Route | Trigger Function |
|-------|------------------|
| POST /api/bookings | `triggerBookingCreated(booking, client, pro)` |
| PATCH /api/bookings/:id | `triggerBookingUpdated(booking, client, pro, oldStatus)` |
| DELETE /api/bookings/:id | `triggerBookingCancelled(booking, client, pro, reason)` |
| Payment success | `triggerPaymentCompleted(payment, quote, pro, client)` |
| Payment failure | `triggerPaymentFailed(payment, quote, pro, client, reason)` |
| POST /api/quotes | `triggerQuoteCreated(quote, pro, project, client)` |
| Quote accept | `triggerQuoteAccepted(quote, pro, project, client)` |
| Quote refuse | `triggerQuoteRefused(quote, pro, project, client)` |
| POST /api/auth/register | `triggerUserRegistered(user)` |
| Email verify | `triggerUserVerified(user)` |
| POST /api/projects | `triggerProjectCreated(project, client)` |
| Project complete | `triggerProjectCompleted(project, client)` |

## 6. Setup Retry Job

Add this to your application startup (in `index.js` or separate worker file):

```javascript
const { retryFailedWebhooks } = require('./utils/webhooks');

// Run every 5 minutes to retry failed webhooks
setInterval(async () => {
  try {
    const count = await retryFailedWebhooks();
    if (count > 0) {
      console.log(`[Webhooks] Retried ${count} failed deliveries`);
    }
  } catch (err) {
    console.error('[Webhooks] Retry job failed:', err.message);
  }
}, 5 * 60 * 1000); // Every 5 minutes

console.log('[Webhooks] Retry job started');
```

## 7. Verify It Works

Deploy your code and:

1. Create a webhook via admin API
2. Trigger an event (e.g., create a booking)
3. Check webhook logs: `GET /api/admin/webhooks/:id/logs`
4. Verify webhook was delivered with status "success"

## Webhook Payload Format

All webhooks are sent as POST requests with this structure:

```json
{
  "event": "booking.created",
  "timestamp": "2024-11-11T12:30:45.123Z",
  "data": {
    "bookingId": "uuid",
    "professionalId": "uuid",
    "clientId": "uuid",
    "date": "2024-11-15T00:00:00Z",
    "startTime": "09:00",
    "endTime": "11:00",
    "status": "PENDING",
    "createdAt": "2024-11-11T12:30:45.123Z",
    "client": {
      "id": "uuid",
      "email": "client@example.com",
      "firstName": "Jean",
      "lastName": "Dupont"
    },
    "professional": {
      "id": "uuid",
      "email": "pro@example.com",
      "firstName": "Marie",
      "lastName": "Martin"
    }
  }
}
```

## Webhook Headers

Every webhook request includes:

```
X-Webhook-Event: booking.created
X-Webhook-Signature: sha256=<hmac-hex>
X-Webhook-Attempt: 1
Content-Type: application/json
```

## Signature Verification (IMPORTANT!)

Your webhook receiver MUST verify the signature:

```javascript
const crypto = require('crypto');

app.post('/webhooks/manawa', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const secret = process.env.MANAWA_WEBHOOK_SECRET;
  
  // Compute expected signature
  const payload = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Verify timing-safe to prevent timing attacks
  if (!crypto.timingSafeEqual(signature, expected)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process webhook
  console.log('Valid webhook:', req.body.event);
  res.json({ received: true });
});
```

## Admin API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/webhooks` | List all webhooks |
| GET | `/api/admin/webhooks/events` | List available event types |
| POST | `/api/admin/webhooks` | Create webhook |
| GET | `/api/admin/webhooks/:id` | Get webhook details + logs |
| PUT | `/api/admin/webhooks/:id` | Update webhook |
| DELETE | `/api/admin/webhooks/:id` | Delete webhook |
| PATCH | `/api/admin/webhooks/:id/activate` | Enable/disable webhook |
| POST | `/api/admin/webhooks/:id/test` | Send test webhook |
| GET | `/api/admin/webhooks/:id/logs` | Get delivery logs |

## Troubleshooting

### Webhook not delivering?
1. Check webhook is `isActive: true` - `GET /api/admin/webhooks/:id`
2. Check endpoint is reachable - `POST /api/admin/webhooks/:id/test`
3. Check response code is 2xx - View in webhook logs
4. Verify signature verification is correct

### Webhook signature invalid?
- Ensure you're using the raw JSON body (not parsed)
- Verify secret matches exactly
- Use `crypto.timingSafeEqual()` to prevent timing attacks

### Webhook not triggered?
- Verify trigger function is in the route handler
- Check trigger is called after DB operation
- Verify event type is in webhook subscription
- Check application logs for errors

### Still having issues?
See full documentation in `WEBHOOK_SETUP_GUIDE.md`

## Next Steps

1. ✅ Run database migration
2. ✅ Create test webhook
3. ✅ Send test webhook
4. ⏳ Add triggers to routes (12 different events)
5. ⏳ Deploy and verify
6. ⏳ Share webhook endpoints with external partners

## File Reference

- `utils/webhooks.js` - Core webhook dispatcher
- `utils/webhook-triggers.js` - Ready-to-use trigger functions
- `routes/webhooks-admin.js` - Admin management API
- `WEBHOOK_SETUP_GUIDE.md` - Comprehensive guide
- `WEBHOOK_IMPLEMENTATION_CHECKLIST.md` - Step-by-step tasks
- `tests/webhooks.test.js` - Test suite

## That's It!

Your webhook system is now ready. The core infrastructure is complete, admin API is live, and you can start integrating webhooks into your routes.

For detailed information, see `WEBHOOK_SETUP_GUIDE.md`.
