# Canary Deployment Strategy

## Overview

Canary deployment is a release strategy that gradually introduces new application versions to a subset of users before rolling out to the entire infrastructure. This minimizes risk by detecting issues early and enabling automatic rollback if problems occur.

## Strategic Objectives

- **Gradual Risk Mitigation**: Route only a small percentage of traffic to new version initially
- **Early Problem Detection**: Identify issues with limited blast radius
- **Automatic Rollback**: Revert to stable version if key metrics degrade
- **Progressive Confidence**: Incrementally increase traffic as confidence grows
- **Zero Downtime**: Maintain service availability throughout deployment

## Architecture Components

### 1. Load Balancing Layer

```
Ingress/LoadBalancer
    ↓
├── Canary (5% traffic)  → Pod V2 (new version)
├── Stable (95% traffic) → Pod V1 (current version)
```

**Traffic Distribution**:
- Phase 1: 5% canary, 95% stable
- Phase 2: 25% canary, 75% stable
- Phase 3: 100% canary (no stable)

### 2. Monitoring & Metrics

**Key Performance Indicators (KPIs)**:
- Error Rate: Threshold 1% (5-minute window)
- Latency P95: Threshold +20% vs baseline
- Memory Usage: Threshold 500MB per pod
- CPU Usage: Threshold 80% per pod
- HTTP 5xx Errors: Threshold 5 per minute
- Request Latency P99: Threshold +30% vs baseline

**Metrics Collection Sources**:
- Prometheus for infrastructure metrics
- Application logs via ELK/Splunk
- Custom instrumentation (Pino logger)
- Sentry for error tracking
- New Relic or DataDog for APM

### 3. Flagger Configuration (Kubernetes)

Flagger is an automated canary release orchestration tool for Kubernetes.

#### Prerequisites

```bash
# Install Flagger with Istio provider
helm repo add flagger https://flagger.app
helm install flagger flagger/flagger \
  --namespace istio-system \
  --set crd.create=true \
  --set slack.webhookUrl=https://hooks.slack.com/services/YOUR/WEBHOOK \
  --set slack.botName="Flagger"

# Install Prometheus for metrics collection
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --set prometheus.prometheusSpec.remoteWrite[0].url="http://remote-storage:9009/api/v1/push"
```

#### Canary Resource Definition

```yaml
# File: infrastructure/k8s/canary-config.yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: manawa-api-canary
  namespace: production
spec:
  # Target Deployment
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: manawa-api
  
  # Canary Configuration
  progressDeadlineSeconds: 300
  
  # Service Mesh Provider
  provider: istio
  
  # Automated Promotion Settings
  skipAnalysis: false
  suspend: false
  
  # Traffic Management
  service:
    port: 3000
    targetPort: 3000
  
  # Canary Strategy
  analysis:
    # Interval between checks (seconds)
    interval: 1m
    
    # Threshold for successful checks (percentage)
    threshold: 10
    
    # Maximum weight for canary (percentage)
    maxWeight: 50
    
    # Weight increment per check (percentage)
    stepWeight: 5
    
    # Metrics-based analysis
    metrics:
    - name: request-success-rate
      thresholdRange:
        min: 99
      interval: 1m
    
    - name: request-duration
      thresholdRange:
        max: 500  # milliseconds
      interval: 1m
    
    - name: error-rate
      thresholdRange:
        max: 1
      interval: 5m
    
    # Webhook-based validation
    webhooks:
    - name: load-testing
      url: http://flagger-loadtester:80/
      timeout: 30s
      metadata:
        type: smoke
        cmd: "curl -s http://manawa-api-canary:3000/health"
    
    - name: acceptance-test
      url: http://flagger-loadtester:80/
      timeout: 30s
      metadata:
        type: acceptance
        cmd: "bash -c 'curl -s http://manawa-api-canary:3000/health | grep -q alive'"
    
    # Alert notifications
    alerts:
    - name: canary-errors-high
      severity: error
      provider: slack
      message: "Canary: High error rate detected"
    
    - name: canary-latency-high
      severity: warning
      provider: slack
      message: "Canary: High latency detected"

  # Rollback triggers
  skipAnalysis: false
  suspend: false
```

#### VirtualService for Traffic Management

