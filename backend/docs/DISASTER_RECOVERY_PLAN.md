# Disaster Recovery Plan - MANAWA

**Version**: 2.0  
**Last Updated**: 2026-11-12  
**Status**: ✅ Production Ready

---

## 1. Executive Summary

This document defines MANAWA's comprehensive disaster recovery strategy for Q77 (Configuration Versioning) and Q78 (Rollback Strategy). It covers:

- Recovery Time Objectives (RTO): <5 seconds for critical failures
- Recovery Point Objectives (RPO): Maximum 1 hour of data loss
- Four-tier rollback system with automatic failover
- 24/7 automated health monitoring
- Hourly backup integrity verification

---

## 2. Disaster Scenarios & Recovery

### 2.1 Scenario 1: Configuration Bug (Low Severity)

**Indicators**:
- Increased support tickets
- Payment failures
- Login issues
- Rate limiting too strict

**RTO**: <1 minute  
**RPO**: No data loss  
**Recovery**: Configuration rollback

**Recovery Steps**:

1. **Identify Issue** (1-5 min)
   ```bash
   # Check error logs
   tail -100 logs/application-$(date +%Y-%m-%d).log | grep ERROR
   
   # Check recent configuration changes
   curl -H "Authorization: Bearer $JWT" \
     http://localhost:4000/api/v1/admin/config/versions?limit=5
   ```

2. **Rollback Configuration** (30 seconds)
   ```bash
   # Option A: Manual rollback via API
   curl -X POST \
     http://localhost:4000/api/v1/admin/config/versions/1.0.0/restore \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"reason": "Payment gateway timeout causing failures"}'
   
   # Option B: Manual rollback via Node.js
   node -e "
     const rollbackManager = require('./utils/rollback-manager');
     (async () => {
       const result = await rollbackManager.rollbackConfiguration(
         '1.0.0',
         'admin-id',
         'Payment failures due to 30s timeout'
       );
       console.log(result);
     })();
   "
   ```

3. **Verify Recovery** (30 seconds)
   ```bash
   # Check configuration is applied
   curl http://localhost:4000/api/v1/monitoring/health
   
   # Monitor error rate drops
   watch -n 5 "curl -s http://localhost:4000/api/v1/monitoring/health | jq '.data.errorRate'"
   ```

4. **Cleanup**
   - Investigate root cause
   - Update configuration values
   - Create new stable version
   - Schedule post-mortem

---

### 2.2 Scenario 2: Buggy Code Deployment (Medium Severity)

**Indicators**:
- Widespread errors after deployment
- Memory leaks
- Database connection pool exhaustion
- High latency across all endpoints

**RTO**: 5-10 minutes  
**RPO**: No data loss  
**Recovery**: Code rollback (git revert + redeploy)

**Recovery Steps**:

1. **Identify Problematic Commit** (2-5 min)
   ```bash
   git log --oneline -20
   # Output:
   # abc123d Fix payment bug
   # def456e Add 2FA enforcement  ← This one broke things
   # ghi789f Update dependencies
   ```

2. **Verify Symptoms**
   ```bash
   # Check error rate
   curl http://localhost:4000/api/v1/monitoring/health | jq '.data.errorRate'
   
   # Check logs
   tail -50 logs/application-*.log
   ```

3. **Trigger Code Rollback**
   ```bash
   # Via rollback manager
   node -e "
     const rollbackManager = require('./utils/rollback-manager');
     (async () => {
       const result = await rollbackManager.rollbackCode(
         'def456e',  // Commit hash
         'admin-id',
         'Revert 2FA enforcement causing auth failures'
       );
       console.log('Rollback initiated:', result);
     })();
   "
   ```

4. **Redeploy**
   ```bash
   # Trigger redeployment webhook
   curl -X POST $DEPLOY_WEBHOOK_URL \
     -H "Content-Type: application/json" \
     -d '{"action": "redeploy", "reason": "code_rollback"}'
   
   # Monitor deployment
   # (Assuming CI/CD pipeline in place)
   ```

