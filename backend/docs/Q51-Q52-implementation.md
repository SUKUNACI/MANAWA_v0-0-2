# Q51 + Q52 Implementation: GeniusPay Webhooks & Payment Reconciliation

## Overview

This document describes the implementation of two critical payment features:

- **Q51**: GeniusPay Webhook Route (receiver only, no failover)
- **Q52**: Payment Reconciliation Cron Job (daily at midnight UTC)

## Q51: GeniusPay Webhook Route

### File: `/routes/webhooks-geniuspay.js`

**Endpoint**: `POST /api/v1/webhooks/geniuspay`

### Features

1. **Signature Verification**
   - Verifies HMAC-SHA256 signature from GeniusPay headers
   - Uses `X-GeniusPay-Signature` header
   - Prevents replay attacks using `X-GeniusPay-Timestamp` (5-minute window)
   - Uses timing-safe comparison to prevent timing attacks

2. **Event Processing**
   Handles four payment event types:
   - `payment.succeeded` / `payment.completed` → Updates to `succeeded`
   - `payment.failed` → Updates to `failed`
   - `payment.cancelled` → Updates to `failed`
   - `payment.expired` → Updates to `failed`

3. **Amount Validation**
   - Verifies received amount matches expected amount
   - Tolerance: ±1 XOF
   - Amount mismatch triggers payment failure

4. **Audit Logging**
   - Creates `PaymentAuditLog` entry for every status change
   - Logs reason, metadata, and GeniusPay response data
   - Enables full payment history tracking

5. **User Notifications**
   - Creates `Notification` entry on payment success/failure
   - Notifies client via preferred channels (push, email, SMS)
   - Message translated per user locale

### Request Example

```bash
curl -X POST http://localhost:4000/api/v1/webhooks/geniuspay \
  -H "X-GeniusPay-Signature: <hmac-sha256>" \
  -H "X-GeniusPay-Timestamp: <unix-timestamp>" \
  -H "Content-Type: application/json" \
  -d '{
    "event": { "type": "payment.succeeded" },
    "data": {
      "reference": "gp_123456",
      "amount": 50000,
      "status": "completed"
    }
  }'
```

### Response

**Success (200 OK)**:
```json
{ "received": true, "processed": true }
```

**Invalid Signature (401)**:
```json
{ "error": "Invalid signature" }
```

**Missing Payment (200 OK)**: Still returns 200 to acknowledge

### Database Updates

1. **Payment table**:
   - Updates `status` field
   - Sets `completedAt` on success
   - Stores GeniusPay response in `metadata`

2. **PaymentAuditLog table**:
   - Records status transition
   - Stores reason (`webhook`)
   - Includes GeniusPay event data

3. **Notification table**:
   - Creates notification entry
   - Sets type: `PAYMENT_RECEIVED` or `PAYMENT_FAILED`
   - Includes payment details in metadata

---

## Q52: Payment Reconciliation Cron Job

### File: `/jobs/payment-reconciliation-daily.js`

**Schedule**: Daily at **00:00 UTC** (midnight)

### Features

1. **Scope**
   - Reconciles **ALL** pending payments (not just recent ones)
   - Covers gaps where webhooks were missed
   - Detects payments stuck in pending state

2. **GeniusPay API Integration**
   - Calls `getPayment()` for each pending payment
   - Retrieves latest status from GeniusPay
   - Syncs database with authoritative source

3. **Status Sync**
   Handles all GeniusPay statuses:
   - `completed`, `success`, `succeeded` → `succeeded` (with amount check)
   - `failed`, `cancelled`, `expired` → `failed`
   - `pending`, `processing` → remains pending (checks for stuck)

4. **Amount Validation**
   - Checks received amount vs. expected amount
   - Tolerance: ±1 XOF
   - Mismatch marks payment as failed

5. **Stuck Payment Detection**
   - Identifies payments pending > 7 days
   - If count > 10:
     - Creates `SYSTEM_ALERT` notification for all admins
     - Includes sample stuck payments with details
     - Admin can investigate and take action

6. **Comprehensive Logging**
   - Creates `PaymentAuditLog` for each status change
   - Logs reason: `reconciliation`
   - Stores GeniusPay status in metadata
   - Enables audit trail and debugging

### Execution Flow

```
1. Find all payments with status = 'pending'
   ↓
2. For each payment:
   a. Fetch payment from GeniusPay API
   b. Check status:
      - If succeeded: validate amount, update if OK
      - If failed/cancelled: update to failed
      - If pending: check if stuck > 7 days
   c. Log audit entry
   ↓
3. Count stuck payments (pending > 7 days)
   ↓
4. If stuck > 10:
   - Create admin notifications
   - Include sample payments for investigation
   ↓
5. Log job completion with stats
```

### Database Updates

1. **Payment table**:
   - Updates `status`
   - Sets `completedAt` on success
   - Sets `reconciledAt` = now()
   - Sets `reconciledBy` = 'reconciliation_job'

2. **PaymentAuditLog table**:
   - Records status change with reason `reconciliation`
   - Stores GeniusPay status and metadata

3. **Notification table** (admin alert):
   - Type: `SYSTEM_ALERT`
   - Title: "Alerte: Paiements bloqués"
   - Message includes stuck count and samples

### Configuration

Schedule configured in `/index.js`:

```javascript
const { schedulePaymentReconciliation } = require('./jobs/payment-reconciliation-daily');
schedulePaymentReconciliation();
```

The function calculates the next midnight (UTC) and schedules the first run, then repeats every 24 hours.

### Error Handling

