# MANAWA Backend - Render Horizontal Scaling Guide

## Overview

This guide covers deploying the MANAWA backend with horizontal scaling on Render.com, including multi-region deployment, auto-scaling, and failover strategies.

---

## Table of Contents

1. [Single Instance Deployment](#single-instance-deployment)
2. [Horizontal Scaling with Render Web Services](#horizontal-scaling)
3. [Multi-Region Deployment](#multi-region-deployment)
4. [Auto-Scaling Configuration](#auto-scaling-configuration)
5. [Failover Strategy](#failover-strategy)
6. [Monitoring & Health Checks](#monitoring--health-checks)
7. [Cost Estimation](#cost-estimation)
8. [Deployment Checklist](#deployment-checklist)

---

## Single Instance Deployment

### Step 1: Create Render Web Service

1. Log in to [render.com](https://render.com)
2. Click **New +** → **Web Service**
3. Connect your Git repository (MANAWA backend)
4. Configure the service:

```yaml
Service Name: manawa-api
Runtime: Node
Build Command: npm install
Start Command: node index.js
Plan: Standard ($12/month)
Region: Singapore or closest to your target market
```

### Step 2: Configure Environment Variables

In Render dashboard → Environment → **Environment Variables**, add:

```
DATABASE_URL=postgresql://user:pass@host/manawa
JWT_SECRET=your-super-secret-key-min-32-chars
NODE_ENV=production
REDIS_URL=redis://redis-instance:6379/0
CORS_ORIGINS=https://app.manawa.app,https://web.manawa.app
SENTRY_DSN=https://key@sentry.io/project-id
MAILJET_API_KEY=your-mailjet-api-key
MAILJET_SECRET_KEY=your-mailjet-secret-key
ADMIN_LOG_RETENTION_DAYS=90
```

### Step 3: Configure Health Checks

In **Settings** → **Health Check**:
- Path: `/api/health`
- Check Interval: 30 seconds
- Timeout: 10 seconds
- Failure Threshold: 3

---

## Horizontal Scaling

### Strategy: Multiple Render Web Services Behind Render Load Balancer

#### Architecture:
```
Clients
  ↓
[Render Load Balancer]
  ↓
[Web Service 1] [Web Service 2] [Web Service 3] [Web Service 4]
  ↓
[Shared PostgreSQL]
[Shared Redis]
```

### Deployment Steps

#### Step 1: Create Load Balancer on Render

```bash
# Note: Render uses automatic load balancing for web services
# Scale instances instead of creating separate load balancers
```

#### Step 2: Deploy 4 Backend Instances

Create 4 identical Render Web Services (or scale one service to 4 instances):

**Option A: Single Service with Multiple Instances**
1. In your Render Web Service settings
2. Go to **Settings** → **Plan**
3. Select **Standard** plan
4. In the same service dashboard, set **Num Instances = 4**

**Option B: Create 4 Separate Services (Recommended for Better Control)**

For each instance (backend-1, backend-2, backend-3, backend-4):

```yaml
Service Name: manawa-api-instance-1
Runtime: Node
Build Command: npm install
Start Command: node index.js
Plan: Standard ($12/month)
Region: Singapore
Instance Count: 1
Environment: Same as above
```

Then repeat for instances 2-4.

#### Step 3: Configure Shared Redis

1. Click **New +** → **Redis**
2. Select **Standard** plan
3. Configure:
```
Name: manawa-redis
Region: Same as backend services
Plan: Standard (1GB, $15/month)
```
4. Copy the connection string to all backend instances' `REDIS_URL`

#### Step 4: Configure Shared PostgreSQL

Use your existing Supabase or Neon PostgreSQL (already configured).

---

## Multi-Region Deployment

### Architecture for Global Users

```
Clients in Asia → [Singapore Backend] → Shared DB (writes), Read Replicas
Clients in EU   → [London Backend]    → Read replicas → Main DB
Clients in US   → [Oregon Backend]    → Read replicas → Main DB
```

### Step 1: Deploy to Multiple Regions

Create Render Web Services in each region:

**Region 1: Singapore**
```yaml
manawa-api-sg:
  Region: Singapore
  Instance Count: 2
  Shared DB: Primary (write)
```

**Region 2: London**
```yaml
manawa-api-eu:
  Region: London
  Instance Count: 1
  Shared DB: Read Replica
```

**Region 3: Oregon**
```yaml
manawa-api-us:
  Region: Oregon
  Instance Count: 1
  Shared DB: Read Replica
```

### Step 2: Database Replication

If using Neon PostgreSQL:
1. In Neon dashboard → **Branching** → Create read-only branches
2. Configure connection pooling per region

### Step 3: DNS Failover with Render

Render automatically handles DNS load balancing, but for geo-redundancy:

```
app.manawa.app     → Route 53 or Cloudflare (geo-aware DNS)
├── manawa-api-sg.onrender.com  (Primary)
├── manawa-api-eu.onrender.com  (Failover 1)
└── manawa-api-us.onrender.com  (Failover 2)
```

---

## Auto-Scaling Configuration

### Render Auto-Scaling Limits

Render allows scaling instance count, but **scaling policy is manual** (not automatic yet).

### Manual Scaling Strategy

Monitor these metrics in Render dashboard:
- **CPU Usage**: If > 80% consistently → scale up
- **Memory Usage**: If > 90% → scale up or optimize
- **Response Time**: If > 1000ms p95 → scale up

### Scaling Action Plan

1. **High Load Detected** (via monitoring)
   ```
   Scale from 2 → 4 instances
   Expected cost increase: $12/month → $24/month
   ```

2. **Medium Load**
   ```
   Keep 2-3 instances active
   Cost: $24-36/month
   ```

3. **Low Load (Off-peak)**
   ```
   Scale down to 1 instance
   Cost: $12/month
   ```

### Automated Scaling (Future Enhancement)

When Render adds native auto-scaling, use:
```yaml
autoscaling:
  min_instances: 1
  max_instances: 4
  target_cpu: 70%
  target_memory: 80%
```

---

## Failover Strategy

### Level 1: Instance Failover (Within Region)

- **Render's Built-in**: Automatically restarts failed instances
- **Health Checks**: Every 30s, marks unhealthy instances as failed
- **Recovery Time**: 2-5 minutes to replace instance

### Level 2: Regional Failover

**Scenario**: Singapore region becomes unavailable

```
1. Render detects all Singapore instances unhealthy
2. DNS (Route 53/Cloudflare) redirects to London (or Oregon)
3. London instances handle load
4. Users reconnect (WebSocket reconnection policy: 5s exponential backoff)
```

**Configuration** (Cloudflare example):
```
app.manawa.app
├── SG Instance 1 (Priority: 10, Health: /api/health)
├── SG Instance 2 (Priority: 10, Health: /api/health)
├── EU Instance   (Priority: 20, Health: /api/health)
└── US Instance   (Priority: 30, Health: /api/health)
```

### Level 3: Database Failover

**Neon PostgreSQL**:
1. Primary DB in Singapore region
2. Read replicas in EU and US
3. Manual promotion of read replica to primary if needed

**Render Cache**:
1. Redis cluster with persistence enabled
2. AOF (Append-Only File) for durability
3. Backup snapshot every 24 hours

### Level 4: Data Persistence

```yaml
Backup Strategy:
├── Redis: Persistence enabled (AOF)
├── PostgreSQL: Automated backups (Neon/Supabase)
├── Uploads: Cloudinary CDN (replicated globally)
└── Admin Logs: 90-day retention policy (database)
```

---

## Monitoring & Health Checks

### Health Check Endpoint

```javascript
// GET /api/health
{
  "status": "ok",
  "timestamp": "2026-11-11T10:30:00Z",
  "instance": "backend-1",
  "uptime": 3600,
  "checks": {
    "database": "healthy",
    "redis": "healthy",
    "memory": "ok"
  }
}
```

### Key Metrics to Monitor

1. **Request Rate**
   - Alert if > 1000 req/s per instance

2. **Response Time**
   - P50: < 100ms
   - P95: < 500ms
   - P99: < 2000ms
   - Alert if P95 > 1s

3. **Error Rate**
   - Alert if > 1% (5xx errors)

4. **Instance Health**
   - Alert if health check fails 3x consecutively

5. **Database Connections**
   - Alert if > 80% of max pool size

6. **Redis Memory**
   - Alert if > 80% of allocated memory

### Monitoring Tools

**Render Built-in**:
- Logs dashboard
- Metrics (basic CPU, memory)

**Recommended Add-ons**:
- **Sentry**: Error tracking (already configured)
- **DataDog**: APM and metrics
- **New Relic**: Performance monitoring
- **Prometheus + Grafana**: Self-hosted metrics

---

## Cost Estimation

### Single Instance (Development)
```
Render Web Service (Standard): $12/month
Redis (Standard, 1GB): $15/month
PostgreSQL (Supabase): ~$50-100/month
Total: ~$77-127/month
```

### 4 Instances (Production)
```
Render Web Services (4 × $12): $48/month
Redis (Standard, 1GB): $15/month
PostgreSQL (Supabase Pro): ~$150-200/month
Total: ~$213-263/month
```

### 3 Regions × 2 Instances (Global Production)
```
Render Web Services (6 × $12): $72/month
Redis Clusters (3 × $15): $45/month
PostgreSQL (Supabase Enterprise): ~$500/month
CDN (Cloudinary): ~$50-100/month
Monitoring (DataDog): ~$100-200/month
Total: ~$767-917/month
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All environment variables configured in Render
- [ ] Database migrations tested (`prisma migrate deploy`)
- [ ] Health check endpoint verified locally
- [ ] Redis connection verified
- [ ] SSL certificate configured (if using custom domain)
- [ ] Backups enabled in database service
- [ ] Error tracking (Sentry) configured

### Deployment
- [ ] Deploy to Render (git push or manual trigger)
- [ ] Verify build completes successfully
- [ ] Check logs for startup errors
- [ ] Test health check endpoint
- [ ] Verify database migrations ran
- [ ] Test API endpoints (auth, user, etc.)
- [ ] Test WebSocket connections (Socket.io)
- [ ] Verify file uploads work

### Post-Deployment
- [ ] Monitor error rates for 1 hour
- [ ] Check response times
- [ ] Verify Redis cache is working
- [ ] Test failover (stop one instance, verify redirect)
- [ ] Set up monitoring alerts
- [ ] Document instance configuration
- [ ] Update DNS records if needed

### Scaling to Multiple Instances
- [ ] Deploy second instance
- [ ] Verify session persistence (Redis)
- [ ] Test sticky sessions with JWT
- [ ] Test WebSocket across instances
- [ ] Load test with 1000+ concurrent users
- [ ] Monitor error rates during load test
- [ ] Set up auto-failover DNS

---

## Render Specific Configuration

### render.yaml (Deploy Configuration)

Create `render.yaml` in repository root:

```yaml
services:
  - type: web
    name: manawa-api
    runtime: node
    plan: standard
    buildCommand: npm install && npx prisma migrate deploy
    startCommand: node index.js
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: manawa-postgres
          property: connectionString
      - key: JWT_SECRET
        scope: project
      - key: NODE_ENV
        value: production
    autoDeploy: true
    region: singapore

  - type: redis
    name: manawa-redis
    plan: standard
    maxmemoryPolicy: allkeys-lru

databases:
  - name: manawa-postgres
    plan: standard
    region: singapore
```

### Deploy using render.yaml

```bash
# Login to Render CLI
npm install -g @render-cli/cli
render login

# Create service from render.yaml
render create-service --name manawa-api
```

---

## Troubleshooting

### Instance Won't Start
```
Check logs: Render Dashboard → Logs
Common causes:
- Missing environment variables
- Database connection failed
- Redis connection failed
- Port already in use
```

### Health Check Failing
```
1. Test endpoint locally: curl http://localhost:4000/api/health
2. Check database connection: SELECT 1;
3. Check Redis connection: redis-cli ping
4. Increase timeout if network slow
```

### Session Not Persisting Across Instances
```
1. Verify Redis URL same for all instances
2. Check Redis is accessible from all instances
3. Test Redis with: redis-cli ping
4. Verify JWT token not corrupted in transit
```

### High Memory Usage
```
1. Check for memory leaks: npm audit fix
2. Increase Node heap: NODE_OPTIONS="--max-old-space-size=512"
3. Scale up instances (CPU time might be better than memory)
4. Profile with: clinic.js or node --inspect
```

---

## Next Steps

1. **Deploy to Render**: Follow "Single Instance Deployment"
2. **Monitor for 24 hours**: Check error rates, response times
3. **Scale to 4 instances**: Follow "Horizontal Scaling"
4. **Setup monitoring**: Configure Sentry, Prometheus, or DataDog
5. **Plan multi-region**: Setup EU/US regions for global users
6. **Document runbook**: Document common issues and solutions

---

## Support & References

- Render Docs: https://render.com/docs
- Node.js Best Practices: https://nodejs.org/en/docs/guides/nodejs-performance-clinic/
- Render Community: https://discord.gg/render
