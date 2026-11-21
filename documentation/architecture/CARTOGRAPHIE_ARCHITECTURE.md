# CARTOGRAPHIE COMPLÈTE DE L'ARCHITECTURE BACKEND MANAWA

**Version:** 1.0.2-v1  
**Date:** 14 novembre 2026  
**Scope:** C:\Users\HP\Desktop\MANAWA_NEW\backend

---

## 1. STRUCTURE GÉNÉRALE

**Total:** 357 fichiers source | ~40K LOC | 79+ modèles Prisma | 331+ endpoints

```
backend/
├── index.js (877 LOC) — Entry point + Bootstrap + CRON
├── package.json — 27 production deps
├── jest.config.js — 75% coverage gate
├── prisma/
│   ├── schema.prisma (1,277 LOC) — 79+ modèles
│   ├── migrations/ — Migration history
│   └── seed-notifications.js — Data seeding
│
├── config/ (41 fichiers, 6,470 LOC)
│   ├── db.js — Prisma client
│   ├── redis.js — Cache
│   ├── firebase-admin.js — Notifications
│   ├── meilisearch.js — Search
│   ├── feature-flags.js — Feature management
│   ├── monitoring-config.js — Sentry setup
│   ├── third-party-api-config.js — External APIs
│   └── [38 autres configurations]
│
├── middleware/ (11 fichiers, 1,576 LOC)
│   ├── auth.js — JWT authentication
│   ├── validateInput.js — Validation
│   ├── bruteForceMiddleware.js — Brute force protection
│   ├── cacheMiddleware.js — Response caching
│   ├── api-timeout.js — Request timeouts
│   └── [6 autres middlewares]
│
├── routes/ (63 fichiers, 18,374 LOC, 331+ endpoints)
│   ├── auth.js — Registration, login, password reset
│   ├── users.js — Profile management
│   ├── professionals.js — Professional profiles
│   ├── projects.js — Project management
│   ├── quotes.js — Quote generation
│   ├── payments.js — Payment processing
│   ├── bookings.js — Booking system
│   ├── messages.js — Messaging
│   ├── notifications.js — Notification delivery
│   ├── admin.js — Admin dashboard
│   ├── analytics.js — Analytics
│   └── [53 autres routes]
│
├── utils/ (33 fichiers, 7,085 LOC)
│   ├── geniuspay.js — Payment API
│   ├── logger.js — Logging
│   ├── circuit-breaker.js — Resilience
│   ├── rate-limiter-adaptive.js — Rate limiting
│   ├── notification-triggers.js — Event triggers
│   └── [28 autres utilitaires]
│
├── jobs/ (9 fichiers, 2,637 LOC)
│   ├── workers.js — Bull queue setup
│   ├── processPaymentJob.js — Payment jobs
│   ├── sendEmailJob.js — Email sending
│   ├── generatePdfJob.js — PDF generation
│   └── [5 autres jobs]
│
├── socket/ (8 fichiers, 1,921 LOC)
│   ├── manager.js — Socket.IO orchestration
│   └── handlers/ — Event handlers (messages, bookings, notifications, payments, presence)
│
├── tests/ (170 fichiers, ~75K LOC total)
│   ├── routes/ (58 test files) — Route testing
│   ├── config/ (18 test files) — Config testing
│   ├── utils/ (42 test files) — Utility testing
│   ├── middleware/ (5 test files) — Middleware testing
│   ├── security/ (5 test files) — Security testing
│   ├── e2e/ (9 test files) — End-to-end flows
│   └── performance/ (3 monitoring scripts)
│
├── docs/
│   ├── api-endpoints.js — OpenAPI definitions (337+ endpoints)
│   ├── schemas.js — OpenAPI schemas
│   └── swagger.js — Swagger setup
│
└── infrastructure/
    ├── backup-strategy.md
    ├── disaster-recovery.md
    ├── deployment-guides.md
    └── [deployment configs]
```

---

## 2. TECHNOLOGY STACK

**Runtime & Framework:**
- Node.js (LTS)
- Express.js v4.19.2

**Database:**
- PostgreSQL (via Supabase)
- Prisma v5.18.0 (ORM + Migrations)
- Neon (managed PostgreSQL)

**Caching:**
- Redis v6.3.1 (ioredis v6.0.0)
- In-memory fallback

**Authentication:**
- JWT (jsonwebtoken v9.0.2)
- bcryptjs v2.4.3 (passwords)
- Speakeasy v2.0.0 (2FA/TOTP)

**Real-time:**
- Socket.IO v4.7.5

**External Services:**
- GeniusPay (payments)
- Firebase Admin SDK v14.2.0 (notifications)
- Mailjet v6.0.11 (email)
- Twilio v5.2.2 (SMS)
- Cloudinary v2.10.0 (images)
- MeiliSearch v0.43.0 (search)
- Sentry v10.67.0 (monitoring)

**Background Jobs:**
- Bull v4.16.5 (Redis-backed queue)

