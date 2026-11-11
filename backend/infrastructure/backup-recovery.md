# Database Backup & Disaster Recovery Strategy

## Executive Summary

MANAWA implements a comprehensive backup and disaster recovery strategy with:

- **RTO (Recovery Time Objective):** 30 minutes
- **RPO (Recovery Point Objective):** 6 hours (incremental backups every 6 hours)
- **Backup Retention:** 30 days
- **Storage Location:** AWS S3 with geographic redundancy
- **Encryption:** AES-256 in transit and at rest

## Backup Strategy

### Backup Schedule

```
┌────────────────────────────────────────────────────────────────┐
│ Daily Schedule (UTC)                                           │
├────────────────────────────────────────────────────────────────┤
│ 02:00 - Full backup (24GB avg, 20 min)                         │
│ 08:00 - Incremental backup (500MB avg, 5 min)                  │
│ 14:00 - Incremental backup (500MB avg, 5 min)                  │
│ 20:00 - Incremental backup (500MB avg, 5 min)                  │
│ 23:00 - Incremental backup (500MB avg, 5 min)                  │
└────────────────────────────────────────────────────────────────┘

Configuration:
- Full backups: Daily at 02:00 UTC (configurable via BACKUP_FULL_HOUR)
- Incremental: Every 6 hours (configurable via BACKUP_INCREMENTAL_HOURS)
- Retention: 30 days (configurable via BACKUP_RETENTION_DAYS)
- S3 Storage: STANDARD (full) + GLACIER (incremental)
```

### Backup Types

#### Full Backup

**What:** Complete PostgreSQL database dump (all tables, data, indexes)

**When:** Daily at 02:00 UTC

**Duration:** ~20 minutes

**Size:** ~24GB (compressed)

**Process:**
1. Execute `pg_dump` on primary database
2. Compress with gzip (60% compression ratio)
3. Upload to S3 with STANDARD storage class
4. Delete local copy after upload
5. Verify integrity

**Restore Time:** 40-60 minutes

**Characteristics:**
- Complete recovery to full state
- No dependencies on other backups
- Can restore to point-in-time within this day
- High storage cost (STANDARD tier)

#### Incremental Backup

**What:** Transaction log containing only changes since last full backup

**When:** Every 6 hours

**Duration:** ~5 minutes

**Size:** ~500MB (varies with transaction volume)

**Process:**
1. Query `audit_log` table for changes in last 6 hours
2. Export as JSONL (one change per line)
3. Compress with gzip
4. Upload to S3 with GLACIER storage class
5. Retention: 30 days

**Restore Time:** Full (60 min) + Incremental application (5 min)

**Characteristics:**
- Cheap storage (GLACIER tier)
- Fast incremental backup
- Combined with full for point-in-time recovery
- Dependent on full backup

### Backup Storage & Costs

```
S3 Pricing Breakdown:

Full Backups (STANDARD):
- 1 backup/day × 30 days = 30 backups
- 24GB × 30 = 720GB stored
- STANDARD: $0.023/GB/month = $16.56/month

Incremental Backups (GLACIER):
- 4 incremental/day × 30 days = 120 backups
- 500MB × 120 = 60GB stored
- GLACIER: $0.004/GB/month = $0.24/month

Total Storage Cost: ~$16.80/month
Plus: Data transfer out (restore): $0.09/GB

Estimated Monthly Cost:
- Backup storage: $17/month
- Restore scenario: $50-100 (varies with recovery size)
- Total: $70-120/month for 30-day retention
```

### Backup Integrity Testing

```
Daily Integrity Checks (2 backups tested per day):

03:00 UTC - Test today's full backup
  ✓ Download from S3 (2 min)
  ✓ Decompress (1 min)
  ✓ Validate SQL syntax (30 sec)
  ✓ Check row counts match (1 min)
  ✓ Delete test copy (30 sec)
  Total time: 5 minutes

09:00 UTC - Test yesterday's full backup
  ✓ Verify file integrity (CRC check)
  ✓ Verify S3 object metadata
  ✓ Check replication lag during backup
  Total time: 2 minutes

Monthly Full Recovery Test:
  - First Sunday of each month at 03:00 UTC
  - Spin up temporary environment
  - Restore full backup + all incremental backups
  - Run test suite against restored DB
  - Verify data integrity
  - Cost: ~$5 per test (temporary compute)
  - Duration: 2 hours
```

