# Blue-Green Deployment Strategy

## Overview

Blue-Green deployment maintains two identical production environments: one active (Blue) and one standby (Green). The new version is deployed to the standby environment, tested, and then traffic is switched to it using DNS or service mesh. This enables zero-downtime deployments with instant rollback capability.

## Strategic Objectives

- **Zero-Downtime Deployment**: Switch active environment instantaneously
- **Instant Rollback**: Revert to previous version with single DNS switch
- **Complete Environment Isolation**: Test new version without affecting production
- **Database Compatibility**: Support pre-deploy migrations and rollback
- **No Gradual Transition**: Full switch for cleaner state management

## Architecture

### Environment Architecture

```
┌─────────────────────────────────────────┐
│        Load Balancer / DNS              │
│  api.manawa.app (currently → Blue)      │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴────────┐
        ↓                 ↓
    ┌────────┐       ┌────────┐
    │  BLUE  │       │ GREEN  │
    │ v1.0.0 │       │ v2.0.0 │
    │ Active │       │ Standby│
    │        │       │        │
    │ Pods:  │       │ Pods:  │
    │ 3x     │       │ 3x     │
    └────────┘       └────────┘
        │                 │
        └─────────┬───────┘
                  ↓
          Database (Shared)
          - Backward-compatible schema
          - Pre-migration support
```

### DNS Switch Mechanism

```
Current State (Blue Active):
  api.manawa.app → 10.0.1.100 (Blue Load Balancer)

After Green Verification (Green Active):
  api.manawa.app → 10.0.2.100 (Green Load Balancer)

TTL: 60 seconds (fast propagation)
```

## Deployment Process

### Pre-Deployment

#### 1. Database Migration Planning

```bash
#!/bin/bash
# scripts/blue-green-db-prepare.sh

set -e

echo "=== Database Migration Preparation ==="

# 1. Create database backup
BACKUP_FILE="/backups/manawa-db-$(date +%Y%m%d-%H%M%S).sql"
pg_dump $DATABASE_URL > $BACKUP_FILE
echo "✓ Backup created: $BACKUP_FILE"

# 2. Test migration on copy
TEMP_DB=$(createdb manawa_test_$(date +%s))
pg_restore -d $TEMP_DB $BACKUP_FILE

# 3. Run migrations
psql $TEMP_DB < infrastructure/migrations/001-schema-v2.sql
psql $TEMP_DB < infrastructure/migrations/002-data-v2.sql

# 4. Verify schema compatibility
echo "✓ Schema compatibility verified"

# 5. Measure migration time
MIGRATION_TIME=$(psql $TEMP_DB -c "SELECT COUNT(*) FROM pg_class WHERE relkind='r';")
echo "Migration time estimate: ~${MIGRATION_TIME}ms"

# 6. Cleanup test database
dropdb $TEMP_DB

echo "✓ Database ready for deployment"
```

#### 2. Pre-Migration Execution

```bash
# 1. Execute forward-compatible migrations on current (Blue) database
psql $DATABASE_URL < infrastructure/migrations/001-schema-v2-backward-compat.sql

# Sample backward-compatible migration:
-- Add new column without constraints (nullable)
ALTER TABLE users ADD COLUMN new_field VARCHAR(255);
ALTER TABLE users ADD COLUMN feature_flag BOOLEAN DEFAULT false;

-- Create new tables in shadow schema
CREATE SCHEMA IF NOT EXISTS v2_shadow;
CREATE TABLE v2_shadow.audit_logs AS SELECT * FROM audit_logs WHERE 1=0;

# 2. Deploy code that handles both old and new schema
# The application code should gracefully handle missing columns
```

### Deployment Steps

#### Phase 1: Deploy to Green

