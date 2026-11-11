# MANAWA Disaster Recovery Plan (DRP)

**Version:** 1.0  
**Last Updated:** 2026-11-11  
**Status:** Production Ready  
**Classification:** Internal - Operational

## 1. Executive Summary

The MANAWA Disaster Recovery Plan outlines procedures to restore business operations following a system failure, data loss, or catastrophic event. This plan ensures:

- **RTO (Recovery Time Objective):** Max 4 hours for full system recovery
- **RPO (Recovery Point Objective):** Max 1 hour for database, 24 hours for configs
- **Availability Target:** 99.5% uptime (SLA commitment)
- **Compliance:** GDPR, PCI-DSS, CCPA ready

## 2. Disaster Recovery Architecture

### 2.1 Recovery Layers

```
┌─────────────────────────────────────────┐
│        Application Layer (Express)      │
│  RTO: 30 min | RPO: N/A                 │
└─────────────────────────────────────────┘
           ↓ Depends on ↓
┌─────────────────────────────────────────┐
│      Database Layer (PostgreSQL)        │
│  RTO: 1-2 hours | RPO: 1 hour          │
│  Backups: Hourly + Daily Full           │
└─────────────────────────────────────────┘
           ↓ Depends on ↓
┌─────────────────────────────────────────┐
│    Configuration Layer (AWS Vault)      │
│  RTO: 15 min | RPO: 24 hours            │
│  Backups: Daily snapshots               │
└─────────────────────────────────────────┘
           ↓ Depends on ↓
┌─────────────────────────────────────────┐
│   File Storage (Cloudinary / S3)        │
│  RTO: 30 min | RPO: Real-time           │
│  Redundancy: Cloudinary managed         │
└─────────────────────────────────────────┘
```

### 2.2 Recovery Sites

| Site | Type | Purpose | Failover Time | Data Sync |
|------|------|---------|---------------|-----------|
| AWS eu-west-1 (Ireland) | Primary | Production environment | N/A | Real-time |
| AWS eu-central-1 (Frankfurt) | Secondary | Hot standby | 30 minutes | Hourly snapshots |
| GCS europe-west1 (Belgium) | Backup | Cold storage | 2-4 hours | 6-hour async |

### 2.3 RTO/RPO Targets by Component

| Component | RTO | RPO | Justification |
|-----------|-----|-----|---------------|
| **Database** | 1-2 hours | 1 hour | Hourly backups, replicate to secondary |
| **API Server** | 30 minutes | N/A | Stateless, auto-scaling group recovery |
| **Configuration** | 15 minutes | 24 hours | AWS Secrets Manager versioning |
| **File Storage** | 30 minutes | Real-time | Cloudinary's native redundancy |
| **Email Queue** | 1 hour | 1 hour | Bull queue in Redis, backed up hourly |
| **Audit Logs** | 2 hours | 1 hour | Immutable backup in S3 |

## 3. Disaster Scenarios & Response Procedures

### Scenario A: Database Corruption (Recent Data)

**Trigger:** Constraint violations, missing records, or data inconsistency detected  
**Severity:** HIGH  
**Estimated Data Loss:** 0-1 hours

#### Detection
```
Alert triggers when:
- Backup verification fails (corruption detected)
- Application throws database constraint errors
- Restore test fails on weekly check
```

#### Step-by-Step Recovery (Estimated 45 minutes)

**Phase 1: Containment (5 minutes)**
1. Declare incident in Slack #incidents channel
2. Page on-call database engineer (PagerDuty)
3. Gather recovery team (DBA, DevOps, Backend Lead)
4. Obtain approval from Infrastructure Lead for restore

**Phase 2: Preparation (10 minutes)**
```bash
# 1. Identify latest good backup
curl -X GET http://localhost:3000/api/admin/recovery/status \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 2. Review backup manifest
aws s3 cp s3://manawa-prod-backups/database/manifest.json - | jq .

# Response shows:
# - Last successful backup: 2026-11-11T02:00:00Z
# - Backup type: FULL
# - Estimated restore time: 28 minutes
# - Data loss: 28 minutes of changes
```

