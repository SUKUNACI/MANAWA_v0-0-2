# Q55 + Q56 Deployment Steps

## Summary
- **Q55:** Webhook Signature Verification (HMAC-SHA256)
- **Q56:** Webhook Ordering Guarantees (Bull Queue FIFO)
- **Status:** Ready for deployment
- **Testing:** All syntax validated, tests created
- **Risk Level:** Low (non-breaking changes)

---

## Pre-Deployment Checklist

- [ ] All files created and syntax validated
- [ ] Tests passing locally: `npm test -- webhooks-q55-q56.test.js`
- [ ] Database backup taken
- [ ] Redis configured and accessible
- [ ] Team notified

---

## Step 1: Code Review & Merge (Dev Team)

### Files to Review
1. `middleware/webhook-signature-verification.js` - Q55 middleware
2. `config/webhook-queue-config.js` - Q56 queue config
3. `utils/webhook-queue-manager.js` - Q56 manager
4. `tests/webhooks-q55-q56.test.js` - Tests
5. Modified files: `prisma/schema.prisma`, `config/queue.js`, `index.js`

### Code Review Points
- [ ] Timing-safe comparison implementation (Q55)
- [ ] FIFO queue setup (Q56)
- [ ] Error handling and logging
- [ ] Test coverage completeness
- [ ] Documentation accuracy

### Merge to Feature Branch
```bash
git checkout -b feature/q55-q56-webhooks
git add middleware/ config/ utils/ tests/ prisma/ index.js Q55_Q56*.md DEPLOYMENT_STEPS_Q55_Q56.md
git commit -m "feat(Q55+Q56): Add webhook signature verification and ordering guarantees

- Q55: Middleware for HMAC-SHA256 signature verification
- Q56: Bull Queue FIFO ordering with sequence numbers
- Database: Add sequence and idempotencyKey to WebhookLog
- Tests: 12+ test cases for Q55 and Q56
- Docs: Complete implementation guide

Implements:
- Timing-safe comparison (crypto.timingSafeEqual)
- FIFO webhook ordering (1 job at a time)
- Idempotency key support
- Headers: X-Webhook-Signature, X-Webhook-Sequence, X-Idempotency-Key
"
git push origin feature/q55-q56-webhooks
```

### Create Pull Request
- Link to issue/task
- Describe Q55 and Q56 features
- Reference implementation docs
- Tag reviewers

---

## Step 2: Staging Deployment

### 2.1 Deploy Code to Staging
```bash
# Pull latest feature branch
git fetch origin
git checkout feature/q55-q56-webhooks

# Deploy to staging environment
# (Render, Heroku, or your CI/CD)
# Set environment variables
export REDIS_HOST=staging-redis.example.com
export REDIS_PORT=6379
# Deploy...
```

### 2.2 Apply Database Migration

**Option A: Prisma Migration**
```bash
npx prisma migrate deploy
# or
npx prisma migrate dev --name "add_webhook_sequence_and_idempotency"
```

**Option B: Direct SQL (if Prisma not available)**
```bash
psql $DATABASE_URL << EOF
-- Add sequence column (default 0)
ALTER TABLE "WebhookLog" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

-- Add idempotencyKey column (nullable)
ALTER TABLE "WebhookLog" ADD COLUMN "idempotencyKey" TEXT;

-- Create indexes for better query performance
CREATE INDEX "WebhookLog_sequence_idx" ON "WebhookLog"("sequence");
CREATE INDEX "WebhookLog_idempotencyKey_idx" ON "WebhookLog"("idempotencyKey");
EOF
```

### 2.3 Verify Database Changes
```bash
# Check columns exist
psql $DATABASE_URL -c "\d WebhookLog"

# Check indexes created
psql $DATABASE_URL -c "SELECT * FROM pg_indexes WHERE tablename = 'WebhookLog'"
```

### 2.4 Run Tests on Staging
```bash
npm test -- webhooks-q55-q56.test.js

# Output should show:
# Q55: Webhook Signature Verification (7 tests)
# Q56: Webhook Ordering Guarantees (5 tests)
# Integration Tests (1 test)
# Total: 13 tests passed
```

### 2.5 Manual Integration Tests

**Test Q55: Signature Verification**

1. Create test webhook in admin panel
2. Send webhook with valid signature:
   ```bash
   SECRET="webhook-secret"
   PAYLOAD='{"test":"data"}'
   SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)
   
   curl -X POST https://staging.manawa.app/api/v1/webhooks/test \
     -H "X-Webhook-Signature: sha256=$SIGNATURE" \
     -H "X-Webhook-Event: payment.completed" \
     -H "X-Webhook-Attempt: 1" \
     -H "Content-Type: application/json" \
     -d "$PAYLOAD"
   ```
   Expected: 200 OK

3. Send webhook with invalid signature:
   ```bash
   curl -X POST https://staging.manawa.app/api/v1/webhooks/test \
     -H "X-Webhook-Signature: sha256=invalid" \
     -H "X-Webhook-Event: payment.completed" \
     -H "Content-Type: application/json" \
     -d "$PAYLOAD"
   ```
   Expected: 401 Unauthorized