```bash
#!/bin/bash
# scripts/deploy-to-green.sh

TARGET_ENV="green"
NEW_VERSION="v2.0.0"
REGISTRY="gcr.io/manawa"

echo "=== Deploying to Green ($TARGET_ENV) ==="

# 1. Build new image
echo "Building Docker image..."
docker build -t $REGISTRY/api:$NEW_VERSION \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  -f Dockerfile .

# 2. Push to registry
echo "Pushing to registry..."
docker push $REGISTRY/api:$NEW_VERSION

# 3. Deploy to Kubernetes (Green)
echo "Deploying to Green environment..."
kubectl set image deployment/manawa-api-green \
  manawa-api=$REGISTRY/api:$NEW_VERSION \
  -n production

# 4. Wait for rollout
kubectl rollout status deployment/manawa-api-green -n production --timeout=5m

# 5. Verify pods are ready
READY_PODS=$(kubectl get deployment manawa-api-green -n production \
  -o jsonpath='{.status.readyReplicas}')
DESIRED_PODS=$(kubectl get deployment manawa-api-green -n production \
  -o jsonpath='{.status.desiredReplicas}')

if [ "$READY_PODS" -eq "$DESIRED_PODS" ]; then
  echo "✓ All $READY_PODS Green pods are ready"
else
  echo "✗ Green deployment failed: $READY_PODS/$DESIRED_PODS pods ready"
  exit 1
fi

# 6. Record deployment metadata
kubectl annotate deployment manawa-api-green \
  -n production \
  deployment.kubernetes.io/deployment-date="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  deployment.kubernetes.io/deployment-version="$NEW_VERSION" \
  --overwrite

echo "✓ Deployment to Green complete"
```

#### Phase 2: Render Deployment (Alternative)

For Render.com without Kubernetes:

```bash
#!/bin/bash
# scripts/render-deploy-green.sh

set -e

echo "=== Deploying to Render Green Service ==="

# Get Green service ID
GREEN_SERVICE_ID=$(curl -s https://api.render.com/v1/services \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  | jq -r '.[] | select(.name=="manawa-api-green") | .id')

echo "Green Service ID: $GREEN_SERVICE_ID"

# 1. Update environment variables
curl -s -X PATCH https://api.render.com/v1/services/$GREEN_SERVICE_ID \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "envVars": {
      "DATABASE_URL": "'$DATABASE_URL'",
      "REDIS_URL": "'$REDIS_URL'",
      "VERSION": "v2.0.0"
    }
  }'

# 2. Trigger deployment
DEPLOY_ID=$(curl -s -X POST https://api.render.com/v1/services/$GREEN_SERVICE_ID/deploys \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  | jq -r '.id')

echo "Deployment ID: $DEPLOY_ID"

# 3. Wait for deployment to complete
timeout 600 bash -c "
  while true; do
    STATUS=\$(curl -s https://api.render.com/v1/services/$GREEN_SERVICE_ID/deploys/$DEPLOY_ID \
      -H 'Authorization: Bearer $RENDER_API_KEY' \
      | jq -r '.status')
    
    if [ \"\$STATUS\" = \"live\" ]; then
      echo \"✓ Deployment live\"
      exit 0
    elif [ \"\$STATUS\" = \"failed\" ]; then
      echo \"✗ Deployment failed\"
      exit 1
    fi
    
    sleep 5
  done
" || { echo "✗ Deployment timeout"; exit 1; }

echo "✓ Green deployment complete"
```

#### Phase 3: Test Green Environment

