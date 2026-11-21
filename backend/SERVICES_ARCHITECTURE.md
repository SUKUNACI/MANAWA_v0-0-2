# MANAWA Backend - External Services Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    MANAWA BACKEND (Node.js)                     │
│                    (Render Platform)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   PostgreSQL     │ │      Redis       │ │  Bull Queues     │
│   (Neon Cloud)   │ │    (Upstash)     │ │  (5 queue types) │
│                  │ │   rediss://      │ │                  │
│  Pools:          │ │   (with TLS)     │ │  • emails        │
│  • App (active)  │ │                  │ │  • pdfs          │
│  • Migration     │ │  Backed by:      │ │  • analytics     │
│                  │ │  • Cache         │ │  • payments      │
│ Credentials:     │ │  • Sessions      │ │  • badges        │
│ • DATABASE_URL   │ │  • Rate limits   │ │  • webhooks      │
│ • DIRECT_URL     │ │  • Features      │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
        │                                           │
        │                    ┌──────────────────────┘
        │                    │
        │                    ▼
        │              ┌──────────────────┐
        │              │   Search Layer   │
        │              │                  │
        │              │ PostgreSQL       │
        │              │ Full-Text Search │
        │              └──────────────────┘
        │
        └────────────────────────────────────────────────────────┐
                                                                 │
     ┌──────────────────────────────────────────────────────────┐
     │                                                            │
     ▼                    ▼                    ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   Mailjet        │ │     Twilio       │ │   Firebase FCM   │ │     Sentry       │
│   (Email)        │ │     (SMS)        │ │  (Push Notif)    │ │ (Error Tracking) │
│                  │ │                  │ │                  │ │                  │
│  Status:         │ │  Status:         │ │  Status:         │ │  Status:         │
│  NOT Config      │ │  NOT Config      │ │  NOT Config      │ │  NOT Config      │
│                  │ │                  │ │                  │ │                  │
│  Fallback:       │ │  Fallback:       │ │  Fallback:       │ │  Fallback:       │
│  Dev mode        │ │  Test mode       │ │  Expo push       │ │  Disabled        │
│  (no emails)     │ │  (no SMS)        │ │                  │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## Database Layer

### PostgreSQL (Neon)

```
┌────────────────────────────────────────┐
│  PostgreSQL (Neon Cloud)               │
│  ep-bold-hat-zansfpof-pooler...        │
└────────────────────────────────────────┘
         │                        │
         ▼                        ▼
    ┌─────────────┐        ┌──────────────┐
    │ Pooler      │        │ Direct       │
    │ (App)       │        │ (Migrations) │
    │             │        │              │
    │ Active      │        │ Used by      │
    │ queries     │        │ Prisma       │
    │             │        │ Migrate      │
    └─────────────┘        └──────────────┘
```

**Current State:**
- ✅ Connected (Neon pooler)
- ✅ Health check: `SELECT 1`
- ✅ Supports: Users, professionals, projects, packages, reviews, etc.
- ✅ Replication: Optional (not configured)
- ✅ Backup: Optional (not configured)

**Testing:** `curl https://manawa-v0-0-2.onrender.com/api/v1/health | jq '.services.database'`

---

## Cache Layer (Redis)

```
┌────────────────────────────────────────┐
│  Redis Cache (Upstash)                 │
│  rediss://deciding-cow-120586...       │
│  (TLS Secured)                         │
└────────────────────────────────────────┘
         │                    │
         ▼                    ▼
    ┌─────────────┐      ┌──────────────┐
    │  Health:    │      │  Usage:      │
    │  PING cmd   │      │              │
    │  Response   │      │  • Sessions  │
    │  "PONG"     │      │  • Cache     │
    │             │      │  • Counters  │
    └─────────────┘      │  • Features  │
                         └──────────────┘
         │                    │
         ▼                    ▼
    ┌─────────────┐      ┌──────────────┐
    │ Connected   │      │ Fallback:    │
    │ ✅ OK       │      │ In-memory    │
    │             │      │ (Dev only)   │
    └─────────────┘      └──────────────┘
```

**Current State:**
- ✅ Connected (Upstash TLS)
- ✅ Health check: PING command
- ✅ Circuit breaker: Enabled
- ✅ Fallback: In-memory cache
- ✅ Backed by: Bull queues

**Testing:** `curl https://manawa-v0-0-2.onrender.com/api/v1/health | jq '.services.redis'`

---

## Job Queue System (Bull)

