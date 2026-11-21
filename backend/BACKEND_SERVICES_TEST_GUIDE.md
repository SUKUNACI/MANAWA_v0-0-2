# MANAWA Backend - External Services Testing Guide

**Date:** 2026-11-18  
**Environment:** Render (Production)  
**Current Configuration:** PostgreSQL (Neon) + Redis (Upstash TLS)

---

## Executive Summary

All external services in MANAWA backend can be tested **safely** without modifying production data:

- ✅ **Redis**: PING command via health check
- ✅ **Bull Queues**: Status endpoint via `GET /api/bull-status` (local)
- ✅ **Firebase FCM**: Initialization status check
- ✅ **Mailjet**: Graceful dev-mode fallback (no emails sent)
- ✅ **Twilio**: Graceful test-mode fallback (no SMS sent)
- ✅ **Sentry**: Passive monitoring (no data modification)

---

## Quick Test Commands

### 1. System Health Check (All Services)

```bash
# Test all services at once
curl -X GET "https://manawa-v0-0-2.onrender.com/api/v1/health"

# Expected response:
{
  "status": "healthy",
  "timestamp": "2026-11-18T18:10:00Z",
  "services": {
    "database": "ok",
    "redis": "ok",
    "firebase": "ok|error",
    "sentry": "ok|disabled"
  }
}
```

### 2. Redis Connectivity

```bash
# Verify Redis cache
curl -X GET "https://manawa-v0-0-2.onrender.com/api/v1/health" | jq '.services.redis'

# Expected: "ok" (Upstash with TLS working)
```

### 3. Bull Queue Status (Local Only)

```bash
# Test queue connection (127.0.0.1 only)
curl -X GET "http://localhost:4000/api/bull-status"

# Expected response:
{
  "status": "connected",
  "redis": {
    "host": "deciding-cow-120586.upstash.io",
    "port": 6379,
    "tls": true
  }
}
```

### 4. Search Endpoint

```bash
# Test PostgreSQL full-text search
curl -X GET "https://manawa-v0-0-2.onrender.com/api/search?q=test&type=professionals&limit=5"

# Expected: Results from PostgreSQL search
```

### 5. Search Facets (Metadata)

```bash
# Get facet counts (useful for UI filters)
curl -X GET "https://manawa-v0-0-2.onrender.com/api/search-facets/facets?q=electrician"

# Expected response with counts by city, trade, rating
```

### 6. Queue Admin Dashboard (Admin Auth Required)

```bash
# Get all queue stats
curl -X GET "https://manawa-v0-0-2.onrender.com/api/admin/queues" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT"

# Expected response:
{
  "success": true,
  "emails": { "active": 0, "completed": 42, "failed": 2, "delayed": 0, "waiting": 5 },
  "pdfs": { "active": 0, "completed": 18, "failed": 0, "delayed": 0, "waiting": 0 },
  "analytics": { ... },
  "payments": { ... },
  "badges": { ... }
}
```

### 7. Monitoring Metrics (Prometheus Format)

```bash
# Prometheus metrics endpoint (for scraping)
curl -X GET "https://manawa-v0-0-2.onrender.com/api/monitoring/metrics"

# Expected: Prometheus format metrics for all HTTP routes and system stats
```

---

## Service-by-Service Testing

### Redis Cache

**Status:** Configured in production (Upstash)  
**Config File:** `/backend/config/redis.js`

#### Safe Tests

1. **Health check (PING command):**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/v1/health" | jq '.services.redis'
   ```

2. **Local Redis connection test:**
   ```bash
   # In Node.js local environment
   const redis = require('./config/redis');
   await redis.initializeRedis();
   const health = await redis.healthCheck();
   ```

3. **Cache stats:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/monitoring/metrics" | grep redis
   ```

#### Critical Notes

- **Production requirement:** REDIS_URL must be set (`rediss://` with TLS)
- Currently using: `rediss://deciding-cow-120586.upstash.io:6379`
- Fallback: In-memory cache (development only, unsafe for clusters)
- **Non-destructive testing:** PING, key count queries only

---

### Bull Queues (Email, PDF, Analytics, Payments, Badges)

**Status:** Active in production  
**Config File:** `/backend/config/queue.js`

#### Safe Tests

1. **Queue status (local only):**
   ```bash
   curl -X GET "http://localhost:4000/api/bull-status"
   ```

2. **Queue stats (admin auth required):**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/admin/queues" \
     -H "Authorization: Bearer ADMIN_JWT"
   ```

3. **Specific queue stats:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/admin/queues/emails" \
     -H "Authorization: Bearer ADMIN_JWT"
   ```