**Test Q56: Ordering**

1. Send 3 webhooks in sequence
2. Verify sequence numbers: 1, 2, 3
3. Verify X-Webhook-Sequence header in logs
4. Check WebhookLog table:
   ```sql
   SELECT id, sequence, idempotencyKey, status FROM "WebhookLog"
   WHERE webhookId = 'xxx'
   ORDER BY sequence ASC;
   ```

**Test Q56: Idempotency**

1. Send webhook with idempotency key
2. Send same webhook with same idempotency key
3. Verify only one entry in queue

### 2.6 Monitor Staging

**Check Logs**
```bash
# Look for Q55 and Q56 markers
tail -f logs/server.log | grep -E "Q55|Q56"

# Expected logs:
# [Q55] Webhook signature verified
# [Q56] Webhook added to queue
# [Q56] Webhook job completed
```

**Check Queue Stats**
```bash
curl https://staging.manawa.app/api/v1/admin/queues
```

Response should include:
```json
{
  "webhooks": {
    "active": 0,
    "waiting": 0,
    "completed": 3,
    "failed": 0
  }
}
```

### 2.7 Staging Sign-off

- [ ] All tests passing
- [ ] Signatures verified correctly (Q55)
- [ ] Webhooks in FIFO order (Q56)
- [ ] Idempotency working
- [ ] No errors in logs
- [ ] Performance acceptable
- [ ] Product owner approval

---

## Step 3: Production Deployment

### 3.1 Create Backup

```bash
# Backup database
pg_dump $DATABASE_URL > backup-q55-q56-$(date +%Y%m%d).sql

# Backup to S3 or storage
aws s3 cp backup-q55-q56-*.sql s3://your-bucket/backups/
```

### 3.2 Merge to Main

```bash
git checkout main
git pull origin main
git merge feature/q55-q56-webhooks
git push origin main
```

### 3.3 Deploy to Production

```bash
# Render: Automatic deployment on main push
# Or trigger manually:
# git push heroku main
# Or other deployment process
```

### 3.4 Apply Production Migration

**Option A: Automatic (if Prisma migration runs)**
```bash
# Migration runs automatically on deployment
# Check deployment logs for success:
# prisma.migrationEngine: Migration successfully applied
```

**Option B: Manual SQL**
```bash
# If automatic not available:
psql $DATABASE_URL < prisma/migrations/add_webhook_q56_migration.sql

# Verify:
psql $DATABASE_URL -c "\d WebhookLog"
```

### 3.5 Verify Production Deployment

```bash
# Check deployment status
curl https://api.manawa.app/api/v1/health

# Check webhook queue initialized
curl https://api.manawa.app/api/v1/admin/queues

# Check logs
tail -f logs/production.log | grep -E "Q55|Q56|initializ"

# Expected logs:
# Initialisation de la queue webhook...
# Queue webhook initialisée
```

### 3.6 Monitor Production

**Real-time Monitoring**
- [ ] Error rate normal
- [ ] No timeout errors
- [ ] Redis connection stable
- [ ] Queue processing normally
- [ ] Signature verification working
- [ ] FIFO ordering correct

**Daily Checks (first week)**
- [ ] Webhook logs show sequence numbers
- [ ] Failed webhooks < 1%
- [ ] Processing latency normal (~100-500ms)
- [ ] No signature validation errors (except bad actors)

---

## Step 4: Integration with Existing Routes

### 4.1 Update Webhook Routes

Once Q55+Q56 deployed, update routes that send webhooks:

**Example: routes/payments.js**

Before:
```javascript
const { triggerWebhook } = require('../utils/webhooks');
await triggerWebhook('payment.completed', payload);
```

After:
```javascript
const { triggerWebhookQueued } = require('../utils/webhook-queue-manager');
await triggerWebhookQueued('payment.completed', payload);
```

This is a **non-breaking change** because:
- `triggerWebhookQueued` has same signature as `triggerWebhook`
- Returns a Promise
- Logs success/failure
- Handles errors gracefully

### 4.2 Routes to Update

Priority order:
1. `routes/payments.js` - GeniusPay webhook handler
2. `routes/subscriptions.js` - Subscription notifications
3. `routes/quotes.js` - Quote events (if any)
4. Other webhook-triggering endpoints

### 4.3 PR for Route Updates

Create separate PR:
```bash
git checkout -b feature/use-webhook-queue-for-triggers
# Update routes
git commit -m "refactor: Use triggerWebhookQueued for all webhook events

Replaces direct triggerWebhook calls with queued version:
- Ensures FIFO ordering
- Supports idempotency
- Maintains backward compatibility
- Same API signature
"
git push origin feature/use-webhook-queue-for-triggers
```

---

## Step 5: Rollback Plan

If issues occur:

### 5.1 Quick Disable