## Recovery Procedures

### Recovery Time Objectives (RTO)

```
Scenario                      RTO        Process
────────────────────────────────────────────────────────────
Data corruption               30 min     Restore from incremental
Single table loss             15 min     Single table restore
Complete DB loss              60 min     Full restore + incremental replay
Primary failure               5 min      Fail to read replica
Regional outage               120 min    Restore to new region
```

### Recovery Point Objectives (RPO)

```
RPO = Maximum data loss acceptable

Current Strategy:
- Full backup: 24 hours (worst case for daily full)
- Incremental: 6 hours (4 per day)

Example:
  Backup schedule:
  02:00 - Full backup
  08:00 - Incremental 1
  14:00 - Incremental 2
  20:00 - Incremental 3

  If primary fails at 10:00:
  - Latest backup: 08:00 incremental (2 hours old)
  - Data loss: ~2 hours ✓ (acceptable)
  
  If primary fails at 23:30:
  - Latest backup: 20:00 incremental (3.5 hours old)
  - Data loss: ~3.5 hours ✓ (acceptable)
```

## Restore Procedures

### Procedure 1: Restore Recent Incremental Backup

**Scenario:** Accidental data deletion discovered within 6 hours

**Time:** 30 minutes | **Data Loss:** 0 minutes

```bash
# 1. Stop application (prevent writes during recovery)
docker ps | grep manawa
docker stop manawa-api-1

# 2. List available backups
aws s3 ls s3://manawa-db-backups/incremental-backups/ --recursive

# 3. Download and apply incremental backup
aws s3 cp s3://manawa-db-backups/incremental-backups/backup-incremental-2026-11-11T08-00-00Z.jsonl.gz ./

gunzip backup-incremental-*.jsonl.gz

# 4. Connect to database and apply changes
psql -U manawa_user -d manawa < recovery.sql

# 5. Verify data integrity
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM projects;
SELECT COUNT(*) FROM quotes;

# 6. Restart application
docker start manawa-api-1
```

### Procedure 2: Restore Full + Incremental Backups

**Scenario:** Primary database corrupted, complete restore needed

**Time:** 60 minutes | **Data Loss:** 6 hours (max)

```bash
# 1. Identify restore point-in-time (when corruption detected)
# Example: 2026-11-10 14:30 UTC

# 2. Stop application
systemctl stop manawa-api

# 3. Backup current corrupted data (for forensics)
pg_dump -U postgres -d manawa > /backups/corrupted-$(date +%s).sql

# 4. Download full backup closest to corruption time
# List available full backups
aws s3 ls s3://manawa-db-backups/full-backups/ --recursive

# Restore from 2026-11-10 full backup (02:00 UTC)
aws s3 cp s3://manawa-db-backups/full-backups/backup-full-2026-11-10.sql.gz ./

gunzip backup-full-2026-11-10.sql.gz

# 5. Restore full backup (40 minutes)
psql -U postgres -d manawa < backup-full-2026-11-10.sql

# 6. Apply incremental backups up to restore point
# List incremental backups between 02:00-14:30 on 2026-11-10
aws s3 ls s3://manawa-db-backups/incremental-backups/ --recursive | grep 2026-11-10

# Apply each incremental in order
for backup in backup-incremental-2026-11-10T08-*; do
  aws s3 cp "s3://manawa-db-backups/incremental-backups/$backup" ./
  gunzip "$backup"
  psql -U postgres -d manawa < "${backup%.gz}"
done

# 7. Verify restoration
SELECT COUNT(*) FROM users;
SELECT MAX(updated_at) FROM users;
SELECT MAX(updated_at) FROM projects;

# 8. Restart application
systemctl start manawa-api

# 9. Monitor for issues
tail -f /var/log/manawa/api.log
```

### Procedure 3: Restore to Different Region

**Scenario:** Entire AWS region outage

**Time:** 120 minutes | **Data Loss:** 6 hours (max)

