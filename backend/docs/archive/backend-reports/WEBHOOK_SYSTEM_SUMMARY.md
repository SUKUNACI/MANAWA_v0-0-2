# Webhook Event System - Implementation Summary

## Overview

A complete webhook event system has been implemented for the MANAWA backend enabling real-time notifications to external services. The system includes:

- ✅ Core webhook dispatcher with retry logic
- ✅ Admin management panel with full CRUD operations
- ✅ HMAC-SHA256 signature verification for security
- ✅ 12 business events across 5 categories
- ✅ Automatic retry with exponential backoff
- ✅ Comprehensive logging and monitoring
- ✅ Full test suite
- ✅ Complete documentation

## Files Created

### 1. Core Utilities (2 files)

**`/utils/webhooks.js`** (460 lines)
- Main webhook dispatcher and manager
- Functions:
  - `registerWebhook(url, secret, events)` - Register endpoint
  - `triggerWebhook(event, payload)` - Send event to all subscribers
  - `retryFailedWebhooks()` - Retry failed deliveries (cron job)
  - `getWebhooks()`, `getWebhookLogs()` - Query webhooks
  - `sendTestWebhook()` - Test connectivity
  - `generateSignature()` - HMAC signing
- Features:
  - Automatic retry with exponential backoff (5s, 10s, 20s)
  - 30-second request timeout
  - HMAC-SHA256 signature on all requests
  - Comprehensive error handling and logging

**`/utils/webhook-triggers.js`** (320 lines)
- Ready-to-use trigger functions for all events
- 12 event triggers covering:
  - Bookings (created, updated, cancelled)
  - Payments (completed, failed)
  - Quotes (created, accepted, refused)
  - Users (registered, verified)
  - Projects (created, completed)
- Each function accepts related data and sends structured payload
- Non-blocking async/await pattern

### 2. Admin Routes (1 file)

**`/routes/webhooks-admin.js`** (310 lines)
- Express router for webhook management
- Endpoints:
  - `GET /api/admin/webhooks` - List all webhooks
  - `GET /api/admin/webhooks/events` - List available events
  - `POST /api/admin/webhooks` - Register new webhook
  - `GET /api/admin/webhooks/:id` - Get details + logs
  - `PUT /api/admin/webhooks/:id` - Update configuration
  - `DELETE /api/admin/webhooks/:id` - Remove webhook
  - `PATCH /api/admin/webhooks/:id/activate` - Toggle status
  - `POST /api/admin/webhooks/:id/test` - Send test event
  - `GET /api/admin/webhooks/:id/logs` - Get logs (paginated)
- Input validation for URLs, secrets, events
- Admin logging for all operations
- Requires ADMIN role authentication

### 3. Database Schema (Updated)

**`/prisma/schema.prisma`** (Updated)
- New `Webhook` model:
  - `id` (UUID)
  - `url` (String) - Endpoint URL
  - `secret` (String) - HMAC secret
  - `events` (String[]) - Subscribed events
  - `isActive` (Boolean) - Delivery toggle
  - `createdAt`, `updatedAt` (DateTime)
  - Relations to WebhookLog

- New `WebhookLog` model:
  - `id` (UUID)
  - `webhookId` (String) - FK to Webhook
  - `event` (String) - Event type
  - `payload` (String) - Full JSON payload
  - `status` (String) - success|failed|pending
  - `response` (String) - Endpoint response
  - `attempt` (Int) - Current attempt (1-3)
  - `nextRetryAt` (DateTime) - Scheduled retry
  - `createdAt` (DateTime)
  - Indexes on webhookId, event, status, createdAt

### 4. Route Registration

**`/index.js`** (Updated)
- Added webhook admin routes import
- Registered at `/api/admin/webhooks`
- Protected with admin authentication middleware

### 5. Tests (1 file)

**`/tests/webhooks.test.js`** (360 lines)
- 25+ test cases covering:
  - Webhook registration and validation
  - Event triggering
  - Signature generation
  - Webhook deletion
  - Log retrieval and filtering
  - Test webhook sending
  - Retry logic
  - Headers and metadata
  - Event type validation
- Uses Jest with mocked axios for HTTP testing
- Includes integration test placeholders

### 6. Documentation (3 files)

**`WEBHOOK_SETUP_GUIDE.md`** (420 lines)
- Complete implementation guide
- Database migration steps
- All 12 event types documented
- Integration examples for each event
- Payload structure reference
- HMAC verification code examples
- Retry logic explanation
- Admin API usage examples
- Test examples
- Troubleshooting guide

**`WEBHOOK_IMPLEMENTATION_CHECKLIST.md`** (330 lines)
- 7-phase implementation checklist
- Detailed task breakdown
- Event integration points for each route
- Testing checklist
- Deployment steps
- Security checklist
- Performance considerations
- Timeline estimates (6-8 hours)

**`WEBHOOK_SYSTEM_SUMMARY.md`** (This file)
- Quick reference overview
- File inventory
- Key features
- Next steps

## Webhook Events

### Available Events (12 total)

**Booking Events (3)**
- `booking.created` - New booking created
- `booking.updated` - Booking status changed
- `booking.cancelled` - Booking cancelled

**Payment Events (2)**
- `payment.completed` - Payment succeeded
- `payment.failed` - Payment failed

**Quote Events (3)**
- `quote.created` - New quote created
- `quote.accepted` - Quote accepted by client
- `quote.refused` - Quote refused by client

**User Events (2)**
- `user.registered` - New user registered
- `user.verified` - Email verified

**Project Events (2)**
- `project.created` - New project posted
- `project.completed` - Project marked complete

## Key Features