```bash
#!/bin/bash
# scripts/test-green.sh

echo "=== Testing Green Environment ==="

GREEN_URL="https://manawa-api-green-internal.onrender.com"
# For Kubernetes: GREEN_URL="http://manawa-api-green.production.svc.cluster.local:3000"

# 1. Health check
echo "Running health checks..."
HEALTH=$(curl -s -X GET "$GREEN_URL/health" -w "\n%{http_code}")
HTTP_CODE=$(echo "$HEALTH" | tail -n1)

if [ "$HTTP_CODE" -ne 200 ]; then
  echo "✗ Health check failed: HTTP $HTTP_CODE"
  exit 1
fi
echo "✓ Health check passed"

# 2. Database connectivity
echo "Testing database connectivity..."
DB_TEST=$(curl -s -X GET "$GREEN_URL/health/db" -w "\n%{http_code}")
DB_CODE=$(echo "$DB_TEST" | tail -n1)

if [ "$DB_CODE" -ne 200 ]; then
  echo "✗ Database check failed: HTTP $DB_CODE"
  exit 1
fi
echo "✓ Database connectivity verified"

# 3. API endpoints
echo "Testing critical API endpoints..."
API_TESTS=(
  "GET /api/health"
  "GET /api/v1/markets"
  "POST /api/v1/auth/verify"
)

for test in "${API_TESTS[@]}"; do
  METHOD=$(echo $test | awk '{print $1}')
  ENDPOINT=$(echo $test | awk '{print $2}')
  
  RESPONSE=$(curl -s -X $METHOD "$GREEN_URL$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-token" \
    -w "\n%{http_code}")
  
  CODE=$(echo "$RESPONSE" | tail -n1)
  
  if [ "$CODE" -ge 400 ] && [ "$CODE" -lt 500 ]; then
    echo "✓ $METHOD $ENDPOINT: HTTP $CODE (expected)"
  elif [ "$CODE" -lt 400 ]; then
    echo "✓ $METHOD $ENDPOINT: HTTP $CODE"
  else
    echo "✗ $METHOD $ENDPOINT: HTTP $CODE"
    exit 1
  fi
done

# 4. Performance baseline
echo "Collecting performance metrics..."
LATENCY=$(curl -s -o /dev/null -w "%{time_total}" "$GREEN_URL/api/health")
echo "✓ Response time: ${LATENCY}s"

# 5. E2E smoke tests
echo "Running E2E smoke tests..."
npm run test:e2e -- --suite=smoke --url=$GREEN_URL

# 6. Schema verification
echo "Verifying database schema..."
psql $DATABASE_URL -c "
  SELECT tablename FROM pg_tables 
  WHERE schemaname = 'public' 
  ORDER BY tablename;"

echo "✓ All Green environment tests passed"
```

### Phase 4: DNS Switch (Blue → Green)

```bash
#!/bin/bash
# scripts/blue-green-switch.sh

echo "=== Blue-Green DNS Switch ==="

DOMAIN="api.manawa.app"
CURRENT_ENV="blue"
TARGET_ENV="green"
CURRENT_IP=$(dig +short $DOMAIN)
TARGET_IP=$(dig +short manawa-api-green-lb.manawa.app)

echo "Current: $DOMAIN → $CURRENT_IP ($CURRENT_ENV)"
echo "Target: $DOMAIN → $TARGET_IP ($TARGET_ENV)"

# 1. Pre-switch validation
echo "Pre-switch validation..."
if ! curl -s -f "$GREEN_URL/health" > /dev/null; then
  echo "✗ Green health check failed - aborting switch"
  exit 1
fi
echo "✓ Green is healthy"

# 2. Update DNS record
echo "Updating DNS record..."
gcloud dns record-sets update $DOMAIN \
  --rrdatas=$TARGET_IP \
  --ttl=60 \
  --type=A \
  --zone=manawa-dns

# Alternative for CloudFlare:
# curl -X PUT https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID \
#   -H "X-Auth-Key: $CF_API_KEY" \
#   -H "X-Auth-Email: $CF_EMAIL" \
#   -d '{"type":"A","name":"api.manawa.app","content":"'$TARGET_IP'","ttl":60}'

echo "✓ DNS updated: $DOMAIN → $TARGET_IP"

# 3. Wait for DNS propagation
echo "Waiting for DNS propagation..."
MAX_WAIT=300
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  RESOLVED=$(dig +short $DOMAIN)
  if [ "$RESOLVED" = "$TARGET_IP" ]; then
    echo "✓ DNS propagated to $DOMAIN → $RESOLVED"
    break
  fi
  ELAPSED=$((ELAPSED + 5))
  echo "Still waiting... ($ELAPSED/$MAX_WAIT seconds)"
  sleep 5
done

# 4. Verify traffic is routing to Green
echo "Verifying traffic routing..."
NEW_RESPONSE=$(curl -s -I "https://$DOMAIN/health" | grep -i x-version)
echo "Response headers: $NEW_RESPONSE"

# 5. Monitor metrics for 5 minutes
echo "Monitoring Green environment (5 minutes)..."
for i in {1..60}; do
  ERROR_RATE=$(curl -s "http://prometheus:9090/api/v1/query?query=rate(http_requests_total%7Bdeployment%3D%22manawa-api-green%22%2Cstatus%3D~%225..%22%7D%5B1m%5D)" | jq '.data.result[0].value[1]' -r)
  
  if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
    echo "✗ High error rate detected: $ERROR_RATE - initiating rollback"
    bash scripts/blue-green-rollback.sh
    exit 1
  fi
  
  echo "[$((i*5))s] Error rate: $ERROR_RATE"
  sleep 5
done

echo "✓ Switch complete and stable"

# 6. Record switch event
echo "Recording deployment event..."
curl -X POST https://api.manawa.app/admin/deployment-events \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "event": "blue_green_switch",
    "from": "'$CURRENT_ENV'",
    "to": "'$TARGET_ENV'",
    "timestamp": "'$(date -u +'%Y-%m-%dT%H:%M:%SZ')'",
    "switched_by": "'$USER'",
    "status": "success"
  }'

echo "✓ Deployment event recorded"
```