4. **Job status by type:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/admin/queues/emails/jobs?status=failed&limit=10" \
     -H "Authorization: Bearer ADMIN_JWT"
   ```

#### Queue Types

| Queue | Purpose | Status |
|-------|---------|--------|
| `emails` | Email sending | Active |
| `pdfs` | PDF generation | Active |
| `analytics` | Analytics aggregation | Active |
| `payments` | Payment processing | Active |
| `badges` | Badge assignment | Active |
| `webhooks` | Webhook delivery | Active (separate config) |

#### Non-Destructive Operations

- `GET` stats endpoints (read-only)
- `GET` job details (read-only)
- Health check via Redis connectivity

#### Destructive Operations (Admin Only)

- `POST` retry (modifies job status)
- `DELETE` job (removes job)
- `POST` pause/resume (changes queue state)

**Testing Recommendation:** Read stats only, don't modify production jobs.

---

### Firebase Cloud Messaging (FCM)

**Status:** Not configured in production  
**Config File:** `/backend/config/firebase-admin.js`

#### Safe Tests

1. **Initialization status:**
   ```javascript
   const firebase = require('./config/firebase-admin');
   const isInitialized = firebase.isInitialized();
   console.log('Firebase ready:', isInitialized);
   ```

2. **Health check via main endpoint:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/v1/health" | jq '.services.firebase'
   ```

#### Production Notes

- No Firebase credentials in production `.env`
- Fallback: Expo push notifications (enabled in `/config/push-notification-fallback.js`)
- Push notifications still work without FCM

---

### Mailjet Email Service

**Status:** Not configured in production  
**Config File:** `/backend/config/mailer.js`

#### Safe Tests

1. **Dev mode test (no actual email sent):**
   ```javascript
   const mailer = require('./config/mailer');
   const result = await mailer.sendVerificationEmail(
     'test@example.com',
     '123456',
     'verify'
   );
   // Returns: { sent: false, devCode: '123456' }
   // Code is logged to backend logs, not sent
   ```

2. **Check configuration status:**
   ```javascript
   const { isConfigured } = require('./config/mailer');
   console.log('Mailjet configured:', isConfigured);
   ```

#### Safe Behavior

- ✅ No credentials = test mode (codes logged only)
- ✅ Authentication still works (codes visible in logs)
- ✅ No real emails sent
- ✅ Perfect for testing email flow without sending

#### Routes That Use Mailjet

- `POST /api/auth/verify/request` → Sends verification email (or logs in dev mode)
- `POST /api/auth/password-reset/request` → Sends reset email (or logs in dev mode)
- Admin trigger: Package suspension notification

---

### Twilio SMS Service

**Status:** Not configured in production  
**Config File:** `/backend/config/sms.js`

#### Safe Tests

1. **Test mode (no SMS sent):**
   ```javascript
   const sms = require('./config/sms');
   const result = await sms.sendVerificationSms(
     '+33612345678',
     '123456'
   );
   // Returns: { sent: false, devCode: '123456' }
   // Code is logged to backend, not sent as SMS
   ```

2. **Configuration check:**
   ```javascript
   const { isConfigured } = require('./config/sms');
   console.log('Twilio configured:', isConfigured);
   ```

#### Safe Behavior

- ✅ No credentials = test mode (codes logged only)
- ✅ Authentication still works (codes visible in logs)
- ✅ No real SMS sent
- ✅ Safe for testing phone verification flow

---

### Sentry Error Tracking

**Status:** Not configured in production  
**Config File:** `/backend/index.js` (lines 20-27, 542-560)

#### Safe Tests

1. **Check Sentry initialization:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/v1/health" | jq '.services.sentry'
   ```

2. **Sentry middleware verification:**
   - Sentry middleware is installed if DSN provided
   - If DSN missing, error tracking is disabled gracefully
   - **No production impact**

#### Non-Invasive Monitoring

- Passive error capture (read-only)
- No data modification
- Safe to enable/disable anytime

---

### Monitoring & Metrics

**Status:** Active  
**Config File:** `/backend/routes/monitoring.js`

#### Safe Tests

1. **Health dashboard:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/monitoring/health"
   ```

2. **Prometheus metrics:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/monitoring/metrics"
   ```

3. **Admin dashboard (auth required):**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/monitoring/admin/monitoring" \
     -H "Authorization: Bearer ADMIN_JWT"
   ```

4. **Performance by route:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/monitoring/admin/performance/top-routes" \
     -H "Authorization: Bearer ADMIN_JWT"
   ```

5. **Database performance:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/monitoring/admin/performance/database" \
     -H "Authorization: Bearer ADMIN_JWT"
   ```

6. **Business metrics:**
   ```bash
   curl -X GET "https://manawa-v0-0-2.onrender.com/api/monitoring/admin/business/metrics" \
     -H "Authorization: Bearer ADMIN_JWT"
   ```

#### Safe Operations

- All queries are read-only
- Metrics collection is passive
- No data modification required

---

## Production Environment Details

```
Database:         PostgreSQL (Neon Cloud pooler)
Cache:            Redis (Upstash, rediss:// with TLS)
Queues:           Bull backed by Redis
Search:           PostgreSQL full-text search (built-in)
Email:            Mailjet (not configured)
SMS:              Twilio (not configured)
Push:             Firebase FCM (not configured) + Expo (fallback)
Error Tracking:   Sentry (not configured)
Monitoring:       Prometheus metrics + health checks
API Base:         https://manawa-v0-0-2.onrender.com or Render deployment URL
```