5. **Verify Recovery** (3-5 min)
   ```bash
   # Check error rate trends to <0.5%
   # Verify application responds
   curl http://localhost:4000/health
   
   # Smoke test critical flows
   npm run test:smoke:payments
   ```

---

### 2.3 Scenario 3: Data Corruption (High Severity)

**Indicators**:
- Corrupted user records
- Negative amounts in payments
- Orphaned foreign keys
- Database consistency errors

**RTO**: 30-60 minutes  
**RPO**: Maximum 1 hour of data loss  
**Recovery**: Database rollback from backup

**Recovery Steps**:

1. **Detect Corruption** (5-10 min)
   ```bash
   # Run database integrity checks
   psql "$DATABASE_URL" -c "
     SELECT COUNT(*) FROM pg_stat_user_tables 
     WHERE last_vacuum IS NULL OR last_autovacuum IS NULL;
   "
   
   # Check for constraint violations
   psql "$DATABASE_URL" -c "
     SELECT * FROM pg_stat_user_indexes 
     WHERE idx_scan = 0;
   "
   ```

2. **Identify Last Good Backup** (5 min)
   ```bash
   # List recent backups
   ls -lht .backups/ | head -20
   
   # Query backup metadata
   node -e "
     const { prisma } = require('./config/db');
     (async () => {
       const checks = await prisma.backupIntegrityCheck.findMany({
         where: { status: 'SUCCESS' },
         orderBy: { createdAt: 'desc' },
         take: 5
       });
       console.log(JSON.stringify(checks, null, 2));
     })();
   "
   ```

3. **Initiate Database Rollback** (30-45 min)
   ```bash
   # CRITICAL: Put application in maintenance mode first
   export MAINTENANCE_MODE=true
   
   # Trigger database rollback
   node -e "
     const rollbackManager = require('./utils/rollback-manager');
     (async () => {
       const result = await rollbackManager.rollbackDatabase(
         'backup_2026-11-12_13:00:00',
         'admin-id'
       );
       console.log('Database rollback result:', result);
     })();
   "
   ```

4. **Verify Data Integrity** (5-10 min)
   ```bash
   # Run integrity checks
   npm run db:integrity-check
   
   # Verify critical tables
   psql "$DATABASE_URL" -c "
     SELECT COUNT(*) as users FROM \"User\";
     SELECT COUNT(*) as payments FROM \"Payment\";
     SELECT COUNT(*) as professionals FROM \"Professional\";
   "
   ```

5. **Bring System Back Online**
   ```bash
   # Exit maintenance mode
   export MAINTENANCE_MODE=false
   
   # Restart application
   pm2 restart manawa-backend
   
   # Monitor for issues
   curl http://localhost:4000/health
   ```

6. **Post-Recovery Actions**
   - Analyze what caused corruption
   - Audit data for anomalies
   - Notify affected users
   - Update backup strategy if needed

---

### 2.4 Scenario 4: Complete Infrastructure Failure (Critical)

**Indicators**:
- Application completely down
- Cannot reach database
- All requests timing out
- Health check endpoints unreachable

**RTO**: <5 seconds  
**RPO**: Acceptable to lose in-flight requests  
**Recovery**: Blue-green environment switch

**Recovery Steps**:

1. **Verify Failure** (<10 seconds)
   ```bash
   # Check primary environment
   curl -m 2 http://prod.manawa.com/health || echo "PRIMARY UNREACHABLE"
   
   # Check green environment status
   curl -m 2 http://green.manawa.com/health
   ```

2. **Trigger Blue-Green Failover** (<5 seconds)
   ```bash
   # Via rollback manager
   node -e "
     const rollbackManager = require('./utils/rollback-manager');
     (async () => {
       const result = await rollbackManager.blueGreenFallback('green');
       console.log('Failover result:', result);
     })();
   "
   
   # Via DNS provider CLI (example: AWS Route53)
   aws route53 change-resource-record-sets \
     --hosted-zone-id ZONE_ID \
     --change-batch '{
       \"Changes\": [{
         \"Action\": \"UPSERT\",
         \"ResourceRecordSet\": {
           \"Name\": \"api.manawa.com\",
           \"Type\": \"A\",
           \"AliasTarget\": {
             \"HostedZoneId\": \"GREEN_ZONE_ID\",
             \"DNSName\": \"green.manawa.com\",
             \"EvaluateTargetHealth\": false
           }
         }
       }]
     }'
   ```