```yaml
# File: infrastructure/k8s/virtualservice-canary.yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: manawa-api
  namespace: production
spec:
  hosts:
  - manawa-api
  http:
  # Route for canary (managed by Flagger)
  - match:
    - headers:
        x-canary-version:
          exact: "true"
    route:
    - destination:
        host: manawa-api-canary
        port:
          number: 3000
    timeout: 10s
    retries:
      attempts: 3
      perTryTimeout: 2s
  
  # Default route to stable
  - route:
    - destination:
        host: manawa-api-stable
        port:
          number: 3000
        subset: stable
      weight: 95
    - destination:
        host: manawa-api-canary
        port:
          number: 3000
        subset: canary
      weight: 5
    timeout: 10s
    corsPolicy:
      allowOrigins:
      - exact: "https://manawa.app"
      allowMethods:
      - POST
      - GET
      - PUT
      - DELETE
      - OPTIONS
      allowHeaders:
      - authorization
      - content-type
      maxAge: "24h"

  # Destination Rules for subsets
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: manawa-api
  namespace: production
spec:
  host: manawa-api
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 1000
      http:
        http1MaxPendingRequests: 1000
        maxRequestsPerConnection: 2
        h2UpgradePolicy: UPGRADE
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
      splitExternalLocalOriginErrors: true
  subsets:
  - name: stable
    labels:
      version: stable
  - name: canary
    labels:
      version: canary
```

## Deployment Phases

### Phase 0: Preparation

```bash
# 1. Build and test new version
docker build -t manawa-api:v2.0.0 .
docker push gcr.io/manawa/api:v2.0.0

# 2. Deploy new version alongside current
kubectl apply -f infrastructure/k8s/deployment-canary.yaml

# 3. Verify health checks pass
kubectl logs deployment/manawa-api-canary -n production
```

### Phase 1: Initial Canary (5%)

```
Duration: 5-10 minutes
Traffic: 5% to canary, 95% to stable
Monitoring: Continuous error rate and latency checks
Threshold: Error rate must stay < 1%
```

**Automatic Actions**:
- Monitor error_rate_5m metric every 1 minute
- If error_rate > 1%: ROLLBACK immediately
- If error_rate < 0.5%: Proceed to Phase 2
- If no decision after 10 min: Manual review required

### Phase 2: Progressive Rollout (25%)

```
Duration: 10-15 minutes
Traffic: 25% to canary, 75% to stable
Monitoring: Enhanced metrics collection
Threshold: Error rate < 1%, P95 latency < baseline + 20%
```

**Automatic Actions**:
- Monitor all KPIs every 2 minutes
- If P95 latency spike: Alert and hold traffic increase
- If error_rate increases: Begin gradual rollback
- If all metrics stable: Proceed to Phase 3

### Phase 3: Full Canary (100%)

```
Duration: 5-10 minutes
Traffic: 100% to canary
Monitoring: Final validation
Threshold: All metrics green for at least 5 minutes
```

**Actions**:
- Mark canary as stable release
- Retire previous stable version (keep for emergency rollback)
- Update DNS/service mesh
- Document deployment metadata

## Automatic Rollback Strategy

### Rollback Triggers

**Immediate Rollback** (Error Rate):
```
IF error_rate_5m > 1% THEN
  - Revert all traffic to stable version
  - Send alert to PagerDuty
  - Trigger incident in Slack
  - Start post-mortem timeline
```

**Progressive Rollback** (Latency):
```
IF p95_latency > baseline * 1.2 FOR 2_minutes THEN
  - Hold traffic increase for 5 minutes
  - Run health diagnostics
  - If latency continues: initiate rollback
```

**Memory/Resource Rollback**:
```
IF memory_usage > 500MB FOR 3_consecutive_checks THEN
  - Trigger memory leak investigation
  - Begin rollback preparation
  - If not resolved in 5 min: execute rollback
```

### Rollback Execution

```bash
#!/bin/bash
# Automatic rollback script
CANARY_VERSION=$(kubectl get deployment manawa-api-canary -o jsonpath='{.spec.template.spec.containers[0].image}' -n production)
STABLE_VERSION=$(kubectl get deployment manawa-api-stable -o jsonpath='{.spec.template.spec.containers[0].image}' -n production)

echo "ROLLBACK INITIATED"
echo "Reverting from: $CANARY_VERSION"
echo "Reverting to: $STABLE_VERSION"

# 1. Update VirtualService to route 100% to stable
kubectl patch vs manawa-api -n production \
  --type merge -p '{"spec":{"http":[{"route":[{"destination":{"host":"manawa-api-stable","port":{"number":3000}},"weight":100},{"destination":{"host":"manawa-api-canary","port":{"number":3000}},"weight":0}]}]}}'

# 2. Wait for traffic to stabilize
sleep 30

# 3. Verify metrics improved
ERROR_RATE=$(curl -s "http://prometheus:9090/api/v1/query?query=rate(http_requests_total%7Bstatus%3D~%225..%22%7D%5B5m%5D)" | jq '.data.result[0].value[1]' -r)

if (( $(echo "$ERROR_RATE < 0.01" | bc -l) )); then
  echo "Rollback successful - Error rate normalized to $ERROR_RATE"
  # 4. Scale down canary
  kubectl scale deployment manawa-api-canary --replicas=0 -n production
  # 5. Send Slack notification
  curl -X POST $SLACK_WEBHOOK_URL -d '{"text":"🔴 Canary Rollback Complete - Back to stable version"}'
else
  echo "WARNING: Error rate still high after rollback: $ERROR_RATE"
  # Escalate to on-call engineer
fi
```

