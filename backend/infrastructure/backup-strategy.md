# MANAWA Backup Strategy

**Version:** 1.0  
**Last Updated:** 2026-11-11  
**Status:** Production Ready

## 1. Overview

The MANAWA backup strategy ensures data protection, compliance, and rapid recovery from system failures. This strategy covers three critical data layers:
- **Database Layer:** PostgreSQL with Prisma ORM
- **File Layer:** User uploads (hosted on Cloudinary)
- **Configuration Layer:** Environment variables and secrets

## 2. Backup Architecture

### 2.1 Data Classification

| Data Type | Location | Business Criticality | Retention |
|-----------|----------|----------------------|-----------|
| User data, Projects, Quotes | PostgreSQL | CRITICAL | 90 days archive + 30 days online |
| User uploads, Media, PDFs | Cloudinary | HIGH | 30 days online |
| Configuration, Secrets | Vault (AWS Secrets Manager) | CRITICAL | 90 days archive |
| Audit logs | PostgreSQL + Immutable storage | CRITICAL | 90 days minimum |
| Application state | Redis | MEDIUM | Real-time replication |

### 2.2 Backup Types

#### Full Backups (Complete Snapshot)
- **Frequency:** Daily at 02:00 UTC
- **Duration:** 15-30 minutes (PostgreSQL, ~5GB typical)
- **Scope:** Entire database + all application configuration
- **Storage:** Primary S3 bucket + Secondary GCS bucket
- **Retention:** 30 days online, 90 days archive (cold storage)
- **Compression:** GZIP (50-65% reduction typical)
- **Verification:** SHA256 checksum validation

#### Incremental Backups (Delta Changes)
- **Frequency:** Every hour (on the hour, UTC)
- **Duration:** 5-10 minutes
- **Scope:** Only changes since last full backup
- **Storage:** Primary S3 bucket
- **Retention:** 30 days
- **Benefits:** Faster backups, reduced storage, faster RTO for recent data
- **Chain:** Always linked to parent full backup

#### Differential Backups (Optional for Archives)
- **Frequency:** Weekly on Mondays at 03:00 UTC
- **Scope:** Changes since last full backup (more granular than incremental)
- **Retention:** 90 days in cold storage (Glacier)
- **Use Case:** Long-term compliance and audit trails

### 2.3 Backup Schedule

```
Monday-Sunday:
  02:00 UTC  → FULL backup (PostgreSQL)
  03:00-23:00 UTC → HOURLY incremental backups
  03:00 UTC (Mondays) → Differential for archives

Retention Timeline:
  ├─ Online: 30 days (S3 Standard)
  ├─ Archive: 90 days (Glacier/GCS Archive)
  └─ Compliance: 90 days minimum (immutable logs)
```

### 2.4 Backup Storage Infrastructure

#### Primary: AWS S3
- **Region:** `eu-west-1` (Ireland) - GDPR compliant
- **Bucket Structure:**
  ```
  manawa-prod-backups/
  ├─ database/
  │  ├─ full/2026-11-11-020000.sql.gz
  │  ├─ incremental/2026-11-11-030000.sql.gz
  │  └─ manifest.json
  ├─ config/
  │  ├─ env-backup-2026-11-11.enc
  │  └─ secrets-backup-2026-11-11.enc
  └─ logs/
     ├─ backup-2026-11-11-020000.log
     └─ verification-2026-11-11-020000.log
  ```
- **Versioning:** Enabled for rollback protection
- **Lifecycle Policy:**
  - Days 0-30: S3 Standard (immediate access)
  - Days 31-90: Glacier (archive rate, slow access)
  - Days 91+: Delete (compliance retention met)

#### Secondary: Google Cloud Storage (GCS)
- **Region:** `europe-west1` (Belgium) - Geo-redundancy
- **Replication:** Asynchronous from S3 (6-hour window)
- **Use Case:** Disaster recovery (complete DC failure)
- **Access:** Lower cost, slower retrieval for long-term archives
- **Cross-region:** Mitigates regional cloud provider outages

#### Encryption Standards
- **In Transit:** TLS 1.3 (AWS VPC endpoints)
- **At Rest:** AES-256 (AWS KMS managed keys)
- **Keys:** Separate KMS key per environment (prod, staging, dev)
- **Rotation:** Annual automatic key rotation enabled

## 3. Backup Management

### 3.1 Database Backup Procedures

#### PostgreSQL Backups
```bash
# Full backup using pg_dump
pg_dump --format=custom --compress=9 \
  --file=backup-$(date +%Y%m%d-%H%M%S).sql.gz \
  $DATABASE_URL

# Size: ~5GB uncompressed → ~1.5-2GB compressed
# Time: 15-30 minutes (full), 5-10 minutes (incremental)

# Incremental via WAL archiving
pg_basebackup --checkpoint=fast --format=tar --label=backup
```