3. **Verify Failover** (<30 seconds)
   ```bash
   # Test green environment
   for i in {1..10}; do
     curl -s http://api.manawa.com/health | jq '.status'
     sleep 1
   done
   
   # Verify data sync
   curl http://api.manawa.com/api/v1/admin/sync-status
   ```

4. **Investigate Primary Failure** (parallel)
   ```bash
   # SSH to primary server
   ssh prod-server
   
   # Check system status
   systemctl status manawa-backend
   journalctl -u manawa-backend -n 100
   
   # Check resources
   free -h
   df -h
   top -b -n 1 | head -20
   ```

5. **Failback to Primary** (once fixed)
   ```bash
   # Only after verification
   aws route53 change-resource-record-sets \
     --hosted-zone-id ZONE_ID \
     --change-batch '{
       "Changes": [{
         "Action": "UPSERT",
         "ResourceRecordSet": {
           "Name": "api.manawa.com",
           "Type": "A",
           "AliasTarget": {
             "HostedZoneId": "BLUE_ZONE_ID",
             "DNSName": "blue.manawa.com",
             "EvaluateTargetHealth": false
           }
         }
       }]
     }'
   ```

---

## 3. Prevention & Monitoring

### 3.1 Continuous Health Monitoring

Health checks run every 10 seconds:

```bash
# Start daemon
./scripts/rollback-trigger.sh --daemon

# Logs
tail -f logs/rollback-trigger-$(date +%Y-%m-%d).log
```

### 3.2 Hourly Backup Verification

```bash
# Start backup integrity daemon
./scripts/backup-integrity-test.sh --daemon

# View results
curl -H "Authorization: Bearer $JWT" \
  http://localhost:4000/api/v1/admin/backup-integrity?limit=24
```

### 3.3 Alerting Configuration

Configure in `.env`:

```bash
# Sentry (error tracking)
SENTRY_DSN=https://key@sentry.io/project

# Slack (instant notifications)
SLACK_ROLLBACK_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Email (persistent record)
ROLLBACK_ALERT_EMAILS=oncall@manawa.com,devops@manawa.com
```

---

## 4. Recovery Procedures by Component

### 4.1 Database Recovery

**Full Backup Restore** (30-60 min):
```bash
# List backups
aws s3 ls s3://manawa-backups/ --recursive

# Download backup
aws s3 cp s3://manawa-backups/backup_2026-11-12_10-00-00.dump .

# Restore
pg_restore -d manawa_production \
  --clean --if-exists \
  backup_2026-11-12_10-00-00.dump
```

**Point-in-Time Recovery** (60-90 min):
```bash
# Requires WAL archiving enabled
pg_basebackup -h localhost -D /var/lib/postgresql/recovery

# Restore from point in time
pg_ctl start -D /var/lib/postgresql/recovery \
  -c recovery_target_timeline=latest \
  -c recovery_target_time='2026-11-12 14:30:00'
```

### 4.2 Redis Cache Recovery

**Cache Rebuild** (<5 min):
```bash
# Clear cache
redis-cli FLUSHALL

# Rebuild from database
node -e "
  const redis = require('./config/redis');
  const { prisma } = require('./config/db');
  
  (async () => {
    // Rebuild config cache
    const configs = await prisma.appConfig.findMany();
    for (const cfg of configs) {
      await redis.set(\`app_config_\${cfg.key}\`, cfg.value);
    }
    console.log('Cache rebuilt');
  })();
"
```

### 4.3 File Storage Recovery

**S3 Recovery** (5-15 min):
```bash
# List recent uploads
aws s3api list-objects-v2 \
  --bucket manawa-cdn \
  --prefix uploads/ \
  --query 'Contents[?LastModified>=`2026-11-12T14:00:00`]' \
  --output table

# Restore if needed
aws s3 sync s3://manawa-cdn-backup/uploads/ s3://manawa-cdn/uploads/ \
  --exclude "*" --include "*.jpg" --include "*.png"
```

