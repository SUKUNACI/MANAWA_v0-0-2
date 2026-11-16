# Webhook System Implementation Checklist

## Phase 1: Database Setup ✅

- [x] Added `Webhook` model to Prisma schema
- [x] Added `WebhookLog` model to Prisma schema
- [x] Created database migration file
- [ ] **TODO**: Run `npm run migrate` to create tables

## Phase 2: Core Infrastructure ✅

- [x] Created `/utils/webhooks.js` - Core dispatcher
  - [x] `registerWebhook()` function
  - [x] `unregisterWebhook()` function
  - [x] `triggerWebhook()` function
  - [x] `retryFailedWebhooks()` function
  - [x] `getWebhooks()` function
  - [x] `getWebhookLogs()` function
  - [x] `sendTestWebhook()` function
  - [x] `generateSignature()` for HMAC signing
  - [x] Retry logic with exponential backoff
  - [x] Error handling and logging

- [x] Created `/routes/webhooks-admin.js` - Admin panel
  - [x] `GET /admin/webhooks` - List all
  - [x] `GET /admin/webhooks/events` - List available events
  - [x] `POST /admin/webhooks` - Register new
  - [x] `GET /admin/webhooks/:id` - Get details with logs
  - [x] `PUT /admin/webhooks/:id` - Update configuration
  - [x] `DELETE /admin/webhooks/:id` - Remove webhook
  - [x] `PATCH /admin/webhooks/:id/activate` - Toggle active status
  - [x] `POST /admin/webhooks/:id/test` - Send test webhook
  - [x] `GET /admin/webhooks/:id/logs` - Get logs (paginated)
  - [x] Admin logging for all operations

- [x] Created `/utils/webhook-triggers.js` - Integration helpers
  - [x] `triggerBookingCreated()`
  - [x] `triggerBookingUpdated()`
  - [x] `triggerBookingCancelled()`
  - [x] `triggerPaymentCompleted()`
  - [x] `triggerPaymentFailed()`
  - [x] `triggerQuoteCreated()`
  - [x] `triggerQuoteAccepted()`
  - [x] `triggerQuoteRefused()`
  - [x] `triggerUserRegistered()`
  - [x] `triggerUserVerified()`
  - [x] `triggerProjectCreated()`
  - [x] `triggerProjectCompleted()`

- [x] Registered webhook routes in `index.js`
  - [x] Added `const webhooksAdminRoutes = require('./routes/webhooks-admin');`
  - [x] Added `app.use('/api/admin/webhooks', injectAdminCookie, webhooksAdminRoutes);`

## Phase 3: Event Integration ⏳

Add webhook triggers to the following routes:

### Bookings Routes (`/routes/bookings.js`)
- [ ] Add `triggerBookingCreated()` after `POST /bookings`
- [ ] Add `triggerBookingUpdated()` after `PATCH /bookings/:id`
- [ ] Add `triggerBookingCancelled()` after `DELETE /bookings/:id`

### Payments Routes (`/routes/payments.js` or payment handler)
- [ ] Add `triggerPaymentCompleted()` when payment status = 'succeeded'
- [ ] Add `triggerPaymentFailed()` when payment status = 'failed'

### Quotes Routes (`/routes/quotes.js`)
- [ ] Add `triggerQuoteCreated()` after `POST /quotes`
- [ ] Add `triggerQuoteAccepted()` after quote status changes to 'ACCEPTED'
- [ ] Add `triggerQuoteRefused()` after quote status changes to 'REFUSED'

### Authentication Routes (`/routes/auth.js`)
- [ ] Add `triggerUserRegistered()` after `POST /auth/register`
- [ ] Add `triggerUserVerified()` after email verification

### Projects Routes (`/routes/projects.js`)
- [ ] Add `triggerProjectCreated()` after `POST /projects`
- [ ] Add `triggerProjectCompleted()` after project status = 'COMPLETED'

**Example integration pattern**:
```javascript
const { triggerBookingCreated } = require('../utils/webhook-triggers');

// In your route handler, after successful database operation:
triggerBookingCreated(booking, client, professional).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

// Important: Use .catch() to prevent webhook failures from affecting the API response
```

## Phase 4: Testing ✅

- [x] Created `/tests/webhooks.test.js` with comprehensive tests
  - [x] Unit tests for webhook registration
  - [x] Unit tests for webhook triggering
  - [x] Unit tests for signature generation
  - [x] Unit tests for webhook deletion
  - [x] Unit tests for webhook listing
  - [x] Unit tests for webhook logs
  - [x] Unit tests for test webhook sending
  - [x] Signature header validation tests
  - [x] Retry logic tests
  - [x] WEBHOOK_EVENTS constant tests
  - [x] Admin routes placeholder tests

- [ ] **TODO**: Run tests: `npm test -- tests/webhooks.test.js`
- [ ] **TODO**: Add integration tests for actual route triggers
- [ ] **TODO**: Test webhook payload structure matches documentation

## Phase 5: Deployment & Operations ⏳

### Pre-deployment
- [ ] Database migration tested on staging
- [ ] All webhook triggers added to routes
- [ ] Admin routes tested manually
- [ ] Test webhooks sent successfully
- [ ] Documentation reviewed

### Production Deployment
- [ ] Run migration: `npm run migrate`
- [ ] Deploy code with webhook routes
- [ ] Verify admin webhook panel is accessible
- [ ] Test webhook creation and triggering
- [ ] Monitor webhook logs for failures

### Post-deployment
- [ ] Set up retry cron job
  ```javascript
  // In a separate worker or main app
  setInterval(async () => {
    try {
      const count = await retryFailedWebhooks();
      if (count > 0) logger.info(`Retried ${count} webhooks`);
    } catch (err) {
      logger.error('Retry job failed', { error: err.message });
    }
  }, 5 * 60 * 1000); // Every 5 minutes
  ```