**Phase 3: Staging Verification (15 minutes)**
```bash
# 1. Create snapshot of production database (read-only)
aws rds create-db-snapshot \
  --db-instance-identifier manawa-prod \
  --db-snapshot-identifier manawa-backup-$(date +%Y%m%d-%H%M%S)

# 2. Restore to staging environment
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier manawa-staging-recover \
  --db-snapshot-identifier manawa-prod-snapshot-id

# 3. Connect and verify data integrity
psql -h manawa-staging-recover.c9akciq32.eu-west-1.rds.amazonaws.com \
  -U admin -d manawa_prod -c \
  "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM projects;"

# Expected: Verify record counts match known good values
```

**Phase 4: Production Restore (15 minutes)**
```bash
# 1. Enable read-only mode (prevent new writes)
curl -X PUT http://localhost:3000/api/admin/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"readOnly": true, "reason": "Database recovery in progress"}'

# 2. Restore from backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier manawa-prod \
  --db-snapshot-identifier manawa-good-snapshot-id \
  --apply-immediately

# 3. Update connection string (if DB endpoint changed)
aws secretsmanager update-secret \
  --secret-id manawa/prod/DATABASE_URL \
  --secret-string 'postgresql://user:pass@new-endpoint/manawa_prod'

# 4. Restart application servers
# (Automatic via load balancer health checks)
```

**Phase 5: Verification & Cleanup (5 minutes)**
```bash
# 1. Disable read-only mode
curl -X PUT http://localhost:3000/api/admin/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"readOnly": false}'

# 2. Run health checks
curl http://localhost:3000/api/health
# Expected: { "status": "healthy", "db": "connected", "cache": "connected" }

# 3. Verify no data inconsistencies
curl -X GET http://localhost:3000/api/admin/recovery/verify \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 4. Delete old snapshot
aws rds delete-db-snapshot --db-snapshot-identifier manawa-backup-id
```

**Communication Template:**
```
📢 INCIDENT UPDATE: Database Recovery Complete
   Duration: 45 minutes (5 min detection + 40 min recovery)
   Data Loss: 28 minutes (last good backup: 2026-11-11T02:00:00Z)
   Status: ✓ All systems operational
   
   Affected Users: None (during maintenance window)
   Action Items:
   - [ ] Post-incident review scheduled for tomorrow 10:00 UTC
   - [ ] Root cause analysis document drafted
   - [ ] Backup verification enhanced
```

---

### Scenario B: Database Server Failure

**Trigger:** Complete RDS instance unavailable, cannot restart  
**Severity:** CRITICAL  
**Estimated Data Loss:** 0 hours (RDS handles replication)  
**Estimated RTO:** 2 hours

#### Detection
```
Alert triggers when:
- Database connection pool exhausted
- All connection attempts timeout (30 sec threshold)
- RDS instance status = "failed"
```

#### Step-by-Step Recovery (Estimated 2 hours)

**Phase 1: Assessment (10 minutes)**
```bash
# 1. Verify RDS instance status
aws rds describe-db-instances \
  --db-instance-identifier manawa-prod \
  --query 'DBInstances[0].[DBInstanceStatus, DBInstanceArn]'

# If status = "failed" or "incompatible-parameters":
# - Automatic failover won't work
# - Need manual restore from backup
```

**Phase 2: Emergency Procedures (15 minutes)**
```bash
# 1. Declare CRITICAL incident
slack-incident "CRITICAL: Database server failed - initiating recovery"

# 2. Get latest backup information
aws s3 ls s3://manawa-prod-backups/database/full/ \
  --recursive --human-readable --summarize | tail -5

# Example output:
# 2026-11-11 02:00:00   1.87 GiB 2026-11-11-020000.sql.gz

# 3. Identify backup timestamp (most recent)
BACKUP_ID="full-2026-11-11-020000"
BACKUP_FILE="s3://manawa-prod-backups/database/full/$BACKUP_ID.sql.gz"
```

