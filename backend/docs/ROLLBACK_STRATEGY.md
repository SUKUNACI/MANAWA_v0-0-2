# Q77 + Q78: Configuration Versioning & Rollback Strategy

**Status**: ✅ Production Ready  
**Last Updated**: 2026-11-12  
**Document Length**: 580+ lines

## Table of Contents

1. [Overview](#overview)
2. [Q77: Configuration Versioning](#q77-configuration-versioning)
3. [Q78: Rollback Strategy](#q78-rollback-strategy)
4. [Architecture](#architecture)
5. [Monitoring & Alerts](#monitoring--alerts)
6. [API Reference](#api-reference)
7. [Operational Procedures](#operational-procedures)
8. [Troubleshooting](#troubleshooting)
9. [Deployment](#deployment)

---

## Overview

MANAWA implements a comprehensive configuration versioning and rollback system with automatic disaster recovery capabilities. This strategy ensures zero-downtime configuration changes and rapid recovery from critical failures.

### Key Features

- **Configuration Versioning**: Snapshot-based versioning with git integration
- **Instant Rollback**: Switch configurations in seconds
- **Automatic Failover**: Auto-rollback on error spikes (>1% for 5min)
- **Database Rollback**: Restore from point-in-time backups
- **Blue-Green Deployment**: DNS-based instant environment switching
- **Hourly Integrity Checks**: Automated backup verification
- **Comprehensive Logging**: Full audit trail of all changes

### Deployment Model

```
┌─────────────────────────────────────────────────────────┐
│           MANAWA Rollback Architecture                  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────┐    ┌──────────────────┐           │
│  │  Config Version  │    │  System Health   │           │
│  │    Snapshots     │    │     Monitor      │           │
│  │   (Database)     │    │   (10s checks)   │           │
│  └────────┬─────────┘    └────────┬─────────┘           │
│           │                       │                     │
│           └───────┬───────────────┘                     │
│                   │                                     │
│            ┌──────▼──────┐                              │
│            │  Rollback   │                              │
│            │   Manager   │                              │
│            └──────┬──────┘                              │
│                   │                                     │
│        ┌──────────┼──────────┐                          │
│        │          │          │                          │
│  ┌─────▼──┐  ┌───▼──┐  ┌───▼──┐                        │
│  │ Config │  │ Code │  │ Blue │                        │
│  │Rollback│  │Rollback│ Green │                        │
│  └────────┘  └───────┘ └──────┘                        │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## Q77: Configuration Versioning

### Overview

Q77 provides semantic versioning for application configuration with full snapshot isolation and rollback capabilities.

### Database Schema

```prisma
model ConfigVersion {
  id        String   @id @default(uuid())
  version   String   @unique        // "1.0.0", "1.0.1"
  snapshot  Json                    // Full config snapshot
  createdAt DateTime @default(now())
  createdBy String?                 // Admin user ID
  tag       String?                 // Git tag (config-1.0.0)
  changelog String?                 // Human-readable changes
  isStable  Boolean  @default(false)

  @@index([version])
  @@index([createdAt])
  @@index([isStable])
}
```

### Creating a Configuration Version

#### Manual Creation

```bash
# Save current configuration as v1.0.0
curl -X POST http://localhost:4000/api/v1/admin/config/versions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0.0",
    "changelog": "Initial production configuration with payment gateway integration"
  }'
```

#### Automatic via Node.js

```javascript
const rollbackManager = require('./utils/rollback-manager');

// Save current config as new version
const version = await rollbackManager.saveConfigVersion(
  '1.0.0',
  adminUserId,
  'Initial production config'
);

// Mark as stable for production use
await rollbackManager.markVersionAsStable('1.0.0');
```

### Version History

Retrieve all versions with pagination:

```bash
# Get last 20 versions
curl "http://localhost:4000/api/v1/admin/config/versions?limit=20&offset=0" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Response:

```json
{
  "data": [
    {
      "id": "uuid-123",
      "version": "1.0.1",
      "createdAt": "2026-11-12T10:30:00Z",
      "createdBy": "admin-id",
      "changelog": "Fixed payment timeout from 30s to 60s",
      "isStable": true
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 5 }
}
```

### Semantic Versioning

MANAWA uses semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (new database schema, API changes)
- **MINOR**: New features (new payment gateway, new endpoint)
- **PATCH**: Bug fixes, configuration tweaks

Example progression:

```
1.0.0  → Initial production release
1.0.1  → Bug fix (timeout adjustment)
1.1.0  → New feature (2FA integration)
2.0.0  → Breaking change (API v2)
```

---

## Q78: Rollback Strategy

### Automatic Rollback Triggers

The system automatically rollbacks when:

1. **Error Rate Spike**: >1% for 5+ minutes
2. **Memory Leak**: >85% for 10+ minutes  
3. **Latency Spike**: >3000ms P95 for 5+ minutes (configurable)

### Configuration

Edit `/config/monitoring-thresholds.js`:

```javascript
module.exports = {
  errorRate: {
    CRITICAL_THRESHOLD: 1.0,          // 1% error rate
    MONITOR_WINDOW_MINUTES: 5,         // 5-minute window
    MIN_REQUESTS_SAMPLE: 100,          // Minimum 100 requests
  },

  latency: {
    CRITICAL_THRESHOLD_MS: 3000,       // 3 seconds P95
    CRITICAL_WINDOW_MINUTES: 5,        // 5-minute window
    MIN_SAMPLES: 100,
  },

  memory: {
    CRITICAL_THRESHOLD_PERCENT: 85,    // 85% memory usage
    CRITICAL_WINDOW_MINUTES: 10,       // 10-minute window
  },

  rollback: {
    HEALTH_CHECK_INTERVAL_SECONDS: 10, // Check every 10 seconds
    CONFIRMATION_WINDOW_SECONDS: 30,   // Confirm for 30s
    MIN_INTERVAL_BETWEEN_ROLLBACKS_MINUTES: 30,
    AUTO_ROLLBACK_ON_ERROR_SPIKE: true,
    AUTO_ROLLBACK_ON_LATENCY_SPIKE: false,
    AUTO_ROLLBACK_ON_MEMORY_LEAK: true,
  },
};
```

### Rollback Levels

#### Level 1: Configuration Rollback (Fastest)

**Time**: <1 second  
**Risk**: Low  
**Use Case**: Configuration bugs

```bash
# Restore to previous configuration version
curl -X POST http://localhost:4000/api/v1/admin/config/versions/1.0.0/restore \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Timeout values causing payment failures"
  }'
```

#### Level 2: Code Rollback

**Time**: 5-10 minutes  
**Risk**: Medium  
**Use Case**: Buggy code deployment

```bash
# Via rollback manager
const rollbackManager = require('./utils/rollback-manager');

await rollbackManager.rollbackCode(
  'abc123def456',  // Commit hash
  adminUserId,
  'Revert payment bug'
);
```

#### Level 3: Database Rollback

**Time**: 30-60 minutes  
**Risk**: Medium-High  
**Use Case**: Data corruption, malicious queries

```bash
# Restore from hourly backup
const rollbackManager = require('./utils/rollback-manager');

await rollbackManager.rollbackDatabase(
  'backup_2026-11-12_10:00:00',  // Backup ID
  adminUserId
);
```

#### Level 4: Blue-Green Fallback (Nuclear Option)

**Time**: 1-5 seconds  
**Risk**: Highest (entire environment switch)  
**Use Case**: Complete production failure

```bash
// DNS switches to "green" environment (pre-deployed standby)
const rollbackManager = require('./utils/rollback-manager');

await rollbackManager.blueGreenFallback('green');
```

---

## Architecture

### Health Monitoring System

```
┌──────────────────────────────────────────┐
│   System Health Metrics (every 10s)      │
├──────────────────────────────────────────┤
│ • Error Rate (%)                         │
│ • Latency P95 / P99 (ms)                 │
│ • Memory Usage (%)                       │
│ • CPU Usage (%)                          │
│ • Database Connections                   │
│ • Cache Hit Rate (%)                     │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│   Threshold Evaluation                   │
│   (Every 10 seconds)                     │
├──────────────────────────────────────────┤
│ IF error_rate > 1% for 5 min   ──┐      │
│ IF memory > 85% for 10 min     ──├→ CRITICAL
│ IF latency > 3000ms for 5 min ──┘      │
└────────┬─────────────────────────────────┘
         │
         ▼ (if CRITICAL)
┌──────────────────────────────────────────┐
│   Auto-Rollback Initiated                │
│   (Confirmation window: 30 seconds)      │
├──────────────────────────────────────────┤
│ 1. Fetch last stable version             │
│ 2. Restore configuration                 │
│ 3. Clear Redis cache                     │
│ 4. Send alerts (Sentry/Slack/Email)     │
│ 5. Log to database                       │
└──────────────────────────────────────────┘
```

### Database Schema - Tracking

```prisma
// Rollback events
model RollbackEvent {
  id              String    @id
  fromVersion     String    // Previous version
  toVersion       String    // Target version
  trigger         String    // "manual" | "auto_error_spike" | ...
  status          String    // "INITIATED" | "IN_PROGRESS" | "COMPLETED"
  completedAt     DateTime?
  triggeredBy     String?   // Admin ID or "system"
  databaseRollback Boolean
  backupUsed      String?   // Backup ID if applicable
  createdAt       DateTime
}

// Health metrics history
model SystemHealthMetric {
  id           String   @id
  timestamp    DateTime
  errorRate    Float    // 0-100%
  latencyP95   Int      // milliseconds
  memoryUsage  Float    // 0-100%
  cpuUsage     Float    // 0-100%
  activeUsers  Int
  dbConnections Int
  cacheHitRate Float    // 0-100%
}

// Backup integrity checks
model BackupIntegrityCheck {
  id              String   @id
  backupId        String
  checkType       String   // "FULL_BACKUP" | "DATABASE" | ...
  status          String   // "SUCCESS" | "FAILED"
  checksPerformed Int
  checksSuccessful Int
  duration        Int      // milliseconds
  createdAt       DateTime
}
```

---

## Monitoring & Alerts

### Health Check Endpoint

```bash
curl http://localhost:4000/api/v1/monitoring/health
```

Response:

```json
{
  "status": "healthy",
  "data": {
    "errorRate": 0.02,
    "latencyP95": 250,
    "latencyP99": 450,
    "memoryUsage": 45.2,
    "cpuUsage": 32.1,
    "activeUsers": 1234,
    "dbConnections": 8,
    "cacheHitRate": 92.5,
    "uptime": 864000
  },
  "timestamp": "2026-11-12T14:30:45Z"
}
```

### Alert Levels

| Level | Trigger | Action |
|-------|---------|--------|
| OK | All metrics normal | None |
| ALERT | One threshold at 50% | Log & notify team |
| CRITICAL | Threshold exceeded for window | Auto-rollback (if enabled) |

### Notification Channels

Configure in `.env`:

```bash
# Sentry
SENTRY_DSN=https://key@sentry.io/project

# Slack
SLACK_ROLLBACK_WEBHOOK=https://hooks.slack.com/services/...

# Email
ROLLBACK_ALERT_EMAILS=oncall@company.com,devops@company.com
```

### Alert Example: Slack

```json
{
  "attachments": [
    {
      "color": "#FF0000",
      "title": "CRITICAL: Automatic Rollback Triggered",
      "fields": [
        {
          "title": "Reason",
          "value": "Error rate spike: 2.3% for 5 minutes",
          "short": true
        },
        {
          "title": "From Version",
          "value": "1.0.1",
          "short": true
        },
        {
          "title": "To Version",
          "value": "1.0.0",
          "short": true
        },
        {
          "title": "Timestamp",
          "value": "2026-11-12T14:45:30Z",
          "short": true
        }
      ]
    }
  ]
}
```

---

## API Reference

### Configuration Version Endpoints

#### 1. List All Versions
```
GET /api/v1/admin/config/versions
```

Query Parameters:
- `limit` (optional, default: 20, max: 100)
- `offset` (optional, default: 0)

Response: `200 OK`
```json
{
  "data": [...],
  "pagination": { "limit": 20, "offset": 0, "total": 5 }
}
```

#### 2. Get Version Details
```
GET /api/v1/admin/config/versions/:version
```

Response: `200 OK`
```json
{
  "data": {
    "version": "1.0.0",
    "snapshot": { "APP_NAME": "MANAWA", ... },
    "createdAt": "2026-11-12T10:00:00Z"
  }
}
```

#### 3. Create Version
```
POST /api/v1/admin/config/versions
```

Request Body:
```json
{
  "version": "1.0.1",
  "changelog": "Fixed payment timeout"
}
```

Response: `201 Created`

#### 4. Restore Version
```
POST /api/v1/admin/config/versions/:version/restore
```

Request Body:
```json
{
  "reason": "Production incident - payment failures"
}
```

Response: `200 OK`
```json
{
  "data": {
    "success": true,
    "rollbackId": "uuid-123"
  },
  "message": "Configuration restored to version 1.0.0"
}
```

#### 5. Mark as Stable
```
PATCH /api/v1/admin/config/versions/:version/mark-stable
```

Response: `200 OK`

#### 6. Rollback History
```
GET /api/v1/admin/config/rollback-history
```

Query Parameters:
- `limit` (optional, default: 50, max: 200)

Response: `200 OK`
```json
{
  "data": [
    {
      "id": "uuid-123",
      "fromVersion": "1.0.1",
      "toVersion": "1.0.0",
      "trigger": "manual",
      "status": "COMPLETED",
      "createdAt": "2026-11-12T14:45:30Z"
    }
  ]
}
```

---

## Operational Procedures

### Pre-Production Checklist

Before deploying configuration changes:

```bash
# 1. Create version snapshot
curl -X POST http://localhost:4000/api/v1/admin/config/versions \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.1.0",
    "changelog": "Enable 2FA enforcement for professional accounts"
  }'

# 2. Mark as stable
curl -X PATCH http://localhost:4000/api/v1/admin/config/versions/1.1.0/mark-stable \
  -H "Authorization: Bearer $JWT"

# 3. Wait 24 hours for monitoring

# 4. If problems arise, rollback
curl -X POST http://localhost:4000/api/v1/admin/config/versions/1.0.0/restore \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Increased support tickets for 2FA"}'
```

### Running Health Checks

#### Manual Check (Once)

```bash
./scripts/rollback-trigger.sh --once
```

#### Start Daemon (Production)

```bash
# Terminal 1: Start health monitoring
./scripts/rollback-trigger.sh --daemon

# Terminal 2: Start backup integrity checks
./scripts/backup-integrity-test.sh --daemon
```

#### Systemd Integration

Create `/etc/systemd/system/manawa-health-monitor.service`:

```ini
[Unit]
Description=MANAWA Health Monitor & Rollback System
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=/opt/manawa/backend
ExecStart=/opt/manawa/backend/scripts/rollback-trigger.sh --daemon
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable manawa-health-monitor.service
sudo systemctl start manawa-health-monitor.service

# Check status
sudo systemctl status manawa-health-monitor.service
sudo journalctl -u manawa-health-monitor.service -f
```

### Backup Integrity Checks

Run hourly:

```bash
# Via crontab
0 * * * * cd /opt/manawa/backend && ./scripts/backup-integrity-test.sh --once >> logs/backup-integrity-cron.log 2>&1
```

View results:

```bash
# Query recent checks
curl "http://localhost:4000/api/v1/admin/backup-integrity?limit=10" \
  -H "Authorization: Bearer $JWT"
```

---

## Troubleshooting

### Issue: Auto-rollback not triggering

**Diagnosis**:
```bash
# Check if daemon is running
ps aux | grep rollback-trigger.sh

# Check logs
tail -f logs/rollback-trigger-*.log

# Manually check thresholds
curl http://localhost:4000/api/v1/monitoring/health
```

**Solution**:
1. Verify `AUTO_ROLLBACK_ON_ERROR_SPIKE=true` in config
2. Check error rate > 1% for 5 minutes
3. Ensure 30+ minutes have passed since last rollback

### Issue: Rollback takes too long

**Cause**: Large configuration snapshot  
**Solution**:
- Reduce snapshot size by archiving old configs
- Implement incremental snapshots instead of full

### Issue: Database rollback fails

**Diagnosis**:
```bash
# Check backup availability
ls -lh .backups/

# Verify database connectivity
psql "$DATABASE_URL" -c "SELECT 1;"
```

**Solution**:
1. Ensure backup exists
2. Check database credentials
3. Verify disk space for restore
4. Run manual backup test: `./scripts/backup-strategy.sh test`

### Issue: False positive alerts

**Solution**: Adjust thresholds in `/config/monitoring-thresholds.js`:

```javascript
// More conservative thresholds
errorRate: {
  CRITICAL_THRESHOLD: 2.0,      // Changed from 1.0%
  MONITOR_WINDOW_MINUTES: 10,   // Changed from 5
}
```

---

## Deployment

### Step 1: Database Migration

```bash
# Add new tables
npx prisma migrate deploy

# Verify
npx prisma db seed
```

### Step 2: Install Routes

Register in `/index.js`:

```javascript
const configVersionsRoutes = require('./routes/config-versions');
app.use('/api/v1/admin/config/versions', configVersionsRoutes);
```

### Step 3: Environment Variables

Add to `.env`:

```bash
# Monitoring
ERROR_RATE_CRITICAL=1.0
LATENCY_P95_CRITICAL=3000
MEMORY_CRITICAL=85

# Rollback
ROLLBACK_ALERT_EMAILS=oncall@company.com
SLACK_ROLLBACK_WEBHOOK=https://hooks.slack.com/...
SENTRY_DSN=https://key@sentry.io/...

# Backup
BACKUP_RESTORE_SCRIPT=./scripts/backup-manager.js
AWS_S3_BACKUP_BUCKET=manawa-backups
```

### Step 4: Deploy Scripts

```bash
# Make executable
chmod +x scripts/rollback-trigger.sh
chmod +x scripts/backup-integrity-test.sh

# Deploy to production
scp scripts/rollback-trigger.sh prod:/opt/manawa/backend/scripts/
scp scripts/backup-integrity-test.sh prod:/opt/manawa/backend/scripts/
```

### Step 5: Verify

```bash
# Test configuration version creation
./scripts/test-config-versioning.js

# Test rollback trigger
./scripts/rollback-trigger.sh --once

# Test backup integrity
./scripts/backup-integrity-test.sh --once
```

---

## Disaster Recovery Plan

See `/docs/DISASTER_RECOVERY_PLAN.md` for comprehensive DR procedures.

### Quick Reference

| Scenario | Time | Action |
|----------|------|--------|
| Config bug | <1min | Config rollback (Level 1) |
| Bad deployment | 5-10min | Code rollback (Level 2) |
| Data corruption | 30-60min | DB rollback (Level 3) |
| Infrastructure failure | <5sec | Blue-green switch (Level 4) |

---

## Support

- **Documentation**: `/docs/` directory
- **Configuration**: `/config/monitoring-thresholds.js`
- **Utilities**: `/utils/rollback-manager.js`
- **API Routes**: `/routes/config-versions.js`
- **Scripts**: `/scripts/rollback-trigger.sh`, `/scripts/backup-integrity-test.sh`

## Status

✅ **Production Ready** - All features implemented and tested  
✅ **Fully Automated** - Zero-touch rollbacks for critical scenarios  
✅ **Monitored** - 24/7 health checks with instant alerts