---

## Testing Implementation Roadmap

### Phase 1: Diagnostic (No Risk)

```bash
# 1. Full system health
curl https://manawa-v0-0-2.onrender.com/api/v1/health

# 2. Queue diagnostic (local)
curl http://localhost:4000/api/bull-status

# 3. Monitoring metrics
curl https://manawa-v0-0-2.onrender.com/api/monitoring/metrics
```

**Time:** ~5 minutes  
**Risk:** ✅ None

---

### Phase 2: Connectivity Tests (Low Risk)

```bash
# 1. Search endpoint (read-only)
curl "https://manawa-v0-0-2.onrender.com/api/search?q=test&type=professionals"

# 2. Facets endpoint (read-only)
curl "https://manawa-v0-0-2.onrender.com/api/search-facets/facets"

# 3. Admin queue stats (read-only, auth required)
curl https://manawa-v0-0-2.onrender.com/api/admin/queues -H "Authorization: Bearer JWT"
```

**Time:** ~10 minutes  
**Risk:** ✅ Minimal (read-only operations)

---

### Phase 3: Configuration Tests (Optional)

Only if production credentials need to be added:

```bash
# Add to .env:
MAILJET_API_KEY=...
MAILJET_SECRET_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
FIREBASE_SERVICE_ACCOUNT=...
SENTRY_DSN=...

# Then restart server and verify via /api/v1/health
```

**Time:** Variable  
**Risk:** 🟡 Medium (external service dependencies)

---

## Error Handling & Fallbacks

| Service | Missing Config | Behavior |
|---------|----------------|----------|
| Redis | REDIS_URL (prod only) | FATAL error in production, in-memory in dev |
| Firebase | FIREBASE_SERVICE_ACCOUNT | Expo fallback enabled |
| Mailjet | MAILJET_API_KEY | Test mode, codes logged |
| Twilio | TWILIO_ACCOUNT_SID | Test mode, codes logged |
| Sentry | SENTRY_DSN | Error tracking disabled |

---

## Health Check Interpretation

```json
{
  "status": "healthy",
  "timestamp": "2026-11-18T18:00:00Z",
  "services": {
    "database": "ok",              // ✅ PostgreSQL Neon responding
    "redis": "ok",                 // ✅ Upstash Redis responding (TLS)
    "firebase": "ok",              // ✅ Initialized or gracefully skipped
    "sentry": "ok"                 // ✅ Monitoring active or skipped
  }
}
```

### Degraded Status

```json
{
  "status": "degraded",
  "redis": "in-memory-fallback",   // ⚠️ Redis connection failed, using memory
  "database": "ok"
}
```

**Action:** Check REDIS_URL configuration and Upstash service status.

---

## Monitoring Production Services

### Real-Time Metrics

```bash
# Prometheus format (every 10 seconds)
while true; do
  curl -s https://manawa-v0-0-2.onrender.com/api/monitoring/metrics | grep "http_requests_total"
  sleep 10
done
```

### Queue Health

```bash
# Monitor email queue
watch -n 5 'curl -s https://manawa-v0-0-2.onrender.com/api/admin/queues/emails \
  -H "Authorization: Bearer JWT" | jq ".emails"'
```

### Database Performance

```bash
# Get slow queries
curl -s https://manawa-v0-0-2.onrender.com/api/monitoring/admin/performance/database \
  -H "Authorization: Bearer JWT" | jq ".slow_queries"
```

---

## Troubleshooting Guide

### Issue: Redis Connection Failed

```bash
# Check REDIS_URL format
echo $REDIS_URL
# Should be: rediss://password@host:port (or redis://)

# Check connectivity
curl https://manawa-v0-0-2.onrender.com/api/v1/health | jq '.services.redis'

# Check firewall/network
telnet deciding-cow-120586.upstash.io 6379
```

### Issue: Email/SMS Not Sent

```bash
# 1. Check if configured
curl https://manawa-v0-0-2.onrender.com/api/v1/health | jq '.services'

# 2. If not configured, check backend logs for dev-mode codes
# (Codes are logged instead of sent)

# 3. For production: Add credentials to .env and restart
```

### Issue: Queue Jobs Failing

```bash
# 1. Check queue status
curl https://manawa-v0-0-2.onrender.com/api/admin/queues/emails \
  -H "Authorization: Bearer JWT"

# 2. Get failed job details
curl "https://manawa-v0-0-2.onrender.com/api/admin/queues/emails/jobs?status=failed" \
  -H "Authorization: Bearer JWT"

# 3. Retry failed jobs
curl -X POST https://manawa-v0-0-2.onrender.com/api/admin/queues/emails/retry \
  -H "Authorization: Bearer JWT" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10}'
```

---

## Conclusion

✅ **All services can be tested safely in production using health checks and read-only diagnostic endpoints.**

No data modification required.  
No risk of data loss or corruption.  
Safe for continuous monitoring and periodic verification.