```
┌─────────────────────────────────────────┐
│         Bull Queue System               │
│      (Backed by Redis)                  │
└─────────────────────────────────────────┘
         │
    ┌────┼────┬────────┬────────┬──────────┐
    │    │    │        │        │          │
    ▼    ▼    ▼        ▼        ▼          ▼
┌─────┐┌────┐┌──────┐┌───────┐┌──────┐┌────────┐
│Email││PDF ││Analytics││Payments││Badges││Webhooks│
│     ││    ││        ││       ││      ││       │
│Queue││Queue││Queue   ││Queue  ││Queue ││Queue  │
│     ││    ││        ││       ││      ││       │
│ Max:││ Max:││ Max:   ││ Max:  ││ Max:  ││ Max:  │
│3    ││3    ││ 3      ││ 3     ││ 3     ││ 3    │
│retry││retry││ retry  ││ retry ││ retry ││ retry │
│     ││    ││        ││       ││      ││       │
│ Exp:││ Exp:││ Exp:   ││ Exp:  ││ Exp:  ││ Exp:  │
│Back ││Back ││ Back   ││ Back  ││ Back  ││ Back  │
│off  ││off  ││ off    ││ off   ││ off   ││ off   │
│     ││    ││        ││       ││      ││       │
│2s→  ││2s→  ││ 2s→    ││ 2s→   ││ 2s→   ││ 2s→  │
│4s→  ││4s→  ││ 4s→    ││ 4s→   ││ 4s→   ││ 4s→  │
│8s   ││8s   ││ 8s     ││ 8s    ││ 8s    ││ 8s   │
└─────┘└────┘└──────┘└───────┘└──────┘└────────┘
    │     │     │        │        │         │
    └─────┴─────┴────────┴────────┴─────────┴─────────┘
                         │
                         ▼
                  ┌────────────────┐
                  │  Redis Store   │
                  │  (Job state)   │
                  └────────────────┘
```

**Queue Stats Format:**
```json
{
  "name": "emails",
  "active": 0,
  "completed": 42,
  "failed": 2,
  "delayed": 0,
  "waiting": 5
}
```

**Testing:**
```bash
# All queues
curl https://manawa-v0-0-2.onrender.com/api/admin/queues -H "Authorization: Bearer JWT"

# Specific queue
curl https://manawa-v0-0-2.onrender.com/api/admin/queues/emails -H "Authorization: Bearer JWT"

# Failed jobs
curl "https://manawa-v0-0-2.onrender.com/api/admin/queues/emails/jobs?status=failed" \
  -H "Authorization: Bearer JWT"

# Local diagnostic
curl http://localhost:4000/api/bull-status
```

---

## Search Architecture

```
┌────────────────────────────────────────┐
│        Search Layer                    │
│   PostgreSQL Full-Text Search          │
└────────────────────────────────────────┘
         │
    ┌────┴──────────────┐
    │                    │
    ▼                    ▼
┌──────────────┐ ┌────────────┐
│ ILIKE /      │ │ Facets     │
│ Full-Text    │ │ (Metadata) │
│ Queries      │ │            │
│ (PostgreSQL) │ │ From DB    │
└──────────────┘ └────────────┘
         │              │
         └──────┬───────┘
                ▼
       ┌──────────────────┐
       │  5 entity types: │
       │ • professionals  │
       │ • projects       │
       │ • portfolio      │
       │ • packages       │
       │ • reviews        │
       └──────────────────┘
```

> **Note :** MeiliSearch a été retiré du projet en v0.0.2 (commit `3b386a9`). La recherche
> était précédemment en 3 niveaux (MeiliSearch → PostgreSQL fallback → facets). Depuis le
> retrait, seul PostgreSQL est utilisé. `config/meilisearch.js` n'existe plus.

**Routes:**
```
GET /api/search?q=term
GET /api/v1/search/global?q=term
GET /api/v1/search/global/professionals?q=term
GET /api/v1/search/global/packages?q=term
GET /api/v1/search/global/portfolio?q=term
GET /api/v1/search/global/projects?q=term
GET /api/v1/search/global/reviews?q=term

GET /api/search-facets/facets
GET /api/search-facets/facets/locations
GET /api/search-facets/facets/trades
GET /api/search-facets/facets/ratings
GET /api/search-facets/facets/prices
POST /api/search-facets/facets/combined
```

**Testing:** `curl "https://manawa-v0-0-2.onrender.com/api/search?q=electrician&limit=5"`

---

## Notification Services

```
┌────────────────────────────────────────┐
│    Notification System                 │
└────────────────────────────────────────┘
         │
    ┌────┴──────┬──────────────┐
    │            │              │
    ▼            ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Email   │ │   SMS    │ │  Push    │
│ (Mailjet)│ │(Twilio)  │ │(Firebase)│
└──────────┘ └──────────┘ └──────────┘
    │            │              │
    │NOT Config  │NOT Config    │NOT Config
    │Dev Mode    │Test Mode     │Fallback
    │Codes logged│Codes logged  │to Expo
    │            │              │
    ▼            ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│No emails │ │No SMS    │ │Expo push │
│sent      │ │sent      │ │(working) │
│Auth codes│ │Codes in  │ │          │
│visible   │ │logs      │ │          │
│in logs   │ │          │ │          │
└──────────┘ └──────────┘ └──────────┘
```

**Routes:**
```
POST /api/auth/verify/request          → Email/SMS verification code
POST /api/auth/password-reset/request  → Email password reset
POST /api/notifications/subscribe      → Register push token
POST /api/notifications/send           → Send push notification
```