## Render Deployment Integration

### Canary on Render.com

For Render deployments without Kubernetes, use service shadowing:

```javascript
// File: infrastructure/canary-render.js
const express = require('express');
const httpProxy = require('express-http-proxy');
const app = express();

// Track traffic split
let trafficSplit = {
  stable: 95,
  canary: 5
};

// Middleware to route traffic
app.use((req, res, next) => {
  const randomInt = Math.random() * 100;
  
  if (randomInt < trafficSplit.canary) {
    // Route to canary service
    req.targetService = process.env.CANARY_SERVICE_URL || 'https://manawa-api-canary.onrender.com';
    req.isCanary = true;
  } else {
    // Route to stable service
    req.targetService = process.env.STABLE_SERVICE_URL || 'https://manawa-api-stable.onrender.com';
    req.isCanary = false;
  }
  
  next();
});

// Proxy with metrics collection
app.use('/', httpProxy((req) => req.targetService, {
  proxyReqPathResolver: (req) => req.originalUrl,
  userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {
    // Track response metrics
    userRes.setHeader('X-Canary-Version', userReq.isCanary ? 'canary' : 'stable');
    userRes.setHeader('X-Response-Time', proxyRes.headers['x-response-time']);
    
    return proxyResData;
  }
}));

app.listen(3000, () => {
  console.log('Canary proxy listening on port 3000');
  console.log(`Traffic split - Stable: ${trafficSplit.stable}% | Canary: ${trafficSplit.canary}%`);
});
```

## Monitoring & Alerting

### Prometheus Queries

```promql
# Error Rate (5 minute window)
rate(http_requests_total{status=~"5.."}[5m])

# P95 Latency
histogram_quantile(0.95, http_request_duration_seconds_bucket)

# Memory Usage
container_memory_usage_bytes{pod=~"manawa-api-canary.*"}

# CPU Usage
rate(container_cpu_usage_seconds_total{pod=~"manawa-api-canary.*"}[5m])

# Request Rate
rate(http_requests_total[1m])

# Request Success Rate
rate(http_requests_total{status="200"}[5m]) / rate(http_requests_total[5m])
```

### Slack Alert Template

```yaml
alerts:
- alert: CanaryHighErrorRate
  expr: rate(http_requests_total{status=~"5..", deployment="manawa-api-canary"}[5m]) > 0.01
  for: 5m
  annotations:
    summary: "Canary error rate exceeding 1%"
    description: "Error rate: {{ $value | humanizePercentage }}"
    action: "Consider rollback"
    playbook: "https://runbook.manawa.app/canary-rollback"

- alert: CanaryHighLatency
  expr: histogram_quantile(0.95, http_request_duration_seconds_bucket{deployment="manawa-api-canary"}) > 2
  for: 2m
  annotations:
    summary: "Canary P95 latency exceeding 2 seconds"
    description: "Latency: {{ $value }}s"
    action: "Investigate performance"
```

## Rollback Runbook

### Automated Rollback (Triggered by Metrics)

1. VirtualService traffic routing reverted to 100% stable
2. Canary pods terminated
3. Incident created in incident management system
4. Slack notification sent to #incidents channel
5. Post-mortem scheduled for next business day

### Manual Rollback

```bash
# 1. Check current state
kubectl get canary manawa-api-canary -n production

# 2. Trigger manual rollback
kubectl patch canary manawa-api-canary -n production \
  --type merge -p '{"metadata":{"annotations":{"flagger.app/manual-rollback":"true"}}}'

# 3. Monitor progress
kubectl logs deployment/manawa-api-stable -n production -f

# 4. Verify stable version is healthy
curl -X GET https://api.manawa.app/health -v
```

## Success Criteria

A canary deployment is considered successful when:

1. ✅ Error rate remains < 1% throughout all phases
2. ✅ P95 latency increase < 20% from baseline
3. ✅ Memory usage stays < 500MB per pod
4. ✅ CPU usage remains < 80% per pod
5. ✅ All integration tests pass (automated)
6. ✅ Manual smoke tests pass
7. ✅ No new exceptions in error tracking (Sentry)
8. ✅ Database migrations executed successfully
9. ✅ Cache prewarming completed
10. ✅ All 3 phases completed without manual intervention

