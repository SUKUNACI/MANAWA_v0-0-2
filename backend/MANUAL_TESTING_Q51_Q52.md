# Manual Testing Guide: Q51 + Q52

## Prerequisites

- Backend running: `npm start`
- GeniusPay test account configured
- Environment variables set (see `.env`)
- Postman or `curl` for testing

---

## Q51: GeniusPay Webhook Testing

### 1. Setup Test Data

First, create a test quote and payment:

```bash
# 1. Create test client user (if not exists)
# In Postman or app registration

# 2. Create test quote with client ID

# 3. Create test payment
curl -X POST http://localhost:4000/api/v1/payments/create \
  -H "Authorization: Bearer <CLIENT_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "quoteId": "<QUOTE_ID>",
    "amount": 50000,
    "isDeposit": true
  }'

# Save paymentId and geniuspayRef from response
```

### 2. Generate Valid Webhook Signature

Create a test script to generate the signature:

```javascript
// File: test-webhook-signature.js
const crypto = require('crypto');

const SECRET = process.env.GENIUSPAY_WEBHOOK_SECRET;
const timestamp = Math.floor(Date.now() / 1000);

const payload = {
  event: { type: 'payment.succeeded' },
  data: {
    reference: 'gp_test_123', // Use actual geniuspayRef from payment
    amount: 50000,
    status: 'completed'
  }
};

const data = `${timestamp}.${JSON.stringify(payload)}`;
const signature = crypto
  .createHmac('sha256', SECRET)
  .update(data)
  .digest('hex');

console.log('Timestamp:', timestamp);
console.log('Signature:', signature);
console.log('Payload:', JSON.stringify(payload));
```

Run it:
```bash
node test-webhook-signature.js
```

### 3. Send Test Webhook (Payment Succeeded)

```bash
# Get signature from above script
TIMESTAMP="<TIMESTAMP>"
SIGNATURE="<SIGNATURE>"

curl -X POST http://localhost:4000/api/v1/webhooks/geniuspay \
  -H "X-GeniusPay-Signature: $SIGNATURE" \
  -H "X-GeniusPay-Timestamp: $TIMESTAMP" \
  -H "Content-Type: application/json" \
  -d '{
    "event": { "type": "payment.succeeded" },
    "data": {
      "reference": "gp_test_123",
      "amount": 50000,
      "status": "completed"
    }
  }'
```

**Expected Response** (200 OK):
```json
{ "received": true, "processed": true }
```

### 4. Verify Payment Status Updated

```bash
# Get payment details
curl -X GET http://localhost:4000/api/v1/payments/<PAYMENT_ID> \
  -H "Authorization: Bearer <CLIENT_JWT_TOKEN>"
```

**Expected**: `status: "succeeded"`, `completedAt: <timestamp>`

### 5. Verify Audit Log Created

```bash
# In database
SELECT * FROM PaymentAuditLog 
WHERE paymentId = '<PAYMENT_ID>' 
ORDER BY createdAt DESC LIMIT 1;
```

**Expected**: 
- `fromStatus: "pending"`
- `toStatus: "succeeded"`
- `reason: "webhook"`

### 6. Verify Notification Created

```bash
# In database
SELECT * FROM Notification 
WHERE userId = '<CLIENT_USER_ID>' 
AND type = 'PAYMENT_RECEIVED' 
ORDER BY createdAt DESC LIMIT 1;
```

**Expected**: Notification with `PAYMENT_RECEIVED` type

### 7. Test Invalid Signature

```bash
# Try with wrong signature
curl -X POST http://localhost:4000/api/v1/webhooks/geniuspay \
  -H "X-GeniusPay-Signature: wrong_signature" \
  -H "X-GeniusPay-Timestamp: $(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{
    "event": { "type": "payment.succeeded" },
    "data": { "reference": "test" }
  }'
```

**Expected Response** (401 Unauthorized):
```json
{ "error": "Invalid signature" }
```

### 8. Test Payment Failed Event

```bash
# Generate signature for failed event
const payload = {
  event: { type: 'payment.failed' },
  data: {
    reference: 'gp_test_456',
    failure_reason: 'Card declined'
  }
};

# Then send webhook (same as payment.succeeded above)
```

**Expected**: Payment status updated to `failed`

### 9. Test Amount Mismatch

```bash
# Create new payment
# Generate webhook with mismatched amount

const payload = {
  event: { type: 'payment.succeeded' },
  data: {
    reference: 'gp_test_789',
    amount: 50001,  // Expected 50000, but received 50001 (mismatch > 1)
    status: 'completed'
  }
};
```

