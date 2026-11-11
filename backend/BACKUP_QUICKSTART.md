# Backup & Disaster Recovery - Quick Start Guide

**Status:** Production Ready  
**Setup Time:** 30 minutes  
**Testing Time:** 2 hours

---

## 1. Files Created

```
backend/
├── infrastructure/
│   ├── backup-strategy.md                    # Comprehensive backup architecture
│   ├── disaster-recovery.md                  # Step-by-step recovery procedures
│   ├── compliance-checklist.md               # GDPR/PCI-DSS/CCPA compliance
│   └── RECOVERY_IMPLEMENTATION_SUMMARY.md    # Integration guide & quick reference
├── scripts/
│   ├── backup-manager.js                     # Backup orchestration script
│   └── dr-test.js                            # DR testing & verification
└── routes/
    └── admin-recovery.js                     # Admin REST API endpoints
```

---

## 2. Integration (3 Steps)

### Step 1: Add Route Import

**File:** `/backend/index.js` (line ~36, with other route imports)

```javascript
// Add this line
const recoveryRoutes = require('./routes/admin-recovery');

// Already configured at line 250 (no change needed):
// app.use('/api/admin/recovery', injectAdminCookie, recoveryRoutes);
```

### Step 2: Install Dependencies

```bash
npm install aws-sdk @google-cloud/storage
```

### Step 3: Set Environment Variables

Add to `.env`:

```
# Backup Configuration
BACKUP_S3_BUCKET=manawa-prod-backups
BACKUP_GCS_BUCKET=manawa-prod-backups-gcs
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
GCS_PROJECT_ID=your-gcp-project
GCS_KEY_FILE=/path/to/gcs-key.json

# Staging for DR Tests
STAGING_DB_HOST=staging.rds.amazonaws.com
STAGING_DB_USER=admin
STAGING_DB_PASSWORD=your_password
STAGING_API_URL=http://localhost:3001
```

---

## 3. Quick Test

### Test Route Integration

```bash
# 1. Start application
npm start

# 2. Check recovery status (requires admin token)
curl -X GET http://localhost:3000/api/admin/recovery/status \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Response should include:
# {
#   "success": true,
#   "data": {
#     "status": "healthy",
#     "database": { "status": "connected" },
#     "lastBackup": { ... }
#   }
# }
```

### Run Backup Test

```bash
# Manual backup trigger via API
curl -X POST http://localhost:3000/api/admin/recovery/backup \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "full", "description": "Test backup"}'

# Response:
# {
#   "success": true,
#   "data": {
#     "backupId": "manual-20261111-143022",
#     "status": "initiated",
#     "estimatedDuration": "28 minutes"
#   }
# }
```

---

## 4. Automation Setup

### AWS Infrastructure

**Create S3 Bucket:**
```bash
aws s3 mb s3://manawa-prod-backups --region eu-west-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket manawa-prod-backups \
  --versioning-configuration Status=Enabled

# Enable Object Lock for immutability
aws s3api put-object-legal-hold \
  --bucket manawa-prod-backups \
  --key dummy.txt \
  --legal-hold Status=ON

# Create lifecycle policy (auto-archive to Glacier day 31, delete day 91)
aws s3api put-bucket-lifecycle-configuration \
  --bucket manawa-prod-backups \
  --lifecycle-configuration file://lifecycle.json
```

**lifecycle.json:**
```json
{
  "Rules": [
    {
      "Id": "ArchiveOldBackups",
      "Status": "Enabled",
      "Prefix": "database/",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "GLACIER"
        }
      ],
      "Expiration": {
        "Days": 90
      }
    }
  ]
}
```

**Create GCS Bucket:**
```bash
gsutil mb -l europe-west1 gs://manawa-prod-backups-gcs

# Enable versioning
gsutil versioning set on gs://manawa-prod-backups-gcs
```

### Scheduled Backups (Cron)

Add to crontab:

```bash
# Edit crontab
crontab -e

# Add these lines:

# Daily full backup at 02:00 UTC
0 2 * * * cd /app && node scripts/backup-manager.js trigger-full >> /var/log/backup-full.log 2>&1

# Hourly incremental backups
0 * * * * cd /app && node scripts/backup-manager.js trigger-incremental >> /var/log/backup-incremental.log 2>&1

# Weekly restore test (Sunday 06:00 UTC)
0 6 * * 0 cd /app && node scripts/dr-test.js weekly >> /var/log/dr-test-weekly.log 2>&1

# Daily backup verification (06:00 UTC)
0 6 * * * cd /app && node scripts/backup-manager.js verify >> /var/log/backup-verify.log 2>&1

# Monthly cleanup (last day of month, 03:00 UTC)
0 3 L * * cd /app && node scripts/backup-manager.js cleanup >> /var/log/backup-cleanup.log 2>&1
```

---

## 5. Backup Manager Commands

```bash
# Create full backup manually
node scripts/backup-manager.js trigger-full

# Create incremental backup manually
node scripts/backup-manager.js trigger-incremental

# Verify backup integrity
node scripts/backup-manager.js verify

# Show backup statistics
node scripts/backup-manager.js status

# Clean up old backups (before 90 days)
node scripts/backup-manager.js cleanup
```

---

## 6. DR Testing

### Weekly Restore Test

```bash
# Run automated weekly restore test
node scripts/dr-test.js weekly

# Results saved to: /backend/logs/dr-tests/weekly-{date}.json

# Check results
cat logs/dr-tests/weekly-2026-11-11.json
```

### Monthly Point-in-Time Restore

```bash
# Restore to specific timestamp
node scripts/dr-test.js monthly 2026-11-10T14:30:00Z

# Results saved to: /backend/logs/dr-tests/monthly-{date}.json
```

### Quarterly DR Drill

```bash
# Full regional failover simulation (manual, 2-4 hours)
node scripts/dr-test.js quarterly

# Run complete verification
node scripts/dr-test.js verify-all

# Display test results
node scripts/dr-test.js status
```

---

## 7. Recovery Scenarios - Cheat Sheet

### Scenario A: Database Corruption

```bash
# 1. Check status
curl -X GET http://localhost:3000/api/admin/recovery/status \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 2. Preview restore (dry-run)
curl -X POST http://localhost:3000/api/admin/recovery/restore \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "targetEnvironment": "staging",
    "dryRun": true
  }'

# 3. See full procedure in: /infrastructure/disaster-recovery.md (Section 3.A)
```

### Scenario B: Database Server Failure

```bash
# 1. Declare incident
# 2. Check latest backup
node scripts/backup-manager.js status

# 3. Follow step-by-step procedure in: /infrastructure/disaster-recovery.md (Section 3.B)
# Estimated RTO: 2 hours
```

### Scenario C: Regional Cloud Failure

```bash
# See full procedure in: /infrastructure/disaster-recovery.md (Section 3.C)
# Estimated RTO: 4 hours
# Uses GCS backup (6-hour sync window behind)
```

### Scenario D: Ransomware/Data Deletion

```bash
# Backups protected by S3 Object Lock
# Cannot be deleted for minimum 90 days
# See full procedure in: /infrastructure/disaster-recovery.md (Section 3.D)
```

---

## 8. Admin API Summary

### Check Recovery Status
```bash
GET /api/admin/recovery/status
# Returns: Database health, last backup, next backup schedule, RTO/RPO targets
```

### Trigger Manual Backup
```bash
POST /api/admin/recovery/backup
# Body: { "type": "full|incremental", "description": "...", "priority": "normal|high" }
```

### Initiate Restore (Staging First)
```bash
POST /api/admin/recovery/restore
# Body: { "targetEnvironment": "staging", "dryRun": true }
# Returns: Estimated duration, data loss, approval requirements
```

### Confirm Production Restore (2-Admin Approval)
```bash
POST /api/admin/recovery/restore/confirm
# Requires approval token from second admin
```

### Check Compliance Status
```bash
GET /api/admin/recovery/compliance
# Returns: GDPR, PCI-DSS, CCPA compliance status
```

### View Audit Trail
```bash
GET /api/admin/recovery/audit-log?limit=50&offset=0
# Returns: All backup/restore operations logged
```

### Get DR Test Results
```bash
GET /api/admin/recovery/test
# Returns: Latest test results, schedule
```

---

## 9. Monitoring & Alerting

### Key Metrics to Monitor