**Phase 3: New Instance Creation (30 minutes)**
```bash
# 1. Create new RDS instance with same configuration
aws rds create-db-instance \
  --db-instance-identifier manawa-prod \
  --db-instance-class db.t3.large \
  --engine postgres \
  --engine-version 15.3 \
  --allocated-storage 100 \
  --storage-type gp3 \
  --master-username admin \
  --master-user-password "$DB_PASSWORD" \
  --publicly-accessible false \
  --vpc-security-group-ids sg-12345 \
  --db-subnet-group-name prod-postgres \
  --backup-retention-period 30 \
  --multi-az

# 2. Wait for instance to reach "available" status
# (Typically 10-15 minutes)
aws rds wait db-instance-available \
  --db-instance-identifier manawa-prod

# 3. Get new endpoint
NEW_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier manawa-prod \
  --query 'DBInstances[0].Endpoint.Address' --output text)
```

**Phase 4: Data Restore (25 minutes)**
```bash
# 1. Download backup from S3
aws s3 cp $BACKUP_FILE - | gunzip | \
  PGPASSWORD="$DB_PASSWORD" psql \
  -h "$NEW_ENDPOINT" \
  -U admin \
  -d postgres \
  -f -

# 2. Verify restore success
PGPASSWORD="$DB_PASSWORD" psql \
  -h "$NEW_ENDPOINT" \
  -U admin \
  -d manawa_prod \
  -c "SELECT COUNT(*) as user_count FROM users; \
      SELECT COUNT(*) as project_count FROM projects; \
      SELECT COUNT(*) as quote_count FROM quotes;"

# Expected output:
# user_count     | 12847
# project_count  | 5403
# quote_count    | 18721
```

**Phase 5: Application Reconnection (20 minutes)**
```bash
# 1. Update database URL in secrets manager
NEW_DATABASE_URL="postgresql://admin:password@$NEW_ENDPOINT/manawa_prod"

aws secretsmanager update-secret \
  --secret-id manawa/prod/DATABASE_URL \
  --secret-string "$NEW_DATABASE_URL"

# 2. Restart application servers (triggers config reload)
# Applications automatically read new endpoint from secrets manager

# 3. Verify application health
for i in {1..30}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    http://localhost:3000/api/health)
  if [ "$STATUS" = "200" ]; then
    echo "Application healthy after $i seconds"
    break
  fi
  sleep 2
done

# 4. Run smoke tests
curl -X GET http://localhost:3000/api/projects?limit=1 \
  -H "Authorization: Bearer $TEST_TOKEN"
# Expected: { "success": true, "data": [...], "total": 5403 }
```

**Phase 6: Cleanup & Verification (10 minutes)**
```bash
# 1. Delete old failed instance (after 30 min verification period)
# aws rds delete-db-instance --db-instance-identifier manawa-prod-old

# 2. Verify backups are running normally
curl -X GET http://localhost:3000/api/admin/recovery/status \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 3. Schedule post-incident review
```

**Total RTO: ~2 hours**  
**Data Loss: 28 minutes (since last backup)**

---

### Scenario C: Regional Cloud Failure (AZ or Region Down)

**Trigger:** Entire AWS region unavailable (earthquake, infrastructure failure)  
**Severity:** CRITICAL  
**RTO:** 4 hours  
**RPO:** 6 hours (GCS sync window)

#### Detection
```
Alert when:
- 100% of health checks failing across all AZs
- AWS status page shows regional outage
- No network connectivity to entire region
```

#### Step-by-Step Recovery to Secondary Region

**Phase 1: Incident Declaration (5 minutes)**
```bash
# 1. Verify AWS status
curl https://status.aws.amazon.com/
# Confirms regional outage

# 2. Declare Regional Failover
slack-incident "CRITICAL: Regional failure - initiating GCS backup recovery"

# 3. Assemble team: Infrastructure Lead, DevOps x2, DBA
```

**Phase 2: Backup Assessment (10 minutes)**
```bash
# 1. Check GCS backup (secondary region, 6 hours behind)
gsutil ls -L gs://manawa-prod-backups-gcs/database/

# 2. Identify latest backup in GCS
# Example: 2026-11-11-200000.sql.gz (6 hours old)

# 3. Assess acceptable data loss
# "6 hours of data OK for regional failover scenario"
```

