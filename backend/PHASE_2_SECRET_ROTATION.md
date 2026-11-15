# PHASE 2 — SECRET ROTATION

## Overview

Secret Rotation is a system for managing secrets (API keys, tokens, passwords) with automated rotation, audit logging, and admin controls.

## Architecture

- **Scheduler**: node-cron job runs daily at 2:00 AM UTC
- **Module**: SecretRotationModule handles rotation logic
- **Database**: Tracks schedules and rotation history
- **Routes**: Admin endpoints for manual control

## Components

### 1. Database (Prisma Models)

**SecretRotationSchedule**
- `secretName` (unique) — Secret identifier
- `secretType` — api_key | token | password
- `rotationInterval` — Days between rotations (30, 90, 365)
- `lastRotated` — Last rotation timestamp
- `nextRotation` — When to rotate next
- `enabled` — Pause/resume rotations
- `rotationMethod` — auto | manual | manual_with_approval

**SecretRotationLog**
- `secretName` — Which secret was rotated
- `rotationType` — automatic | manual | emergency
- `oldHash` — SHA256 of old secret (never store actual secret)
- `newHash` — SHA256 of new secret
- `rotatedBy` — User ID or "system"
- `status` — pending | success | failed | pending_approval
- `errorMessage` — Error details if failed

### 2. Configuration (config/ROTATION_SCHEDULE.js)

- 10+ secrets defined with intervals
- Constants: ROTATION_STATUS, ROTATION_TYPE, ROTATION_METHOD
- Cron schedule: 0 2 * * * (2:00 AM UTC daily)

### 3. Core Module (modules/SecretRotationModule.js)

**Methods:**
- `generateNewSecret(type)` — Cryptographically secure random
- `hashSecret(secret)` — SHA256 one-way hash
- `scheduleRotation(data)` — Create rotation schedule
- `getRotationsDue()` — Secrets due for rotation
- `rotateSecret(secretName, rotatedBy)` — Execute rotation
- `logRotation(data)` — Record in database
- `verifyRotation(...)` — Compare hashes
- `getRotationHistory(secretName)` — Audit trail
- `handleApproval(logId, approved, approvedBy)` — Approve/reject

### 4. Job (jobs/secret-rotation-daily.js)

- Runs daily at 2:00 AM UTC
- Auto-rotates secrets with method=auto
- Marks manual rotations as pending
- Alerts admin for manual approvals
- Logs to Sentry with breadcrumbs

### 5. Scheduler (config/scheduler.js)

- Uses node-cron library
- `initializeScheduler()` — Start jobs
- `stopScheduler()` — Stop jobs
- `getScheduledJobs()` — List active jobs

### 6. Admin Routes (routes/admin-secret-rotation.js)

- `GET /admin/secret-rotation/schedules` — List all
- `GET /admin/secret-rotation/due` — Due for rotation
- `GET /admin/secret-rotation/history/:secretName` — Audit trail
- `POST /admin/secret-rotation/rotate/:secretName` — Manual trigger
- `POST /admin/secret-rotation/approve/:logId` — Approve pending
- `POST /admin/secret-rotation/reject/:logId` — Reject pending
- `GET /admin/secret-rotation/config` — View configuration

## Testing

**26 Tests (100% PASSING)**
- SecretRotationModule: 16 tests
- secretRotationDailyJob: 6 tests
- Scheduler: 4 tests

Test coverage:
- Secret generation (cryptographic)
- Hash verification
- Schedule creation
- Rotation execution (auto + manual)
- Job execution with multiple secrets
- Approval workflows
- Disabled secrets (skip)
- Error handling

## Security

1. **No Secret Storage** — Only SHA256 hashes
2. **Audit Trail** — All rotations logged with user/timestamp
3. **Immutability** — Config frozen with Object.freeze
4. **Hash Verification** — Validate rotation integrity
5. **PII Protection** — Breadcrumbs mask sensitive data

## Deployment

Add to server startup:
```javascript
const { initializeScheduler } = require('./config/scheduler');
initializeScheduler();
```

Register routes:
```javascript
app.use('/admin/secret-rotation', require('./routes/admin-secret-rotation'));
```

## Files Created

- `prisma/schema.prisma` — 2 new models
- `prisma/migrations/1794762076_add_secret_rotation/migration.sql` — DB schema
- `config/ROTATION_SCHEDULE.js` — Configuration
- `config/scheduler.js` — Cron integration
- `modules/SecretRotationModule.js` — Core logic (170 lines)
- `jobs/secret-rotation-daily.js` — Daily job (110 lines)
- `routes/admin-secret-rotation.js` — Admin endpoints (100 lines)
- `tests/modules/SecretRotationModule.test.js` — 16 tests
- `tests/jobs/secret-rotation-daily.test.js` — 6 tests
- `tests/config/scheduler.test.js` — 4 tests

## Monitoring

- Check `/admin/secret-rotation/history/:secretName` for audit trail
- Monitor Sentry for rotation breadcrumbs
- Check `/admin/secret-rotation/due` for pending rotations
- Alert on `status=FAILED` rotations

## Total Effort

- **ÉTAPES**: 8-18 (11 étapes)
- **TESTS**: 26/26 PASSING (100%)
- **FILES**: 10 created/modified
- **LINES OF CODE**: ~380 production + ~300 tests