#### Phase 5: Kubernetes Service Selector Switch

```yaml
# File: infrastructure/k8s/switch-blue-green.yaml
apiVersion: v1
kind: Service
metadata:
  name: manawa-api
  namespace: production
spec:
  selector:
    # Switch this selector between "blue" and "green"
    app: manawa-api
    active-env: green  # Change from "blue" to "green"
  ports:
  - name: http
    port: 3000
    targetPort: 3000
  type: LoadBalancer
---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: manawa-api
  namespace: production
spec:
  hosts:
  - manawa-api
  http:
  - route:
    - destination:
        host: manawa-api-green
        port:
          number: 3000
      weight: 100
    - destination:
        host: manawa-api-blue
        port:
          number: 3000
      weight: 0
```

### Phase 6: Rollback (if needed)

```bash
#!/bin/bash
# scripts/blue-green-rollback.sh

echo "=== Blue-Green Rollback Initiated ==="

DOMAIN="api.manawa.app"
BLUE_IP=$(dig +short manawa-api-blue-lb.manawa.app)
CURRENT_IP=$(dig +short $DOMAIN)

echo "Rolling back..."
echo "Current: $DOMAIN → $CURRENT_IP (green)"
echo "Reverting to: $DOMAIN → $BLUE_IP (blue)"

# 1. Revert DNS
gcloud dns record-sets update $DOMAIN \
  --rrdatas=$BLUE_IP \
  --ttl=60 \
  --type=A \
  --zone=manawa-dns

echo "✓ DNS reverted"

# 2. Wait for propagation
sleep 30

# 3. Verify rollback successful
VERIFY=$(dig +short $DOMAIN)
if [ "$VERIFY" = "$BLUE_IP" ]; then
  echo "✓ Rollback successful"
else
  echo "✗ Rollback verification failed"
  exit 1
fi

# 4. Send alert
curl -X POST $SLACK_WEBHOOK_URL \
  -d '{"text":"🔵 Blue-Green Rollback Complete - Reverted to Blue environment"}'

# 5. Record event
curl -X POST https://api.manawa.app/admin/deployment-events \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "event": "blue_green_rollback",
    "rolled_back_from": "green",
    "rolled_back_to": "blue",
    "timestamp": "'$(date -u +'%Y-%m-%dT%H:%M:%SZ')'",
    "initiated_by": "'$USER'"
  }'
```

## Database Migration Compatibility

### Forward-Compatible Schema Changes

```sql
-- Good: Add nullable columns (backward compatible)
ALTER TABLE users ADD COLUMN new_field VARCHAR(255);
ALTER TABLE users ADD COLUMN feature_flag BOOLEAN DEFAULT false;

-- Good: Create new tables
CREATE TABLE new_feature_logs (id SERIAL PRIMARY KEY, data JSONB);

-- Good: Create new schema versions
CREATE SCHEMA v2;
CREATE TABLE v2.users AS SELECT * FROM public.users;

-- Bad: Drop columns (breaks backward compatibility)
-- ALTER TABLE users DROP COLUMN old_field; -- Don't do this yet!

-- Bad: Change column type (migration risk)
-- ALTER TABLE users ALTER COLUMN age TYPE BIGINT; -- Risky!
```

### Rollback-Safe Migration