- **GeniusPay API errors**: Logged, payment skipped, will retry tomorrow
- **Database errors**: Logged, other payments continue processing
- **Notification errors**: Logged, doesn't block reconciliation

Admin error notification created if entire job fails.

---

## Integration Points

### Environment Variables Required

```env
GENIUSPAY_WEBHOOK_SECRET=<hmac-secret-from-geniuspay>
GENIUSPAY_API_KEY=<api-key>
GENIUSPAY_API_SECRET=<api-secret>
APP_URL=<frontend-url> # For payment success/error redirects
```

### Database Schema Requirements

#### Payment table
- `id` (UUID, PK)
- `quoteId` (UUID, FK)
- `geniuspayRef` (String, nullable)
- `amount` (Float)
- `status` (String: pending|succeeded|failed)
- `completedAt` (DateTime, nullable)
- `reconciledAt` (DateTime, nullable)
- `reconciledBy` (String, nullable)
- `metadata` (JSON, nullable)

#### PaymentAuditLog table
- `id` (UUID, PK)
- `paymentId` (UUID, FK)
- `fromStatus` (String)
- `toStatus` (String)
- `reason` (String: webhook|reconciliation|amount_mismatch|etc)
- `triggeredBy` (String: userId or "system")
- `metadata` (JSON, nullable)
- `createdAt` (DateTime)

### API Routes

**Q51 Webhook**:
- `POST /api/v1/webhooks/geniuspay` (public, signature-verified)

**Q52 Related Routes** (for payment management):
- `POST /api/v1/payments/create` (create payment)
- `GET /api/v1/payments/:paymentId` (get payment details)
- `GET /api/v1/payments?quoteId=...&status=...` (list user payments)
- `GET /api/v1/payment-stats` (admin stats)

---

## Testing

### Q51 Webhook Tests: `/tests/webhooks-geniuspay.test.js`

- ✅ Process `payment.succeeded` event
- ✅ Detect amount mismatches
- ✅ Process `payment.failed` event
- ✅ Reject invalid signatures
- ✅ Create user notifications
- ✅ Log audit trail

**Run**: `npm test -- webhooks-geniuspay.test.js`

### Q52 Reconciliation Tests: `/tests/payment-reconciliation-daily.test.js`

- ✅ Sync pending → succeeded
- ✅ Detect amount mismatch > ±1 XOF
- ✅ Handle tolerance within ±1 XOF
- ✅ Sync failed payments
- ✅ Detect stuck payments > 7 days
- ✅ Skip payments without geniuspayRef
- ✅ Log audit trail
- ✅ Handle GeniusPay API errors
- ✅ Handle no pending payments

**Run**: `npm test -- payment-reconciliation-daily.test.js`

---

## Monitoring & Alerts

### Logs

Check logs for:
- `[Webhook GeniusPay]` → Webhook events
- `[PaymentReconciliation]` → Daily reconciliation
- `[AuditLog]` → Status changes

### Metrics

Query database for insights:

```sql
-- Recent payment status changes
SELECT * FROM PaymentAuditLog 
ORDER BY createdAt DESC LIMIT 100;

-- Pending payments for investigation
SELECT * FROM Payment WHERE status = 'pending' AND createdAt < NOW() - INTERVAL '7 days';

-- Admin alerts
SELECT * FROM Notification WHERE type = 'SYSTEM_ALERT' ORDER BY createdAt DESC;
```

### Admin Dashboard

- View payment statistics: `/api/v1/payment-stats`
- View individual payment audit trail: `/api/v1/payments/:paymentId`
- Manual payment reconciliation: Can trigger cron manually if needed

---

## Deployment Checklist

- [ ] Deploy code changes (routes + jobs)
- [ ] Verify `GENIUSPAY_WEBHOOK_SECRET` set in environment
- [ ] Verify `GENIUSPAY_WEBHOOK_SECRET` matches GeniusPay dashboard
- [ ] Configure GeniusPay webhook URL: `https://api.example.com/api/v1/webhooks/geniuspay`
- [ ] Test webhook manually (see Request Example above)
- [ ] Verify cron runs at next midnight UTC
- [ ] Monitor logs for first reconciliation run
- [ ] Check database for audit logs and notifications

---

## Troubleshooting

### Webhook not received?
1. Check GeniusPay dashboard: webhook enabled and URL correct
2. Verify signature secret matches: `GENIUSPAY_WEBHOOK_SECRET`
3. Check logs for `[Webhook GeniusPay]` entries

### Payment stuck in pending?
1. Check `PaymentAuditLog` for last status change
2. Check GeniusPay dashboard for payment status
3. Run reconciliation manually to sync (or wait for daily cron)
4. Check for amount mismatches

### Admin alerts not received?
1. Verify user has admin role or `adminLevel` set
2. Check notification preferences
3. Check if > 10 payments actually stuck > 7 days
4. Check `Notification` table for SYSTEM_ALERT entries

---

## Performance Notes

- Webhook endpoint is synchronous (< 100ms typical)
- Reconciliation job is async and non-blocking
- Daily cron scheduled for midnight to avoid peak hours
- GeniusPay API calls are parallelizable for future optimization
- Audit logs indexed by `paymentId` for fast retrieval

---

## Security Notes

- ✅ Webhook signature verified with HMAC-SHA256
- ✅ Timing-safe comparison prevents timing attacks
- ✅ Timestamp validation prevents replay attacks (5-min window)
- ✅ Amount mismatch detection prevents fraud
- ✅ All status changes logged to audit trail
- ✅ Admin alerts use secure notification channels