### Security
✅ HMAC-SHA256 signature on all requests
✅ Signature in `X-Webhook-Signature` header
✅ Admin-only webhook management
✅ Secret minimum 16 characters
✅ HTTPS URL validation
✅ Admin logging of all operations

### Reliability
✅ Automatic retry with exponential backoff (5s, 10s, 20s)
✅ Max 3 retry attempts per webhook
✅ 30-second request timeout
✅ Non-blocking delivery (fire-and-forget)
✅ Comprehensive delivery logging
✅ Pending status tracking

### Observability
✅ Full delivery logs stored in database
✅ Tracks attempt count
✅ Stores endpoint responses
✅ Logs failures with details
✅ Paginable log history
✅ Status filtering (success/failed/pending)

### Admin Panel
✅ List all webhooks with recent logs
✅ Create/update/delete webhooks
✅ Enable/disable without deletion
✅ Send test webhooks
✅ View detailed delivery logs
✅ Filter logs by status
✅ Admin action audit trail

## Webhook Payload Structure

All payloads include:
```json
{
  "event": "booking.created",
  "timestamp": "2024-11-11T12:30:45.123Z",
  "data": {
    // Event-specific data
  }
}
```

Delivery headers:
```
X-Webhook-Event: booking.created
X-Webhook-Signature: sha256=<hmac-hex-digest>
X-Webhook-Attempt: 1
Content-Type: application/json
```

## Next Steps

### 1. Database Migration (5 min)
```bash
npm run migrate
```

### 2. Add Event Triggers (2-3 hours)
Add trigger functions to route handlers:
- `/routes/bookings.js` - 3 triggers
- `/routes/payments.js` - 2 triggers
- `/routes/quotes.js` - 3 triggers
- `/routes/auth.js` - 2 triggers
- `/routes/projects.js` - 2 triggers

Example pattern:
```javascript
const { triggerBookingCreated } = require('../utils/webhook-triggers');

// After creating booking
triggerBookingCreated(booking, client, professional).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});
```

### 3. Set Up Retry Cron Job (15 min)
```javascript
const { retryFailedWebhooks } = require('./utils/webhooks');

setInterval(async () => {
  try {
    const count = await retryFailedWebhooks();
    if (count > 0) logger.info(`Retried ${count} webhooks`);
  } catch (err) {
    logger.error('Retry job failed', { error: err.message });
  }
}, 5 * 60 * 1000); // Every 5 minutes
```

### 4. Run Tests (30 min)
```bash
npm test -- tests/webhooks.test.js
```

### 5. Deploy & Verify (30 min)
- Deploy code
- Access admin panel: `/admin/webhooks`
- Create test webhook
- Send test event
- Verify webhook logs

### 6. Enable Event Triggers
- Deploy updated routes with triggers
- Monitor webhook deliveries
- Handle failures via retry job

## Integration Points

Each route needs to call the appropriate trigger function after successful database operations:

| Route | Event | Function |
|-------|-------|----------|
| POST /api/bookings | booking.created | triggerBookingCreated() |
| PATCH /api/bookings/:id | booking.updated | triggerBookingUpdated() |
| DELETE /api/bookings/:id | booking.cancelled | triggerBookingCancelled() |
| POST /api/payments | payment.completed | triggerPaymentCompleted() |
| POST /api/payments | payment.failed | triggerPaymentFailed() |
| POST /api/quotes | quote.created | triggerQuoteCreated() |
| PATCH /api/quotes/:id/accept | quote.accepted | triggerQuoteAccepted() |
| PATCH /api/quotes/:id/refuse | quote.refused | triggerQuoteRefused() |
| POST /api/auth/register | user.registered | triggerUserRegistered() |
| POST /api/auth/verify-email | user.verified | triggerUserVerified() |
| POST /api/projects | project.created | triggerProjectCreated() |
| PATCH /api/projects/:id/complete | project.completed | triggerProjectCompleted() |

## Testing Checklist

- [ ] Database migration runs successfully
- [ ] Admin can access `/api/admin/webhooks`
- [ ] Admin can create webhook with valid URL and secret
- [ ] Admin can send test webhook
- [ ] Test webhook appears in logs with success status
- [ ] Admin can view webhook logs
- [ ] Event triggers appear in database
- [ ] Failed webhooks show in logs with pending status
- [ ] Retry job successfully retries pending webhooks
- [ ] HMAC signature validates correctly

## Deployment Considerations

1. **Database**: Run migration before deploying code
2. **Retry Job**: Add to application startup or separate worker
3. **Monitoring**: Set up alerts for high webhook failure rates
4. **Cleanup**: Consider removing logs older than 90 days
5. **Scaling**: For high volume, consider message queue instead

## Performance Notes

- Webhook triggers are non-blocking (fire-and-forget)
- Each event can target multiple endpoints (single query for all active webhooks)
- Database indexes ensure fast log retrieval
- Retry job processes max 100 webhooks per run
- Request timeout is 30 seconds to prevent hanging

## Security Notes

- Always verify signatures on receiving end
- Use HTTPS for all webhook URLs
- Keep secrets secure and rotate periodically
- Implement idempotency (handle duplicate events)
- Log all webhook activity
- Set timeouts on receiving endpoints

## Support

For detailed information, see:
- `WEBHOOK_SETUP_GUIDE.md` - Complete implementation guide
- `WEBHOOK_IMPLEMENTATION_CHECKLIST.md` - Step-by-step tasks
- `/utils/webhooks.js` - Source code documentation
- `/routes/webhooks-admin.js` - Admin endpoint documentation

---

**Total Files Created**: 8
**Total Lines of Code**: ~2,000
**Test Coverage**: 25+ test cases
**Documentation**: 3 comprehensive guides
**Events Supported**: 12
**Estimated Implementation Time**: 6-8 hours