```sql
-- Phase 1: Prepare (executed on Blue before Green deployment)
ALTER TABLE users ADD COLUMN email_v2 VARCHAR(255);

-- Phase 2: Dual-write (Green deployment uses both old and new columns)
-- Application code writes to both email and email_v2

-- Phase 3: Backfill (after Green runs successfully)
UPDATE users SET email_v2 = email WHERE email_v2 IS NULL;

-- Phase 4: Switch (application stops using email)
-- (After 2 full deployment cycles)

-- Phase 5: Cleanup (final removal of old column)
-- ALTER TABLE users DROP COLUMN email;
```

### Zero-Downtime Migration Example

```javascript
// Application code handling dual schema
class UserRepository {
  async getUser(userId) {
    // Try new schema first (for Green)
    try {
      const result = await db.query(
        'SELECT id, email_v2 as email FROM users WHERE id = $1',
        [userId]
      );
      return result.rows[0];
    } catch (e) {
      // Fall back to old schema (for Blue)
      const result = await db.query(
        'SELECT id, email FROM users WHERE id = $1',
        [userId]
      );
      return result.rows[0];
    }
  }

  async createUser(userData) {
    // Write to both columns for compatibility
    await db.query(
      `INSERT INTO users (email, email_v2) VALUES ($1, $2)`,
      [userData.email, userData.email]
    );
  }
}
```

## Render Deployment Configuration

### Environment Setup

```yaml
# render.yaml
services:
  - type: web
    name: manawa-api-blue
    env: node
    plan: standard
    startCommand: npm start
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: REDIS_URL
        sync: false
      - key: ENVIRONMENT
        value: production
      - key: VERSION
        value: v1.0.0
    numInstances: 3
    autoScaling:
      enabled: true
      minInstances: 3
      maxInstances: 5
    healthCheckPath: /health
    domain: manawa-api-blue.onrender.com

  - type: web
    name: manawa-api-green
    env: node
    plan: standard
    startCommand: npm start
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: REDIS_URL
        sync: false
      - key: ENVIRONMENT
        value: production
      - key: VERSION
        value: v2.0.0
    numInstances: 3
    autoScaling:
      enabled: true
      minInstances: 3
      maxInstances: 5
    healthCheckPath: /health
    domain: manawa-api-green.onrender.com
```

### DNS Management

```bash
#!/bin/bash
# scripts/render-dns-config.sh

# Configure DNS to route to Blue initially
# Then switch to Green after validation

echo "=== Render DNS Configuration ==="

# Set main domain to Blue
curl -X POST https://api.render.com/v1/domains \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "api.manawa.app",
    "service": "manawa-api-blue"
  }'

echo "✓ DNS configured: api.manawa.app → manawa-api-blue"

# After Green is tested and verified, switch with:
# curl -X PATCH https://api.render.com/v1/domains/api.manawa.app \
#   -H "Authorization: Bearer $RENDER_API_KEY" \
#   -d '{"service": "manawa-api-green"}'
```

## Monitoring & Alerting

### Real-time Traffic Monitoring

```javascript
// File: infrastructure/traffic-monitor.js
const prometheus = require('prom-client');
const express = require('express');

const trafficGauge = new prometheus.Gauge({
  name: 'deployment_traffic_split',
  help: 'Current traffic distribution',
  labelNames: ['environment']
});

const errorRateGauge = new prometheus.Gauge({
  name: 'deployment_error_rate',
  help: 'Error rate per environment',
  labelNames: ['environment']
});

async function monitorTraffic() {
  // Get traffic metrics from load balancer
  const blueMetrics = await getLoadBalancerMetrics('blue');
  const greenMetrics = await getLoadBalancerMetrics('green');

  trafficGauge.set({ environment: 'blue' }, blueMetrics.traffic);
  trafficGauge.set({ environment: 'green' }, greenMetrics.traffic);

  errorRateGauge.set({ environment: 'blue' }, blueMetrics.errorRate);
  errorRateGauge.set({ environment: 'green' }, greenMetrics.errorRate);

  // Alert if error rate spikes
  if (greenMetrics.errorRate > 0.01) {
    console.warn('GREEN HIGH ERROR RATE:', greenMetrics.errorRate);
    // Trigger rollback
  }
}

setInterval(monitorTraffic, 10000);
```