```javascript
// In index.js, comment out initialization:
// await initializeWebhookQueue();

// Fall back to old triggerWebhook function
const { triggerWebhook } = require('./utils/webhooks');
// Instead of triggerWebhookQueued
```

### 5.2 Revert Changes

```bash
git revert feature/q55-q56-webhooks
git push origin main
# Redeploy
```

### 5.3 Restore from Backup

```bash
psql $DATABASE_URL < backup-q55-q56-*.sql
```

### 5.4 Verify Rollback

```bash
# Check DB reverted
psql $DATABASE_URL -c "\d WebhookLog" | grep sequence
# Should show: column 'sequence' not found (OK)

# Check logs
tail -f logs/production.log | grep -i rollback
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

**Q55 Signature Verification**
- Invalid signatures: Should be < 0.1% (unless under attack)
- Signature verification latency: ~1ms
- Alert if: > 5% invalid signatures

**Q56 Queue Processing**
- Queue depth: Should be < 10 jobs
- Processing time: 100-500ms per webhook
- Failed jobs: < 1% of total
- Alert if: Queue depth > 100 or failure rate > 5%

### Logging Queries

```bash
# Count invalid signatures (Q55)
grep "[Q55] Signature webhook invalide" logs/*.log | wc -l

# Count failed jobs (Q56)
grep "[Q56] Webhook delivery failed" logs/*.log | wc -l

# Monitor sequence numbers (Q56)
grep "X-Webhook-Sequence:" logs/*.log | tail -20
```

### Database Queries

```sql
-- Check webhook processing status
SELECT 
  status, 
  COUNT(*) as count,
  MAX(createdAt) as last_event
FROM "WebhookLog"
WHERE createdAt > NOW() - INTERVAL '1 hour'
GROUP BY status;

-- Find failures
SELECT id, event, response, attempt, sequence
FROM "WebhookLog"
WHERE status = 'failed'
AND createdAt > NOW() - INTERVAL '24 hours'
ORDER BY createdAt DESC;

-- Check sequence numbers
SELECT 
  webhookId,
  MIN(sequence) as min_seq,
  MAX(sequence) as max_seq,
  COUNT(*) as total
FROM "WebhookLog"
WHERE createdAt > NOW() - INTERVAL '24 hours'
GROUP BY webhookId;
```

---

## Troubleshooting

### Q55 Issues

**Problem:** Signature verification failing
```bash
# Check secret is configured
grep WEBHOOK_SECRET .env

# Verify middleware is applied
grep webhookSignatureVerification index.js

# Check raw body capture order
grep captureRawBody index.js  # Should be before express.json()
```

**Solution:**
- Ensure WEBHOOK_SECRET in .env
- Verify middleware order: captureRawBody → express.json() → verification
- Check client is sending signature in correct format

### Q56 Issues

**Problem:** Webhooks not being queued
```bash
# Check Redis connection
redis-cli ping

# Check queue initialization
grep "Queue webhook initializ" logs/*.log

# Check Bull queue in Redis
redis-cli KEYS "bull:webhooks:*" | head
```

**Solution:**
- Verify Redis accessible
- Check REDIS_HOST, REDIS_PORT env vars
- Restart server

**Problem:** FIFO order not guaranteed
```bash
# Check sequence numbers increasing
SELECT sequence, createdAt FROM "WebhookLog" 
ORDER BY createdAt DESC LIMIT 10;

# Check concurrency setting
grep "concurrency" config/webhook-queue-config.js
# Should be: process(1, ...)
```

**Solution:**
- Verify concurrency = 1 in queue config
- Check no multiple processors running
- Restart queue workers

---

## Post-Deployment Tasks

- [ ] Update webhook documentation for clients
- [ ] Add X-Webhook-Signature header requirement to API docs
- [ ] Add X-Webhook-Sequence, X-Idempotency-Key headers to docs
- [ ] Add idempotency handling guide for clients
- [ ] Setup monitoring dashboards
- [ ] Configure alerts for failures
- [ ] Document rollback procedure
- [ ] Schedule 1-week stability check
- [ ] Plan Q55/Q56 optimization tasks (if needed)

---

## Success Criteria

Deployment is successful when:

- [ ] All 13+ tests passing
- [ ] Zero errors in logs related to Q55/Q56
- [ ] Signature verification working (401 on invalid)
- [ ] Webhooks delivered in FIFO order
- [ ] Queue depth stable (< 10 jobs)
- [ ] Processing latency normal
- [ ] Idempotency working (no duplicates)
- [ ] Production webhook delivery rate > 99.5%
- [ ] No performance degradation
- [ ] Team confirms stability

---

## Contact & Support

For issues or questions:
- Refer to: `Q55_Q56_IMPLEMENTATION.md`
- Check: `INTEGRATION_Q55_Q56.md`
- Review: `Q55_Q56_SUMMARY.txt`
- Check logs with: `[Q55]` and `[Q56]` prefixes

---

**Deployment completed by:** ________________  
**Date:** ________________  
**Status:** ☐ Staging ☐ Production ☐ Rollback