```bash
# 1. Alert: Region us-east-1 is down
# Failover to us-west-2

# 2. Create new RDS instance in us-west-2
# - Same configuration as primary
# - Same backup retention settings
# - Enable automated backups

# 3. Restore from latest backup to new region
aws s3 cp \
  s3://manawa-db-backups/full-backups/backup-full-$(date -d '1 day ago' +%Y-%m-%d).sql.gz \
  s3://backups-us-west-2/

# 4. Create snapshot and restore
aws rds create-db-instance-from-db-snapshot \
  --db-instance-identifier manawa-db-west-2 \
  --db-snapshot-identifier snapshot-20261110 \
  --region us-west-2

# 5. Update environment variables
# Update DATABASE_PRIMARY_URL to point to new region
export DATABASE_PRIMARY_URL="postgresql://user:pass@manawa-db-west-2.region.rds.amazonaws.com:5432/manawa"

# 6. Restart application pointing to new region
docker pull manawa-api:latest
docker run -e DATABASE_PRIMARY_URL=$DATABASE_PRIMARY_URL ... manawa-api

# 7. Monitor replication
# Set up new replicas in us-west-2 region
```

## Point-in-Time Recovery (PITR)

### PITR with Backup + WAL Archiving

```
Timeline:
13:00 - Error introduced
13:15 - Error detected

Recovery: Restore to 13:00 (before error)

Process:
1. Identify corrupted data timestamp
2. Find full backup before 13:00 (usually 02:00 same day)
3. Find incremental backup just before 13:00 (usually 08:00)
4. Apply all WAL records up to 13:00
5. Verify target state
```

### Limitations

PITR available for:
- Data corruption events (within 30 days)
- Accidental deletes (within 30 days)
- Past queries that modified data

PITR NOT available for:
- Encryption key loss
- Storage failure (all copies lost)
- Ransomware + backup destruction
- Configurations changed before backup

### Recovery Window

```
Current setup: 30-day retention

Day 1: Can restore to any point from past 30 days ✓
Day 15: Can restore to any point from past 15 days ✓
Day 30: Can restore to any point from past 1 day ✓
Day 31: Previous day's backups are deleted ✗

To extend retention:
- Set BACKUP_RETENTION_DAYS=90 (costs 3x storage)
- Archive old backups to GLACIER tier (cheaper)
```

## Data Retention Compliance

### GDPR Right to Erasure

```
User requests deletion:
1. Soft delete in main DB
2. Hard delete in next full backup (~24 hours)
3. All incremental backups referencing user deleted
4. Verification: Query backup and confirm user absent

Backup Compliance:
- Backups follow same retention as live DB
- No uncontrolled backup access
- Encrypted in transit and at rest
- Access logged and audited
```

### Retention Policy

```
Archive Strategy:

┌─────────────────────────────────────────────┐
│ Backup Age    │ Storage Class │ Cost        │
├─────────────────────────────────────────────┤
│ 0-7 days      │ STANDARD      │ $0.023/GB   │
│ 7-30 days     │ STANDARD-IA   │ $0.0125/GB  │
│ 30-90 days    │ GLACIER       │ $0.004/GB   │
│ 90+ days      │ DEEP ARCHIVE  │ $0.00099/GB │
└─────────────────────────────────────────────┘

Recommendation:
- Keep 7 daily full backups in STANDARD (hot)
- Move older to STANDARD-IA (warm)
- Move >30 days to GLACIER (cold)
- Saves ~70% on storage costs after 30 days
```

## Disaster Recovery Testing

### Monthly Disaster Recovery Drill

**Frequency:** First Sunday of each month, 03:00 UTC

**Duration:** 2 hours

**Cost:** ~$5 (temporary compute)

**Procedure:**
1. Spin up temporary environment (separate VPC/subnet)
2. Restore latest full backup to temporary DB
3. Apply all incremental backups
4. Run integrity verification queries
5. Execute test data migration scripts
6. Verify application can connect
7. Run smoke test suite (critical features)
8. Document results
9. Tear down temporary environment
10. File incident report with findings

**Success Criteria:**
- All backups successfully downloaded from S3
- All backups successfully restored to database
- Data integrity: Row counts match expected values
- Application connectivity: Test suite passes
- Recovery time: Actual time ≤ RTO (30 min)
- Data loss: None detected