#### Verification
- **Checksum:** Generate SHA256 before upload
- **Size Check:** Verify backup size is within expected range (±10%)
- **Restore Test:** Weekly restore test to staging environment
- **Data Integrity:** Count records, check constraints

### 3.2 File Backup Procedures

#### Cloudinary Backups
Since user uploads are stored on Cloudinary:
1. **Metadata backup:** List all resources monthly
2. **Download archive:** Quarterly download of all files to S3
3. **Verification:** Ensure all URLs are accessible
4. **Redundancy:** Cloudinary's native backup (included in enterprise plan)

#### Backup Script Location
- `/scripts/backup-manager.js` - Orchestration
- `/scripts/dr-test.js` - Automated testing

### 3.3 Configuration Backup Procedures

#### Environment Variables
- **Encrypted Backup:** Store in AWS Secrets Manager
- **Exclude:** Actual values stored separately, references only backed up
- **Versioning:** Enabled for 90 days
- **Access Control:** Restricted to ADMIN users only

#### Example Backup Content
```json
{
  "timestamp": "2026-11-11T02:00:00Z",
  "environment": "production",
  "config": {
    "DATABASE_URL": "***ENCRYPTED***",
    "JWT_SECRET": "***ENCRYPTED***",
    "NODE_ENV": "production",
    "BACKUP_S3_BUCKET": "manawa-prod-backups",
    "BACKUP_GCS_BUCKET": "manawa-prod-backups-gcs"
  }
}
```

## 4. Backup Verification & Testing

### 4.1 Automated Verification (Post-Backup)

Every backup undergoes automatic verification:

1. **Checksum Validation** (immediate)
   - Compare SHA256 before/after upload
   - Verify against manifest file
   - Alert on mismatch

2. **Size Validation** (immediate)
   - Expected range: 1.5-2.5 GB compressed
   - Alert if outside 10% deviation
   - Historical trending for anomalies

3. **Database Restore Test** (weekly)
   - Restore to staging environment
   - Execute schema validation queries
   - Verify record counts match production
   - Run application health checks

4. **Integrity Checks** (daily)
   - Foreign key constraint validation
   - No orphaned records
   - Index consistency
   - Column data type validation

### 4.2 Restore Testing Schedule

| Frequency | Type | Scope | Duration | Automated |
|-----------|------|-------|----------|-----------|
| Daily | Metadata | Verify backup exists, size OK | 5 min | Yes |
| Weekly | Full Restore | Restore to staging, run tests | 45 min | Yes |
| Monthly | Point-in-Time | Restore to arbitrary date, verify data | 60 min | Yes |
| Quarterly | DR Drill | Full system recovery simulation | 2-4 hours | Yes |

### 4.3 Verification Metrics

All verification results logged to:
- `/logs/backups/verification-{date}.log`
- CloudWatch metrics
- Sentry error tracking (on failure)

Example success log:
```
[2026-11-11T02:45:30Z] BACKUP VERIFICATION COMPLETE
  Backup ID: full-2026-11-11-020000
  File: database/full/2026-11-11-020000.sql.gz
  Size: 1.87 GB
  Checksum: a3c5f8e2b1d9c4... ✓
  Duration: 28 minutes
  Status: SUCCESS
  Next Test: 2026-11-18 (weekly restore test)
```

## 5. Recovery Procedures

### 5.1 Recovery Time Objectives (RTO)

| Scenario | RTO | Notes |
|----------|-----|-------|
| Database corruption (recent backup) | 1 hour | Incremental restore from hourly backup |
| Database server failure | 2 hours | New RDS instance + restore from latest backup |
| Regional cloud failure | 4 hours | Failover to secondary region (GCS) |
| Full system disaster | 4 hours | Complete infrastructure rebuild + restore |
| Data point-in-time restore | 30 min | Restore to specific timestamp within 30 days |

### 5.2 Recovery Point Objectives (RPO)

| Data Type | RPO | Explanation |
|-----------|-----|-------------|
| Database (OLTP) | 1 hour | Hourly incremental backups |
| User configuration | 24 hours | Daily snapshots sufficient |
| Audit logs | 1 hour | Real-time replication + hourly backups |
| File metadata | 24 hours | Cloudinary manages redundancy |

### 5.3 Step-by-Step Recovery Process

See `/infrastructure/disaster-recovery.md` for detailed procedures.

## 6. Backup Automation & Monitoring

### 6.1 Backup Orchestration

Automated via `/scripts/backup-manager.js`:

```javascript
// Scheduled tasks
- 02:00 UTC: triggerFullBackup()
- Hourly:    triggerIncrementalBackup()
- Mondays 03:00: triggerDifferentialBackup()
- Daily 06:00: verifyBackups()
- Weekly: runRestoreTest()
```