**Expected**: 
- Payment status: `failed`
- Metadata contains: `"reason": "amount_mismatch"`

### 10. Test Amount Within Tolerance

```bash
# Amount off by exactly 1 XOF (within tolerance)

const payload = {
  event: { type: 'payment.succeeded' },
  data: {
    reference: 'gp_test_999',
    amount: 50001,  // 50000 ± 1 = OK
    status: 'completed'
  }
};
```

**Expected**: Payment succeeds (status = `succeeded`)

---

## Q52: Reconciliation Cron Testing

### 1. Verify Cron Scheduled

Check server logs at startup:
```
[PaymentReconciliation] Scheduling daily reconciliation at 00:00 UTC
[PaymentReconciliation] First reconciliation scheduled in X hours Y minutes
```

### 2. Create Test Pending Payments

```bash
# Create multiple pending payments with geniuspayRef
# (from Q51 testing above, or via admin panel)

# In database, verify they exist:
SELECT * FROM Payment WHERE status = 'pending' AND geniuspayRef IS NOT NULL;
```

### 3. Mock Upcoming Reconciliation

Instead of waiting until midnight, you can trigger manually:

```javascript
// File: trigger-reconciliation.js
const { reconcilePaymentsDaily } = require('./jobs/payment-reconciliation-daily');

(async () => {
  console.log('Starting manual reconciliation...');
  const result = await reconcilePaymentsDaily();
  console.log('Result:', result);
  process.exit(0);
})();
```

Run it:
```bash
node trigger-reconciliation.js
```

### 4. Verify Reconciliation Results

Check logs:
```
[PaymentReconciliation] Starting daily reconciliation
[PaymentReconciliation] Found pending payments { count: X }
[PaymentReconciliation] Fetched GeniusPay status { paymentId: ..., gpStatus: ... }
[PaymentReconciliation] Payment synced to succeeded { paymentId: ..., amount: ... }
[PaymentReconciliation] Daily reconciliation completed { duration: ..., synced: X, failed: Y }
```

### 5. Verify Database Updates

```bash
# Check payment status updated
SELECT * FROM Payment WHERE id = '<PAYMENT_ID>';

# Check audit logs
SELECT * FROM PaymentAuditLog 
WHERE paymentId = '<PAYMENT_ID>' 
AND reason = 'reconciliation' 
ORDER BY createdAt DESC;

# Check reconciliation metadata
SELECT reconciledAt, reconciledBy FROM Payment 
WHERE status = 'succeeded' AND reconciledBy = 'reconciliation_job';
```

### 6. Test Stuck Payment Detection

```bash
# Create old pending payment (> 7 days ago)
INSERT INTO Payment (id, quoteId, amount, status, geniuspayRef, createdAt, updatedAt, isDeposit)
VALUES (
  gen_random_uuid(),
  '<QUOTE_ID>',
  50000,
  'pending',
  'gp_old_ref',
  NOW() - INTERVAL '8 days',
  NOW() - INTERVAL '8 days',
  true
);

# Repeat this 11 times to trigger alert (> 10)

# Run reconciliation
node trigger-reconciliation.js
```

### 7. Verify Admin Alerts

```bash
# Check notifications
SELECT * FROM Notification 
WHERE type = 'SYSTEM_ALERT' 
AND title LIKE '%bloqués%' 
ORDER BY createdAt DESC LIMIT 1;

# Check for admin notification recipients
SELECT userId FROM Notification 
WHERE type = 'SYSTEM_ALERT' 
AND message LIKE '%paiements%';
```

### 8. Test Amount Mismatch During Reconciliation

```bash
# Create pending payment
# Mock GeniusPay response with mismatched amount

# The reconciliation job will:
# 1. Call getPayment()
# 2. Detect mismatch
# 3. Mark as failed
# 4. Log audit entry
```

### 9. Monitor Performance

```bash
# Check reconciliation duration in logs
# Expected: < 10 seconds for < 100 payments

# Check for any API timeout errors
grep "GeniusPay.*timeout" logs/*.log

# Check database query performance
SELECT COUNT(*), MAX(duration_ms) 
FROM query_logs 
WHERE query LIKE '%Payment%' AND timestamp > NOW() - INTERVAL '1 hour';
```

### 10. Test Error Scenarios