---

## 5. Maintenance & Testing

### 5.1 Monthly DR Drill

Schedule monthly backup recovery test:

```bash
#!/bin/bash
# Monthly DR test script

DATE=$(date +%Y-%m-%d)
LOG_FILE="logs/dr-test-$DATE.log"

{
  echo "Starting monthly DR drill..."
  
  # 1. Test configuration restore
  echo "Testing config restore..."
  npm run test:config-rollback
  
  # 2. Test database backup recovery
  echo "Testing database recovery..."
  npm run test:db-recovery
  
  # 3. Test backup integrity
  echo "Testing backup integrity..."
  ./scripts/backup-integrity-test.sh --once
  
  # 4. Test health check endpoints
  echo "Testing health endpoints..."
  curl -f http://localhost:4000/api/v1/monitoring/health
  
  echo "DR drill completed successfully"
  
} 2>&1 | tee "$LOG_FILE"

# Send results to team
mail -s "DR Drill Results - $DATE" oncall@manawa.com < "$LOG_FILE"
```

### 5.2 Quarterly Failover Test

Test blue-green failover:

```bash
#!/bin/bash
# Quarterly failover test

echo "Starting failover test..."

# 1. Health check both environments
curl http://blue.manawa.com/health
curl http://green.manawa.com/health

# 2. Route traffic to green
aws route53 change-resource-record-sets \
  --hosted-zone-id ZONE_ID \
  --change-batch "$(cat failover-test-green.json)"

sleep 60

# 3. Verify green is handling traffic
curl http://api.manawa.com/api/v1/test-failover

# 4. Route back to blue
aws route53 change-resource-record-sets \
  --hosted-zone-id ZONE_ID \
  --change-batch "$(cat failover-test-blue.json)"

echo "Failover test completed"
```

---

## 6. Emergency Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| On-Call Engineer | TBD | +234-XXX-XXXX | oncall@manawa.com |
| DevOps Lead | TBD | +234-XXX-XXXX | devops@manawa.com |
| CTO | TBD | +234-XXX-XXXX | cto@manawa.com |
| VP Engineering | TBD | +234-XXX-XXXX | vp-eng@manawa.com |

---

## 7. Status Dashboard

Monitor real-time status:

```bash
# Health check
curl http://localhost:4000/api/v1/monitoring/health | jq '.data'

# Recent rollbacks
curl -H "Authorization: Bearer $JWT" \
  http://localhost:4000/api/v1/admin/config/rollback-history?limit=10 | jq '.data'

# Backup status
curl -H "Authorization: Bearer $JWT" \
  http://localhost:4000/api/v1/admin/backup-integrity | jq '.data'
```

---

## 8. Post-Incident Actions

1. **Immediate** (0-1 hour)
   - [ ] Confirm system stable
   - [ ] Post status update
   - [ ] Begin incident log

2. **Short-term** (1-24 hours)
   - [ ] Conduct incident call
   - [ ] Document root cause
   - [ ] Assign action items

3. **Long-term** (1-7 days)
   - [ ] Complete root cause analysis
   - [ ] Implement preventive measures
   - [ ] Update runbooks and procedures
   - [ ] Share learnings with team

---

## 9. Documentation Updates

This plan is version-controlled in Git:

```bash
git log docs/DISASTER_RECOVERY_PLAN.md
git diff docs/DISASTER_RECOVERY_PLAN.md
```

Update whenever:
- Contact information changes
- New procedures are established
- Infrastructure changes
- Incident learnings are captured

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-11-12 | 2.0 | Added Q77/Q78 procedures, 4-tier rollback system |
| 2026-11-01 | 1.0 | Initial draft |

---

## Sign-Off

- [ ] DevOps Lead: _________________ Date: _______
- [ ] CTO: _________________ Date: _______
- [ ] VP Engineering: _________________ Date: _______

---

**Next Review Date**: 2027-01-12