**Phase 3: New Infrastructure in Alternate Region (90 minutes)**
```bash
# 1. Deploy to eu-central-1 (Frankfurt) as emergency replacement
# Use Terraform/CloudFormation to spin up:
# - RDS PostgreSQL instance
# - Application servers
# - Load balancer
# - Security groups
# - IAM roles

cd infrastructure/terraform
terraform workspace new eu-central-1
terraform plan -out=plan.tfplan
terraform apply plan.tfplan

# Takes ~60-90 minutes for full infrastructure to be ready

# 2. Get new infrastructure endpoints
NEW_DB_ENDPOINT=$(terraform output database_endpoint)
NEW_APP_URL=$(terraform output application_url)
```

**Phase 4: Data Restore from GCS (30 minutes)**
```bash
# 1. Download backup from GCS
gsutil cp gs://manawa-prod-backups-gcs/database/full-2026-11-11-200000.sql.gz - | gunzip | \
  PGPASSWORD="$DB_PASSWORD" psql \
  -h "$NEW_DB_ENDPOINT" \
  -U admin \
  -d manawa_prod \
  -f -

# 2. Verify data integrity
PGPASSWORD="$DB_PASSWORD" psql -h "$NEW_DB_ENDPOINT" \
  -U admin -d manawa_prod -c \
  "SELECT COUNT(*) FROM users; \
   SELECT COUNT(*) FROM projects; \
   SELECT COUNT(*) FROM quotes;"
```

**Phase 5: DNS Failover (15 minutes)**
```bash
# 1. Update Route53 DNS to point to new region
aws route53 change-resource-record-sets \
  --hosted-zone-id ZONE123 \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.manawa.com",
        "Type": "A",
        "TTL": 60,
        "ResourceRecords": [{"Value": "'$NEW_APP_URL'"}]
      }
    }]
  }'

# 2. Monitor DNS propagation (may take 5-10 min for edge caches)
dig api.manawa.com +short

# 3. Verify clients connect to new region
curl https://api.manawa.com/api/health
# Should now resolve to Frankfurt endpoint
```

**Phase 6: Application Verification (20 minutes)**
```bash
# 1. Run full health check suite
./scripts/dr-test.js --verify-all

# 2. Check critical user paths
# - User login
# - Project creation
# - Quote generation
# - Payment processing

# 3. Monitor error rates (should be near-zero)
```

**Phase 7: User Communication & Monitoring (Ongoing)**
```
📢 INCIDENT: Regional AWS Outage - Failover Complete

Status: ✓ Service restored in alternate region (Frankfurt)
Timeline:
  - 15:23 UTC: eu-west-1 (Ireland) became unavailable
  - 15:28 UTC: Failover initiated
  - 16:58 UTC: New infrastructure ready
  - 17:28 UTC: Data restored, DNS updated
  - 17:43 UTC: All systems operational

Data Loss: ~6 hours (last GCS backup: 2026-11-11T20:00:00Z)
Affected Users: New requests only (queued requests resumed)

Next Steps:
  1. Restore primary region (pending AWS repair)
  2. Failback to primary (estimated 2026-11-12T08:00:00Z)
  3. Post-incident review (2026-11-13)
```

**Total RTO: ~4 hours**  
**Data Loss: ~6 hours**

---

### Scenario D: Ransomware / Data Deletion Attack

**Trigger:** Unauthorized data deletion, encryption, or corruption  
**Severity:** CRITICAL  
**Estimated Data Loss:** Depends on detection speed  
**Estimated RTO:** 3-6 hours

#### Prevention (Primary Defense)
```
Backup Immutability:
- S3 Object Lock: ENABLED (cannot delete backups for 30 days)
- Versioning: ENABLED (all backup versions retained)
- Separate AWS Account: Backup account separate from production
- Read-Only IAM Policy: Application cannot delete backups
```

