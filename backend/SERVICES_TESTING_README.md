# MANAWA Backend - External Services Testing Documentation

## Overview

This directory contains comprehensive documentation and tools for testing all external services used by the MANAWA backend in production.

**Key Finding:** All services can be tested **safely without modifying production data**.

---

## Files in This Directory

### 1. `SERVICES_TEST_SUMMARY.json` (START HERE)

**Compact JSON summary** with all essential information about each service:
- Configuration files and environment variables
- Public functions and API routes
- Test approaches and safety levels
- Production status

**Usage:** Read this first for a quick overview. Machine-readable format for integration with other tools.

```bash
cat SERVICES_TEST_SUMMARY.json | jq '.summary'
```

---

### 2. `EXTERNAL_SERVICES_INVENTORY.json` (COMPREHENSIVE)

**Complete inventory** with detailed information:
- Queue configurations and retry policies
- Circuit breaker and rate limiter settings
- Health check response formats
- Error handling and fallback mechanisms

**Usage:** Deep reference for understanding service internals and architecture.

```bash
cat EXTERNAL_SERVICES_INVENTORY.json | jq '.services.redis'
```

---

### 3. `BACKEND_SERVICES_TEST_GUIDE.md` (IMPLEMENTATION GUIDE)

**Complete testing guide** with:
- Quick test commands (copy-paste ready)
- Step-by-step testing procedures
- Health check interpretation guide
- Troubleshooting section
- Production environment details

**Usage:** Follow this guide to actually test services in production.

```bash
# Test all services at once
curl https://manawa-v0-0-2.onrender.com/api/v1/health

# Monitor queue status
curl https://manawa-v0-0-2.onrender.com/api/admin/queues \
  -H "Authorization: Bearer YOUR_JWT"
```

---

### 4. `test-external-services.js` (AUTOMATED TEST SCRIPT)

**Executable Node.js script** that runs all tests automatically:
- Tests all services in sequence
- Provides colored terminal output
- Reports pass/skip/fail counts
- Non-destructive diagnostic checks only

**Usage:**

```bash
# Run all tests
node test-external-services.js

# Verbose output with debug info
node test-external-services.js --verbose
```

**Output Example:**
```
✓ Database: PostgreSQL connected (Neon)
✓ Redis: redis active (Redis cache active)
✓ Bull Queues: Connected (0 active, 5 waiting, 2 failed)
⚠ Firebase: Not configured (FIREBASE_SERVICE_ACCOUNT missing)
⚠ Mailjet: Not configured (API key missing) - using dev mode
⚠ Twilio: Not configured (credentials missing) - using test mode
⚠ Sentry: Not configured (DSN missing)

✓ Passed: 3
⚠ Skipped: 4
✗ Failed: 0

Overall: 100% healthy
```

---

## Quick Start

### Test Everything (5 minutes)

```bash
# 1. Run automated test script
node test-external-services.js

# 2. Check full health endpoint
curl https://manawa-v0-0-2.onrender.com/api/v1/health | jq

# 3. Check queue status (if admin)
curl https://manawa-v0-0-2.onrender.com/api/admin/queues \
  -H "Authorization: Bearer YOUR_ADMIN_JWT"
```

### Test Specific Service

```bash
# PostgreSQL Search
curl "https://manawa-v0-0-2.onrender.com/api/v1/search/global?q=test&limit=5"

# Redis (via health check)
curl https://manawa-v0-0-2.onrender.com/api/v1/health | jq '.services.redis'

# Bull Queues
curl https://manawa-v0-0-2.onrender.com/api/bull-status  # Local only

# Monitoring/Metrics
curl https://manawa-v0-0-2.onrender.com/api/monitoring/metrics
```

---

## Services Summary

| Service | Type | Status | Safe to Test | Risk |
|---------|------|--------|--------------|------|
| **PostgreSQL (Neon)** | Database | Active | ✅ Yes | ✅ None |
| **Redis (Upstash)** | Cache | Active | ✅ Yes | ✅ None |
| **Bull Queues** | Job Queue | Active | ✅ Yes | ✅ None |
| **Mailjet** | Email | Not Configured | ✅ Yes | ✅ None |
| **Twilio** | SMS | Not Configured | ✅ Yes | ✅ None |
| **Firebase FCM** | Push Notifications | Not Configured | ✅ Yes | ✅ None |
| **Sentry** | Error Tracking | Not Configured | ✅ Yes | ✅ None |

> **Note :** MeiliSearch a été retiré du projet en v0.0.2 (commit `3b386a9`). La recherche
> full-text est assurée par PostgreSQL. `config/meilisearch.js` n'existe plus.

---

## Testing Strategy

### Phase 1: Diagnostic (No Risk) - ~5 minutes

```bash
# All services at once
curl https://manawa-v0-0-2.onrender.com/api/v1/health

# Queue diagnostic
curl http://localhost:4000/api/bull-status

# Prometheus metrics
curl https://manawa-v0-0-2.onrender.com/api/monitoring/metrics
```

**What's tested:** Service connectivity only, no data modification.

---

### Phase 2: Connectivity (Low Risk) - ~10 minutes

```bash
# Search (read-only)
curl "https://manawa-v0-0-2.onrender.com/api/search?q=test&type=professionals"

# Facets (read-only)
curl "https://manawa-v0-0-2.onrender.com/api/search-facets/facets"

# Admin queue stats (read-only, auth required)
curl https://manawa-v0-0-2.onrender.com/api/admin/queues -H "Authorization: Bearer JWT"
```

**What's tested:** Service connectivity with actual queries, but no data modification.