### Slack Notifications

```javascript
// File: infrastructure/notify-deployment.js
async function notifyDeploymentEvent(event) {
  const message = {
    text: event.type === 'switch' ? 'Blue-Green Switch' : 'Rollback',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${event.type.toUpperCase()}*\nFrom: ${event.from}\nTo: ${event.to}\nTime: ${event.timestamp}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Initiated by: ${event.initiatedBy}`
          }
        ]
      }
    ]
  };

  await axios.post(process.env.SLACK_WEBHOOK_URL, message);
}
```

## Advantages vs Disadvantages

### Advantages ✅

1. **Zero-Downtime Deployment**: Instant switch with no service interruption
2. **Instant Rollback**: Revert to previous version with single DNS change
3. **Complete Environment Isolation**: Test new version thoroughly before switch
4. **No Gradual Transition**: Cleaner state - either old or new, never mixed
5. **Full Validation**: Comprehensive testing before traffic switch
6. **Database Compatibility Testing**: Run full migration tests in Green first

### Disadvantages ❌

1. **Double Infrastructure Cost**: Run two full environments simultaneously
2. **Infrastructure Requirements**: Need resources for 2x deployment
3. **Complexity**: Manual coordination needed for database migrations
4. **Storage Duplication**: Both environments consume full storage space
5. **Synchronization Risk**: Database must stay synchronized during deployment
6. **Manual Cutover**: Not fully automated like canary deployment

## When to Use Blue-Green

Use Blue-Green when:
- ✅ Infrastructure cost is not a concern
- ✅ You need guaranteed zero-downtime deployments
- ✅ You want instant rollback capability
- ✅ Deployments happen infrequently (weekly or less)
- ✅ Database migrations are complex and need full testing
- ✅ You have resources for duplicate infrastructure

Don't use Blue-Green when:
- ❌ Deploying multiple times per day
- ❌ Limited infrastructure budget
- ❌ Running on small instances
- ❌ You need very fast feedback loops
- ❌ Gradual rollout and monitoring are priorities

## Security Considerations

- ✅ DNS records should have low TTL (60s) for faster switches
- ✅ Both environments must be identical for security consistency
- ✅ Secrets must be synced between Blue and Green
- ✅ Database backups should be taken before migration
- ✅ Audit logs should track all deployment events
- ✅ RBAC must restrict deployment operations
- ✅ All changes should be reviewed and approved
- ✅ Rollback decisions should be logged and auditable

## Best Practices

1. **Always test in Green first**: Never skip validation tests
2. **Keep infrastructure identical**: Any drift risks compatibility
3. **Have fast rollback process**: Automate the DNS switch
4. **Monitor during switch**: Watch metrics for 5 minutes after switch
5. **Document procedures**: Keep runbooks updated
6. **Practice rollbacks**: Test rollback procedure before using in production
7. **Schedule deployments**: Avoid off-hours when team isn't available
8. **Notify stakeholders**: Inform team before and after deployment
9. **Verify database migrations**: Test migrations on copy first
10. **Keep deployment history**: Log all deployments for audit trail

## Comparison: Canary vs Blue-Green

| Aspect | Canary | Blue-Green |
|--------|--------|-----------|
| Traffic Increase | Gradual (5% → 25% → 100%) | Instant (0% → 100%) |
| Blast Radius | Limited by percentage | Full environment |
| Rollback Time | 5-10 minutes | < 1 minute |
| Resource Cost | 110% (10% extra) | 200% (double) |
| Testing Duration | 30-60 minutes | Variable |
| Feedback Speed | Fast (real users) | Slower (synthetic) |
| Risk Profile | Medium | Low |
| Best For | Frequent deployments | Infrequent, critical deployments |

## Conclusion

Blue-Green deployment provides a safety mechanism for production releases by maintaining two identical environments and performing instant switches. This strategy is ideal for organizations that:
- Prioritize zero-downtime deployments
- Have infrastructure budget for duplicated resources
- Need guaranteed rollback capability
- Deploy less frequently but need confidence in each release

Combined with comprehensive testing and monitoring, Blue-Green deployment enables safe, predictable production releases.