#### Detection
```
Alert triggers when:
- Abnormal database delete operations (> 1000 rows/second)
- Backup integrity check fails
- Cloudtrail shows suspicious API calls
- File checksums don't match
```

#### Step-by-Step Recovery

**Phase 1: Immediate Containment (5 minutes)**
```bash
# 1. Declare CRITICAL security incident
slack-incident "CRITICAL: Possible ransomware - isolating systems"

# 2. Isolate database (no new connections)
aws rds modify-db-instance \
  --db-instance-identifier manawa-prod \
  --publicly-accessible false \
  --no-auto-minor-version-upgrade

# 3. Stop application servers
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name manawa-prod-asg \
  --desired-capacity 0

# 4. Preserve evidence
aws ec2 create-image \
  --instance-id i-12345 \
  --name manawa-evidence-2026-11-11

# 5. Notify security team
pagerduty-escalate "CRITICAL: Security incident - ransomware suspected"
```

**Phase 2: Backup Integrity Check (10 minutes)**
```bash
# 1. Verify backups are intact (object lock protects)
aws s3api get-object-legal-hold \
  --bucket manawa-prod-backups \
  --key database/full/2026-11-11-020000.sql.gz

# 2. Check backup account activity
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=manawa-prod-backups \
  --max-items 20

# Expected: No deletion events in past 24 hours
```

**Phase 3: Identify Good Recovery Point (15 minutes)**
```bash
# 1. Determine when attack occurred
# From logs: Attack detected at 2026-11-11T14:30:00Z
# Data suspicious from: 2026-11-11T13:45:00Z onwards
# Last good backup: 2026-11-11T13:00:00Z ✓

# 2. Verify backup contents (restore to isolated environment)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier manawa-forensics \
  --db-snapshot-identifier manawa-prod-2026-11-11-130000 \
  --no-publicly-accessible

# 3. Run integrity checks
PGPASSWORD="$DB_PASSWORD" psql \
  -h manawa-forensics.c9akciq32.eu-west-1.rds.amazonaws.com \
  -U admin -d manawa_prod -c \
  "SELECT COUNT(*) FROM users; \
   SELECT COUNT(*) FROM audit_logs WHERE timestamp > '2026-11-11T13:00:00Z';"
```

**Phase 4: Full System Recovery (45-60 minutes)**

Follow Scenario B (Database Server Failure) procedures using backup from:
- **Restore Point:** 2026-11-11T13:00:00Z (13:00 UTC)
- **Data Loss:** 90 minutes of changes (13:00-14:30 UTC)

**Phase 5: Forensics & Investigation (Ongoing)**
```bash
# 1. Preserve all evidence in separate forensics account
# 2. Engage security firm for breach analysis
# 3. Review all access logs from past 7 days
# 4. Check for lateral movement in infrastructure
# 5. Rotate all credentials
```

**Phase 6: Post-Recovery Actions**
- [ ] Restore to production infrastructure
- [ ] Verify no malicious code/backdoors
- [ ] Security audit of all systems
- [ ] Client notification (if applicable under GDPR)
- [ ] Incident post-mortem

---

## 4. Disaster Recovery Testing

### 4.1 Testing Schedule

| Frequency | Scope | Duration | Automated | Purpose |
|-----------|-------|----------|-----------|---------|
| **Daily** | Backup exists, correct size | 5 min | Yes | Sanity check |
| **Weekly** | Full database restore to staging | 45 min | Yes | RTO validation |
| **Monthly** | Point-in-time restore to arbitrary date | 60 min | Yes | RPO validation |
| **Quarterly** | Full DR drill (region failover simulation) | 2-4 hours | Manual | Complete failover test |
| **Annually** | Incident war game (tabletop exercise) | 3 hours | Manual | Team coordination |

### 4.2 Weekly Restore Test

Automated via `/scripts/dr-test.js`:

```bash
npm run dr:test:weekly

# Executes:
# 1. Download latest backup from S3
# 2. Restore to staging RDS instance
# 3. Run schema validation queries
# 4. Execute application health checks
# 5. Verify critical business logic
# 6. Report results to team
# 7. Clean up staging instance

# Duration: 45 minutes
# Success Criteria:
#   - All queries execute without errors
#   - Record counts match production baseline
#   - Health endpoint returns 200
#   - No constraint violations
#   - Application startup successful
```