---

## Monitoring & Health

```
┌─────────────────────────────────────────┐
│     Health Check System                 │
└─────────────────────────────────────────┘
         │
    ┌────┴──────┬────────────────┬─────────┐
    │            │                │         │
    ▼            ▼                ▼         ▼
┌────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────┐
│Database│ │Cache     │ │External Svc  │ │Features │
│ Query  │ │  PING    │ │ Status       │ │ Flags   │
│SELECT 1│ │ Upstash  │ │              │ │ Cache   │
└────────┘ └──────────┘ │ Firebase     │ └─────────┘
                         │ Sentry       │
                         └──────────────┘
         │
         ▼
    ┌─────────────────┐
    │   Response      │
    │   Status codes: │
    │ • healthy = 200 │
    │ • degraded = 200│
    │ • unhealthy=503 │
    └─────────────────┘
         │
    ┌────┴────┬─────────┬────────┐
    │          │         │        │
    ▼          ▼         ▼        ▼
┌────────┐┌────────┐┌──────┐
│Database││Redis   ││Sentry│
│ ok     ││ok|deg  ││ok    │
│   error││ error  ││error │
└────────┘└────────┘└──────┘
```

**Endpoints:**
```
GET /api/v1/health                       → Full health check
GET /api/monitoring/health               → Monitoring health
GET /api/monitoring/metrics              → Prometheus format
GET /api/monitoring/admin/monitoring    → Dashboard (admin)
GET /api/monitoring/admin/performance   → Performance (admin)
GET /api/monitoring/admin/business      → KPIs (admin)
```

---

## Error Handling & Fallbacks

```
When External Service is NOT Configured:
─────────────────────────────────────────

Mailjet (API key missing)
├─ Dev mode active
├─ Codes logged to backend
├─ No emails sent
└─ Impact: ✅ None, testing safe

Twilio (credentials missing)
├─ Test mode active
├─ Codes logged to backend
├─ No SMS sent
└─ Impact: ✅ None, testing safe

Firebase (service account missing)
├─ Push disabled
├─ Fallback: Expo push
├─ Expo still works
└─ Impact: ✅ None, app stable

Sentry (DSN missing)
├─ Error tracking disabled
├─ Errors still logged locally
├─ App continues normally
└─ Impact: ✅ None, app stable
```

---

## Configuration State

### Currently Active

```
✅ PostgreSQL (Neon)    - Database fully operational
✅ Redis (Upstash)      - Cache fully operational
✅ Bull Queues          - Job processing operational
✅ Health Checks        - All endpoints working
✅ Monitoring           - Metrics collection working
```

### Currently Inactive (Optional)

```
⏭️ Mailjet             - Not configured (dev mode, codes logged)
⏭️ Twilio              - Not configured (test mode, codes logged)
⏭️ Firebase FCM        - Not configured (Expo fallback active)
⏭️ Sentry              - Not configured (local logging only)
```

---

## Testing Flow Chart

```
START
  │
  ▼
Is production? YES ─────→ Run: curl https://manawa-v0-0-2.onrender.com/api/v1/health
                    │
                    └──→ Check JSON response
                         • status: healthy|degraded|unhealthy
                         • services: { database, redis, ... }
                    │
                    └──→ If unhealthy, troubleshoot specific service
  │
  NO (Local/Dev)
  │
  ▼
Run: node test-external-services.js
  │
  ├─→ Test Database  ✓/✗
  ├─→ Test Redis     ✓/✗
  ├─→ Test Bull Q    ✓/✗
  ├─→ Test Firebase  ✓/⏭️
  ├─→ Test Mailjet   ✓/⏭️
  ├─→ Test Twilio    ✓/⏭️
  └─→ Test Sentry    ✓/⏭️
  │
  ▼
All tests completed
  │
  ├─→ Passed > 0     → All critical services working ✅
  ├─→ Failed > 0     → Troubleshoot failed services 🔧
  └─→ All skipped    → Some optional services missing ℹ️
```

---

## Summary

| Layer | Service | Status | Health Check | Test Endpoint |
|-------|---------|--------|--------------|---------------|
| **Data** | PostgreSQL | ✅ Active | `SELECT 1` | `GET /health` |
| **Cache** | Redis | ✅ Active | `PING` | `GET /health` |
| **Queues** | Bull | ✅ Active | Redis connect | `GET /admin/queues` |
| **Search** | PostgreSQL | ✅ Active | ILIKE queries | `GET /search` |
| **Email** | Mailjet | ⏭️ Optional | Config check | Dev mode |
| **SMS** | Twilio | ⏭️ Optional | Config check | Test mode |
| **Push** | Firebase | ⏭️ Optional | Init check | Expo fallback |
| **Errors** | Sentry | ⏭️ Optional | Config check | Disabled |

**All services testable safely with zero data modification risk.**

---

*Architecture Documentation*  
*MANAWA Backend (2026-11-18)*