- **Backup Success Rate:** Target 99.9%
- **Average Backup Duration:** Full 28 min, Incremental 8 min
- **Storage Usage:** Track S3 + GCS total
- **Weekly Restore Test Pass Rate:** Target 100%
- **Recovery Time Actuals vs RTO:** All scenarios < target

### Alert Configuration

Set up alerts for:
- Backup missed (> 5 min late)
- Backup failed
- Backup verification failed
- Weekly restore test failed
- Storage quota exceeded (80%)
- Encryption key rotation due

---

## 10. Compliance Checklist

### Pre-Production Verification

- [ ] AWS S3 bucket created (eu-west-1, Ireland)
- [ ] S3 versioning enabled
- [ ] S3 Object Lock enabled (Governance Mode)
- [ ] S3 lifecycle policy configured (30→Glacier, delete 90)
- [ ] AWS KMS key created for encryption
- [ ] GCS bucket created (europe-west1, Belgium)
- [ ] GCS versioning enabled
- [ ] Database backups tested (manual backup successful)
- [ ] Weekly restore test passed
- [ ] Admin API endpoints responding
- [ ] Audit logs recording all backup operations
- [ ] Environment variables configured
- [ ] Cron jobs configured

### Data Protection

- [ ] Backups encrypted in transit (TLS 1.3)
- [ ] Backups encrypted at rest (AES-256)
- [ ] Backup access restricted to ADMIN users
- [ ] All access logged in immutable audit trail
- [ ] Payment data NOT in backups (GeniusPay handles)
- [ ] Personal data retention < 90 days

### Compliance

- [ ] GDPR right to deletion implemented
- [ ] GDPR right to data export implemented
- [ ] CCPA privacy policy updated
- [ ] PCI-DSS audit passed (external QSA)
- [ ] Data anonymization tested
- [ ] Backup exclusion list working

---

## 11. Troubleshooting

### Backup Fails to Upload to S3

```bash
# Check AWS credentials
aws s3 ls s3://manawa-prod-backups/

# Check KMS key access
aws kms describe-key --key-id your-key-id

# Check bucket permissions
aws s3api get-bucket-versioning --bucket manawa-prod-backups

# Check IAM policy
aws iam get-user-policy --user-name backup-user --policy-name BackupPolicy
```

### Weekly Restore Test Fails

```bash
# Check staging database connectivity
PGPASSWORD="$STAGING_DB_PASSWORD" psql \
  -h $STAGING_DB_HOST \
  -U $STAGING_DB_USER \
  -d manawa_prod_test -c "SELECT COUNT(*) FROM users;"

# Check application health
curl http://localhost:3001/api/health

# Review test logs
cat logs/dr-tests/weekly-*.json | jq '.tests[] | select(.passed==false)'
```

### Encryption Key Issues

```bash
# Verify KMS key is accessible
aws kms list-keys

# Test KMS key (encrypt/decrypt)
aws kms encrypt --key-id your-key-id --plaintext "test data"
```

---

## 12. Support & Escalation

**Documentation:**
- Backup Strategy: `/infrastructure/backup-strategy.md`
- Disaster Recovery: `/infrastructure/disaster-recovery.md`
- Compliance Checklist: `/infrastructure/compliance-checklist.md`
- Full Implementation Guide: `/infrastructure/RECOVERY_IMPLEMENTATION_SUMMARY.md`

**Quick Reference:**
- RTO Targets: 1-4 hours (depending on scenario)
- RPO Targets: 1 hour for database
- Backup Success Rate Goal: 99.9%
- Recovery Test Pass Rate Goal: 100%

**Escalation:**
1. On-call engineer (PagerDuty) - immediate for backup failures
2. DevOps team lead - recovery procedures
3. Infrastructure director - critical infrastructure decisions
4. CTO - approval for production recovery procedures

---

## Next Steps

1. ✅ Review `/infrastructure/backup-strategy.md` for architecture
2. ✅ Review `/infrastructure/disaster-recovery.md` for procedures
3. ✅ Add route import to `index.js`
4. ✅ Configure AWS S3/GCS buckets
5. ✅ Set environment variables
6. ✅ Run first manual backup
7. ✅ Run first weekly restore test
8. ✅ Configure cron jobs for automation
9. ✅ Schedule quarterly DR drill
10. ✅ Monitor backup success rate

**Estimated Time to Production:** 2-3 hours