### 6.2 Monitoring & Alerting

**Backup Success Metrics:**
- Backup completed: ✓ Must complete within 35 minutes (full)
- Checksum valid: ✓ No corruption detected
- Storage replicated: ✓ Both S3 and GCS contain copy
- Tests passed: ✓ Weekly restore test successful

**Alerts Triggered:**
- Backup missed (> 5 min late) → Page on-call engineer
- Backup failed → Immediate Slack + PagerDuty
- Verification failed → PagerDuty critical alert
- Storage quota exceeded → Slack warning
- Restore test failed → PagerDuty + email team

**Dashboard Metrics:**
- Backup success rate (%), goal: 99.9%
- Average backup duration (minutes)
- Backup size trend (GB)
- Restore test pass rate (%), goal: 100%
- Recovery time actuals vs RTO

### 6.3 Log Locations

```
/logs/backups/
├─ backup-{date}.log           # Backup execution log
├─ verification-{date}.log     # Checksum & size validation
├─ restore-test-{date}.log     # Weekly restore test results
└─ recovery-{date}.log         # Actual recovery operations
```

## 7. Compliance & Legal Requirements

### 7.1 GDPR Compliance

- **Data Retention:** Max 90 days for backups (personal data)
- **Right to Deletion:** Backup exclusion list maintained
- **Data Export:** Can restore individual records on demand
- **Processing Agreement:** AWS DPA signed (Standard Contractual Clauses)

### 7.2 PCI-DSS Compliance

- **Payment Data:** Never stored in application database (GeniusPay handles)
- **Backup Encryption:** AES-256, encrypted at rest
- **Access Control:** Restricted to authorized ADMIN users
- **Audit Trail:** All backup operations logged and immutable

### 7.3 CCPA Compliance

- **Data Minimization:** Only backup necessary data
- **Opt-out:** Exclude opted-out users from backups
- **Transparency:** Backup policy disclosed in privacy policy
- **Consumer Rights:** Support data deletion requests

### 7.4 Audit Trail Requirements

All backup operations must be immutable logged:
- Who requested backup (user ID)
- When backup occurred (timestamp)
- What was backed up (scope)
- Where it was stored (location)
- Verification results
- Recovery requests and results

**Retention:** 90 days minimum in immutable log storage

## 8. Cost Optimization

### 8.1 Storage Cost Breakdown

```
Monthly Estimate (Production):
  S3 Standard (30 backups × 1.8 GB): $100
  S3 Glacier (60 backups × 1.8 GB): $45
  GCS Archive (60 backups × 1.8 GB): $35
  Data Transfer: $80
  ─────────────────────────────────
  Total: ~$260/month
```

### 8.2 Cost Reduction Strategies

1. **Compression:** GZIP 9 reduces size by 50-65%
2. **Retention Tiers:** Cold storage after 30 days
3. **Deduplication:** Incremental backups reduce overhead
4. **Lifecycle Policies:** Automatic archival to Glacier
5. **Regional Selection:** Use cheaper regions for long-term storage

## 9. Disaster Recovery Runbook

**For step-by-step recovery procedures, see:** `/infrastructure/disaster-recovery.md`

## 10. Operational Procedures

### 10.1 Manual Backup Trigger

```bash
curl -X POST http://localhost:3000/api/admin/recovery/backup \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "full", "description": "Pre-release backup"}'

Response: { "backupId": "manual-20261111-143022", "status": "initiated" }
```

### 10.2 Backup Status Check

```bash
curl http://localhost:3000/api/admin/recovery/status \
  -H "Authorization: Bearer $ADMIN_TOKEN"

Response includes:
  - Last successful backup time
  - Next scheduled backup time
  - Current backup status
  - Storage used (S3, GCS)
  - Restore test results
```

### 10.3 Point-in-Time Restore Request

See recovery procedures in `/infrastructure/disaster-recovery.md`

## 11. Contact & Escalation

**Backup Issues:**
- Level 1: On-call engineer (PagerDuty)
- Level 2: DevOps team lead
- Level 3: Infrastructure director

**SLA Targets:**
- Backup failure alert response: 15 minutes
- Restore test failure: 1 hour fix or incident declared
- Recovery initiation: 30 minutes from approval

## 12. References

- AWS Backup Best Practices: https://aws.amazon.com/backup/
- PostgreSQL Backup Guide: https://www.postgresql.org/docs/current/backup.html
- Cloudinary Backup: https://cloudinary.com/trust/security
- GDPR Data Retention: https://gdpr-info.eu/
- PCI-DSS Requirements: https://www.pcisecuritystandards.org/

---

**Approval:** Infrastructure Lead  
**Last Review:** 2026-11-11  
**Next Review:** 2026-12-11