## Post-Deployment Verification

```bash
#!/bin/bash
# Post-deployment checks

echo "=== POST-DEPLOYMENT VERIFICATION ==="

# 1. Verify all pods are running
kubectl get pods -n production -l app=manawa-api

# 2. Check recent logs for errors
kubectl logs deployment/manawa-api-canary -n production --tail=50 | grep -i error

# 3. Verify database connection
curl -X GET https://api.manawa.app/health/db

# 4. Check metrics
curl -s "http://prometheus:9090/api/v1/query?query=up{job='manawa-api'}"

# 5. Verify DNS propagation
dig @8.8.8.8 api.manawa.app +short

# 6. End-to-end functionality test
npm run test:e2e -- --suite=smoke

echo "=== VERIFICATION COMPLETE ==="
```

## Troubleshooting

### Issue: Canary stuck in analysis phase

```
Symptom: Canary remains in analysis phase for > 30 minutes
Cause: Webhook validation timeout or metric unavailable
Solution:
1. Check Prometheus scrape targets: curl http://prometheus:9090/api/v1/targets
2. Verify webhook endpoint: curl http://flagger-loadtester:80/status
3. Review Flagger logs: kubectl logs -n istio-system -l app=flagger
4. Manually progress: kubectl patch canary manawa-api-canary --type merge -p '{"spec":{"analysis":{"skipAnalysis":true}}}'
```

### Issue: High error rate in canary phase

```
Symptom: Error rate spikes to 5% in phase 1
Cause: Incompatible database migration or configuration mismatch
Solution:
1. Check canary logs: kubectl logs deployment/manawa-api-canary -n production
2. Compare config: kubectl diff -f infrastructure/k8s/config-canary.yaml
3. Verify database: psql -U $POSTGRES_USER -c "SELECT version();"
4. Review recent changes: git log --oneline -5
5. Trigger automatic rollback or manual recovery
```

### Issue: Metrics collection delay

```
Symptom: Metrics appear 5 minutes late
Cause: Prometheus scrape interval too long
Solution:
1. Update scrape config: Update prometheus.yml global.scrape_interval to 15s
2. Reload Prometheus: curl -X POST http://prometheus:9090/-/reload
3. Verify collection: kubectl port-forward -n monitoring svc/prometheus 9090:9090
```

## Best Practices

1. **Always have automated rollback**: Manual intervention delays crisis response
2. **Set aggressive thresholds**: 1% error rate is very conservative
3. **Test canary before production**: Use staging environment first
4. **Monitor tail latencies**: P99 and P95 matter more than averages
5. **Plan database migrations**: Schema changes should be backward compatible
6. **Pre-warm caches**: Canary should start with hot caches
7. **Document deployment**: Tag releases with metadata
8. **Schedule deployments**: Avoid Friday afternoons and low-staffing windows
9. **Have runbooks ready**: Don't create them during incident
10. **Post-deployment review**: Every canary deployment should produce lessons

## Security Considerations

- ✅ Traffic routed through service mesh for encryption in transit
- ✅ RBAC configured for Kubernetes resources
- ✅ Audit logs enabled for all deployments
- ✅ Secrets managed through Kubernetes secrets or external vault
- ✅ Network policies restrict pod-to-pod communication
- ✅ Resource quotas prevent resource exhaustion
- ✅ Pod security policies enforced
- ✅ Image scanning for vulnerabilities before deployment

## Integration with CI/CD Pipeline

```yaml
# File: .github/workflows/deploy-canary.yml
name: Deploy Canary
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to deploy'
        required: true

jobs:
  canary-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Docker image
        run: |
          docker build -t gcr.io/manawa/api:${{ github.event.inputs.version }} .
          docker push gcr.io/manawa/api:${{ github.event.inputs.version }}
      
      - name: Deploy canary
        run: |
          kubectl set image deployment/manawa-api-canary \
            manawa-api=gcr.io/manawa/api:${{ github.event.inputs.version }} \
            -n production
      
      - name: Monitor canary (30 minutes)
        run: |
          ./scripts/canary-monitor.sh ${{ github.event.inputs.version }}
      
      - name: Report results
        if: always()
        run: |
          # Send Slack notification with results
```

## Conclusion

Canary deployment provides a safety net for production deployments by:
- Limiting blast radius through gradual traffic increase
- Enabling automatic rollback based on objective metrics
- Collecting real-world performance data
- Maintaining service availability
- Reducing deployment anxiety through automation

This strategy balances innovation speed with reliability, enabling frequent safe deployments while maintaining customer trust.