### 4.3 Quarterly DR Drill

Full simulation of regional failover:

**Scope:** Entire infrastructure recovery to alternate region  
**Duration:** 2-4 hours (unannounced, business hours)  
**Participants:** DevOps, DBA, Backend Lead, Infrastructure Lead  
**Measurement:** RTO achieved, RPO achieved, team coordination

**Drill Checklist:**
- [ ] Incident declared, team assembled (5 min)
- [ ] Backup integrity verified (10 min)
- [ ] New infrastructure spun up (60-90 min)
- [ ] Data restored from GCS (30 min)
- [ ] DNS failover executed (15 min)
- [ ] Application health verified (20 min)
- [ ] Smoke tests passed (15 min)
- [ ] Documented issues noted for improvement

**Success Criteria:**
- RTO achieved within 4 hours (target: < 4 hours)
- RPO within 6 hours (target: < 6 hours)
- Zero data corruption detected
- All critical services operational
- No manual interventions required beyond approval

### 4.4 Test Result Documentation

All test results recorded in:
```
/logs/dr-tests/
├─ weekly-2026-11-11.log
├─ monthly-2026-11-10.log
└─ quarterly-2026-09-01.log
```

Example success log:
```
[QUARTERLY DR DRILL] 2026-11-11
Duration: 3h 42m
Team: DevOps x2, DBA, Backend Lead

1. Incident Declaration: ✓ 04:32 UTC
2. Backup Verification: ✓ 04:37 UTC
3. Infrastructure Spin-up: ✓ 05:47 UTC (70 min)
4. Data Restore: ✓ 06:17 UTC (30 min)
5. DNS Failover: ✓ 06:32 UTC (15 min)
6. Application Health: ✓ 06:52 UTC (20 min)
7. Smoke Tests: ✓ 07:07 UTC (15 min)

RTO Achieved: 3h 42m (Target: 4h) ✓
RPO Achieved: 6h 15m (GCS sync delay)
Issues Found: 0 blockers, 2 improvements noted

Next Drill: 2026-12-11 (unannounced)
```

## 5. Runbook Templates

### 5.1 Incident Commander Checklist

When disaster is detected:

```
IMMEDIATE (0-5 minutes):
□ Declare incident (Slack #incidents)
□ Page on-call team (PagerDuty)
□ Assemble recovery team
□ Get Infrastructure Lead approval

ASSESSMENT (5-15 minutes):
□ Determine severity (P1=critical, P2=high, P3=medium)
□ Identify scenario (database, infrastructure, region, security)
□ Estimate RTO/RPO impact
□ Notify stakeholders (exec, support, communications)

EXECUTION (15-45 minutes):
□ Execute step-by-step recovery procedure (see scenarios above)
□ Verify at each checkpoint
□ Document issues/blockers
□ Communicate status updates every 15 minutes

VERIFICATION (45-60 minutes):
□ Health checks pass ✓
□ Smoke tests pass ✓
□ Business critical functions work ✓
□ Data integrity confirmed ✓
□ Monitoring alerts normal ✓

POST-RECOVERY (60+ minutes):
□ Declare incident resolved
□ Notify all stakeholders
□ Document recovery process
□ Schedule post-incident review (24 hours)
□ Update runbook if needed
```

### 5.2 Communication Template

**During Recovery:**
```
🔴 INCIDENT: [Brief Description]
Status: IN PROGRESS
ETA: [Time estimate]
Impact: [Services affected, features down]
Actions Taken: [What we're doing]
Next Update: [In X minutes]
```

**Recovery Complete:**
```
✅ INCIDENT RESOLVED
Total Duration: [X hours Y minutes]
Impact: [# users affected, $ estimated]
Root Cause: [Brief explanation]
Data Loss: [If any - be specific]
Follow-up: Post-incident review scheduled for [date/time]
```

## 6. Recovery Operations

### 6.1 Manual Backup Trigger