**Utilities:**
- pdfkit v0.15.0 (PDF generation)
- axios v1.7.4 (HTTP client)
- helmet v8.3.0 (security headers)
- cors v2.8.5
- compression v1.7.4
- pino v10.3.1 (logging)

**Testing:**
- Jest v30.5.2
- Supertest v7.2.2

---

## 3. MODÈLES DE DONNÉES (79+ tables)

### Core Entity Groups

**Users & Access:**
- User (registration, roles, 2FA)
- RefreshToken (JWT refresh)
- LoginAttempt (history, brute force)
- AdminRoleType, AdminTeam, AdminLog (admin governance)
- RolePermission, RolePermissionHistory (fine-grained permissions)

**Professionals & Services:**
- Professional (profile, rating, verification)
- AvailabilitySlot (recurring + exceptions)
- PortfolioItem, PortfolioProject, PortfolioComment, PortfolioLike
- ServicePackage, PackageOrder, PackageSuspensionLog
- Badge, ProfessionalBadge (achievement system)
- Follow, ProfileView (social features)
- Review, ReviewFlag (moderation)

**Transactions & Financial:**
- Project (client projects)
- Quote, QuoteItem (quotes)
- Booking (date/time bookings)
- Payment, PaymentAuditLog (GeniusPay integration)
- Dispute (payment disputes)
- Subscription (tiers)
- Referral, PromoCode, PromoUsage (growth)

**Communication:**
- Message (real-time messaging)
- Notification, NotificationTemplate, NotificationPreference, PushToken
- BroadcastLog (bulk notifications)
- SupportTicket, SupportMessage (support)

**Infrastructure & Ops:**
- AppConfig (global config)
- Webhook, WebhookLog (webhooks)
- ConfigVersion, RollbackEvent (deployment safety)
- BackupIntegrityCheck (DR validation)
- SystemHealthMetric (monitoring)

**Features:**
- FeatureFlag (feature management)
- Experiment, ExperimentVariant, ExperimentAssignment, ExperimentMetric (A/B testing)

**Analytics:**
- UserEvent (event tracking)
- CustomMetric, RetentionSnapshot, CohortSnapshot (analytics)

**Compliance:**
- GdprDeletionRequest, DataRetentionLog (GDPR)
- AdminLog, SlaTarget, AlertEvent, OnCallSchedule (operations)

---

## 4. ROUTES & ENDPOINTS (331+ total)

### Authentication (13 endpoints)
- POST /auth/register, /auth/login, /auth/logout
- POST /auth/refresh, /auth/verify-email, /auth/request-email-verification
- POST /auth/request-password-reset, /auth/reset-password
- POST /auth/admin-session, /auth/setup-admin
- POST /auth/2fa/setup, /auth/2fa/verify
- GET /auth/login-history

### User Management (12 endpoints)
- GET /users/me, GET /users/:id
- PUT /users/:id, DELETE /users/:id
- POST /users/:id/avatar
- POST /verification/email/send, /verification/phone/send
- POST /verification/email/verify, /verification/phone/verify
- GET /users/:id/profile, POST /users/export-data, DELETE /users/delete-account

### Professional Services (25+ endpoints)
- GET /professionals (search, filtering, pagination)
- GET /professionals/:id, POST /professionals, PUT /professionals/:id
- GET /professionals/:id/portfolio, /reviews, /availability, /badges, /stats
- POST /professionals/:id/availability, /portfolio, /follow, /unfollow
- GET /professionals/:id/followers, /following

### Projects & Quotes (18 endpoints)
- POST /projects, GET /projects, GET /projects/:id
- PUT /projects/:id, DELETE /projects/:id
- POST /projects/:id/photos
- POST /quotes, GET /quotes/:id, PUT /quotes/:id
- POST /quotes/:id/pdf, /accept, /refuse

### Payments (12 endpoints)
- POST /payments/create, GET /payments/:id
- POST /payments/:id/status, /retry
- POST /payments/webhook/geniuspay
- GET /payments/retry-history/:paymentId
- POST /disputes/:id/create, /resolve, /appeal

### Bookings (10 endpoints)
- POST /bookings, GET /bookings
- GET /bookings/:id, PUT /bookings/:id, DELETE /bookings/:id
- POST /bookings/:id/confirm, /cancel

### Messaging (12 endpoints)
- POST /messages, GET /messages
- GET /messages/:id, DELETE /messages/:id
- PUT /messages/:id/read
- GET /messages/conversations

### Search (8 endpoints)
- GET /search?query=X&trades=Y&city=Z (MeiliSearch)
- GET /search/global?q=X
- GET /search/facets

### Analytics (20+ endpoints)
- GET /analytics/dashboard, /overview
- GET /analytics/custom-metrics
- GET /analytics/events, /funnels, /retention
- GET /analytics/cohorts, /distribution
- POST /admin/analytics/custom-metrics

### Admin Dashboard (60+ endpoints)
- GET /admin/dashboard, /users, /professionals, /payments, /reports
- GET /admin/users/:id/security, PUT /admin/users/:id/role
- POST /admin/users/:id/suspend, /unlock
- GET /admin/feature-flags, POST /admin/feature-flags
- GET /admin/experiments, POST /admin/experiments
- GET /admin/costs, /sla, /alerts, /oncall
- GET /admin/data-retention, /gdpr/deletion-requests
- GET /admin/config/versions, POST /admin/config/rollback
- [40+ autres endpoints admin]