**Failure Actions:**
- If test fails: Immediately investigate root cause
- If restore exceeds RTO: Optimize restoration process
- If backup corrupted: Verify S3 replication, adjust strategy
- If data loss detected: Review incremental backup logic

### Annual Disaster Recovery Exercise

**Scope:** Full team including ops, devops, and business

**Scenario:** Complete primary database failure

**Steps:**
1. Declare disaster
2. Activate business continuity plan
3. Failover to replica database
4. Document timeline and decisions
5. Execute recovery procedures
6. Verify application functionality
7. Restore to primary after test
8. Conduct post-mortem

**Learning Objectives:**
- Identify recovery bottlenecks
- Update runbooks
- Train team on procedures
- Measure actual RTO/RPO

## Backup Monitoring

### Alerting

```
Alert Conditions:

1. Backup Failed (CRITICAL)
   - Trigger: Full backup hasn't completed in 24 hours
   - Action: PagerDuty alert, ops notified
   - Recovery: Check S3 permissions, retry manually

2. Backup Large (WARNING)
   - Trigger: Full backup > 50GB
   - Action: Email ops team
   - Recovery: Investigate data growth, plan scaling

3. Replication Lag High (WARNING)
   - Trigger: Replica lag > 60 seconds
   - Action: Email monitoring team
   - Recovery: Reduce write load, check network

4. Restore Test Failed (CRITICAL)
   - Trigger: Monthly restore test doesn't pass
   - Action: PagerDuty alert
   - Recovery: Debug backup integrity, halt production changes
```

### Metrics to Monitor

```
Dashboard Metrics:

Backup Metrics:
- Last full backup timestamp
- Last full backup size
- Full backup success rate (%)
- Full backup average duration (minutes)
- Incremental backup count (last 24h)
- Incremental backup success rate (%)
- S3 storage used (GB)
- Monthly backup costs ($)

Restore Metrics:
- Last successful restore timestamp
- Average restore time (minutes)
- Restore test success rate (%)
- Data integrity verification: PASS/FAIL

Compliance Metrics:
- Backups meeting RPO ✓
- Backups meeting RTO ✓
- GDPR retention compliance ✓
- Access logs reviewed ✓
```

## Backup Security

### Encryption

**In Transit:**
- S3 API: HTTPS/TLS 1.2+
- Database: SSL connection
- Credentials: Environment variables + AWS IAM

**At Rest:**
- S3: AES-256 encryption
- Database: Native PostgreSQL TLS
- Temporary files: Deleted after upload

### Access Control

```
IAM Permissions:

Admin (full access):
  - s3:GetObject
  - s3:PutObject
  - s3:DeleteObject
  - s3:ListBucket
  - rds:*

Application (read-only):
  - s3:GetObject
  - s3:ListBucket (restricted path)

Operations (restore only):
  - s3:GetObject
  - s3:ListBucket
  - rds:CreateDBInstanceFromDBSnapshot
  - rds:ModifyDBInstance
```

### Audit Trail

```
All backup operations logged:
- Who initiated restore
- What backup was restored
- When restoration started/completed
- Where backup was restored to
- Result: success/failure + error details

Queries logged:
SELECT * FROM audit_log
WHERE action IN ('backup', 'restore')
ORDER BY created_at DESC;
```

## Best Practices Checklist

- [ ] Full backups created daily
- [ ] Incremental backups every 6 hours
- [ ] All backups encrypted (in transit + at rest)
- [ ] Backups stored in S3 with cross-region replication
- [ ] 30-day retention policy enforced
- [ ] Backup integrity tested monthly
- [ ] Restore procedures documented
- [ ] Team trained on recovery procedures
- [ ] RTO/RPO targets defined and met
- [ ] GDPR compliance verified
- [ ] Access control implemented
- [ ] Monitoring and alerts configured
- [ ] Disaster recovery drills scheduled

## References

- AWS RDS Backups: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_Backups.html
- PostgreSQL PITR: https://www.postgresql.org/docs/current/continuous-archiving.html
- AWS S3 Storage Classes: https://aws.amazon.com/s3/storage-classes/
- GDPR Data Retention: https://gdpr-info.eu/