- [ ] Set up webhook log cleanup job (optional, delete logs >90 days old)
  ```javascript
  setInterval(async () => {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await prisma.webhookLog.deleteMany({
      where: { createdAt: { lt: cutoff } }
    });
  }, 24 * 60 * 60 * 1000); // Daily
  ```

## Phase 6: Documentation & Communication ✅

- [x] Created `WEBHOOK_SETUP_GUIDE.md` with:
  - [x] Overview and architecture
  - [x] Files created documentation
  - [x] Database schema details
  - [x] Available events list
  - [x] Integration examples
  - [x] Webhook payload structure
  - [x] Security/HMAC verification guide
  - [x] Retry logic documentation
  - [x] Admin API usage examples
  - [x] Testing examples
  - [x] Troubleshooting guide

- [x] Created `WEBHOOK_IMPLEMENTATION_CHECKLIST.md` (this file)

- [ ] **TODO**: Add to project README
- [ ] **TODO**: Create integration guide for external partners
- [ ] **TODO**: Document webhook event reference
- [ ] **TODO**: Create troubleshooting guide for production

## Phase 7: External Partner Integration

- [ ] Share webhook documentation with partners
- [ ] Provide example implementation code
- [ ] Provide test credentials/sandbox environment
- [ ] Set up webhook monitoring dashboard
- [ ] Create webhook event reference API documentation
- [ ] Establish SLA for webhook delivery

## Webhook Events Summary

Total events available: **12**

| Category | Events |
|----------|--------|
| Booking | 3 (created, updated, cancelled) |
| Payment | 2 (completed, failed) |
| Quote | 3 (created, accepted, refused) |
| User | 2 (registered, verified) |
| Project | 2 (created, completed) |

## Security Checklist

- [x] HMAC-SHA256 signature implementation
- [x] Signature header on all requests
- [x] Secret validation (min 16 chars)
- [x] HTTPS validation for webhook URLs
- [x] Admin-only webhook management
- [x] Admin logging of webhook operations
- [x] Secure secret storage in database
- [ ] **TODO**: Webhook rotation policy (change secrets regularly)
- [ ] **TODO**: IP whitelist capability (optional enhancement)
- [ ] **TODO**: Rate limiting on webhook endpoints (optional)

## Performance Considerations

- [x] Non-blocking webhook delivery (fire-and-forget)
- [x] Database indexes on high-query fields
- [x] Batch retry processing (max 100 at a time)
- [x] Configurable timeouts (30 seconds default)
- [ ] **TODO**: Monitor webhook delivery latency
- [ ] **TODO**: Set up alerting for high failure rates
- [ ] **TODO**: Consider rate limiting for high-volume events

## Monitoring & Alerts

- [ ] **TODO**: Set up webhook delivery monitoring
- [ ] **TODO**: Alert on high failure rates (>10% in 5 min)
- [ ] **TODO**: Alert on queue buildup (>100 pending)
- [ ] **TODO**: Monitor retry job execution
- [ ] **TODO**: Dashboard showing webhook health

## Integration Points Needed

### Critical (Block Features)
- [x] Core webhook infrastructure
- [x] Admin webhook management API
- [ ] **TODO**: Booking routes integration

### High Priority
- [ ] **TODO**: Payment routes integration
- [ ] **TODO**: Quote routes integration
- [ ] **TODO**: Auth routes integration

### Medium Priority
- [ ] **TODO**: Project routes integration
- [ ] **TODO**: Monitoring dashboard

### Low Priority
- [ ] **TODO**: Webhook log retention policy
- [ ] **TODO**: IP whitelist feature
- [ ] **TODO**: Advanced filtering

## Known Limitations

1. **Synchronous Database Writes**: Webhooks are triggered immediately after database operations. For high-volume scenarios, consider message queue (RabbitMQ, Redis).

2. **No Automatic Cleanup**: WebhookLog entries grow indefinitely. Set up a cleanup job to delete old logs (recommended: older than 90 days).

3. **No Built-in Rate Limiting**: External services should implement rate limiting on their end. Consider adding rate limiting if needed.

4. **Simple Retry**: Uses exponential backoff with fixed max attempts (3). For production, consider persistent queue system.

## Future Enhancements

- [ ] Event filtering by resource ID
- [ ] Webhook templates for common integrations
- [ ] Async delivery via message queue
- [ ] Webhook signature verification in admin panel
- [ ] IP whitelist management
- [ ] Webhook versioning for backward compatibility
- [ ] GraphQL subscriptions as alternative to webhooks
- [ ] Event streaming to third-party services

## Support & Troubleshooting

For issues, check:
1. Webhook is `isActive: true`
2. Endpoint URL is correct and accessible
3. Endpoint accepts POST requests
4. Signature verification is working
5. Check WebhookLog for delivery attempts and responses
6. Verify environment variables if using custom retry config

Contact the development team for complex issues or custom implementations.

---

## Timeline Estimate

| Phase | Status | Est. Time |
|-------|--------|-----------|
| 1. Database Setup | ✅ Complete | 5 min |
| 2. Infrastructure | ✅ Complete | 2 hours |
| 3. Integration | ⏳ Pending | 2-3 hours |
| 4. Testing | ✅ Partial | 1 hour |
| 5. Deployment | ⏳ Pending | 30 min |
| 6. Documentation | ✅ Complete | 1 hour |
| 7. Partner Integration | ⏳ Pending | Ongoing |

**Total Implementation Time**: 6-8 hours
**Total Testing Time**: 2-3 hours
**Go-Live Readiness**: After Phase 5