### Mobile API (10+ endpoints)
- GET /mobile/sync?since=X&checksum=Y
- POST /mobile/sync/conflict-resolution
- GET /mobile/offline-cache

### Webhooks (8 endpoints)
- POST /webhooks/geniuspay (payment webhook)
- GET /admin/webhooks, POST /admin/webhooks
- POST /admin/webhooks/:id/test, /retry
- DELETE /admin/webhooks/:id

### Health & Monitoring (5 endpoints)
- GET /health, /health/detailed
- GET /monitoring/metrics
- POST /monitoring/events

---

## 5. FLOWS MÉTIER CLÉS

### Registration & Onboarding
```
Client Registration → Email Verification → Profile Setup 
  → (If Professional) Document Upload → Manual Review → Approval
```

### Booking & Payment
```
Search Professionals → View Details → Request Booking → Professional Confirms
  → Create Quote → Client Accepts Quote → Payment (Deposit + Balance)
  → Service Execution → Completion → Review
```

### Payment Processing
```
POST /payments/create → Call GeniusPay API → Return Payment URL
  → Client Pays → GeniusPay Webhook → Update Payment Status
  → Daily Reconciliation → Payout to Professional (via Stripe? TBD)
```

### Real-time Messaging
```
Client Sends Message → Socket.IO Broadcast → Professional Receives
  → Socket.IO Live Notification → Read Receipt
```

---

## 6. KEY FEATURES

✅ **Implemented & Complete:**
- Multi-channel notifications (push, email, SMS)
- Full-text search (MeiliSearch)
- 2FA (TOTP-based)
- Admin roles & permissions (RBAC)
- Feature flags & A/B testing
- Payment retry with reconciliation
- GDPR workflows (export, delete)
- Backup & disaster recovery
- Configuration versioning & rollback
- Real-time messaging & notifications
- Analytics framework
- On-call scheduling

⚠️ **Partially Implemented:**
- Mobile API (endpoints exist, completeness unclear)
- Analytics features (infrastructure present, UI missing)
- Admin features (routes exist, full automation missing)

❌ **Missing:**
- KYC/AML with liveness + OCR
- Advanced disputes workflow
- Content moderation automation
- ABAC permissions
- Internationalization (multi-currency, i18n)
- API publiques
- Integrations (CRM, Accounting, OAuth)
- ML/AI features

---

## 7. INFRASTRUCTURE & DEPLOYMENT

**Hosting:** Render.com  
**Database:** Supabase PostgreSQL  
**Cache:** Redis (Upstash or managed)  
**Search:** MeiliSearch  
**CDN:** Cloudinary  
**Monitoring:** Sentry  
**CI/CD:** GitHub Actions  

**Deployment:** Docker containerized, auto-restart on failure, health checks in place

---

## 8. TESTING COVERAGE

**Test Files:** 170  
**Total Test LOC:** ~75,000  
**Coverage:** 79.7% (lines, branches, functions)  
**Coverage Gate:** 75% (enforced)

**Test Types:**
- Unit tests: 161 files
- Integration tests: 9 files
- E2E tests: 6 scenarios
- Security tests: 5 suites
- Performance monitoring: 3 tools

---

## 9. MATURITY ASSESSMENT

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Modularity** | 4/5 | Well-organized, some coupling |
| **Scalability** | 2.5/5 | Monolith limit ~50k DAU |
| **Reliability** | 3/5 | Good backup strategy, untested |
| **Security** | 2.5/5 | 7 CRITICAL findings |
| **Performance** | 2.5/5 | Scaling wall at 10k DAU |
| **Testability** | 4/5 | Strong 79.7% coverage |
| **Operations** | 2/5 | No centralized logs, manual IR |
| **Code Quality** | 3.5/5 | Good patterns, tech debt |

**Overall: 3.1/5 (Production-Grade with Caveats)**

---

## 10. ARCHITECTURAL CONSTRAINTS

**Monolith Limits:**
- Scales to ~50k DAU before rethinking needed
- Single process, no independent service scaling
- All features coupled to same deployment cycle

**Database Limits:**
- Supabase serverless OK to 10-20k DAU
- Need RDS managed for larger workloads
- Connection pool: 30 connections (too low at scale)

**Cache Strategy:**
- Redis centralized — single point of failure
- In-memory fallback present but limited

**External Dependencies:**
- GeniusPay: Single payment processor
- Firebase: Notification delivery
- Mailjet: Email delivery
- MeiliSearch: Search engine

---

## CONCLUSION

MANAWA backend demonstrates **solid modular architecture** with good separation of concerns, comprehensive feature coverage, and strong test foundation. However, **scaling limitations and security findings** require attention before significant user growth.

**Recommended Evolution:** Stay monolith until 50k DAU, extract services incrementally, invest in security hardening and operational excellence.