```bash
# Endpoint
POST /api/admin/recovery/backup

# Headers
Authorization: Bearer $ADMIN_TOKEN
Content-Type: application/json

# Body
{
  "type": "full",              // or "incremental"
  "description": "Pre-release backup",
  "priority": "high"           // or "normal"
}

# Response
{
  "backupId": "manual-20261111-143022",
  "status": "initiated",
  "type": "full",
  "startTime": "2026-11-11T14:30:22Z",
  "estimatedDuration": "28 minutes"
}
```

### 6.2 Recovery Status Endpoint

```bash
# Endpoint
GET /api/admin/recovery/status

# Response
{
  "status": "healthy",
  "lastBackup": {
    "id": "full-2026-11-11-020000",
    "timestamp": "2026-11-11T02:00:00Z",
    "type": "full",
    "size": "1.87 GB",
    "verified": true,
    "checksum": "a3c5f8e2b1d9c4..."
  },
  "nextBackup": "2026-11-11T03:00:00Z",
  "storageUsed": {
    "s3": "58.6 GB",
    "gcs": "56.2 GB"
  },
  "lastRestoreTest": {
    "date": "2026-11-11",
    "passed": true,
    "duration": "42 minutes"
  },
  "rto": "1-4 hours",
  "rpo": "1 hour"
}
```

### 6.3 Initiate Point-in-Time Restore

```bash
# Endpoint
POST /api/admin/recovery/restore

# Body
{
  "timestamp": "2026-11-10T14:30:00Z",  // Restore to this point
  "targetEnvironment": "staging",        // Or "production" (requires confirmation)
  "dryRun": true                         // Preview first
}

# Response
{
  "restoreId": "restore-20261111-144500",
  "status": "planned",
  "sourceBackup": "full-2026-11-10-020000",
  "targetTimestamp": "2026-11-10T14:30:00Z",
  "estimatedDuration": "35 minutes",
  "estimatedDataLoss": "5 hours 30 minutes",
  "approvalRequired": true,
  "approvalToken": "eyJhbGciOiJIUzI1NiIs..."
}

# To confirm restore (requires approval from 2 admins)
POST /api/admin/recovery/restore/confirm
{
  "restoreId": "restore-20261111-144500",
  "approvalToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

## 7. DR Team Roles & Responsibilities

| Role | Responsibilities | Escalation |
|------|------------------|------------|
| **Incident Commander** | Overall coordination, decisions, stakeholder communication | CTO |
| **Database Administrator** | Backup verification, restore execution, data validation | Infrastructure Lead |
| **DevOps Engineer** | Infrastructure provisioning, DNS failover, monitoring | DevOps Lead |
| **Backend Lead** | Application verification, health checks, bug fixes | VP Engineering |
| **Infrastructure Lead** | Approval authority, resource allocation, post-mortems | CTO |

## 8. Escalation Procedures

**Response Times:**

| Severity | Page Delay | Response SLA | Escalation |
|----------|-----------|--------------|-----------|
| P1 (Critical) | Immediate | 5 minutes | CTO notified automatically |
| P2 (High) | 5 minutes | 15 minutes | Lead notified |
| P3 (Medium) | 15 minutes | 1 hour | Team leader notified |

**Escalation Chain:**
```
On-Call Engineer (P1 Alert)
        ↓
DevOps Lead (no response in 10 min)
        ↓
Infrastructure Lead (no response in 20 min)
        ↓
CTO (no response in 30 min)
```

## 9. References & Documentation

- **Backup Strategy:** `/infrastructure/backup-strategy.md`
- **Recovery Endpoints:** `/routes/admin-recovery.js`
- **DR Testing Script:** `/scripts/dr-test.js`
- **Backup Manager:** `/scripts/backup-manager.js`
- **Compliance Checklist:** `/infrastructure/compliance-checklist.md`

---

**Last Tested:** [Weekly restore test date]  
**Next DR Drill:** [Quarterly date]  
**Plan Review:** Quarterly (last: 2026-11-11)  
**Approval:** Infrastructure Lead, CTO