```bash
# Stop GeniusPay mock server
# Run reconciliation - should log errors but continue

# Stop database connection
# Run reconciliation - should fail with error notification

# Restore services
```

---

## Integration Testing

### End-to-End Flow: Payment Creation to Settlement

1. **User initiates payment**
   ```bash
   POST /api/v1/payments/create
   → Payment created with status="pending"
   → GeniusPay payment link generated
   → User redirected to GeniusPay
   ```

2. **User completes payment on GeniusPay**
   ```
   GeniusPay processes payment
   → GeniusPay marks payment as succeeded
   ```

3. **GeniusPay sends webhook**
   ```bash
   POST /api/v1/webhooks/geniuspay
   → Webhook signature verified
   → Payment status updated to "succeeded"
   → Notification created
   → Audit log created
   ```

4. **Next day: Reconciliation cron runs**
   ```
   Daily 00:00 UTC reconciliation job
   → Fetches all pending payments
   → Calls GeniusPay API for each
   → Payment already succeeded, no change
   → Audit log shows reconciliation check
   ```

### Failure Scenario: Webhook Missed

1. **User completes payment**
   ```
   Payment marked succeeded on GeniusPay
   → Webhook sent but network error
   → Payment stuck in "pending" state
   ```

2. **Next day: Reconciliation saves the day**
   ```
   Reconciliation job runs
   → Finds pending payment
   → Calls GeniusPay: payment is succeeded
   → Updates payment status to "succeeded"
   → Audit log shows reconciliation sync
   → User notification created
   ```

---

## Logs Analysis

### Q51 Webhook Logs

```
[Webhook GeniusPay] Raw body parse error
[Webhook GeniusPay] Missing signature or timestamp headers
[Webhook GeniusPay] Invalid signature
[Webhook GeniusPay] Timestamp too old
[Webhook GeniusPay] Received event
[Webhook GeniusPay] Payment not found
[Webhook GeniusPay] Amount mismatch detected
[Webhook GeniusPay] Notification created
[Webhook GeniusPay] Event processed successfully
```

### Q52 Reconciliation Logs

```
[PaymentReconciliation] Starting daily reconciliation
[PaymentReconciliation] Found pending payments
[PaymentReconciliation] Fetched GeniusPay status
[PaymentReconciliation] Payment synced to succeeded
[PaymentReconciliation] Amount mismatch detected
[PaymentReconciliation] Payment synced to failed
[PaymentReconciliation] ALERT: Multiple stuck payments detected
[PaymentReconciliation] Admin alerts created
[PaymentReconciliation] Daily reconciliation completed
[PaymentReconciliation] Job failed
```

---

## Debugging Checklist

### Webhook not received?
- [ ] Check GeniusPay dashboard webhook URL
- [ ] Verify `GENIUSPAY_WEBHOOK_SECRET` matches
- [ ] Check server logs for webhook requests
- [ ] Test manually with curl (see Test Invalid Signature)

### Payment status not updating?
- [ ] Check webhook signature validity
- [ ] Check payment exists in database
- [ ] Check geniuspayRef matches
- [ ] Check for errors in PaymentAuditLog
- [ ] Check notification creation didn't fail

### Reconciliation not running?
- [ ] Check server logs at startup for scheduling message
- [ ] Check if system time is correct (UTC)
- [ ] Check database connection working
- [ ] Manually trigger: `node trigger-reconciliation.js`
- [ ] Check cron logs in application logs

### Amount mismatch false positives?
- [ ] Verify tolerance is ±1 XOF (not ±0.5 or ±2)
- [ ] Check GeniusPay amount parsing (amount vs paid_amount)
- [ ] Check database amount storage (float precision)

### Admin alerts not sent?
- [ ] Verify admin user exists and has role='ADMIN'
- [ ] Check notification creation in logs
- [ ] Verify > 10 stuck payments (not = 10)
- [ ] Check notification preferences not disabled

---

## Success Criteria

✅ All tests pass:
- Webhook receives and processes events
- Payment status updates correctly
- Audit logs created
- Notifications sent to users
- Reconciliation runs daily
- Stuck payments detected
- Admin alerts triggered
- Error scenarios handled gracefully

✅ Logs show healthy execution:
- No HMAC validation failures
- No database errors
- No API timeouts
- Cron scheduled correctly
- Reconciliation completes within timeout

✅ Database state consistent:
- Payment statuses match GeniusPay
- Audit logs complete and accurate
- Notifications created
- Amounts validated

**Status**: Ready for production deployment