---

### Phase 3: Configuration Tests (Optional)

Only if you need to add production credentials:

1. Add to `.env`:
   ```bash
   MAILJET_API_KEY=key
   MAILJET_SECRET_KEY=secret
   TWILIO_ACCOUNT_SID=sid
   TWILIO_AUTH_TOKEN=token
   TWILIO_PHONE_NUMBER=+1234567890
   FIREBASE_SERVICE_ACCOUNT={"type":"..."}
   SENTRY_DSN=https://...
   ```

2. Restart server
3. Verify: `curl https://manawa-v0-0-2.onrender.com/api/v1/health`

---

## Health Check Interpretation

### Healthy Status

```json
{
  "status": "healthy",
  "services": {
    "database": "ok",
    "redis": "ok",
    "firebase": "ok",
    "sentry": "ok"
  }
}
```

✅ All critical services working. Optional services can be skipped.

---

### Degraded Status

```json
{
  "status": "degraded",
  "services": {
    "database": "ok",
    "redis": "in-memory-fallback",
    "reason": "Redis connection failed, using in-memory cache"
  }
}
```

⚠️ Critical service degraded. Check REDIS_URL and Upstash status.

---

## Production Environment

```
Database:         PostgreSQL (Neon pooler)
URL:              ep-bold-hat-zansfpof-pooler.c-2.eu-west-2.aws.neon.tech

Cache:            Redis (Upstash, TLS)
URL:              rediss://deciding-cow-120586.upstash.io:6379

Queues:           Bull (backed by same Redis)
Types:            emails, pdfs, analytics, payments, badges

Email:            Mailjet (NOT configured)
SMS:              Twilio (NOT configured)
Push:             Firebase FCM (NOT configured) + Expo fallback
Errors:           Sentry (NOT configured)
API Base:         https://manawa-v0-0-2.onrender.com or Render deployment URL
```

---

## Configuration Reference

### Environment Variables Required in Production

```bash
# CRITICAL - Must be set
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...        # For migrations
JWT_SECRET=very_long_random_string
REDIS_URL=rediss://password@host:6379

# HIGHLY RECOMMENDED
CORS_ORIGINS=https://app.manawa.ci
```

### Environment Variables Optional

```bash
# Email
MAILJET_API_KEY=key
MAILJET_SECRET_KEY=secret

# SMS
TWILIO_ACCOUNT_SID=sid
TWILIO_AUTH_TOKEN=token
TWILIO_PHONE_NUMBER=+1234567890

# Push notifications
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}

# Error tracking
SENTRY_DSN=https://key@ingest.sentry.io/id

# Video calls
DAILY_API_KEY=key

# Payments
CINETPAY_API_KEY=key
CINETPAY_SITE_ID=id
```

---

## Troubleshooting

### Redis Connection Failed

```bash
# Check configuration
echo $REDIS_URL

# Verify connectivity
curl https://manawa-v0-0-2.onrender.com/api/v1/health | jq '.services.redis'

# Check Upstash status
# Visit: https://console.upstash.com/
```

### Queue Jobs Failing

```bash
# Check queue status
curl https://manawa-v0-0-2.onrender.com/api/admin/queues/emails \
  -H "Authorization: Bearer JWT"

# Get failed job details
curl "https://manawa-v0-0-2.onrender.com/api/admin/queues/emails/jobs?status=failed" \
  -H "Authorization: Bearer JWT"

# Retry failed jobs
curl -X POST https://manawa-v0-0-2.onrender.com/api/admin/queues/emails/retry \
  -H "Authorization: Bearer JWT" \
  -d '{"limit": 10}'
```

### Email/SMS Not Sent

```bash
# Check configuration
curl https://manawa-v0-0-2.onrender.com/api/v1/health | jq '.services | {mailjet, twilio}'

# If not configured, codes are logged to backend
# Check backend logs for verification code

# For production: Add credentials and restart
```

---

## Performance Notes

- **Database:** Pooled connection to Neon (connection pool limit: standard tier)
- **Redis:** Upstash free tier (enough for cache, sessions, queues)
- **Queues:** Max 3 retries with exponential backoff (2s, 4s, 8s)
- **Rate Limiting:** 100 req/min per IP for search, 60 req/min for metrics
- **Health Check:** 200 req/min (aggressive caching for monitoring)

---

## Monitoring Commands

### Continuous Monitoring

```bash
# Watch queue status every 5 seconds
watch -n 5 'curl -s https://manawa-v0-0-2.onrender.com/api/admin/queues \
  -H "Authorization: Bearer JWT" | jq ".emails"'

# Watch metrics every 10 seconds
while true; do
  curl -s https://manawa-v0-0-2.onrender.com/api/monitoring/metrics | grep http_requests_total
  sleep 10
done

# Watch health every 30 seconds
watch -n 30 'curl -s https://manawa-v0-0-2.onrender.com/api/v1/health | jq'
```

---

## Additional Resources

- Health check endpoint: `/api/v1/health`
- Queue admin dashboard: `/api/admin/queues` (auth required)
- Monitoring dashboard: `/api/monitoring/admin/monitoring` (auth required)
- Prometheus metrics: `/api/monitoring/metrics`
- Bull status (local): `/api/bull-status`

---

## Summary

✅ **All services tested safely without data modification**  
✅ **Automated test script available**  
✅ **Non-destructive health checks implemented**  
✅ **Graceful fallback modes for all optional services**  
✅ **Production safe - ready for continuous monitoring**

---

*Generated: 2026-11-18*  
*MANAWA Backend External Services Testing Suite*
