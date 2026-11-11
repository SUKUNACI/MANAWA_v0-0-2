# MANAWA Backend - Load Balancing & Scaling Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                              │
│  ┌──────────────┬────────────────┬──────────────┐          │
│  │  Mobile App  │   Web Browser  │  Admin Panel │          │
│  └──────────────┴────────────────┴──────────────┘          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│            EDGE / CDN (Cloudflare / Cloudinary)             │
│  - Cache static assets                                      │
│  - DDOS protection                                          │
│  - Image optimization                                       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│            LOAD BALANCER (Nginx / Render LB)               │
│  - Rate limiting per IP                                     │
│  - SSL termination                                          │
│  - Request routing                                          │
│  - Health checks                                            │
│  - Sticky sessions (JWT)                                    │
└─────────────────────────────────────────────────────────────┘
         ↓          ↓          ↓          ↓
┌─────────────────────────────────────────────────────────────┐
│              BACKEND CLUSTER (4-10 instances)               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Instance 1  │  Instance 2  │  Instance 3  │ Inst 4 │  │
│  │  (Port 4000) │  (Port 4001) │  (Port 4002) │(Port 4003)│  │
│  │  ┌────────┐  │  ┌────────┐  │  ┌────────┐  │┌────────┐ │  │
│  │  │ Worker1│  │  │ Worker1│  │  │ Worker1│  ││Worker1 │ │  │
│  │  │ Worker2│  │  │ Worker2│  │  │ Worker2│  ││Worker2 │ │  │
│  │  └────────┘  │  └────────┘  │  └────────┘  │└────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
    ↓                  ↓                    ↓
┌──────────────────────────────────────────────────────────────┐
│                  CACHE LAYER (Redis)                        │
│  - Session storage                                           │
│  - JWT blacklist                                             │
│  - Rate limit counters                                       │
│  - Query results cache                                       │
│  - Real-time data (online users)                             │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│              PRIMARY DATABASE (PostgreSQL)                  │
│  - Supabase / Neon                                           │
│  - Automatic backups (daily)                                 │
│  - Connection pooling                                        │
│  - Read replicas (optional, for scale)                       │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│        EXTERNAL SERVICES (Webhooks & Events)               │
│  ┌────────────┬──────────────┬──────────────┬────────────┐  │
│  │ Sentry     │ Mailjet      │ Firebase     │ GeniusPay  │  │
│  │ (Errors)   │ (Email)      │ (Push Notif) │ (Payments) │  │
│  │            │              │              │            │  │
│  │ Twilio     │ Cloudinary   │ Stripe       │ Socket.io  │  │
│  │ (SMS)      │ (Images)     │ (Payments)   │ (Real-time)│  │
│  └────────────┴──────────────┴──────────────┴────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Deployment Models

### 1. Single Instance (Development / MVP)

**Cost**: ~$77-127/month  
**Capacity**: ~1000-2000 concurrent users  
**Failover**: None (single point of failure)

```
Client → Render LB → Backend Instance (1) → PostgreSQL
                  ↓
              Redis Cache
```

**Setup**: 
```bash
# Deploy to Render
git push render main
```

---

### 2. Horizontal Scaling (Production - Recommended)

**Cost**: ~$213-263/month  
**Capacity**: ~5000-10000 concurrent users  
**Failover**: Instance-level (Render auto-restart)

```
                        Render Load Balancer
                    /         |         |         \
              Instance-1   Instance-2  Instance-3  Instance-4
              (Port 4000)  (Port 4001) (Port 4002) (Port 4003)
                    \          |          |         /
                          Redis Cache
                               ↓
                         PostgreSQL (Supabase)
```

**Architecture Benefits**:
- **Load Distribution**: Least-connections algorithm
- **Session Affinity**: JWT-based sticky sessions
- **Health Checks**: Every 30s, auto-restart unhealthy instances
- **Graceful Shutdown**: In-flight requests complete before exit
- **Monitoring**: Real-time logs and metrics

**Setup**:
```bash
# 1. Deploy base instance to Render
git push render main

# 2. Scale to 4 instances
# Render Dashboard → Settings → Plan → Num Instances = 4

# 3. Configure health check
# Path: /api/health
# Interval: 30s
# Timeout: 10s
```

---

### 3. Multi-Region Deployment (Global Scale)

**Cost**: ~$767-917/month  
**Capacity**: ~50000+ concurrent users  
**Failover**: Regional (DNS-based)

```
Singapore (Primary)        London (EU)           Oregon (US)
  ├─ Instance 1            ├─ Instance 1        ├─ Instance 1
  ├─ Instance 2            └─ Instance 2        └─ Instance 2
  └─ Redis Cache
        ↓                        ↓                      ↓
   Primary DB            Read Replica           Read Replica
   (Write)              (Read-only)            (Read-only)
```

**Architecture Benefits**:
- **Geo-redundancy**: Survive regional outages
- **Lower Latency**: Users connect to nearest region
- **Read Scaling**: Replicas handle read-heavy workloads
- **Cost Optimization**: Scale on-demand per region

**Setup**:
```bash
# 1. Deploy to Singapore (primary)
git push render-sg main

# 2. Deploy to London (replica)
git push render-eu main

# 3. Deploy to Oregon (replica)
git push render-us main

# 4. Setup DNS failover (Route 53 / Cloudflare)
# api.manawa.app → Route 53 (health checks)
# ├─ SG Instance (Priority: 10)
# ├─ EU Instance (Priority: 20)
# └─ US Instance (Priority: 30)
```

---

### 4. Kubernetes (Enterprise Scale)

**Cost**: $300-1000+/month (depending on cluster size)  
**Capacity**: 100000+ concurrent users  
**Failover**: Full auto-scaling and self-healing

```
Kubernetes Cluster
├─ Ingress Controller (Nginx)
├─ Service (Load Balancer)
├─ HPA (2-10 pods auto-scaling)
│  ├─ Pod 1 (2 workers)
│  ├─ Pod 2 (2 workers)
│  ├─ Pod 3 (2 workers)
│  └─ Pod N (auto-scaled)
├─ StatefulSet (Redis)
└─ External DB (PostgreSQL)

Rules:
- Scale up if CPU > 70% or Memory > 80%
- Scale down if CPU < 30% for 5 minutes
- Min replicas: 2 (always available)
- Max replicas: 10 (cost control)
```

**Benefits**:
- **True auto-scaling**: Scale based on metrics
- **Self-healing**: Pod crashes trigger auto-replacement
- **Rolling updates**: Zero-downtime deployments
- **Resource efficiency**: VPA optimizes pod size

---

## Load Balancing Strategy

### Algorithm: Least Connections

```
Incoming Request
        ↓
    Check active connections per instance:
    Instance-1: 100 connections
    Instance-2: 95 connections  ← Select this (fewest)
    Instance-3: 102 connections
    Instance-4: 99 connections
        ↓
    Route to Instance-2
```

### Sticky Sessions (JWT-based)

```
1. User logs in
   POST /api/auth/login
   ↓
   Response: Set-Cookie: SERVERID=srv1
   JWT Token: eyJhbGc...

2. User sends subsequent requests
   GET /api/users/profile
   Cookie: SERVERID=srv1
   ↓
   Load balancer routes to Instance-1

3. Benefit: Local in-memory data (Socket.io, sessions) stays consistent
```

### WebSocket Routing

```
1. Client initiates WebSocket
   ws://api.manawa.app/socket.io
   ↓
   Nginx routes to: Instance-2

2. Nginx maintains persistent connection
   (not terminated between requests)

3. Socket.io events routed to same instance
   send_message → Instance-2
   receive_message ← Instance-2

4. If instance dies: Client reconnects, routes to healthy instance
```

---

## Failover Strategy

### Level 1: Instance Failover (Within Region)

**Scenario**: Backend Instance-2 crashes

```
Timeline:
├─ T0: Instance-2 crashes
├─ T30s: Health check fails (3 retries × 10s)
├─ T60s: Render detects failure, marks unhealthy
├─ T90s: Render auto-restarts instance
├─ T120s: Instance-2 healthy again
├─ Load Balancer redirects traffic back to Instance-2
└─ No data loss (state in Redis/DB, not in-memory)

During outage (30-120s):
- Traffic routed to Instance-1, 3, 4
- No user-facing outage (distributed load)
```

**Recovery Action**:
```bash
# Manual recovery (if auto-restart fails)
render-cli redeploy manawa-api-instance-2
# or via UI: Render Dashboard → manawa-api-instance-2 → Redeploy
```

### Level 2: Regional Failover

**Scenario**: Singapore region completely unavailable

```
Timeline:
├─ T0: Entire Singapore region down
├─ T30s: All health checks fail
├─ T60s: DNS detects all SG instances unhealthy
├─ T90s: DNS returns London instance IPs
├─ Clients reconnect to London region
│  (with exponential backoff: 1s, 2s, 4s, 8s)
├─ London instances handle full load
└─ Monitor logs for errors (may see increased latency)

Recovery:
├─ Singapore region comes back online
├─ Instances start failing health checks again
├─ DNS gradually shifts traffic back
└─ Wait 5-10 minutes for full recovery
```

**DNS Configuration** (Route 53):
```
Primary:    sg.api.manawa.app  (Priority: 10)
Failover-1: eu.api.manawa.app  (Priority: 20)
Failover-2: us.api.manawa.app  (Priority: 30)

api.manawa.app → Route 53 health checks → failover to next
```

### Level 3: Data Persistence During Failover

```
Components:
├─ Redis Persistence
│  └─ AOF (Append-Only File)
│     - Every write persisted to disk
│     - Survives Redis pod restart
│     - RPO (Recovery Point Objective): 0 seconds
│
├─ PostgreSQL Backups
│  └─ Automatic daily backups (Supabase)
│     - Point-in-time recovery available
│     - RPO: 1 day (24 hours)
│
└─ File Storage (Uploads)
   └─ Cloudinary CDN (replicated globally)
      - Automatically backed up
      - RPO: 0 (immediately replicated)

RTO (Recovery Time Objective):
├─ Instance restart: 2-5 minutes
├─ Region failover: 1-2 minutes (DNS TTL)
└─ Database restore: 5-30 minutes (if needed)
```

---

## Graceful Shutdown Process

```
Scenario: Pod must be restarted for updates

Timeline:
├─ T0: Shutdown signal (SIGTERM) sent
├─ T1: Stop accepting NEW connections
│   └─ HTTP return 503 (Service Unavailable) for new requests
│
├─ T2-T15: Wait for in-flight requests to complete
│   ├─ Long-running uploads: continue
│   ├─ API calls: continue
│   └─ WebSocket: gracefully close after data sent
│
├─ T15: Check remaining connections
│   ├─ If empty: exit cleanly
│   └─ If not empty: force close after timeout
│
└─ T30: Process exits (kill -9 if still running)

Code Implementation:
// config/scaling.js - GracefulShutdown class
- Tracks active connections
- Closes server (no new connections)
- Waits up to 30s for connections to finish
- Force closes remaining connections
- Exits process gracefully
```

---

## Monitoring & Observability

### Key Metrics

```
Application Level:
├─ Request Rate: requests/second
│  └─ Alert: > 1000 req/s per instance
├─ Response Time: p50, p95, p99
│  ├─ Target: P95 < 500ms
│  └─ Alert: P95 > 1000ms
├─ Error Rate: 5xx / total requests
│  ├─ Target: < 0.1%
│  └─ Alert: > 1%
└─ Cache Hit Rate: cache hits / total requests
   ├─ Target: > 80%
   └─ Alert: < 60%

Infrastructure Level:
├─ CPU Usage: per instance
│  ├─ Target: 40-70%
│  └─ Scale up if: > 80% for 5 minutes
├─ Memory Usage: per instance
│  ├─ Target: 50-70% of max
│  └─ Scale up if: > 90% or OOM kills
├─ Connection Count: active connections
│  ├─ Target: < 1000 per instance
│  └─ Alert: > 5000 (connection leak)
└─ Disk I/O: logs and uploads
   ├─ Target: < 80% full
   └─ Alert: > 90% (cleanup logs)

Database Level:
├─ Connection Pool: active / max connections
│  ├─ Target: < 80%
│  └─ Alert: > 90% (potential connection leak)
├─ Query Performance: slow query log
│  ├─ Target: < 100ms p95
│  └─ Alert: > 1s p95 (add index?)
└─ Replication Lag: replica lag time
   ├─ Target: < 1 second
   └─ Alert: > 10 seconds (failover risk)

Cache Level:
├─ Redis Memory: used / max memory
│  ├─ Target: < 80%
│  └─ Alert: > 90% (scale up or eviction)
├─ Redis Hit Rate: hits / (hits + misses)
│  ├─ Target: > 80%
│  └─ Alert: < 60% (cache efficiency issue)
└─ Redis Command Latency: per command
   ├─ Target: < 10ms
   └─ Alert: > 100ms (performance issue)
```

### Monitoring Tools

```
Real-time Dashboards:
├─ Render Built-in: CPU, Memory, Logs
├─ Sentry: Error tracking and stack traces
├─ DataDog: APM, infrastructure metrics
├─ New Relic: Performance monitoring
└─ Prometheus + Grafana: Custom metrics

Alerting Channels:
├─ Slack: Real-time notifications
├─ Email: Critical alerts
├─ PagerDuty: On-call escalation
└─ SMS: Critical incidents
```

---

## Cost Optimization

### Current Costs (4 instances)

```
Monthly Breakdown:
├─ Compute
│  ├─ 4 × Render Backend (Standard): $12/month each = $48
│  └─ Total Compute: $48/month
│
├─ Cache
│  ├─ Redis (Standard, 1GB): $15/month
│  └─ Total Cache: $15/month
│
├─ Database
│  ├─ PostgreSQL (Supabase Pro): $100-200/month
│  └─ Backups & replicas: $50/month
│  └─ Total Database: $150-250/month
│
├─ Storage
│  ├─ File Uploads (Cloudinary): $50-100/month
│  └─ Logs retention: included
│  └─ Total Storage: $50-100/month
│
└─ Total Monthly: $263-413/month
```

### Cost Reduction Strategies

```
1. Scale Down During Off-Peak
   ├─ Run 2 instances 22:00-07:00 (off-peak)
   ├─ Save: $12/month × 9 hours × 30 days = ~$108
   └─ Implementation: Render scheduled scaling (future feature)
      Or: Manual scale down via dashboard

2. Use In-Memory Cache Fallback
   ├─ Use in-memory cache if Redis down (already implemented)
   ├─ Save: Redis cost if not needed for multi-instance state
   └─ Trade-off: Only works for single instance

3. Optimize Database
   ├─ Use Supabase free tier: $0 (but limited)
   ├─ Use Neon PostgreSQL: $15-100/month (cheaper than Supabase Pro)
   └─ Save: $50-100/month

4. Bundle Services
   ├─ Use Render for compute + Redis
   ├─ Use Neon for database
   ├─ Use Cloudinary for storage
   └─ Consolidated billing: saves 5-10%
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All code committed to git
- [ ] Tests passing (npm test)
- [ ] Environment variables configured
- [ ] Database migrations reviewed
- [ ] Backup strategy confirmed
- [ ] SSL certificate ready (if using HTTPS)
- [ ] Monitoring configured
- [ ] On-call runbook prepared

### Deployment

- [ ] Deploy to staging first
- [ ] Run smoke tests
- [ ] Deploy to production
- [ ] Verify all instances healthy
- [ ] Check logs for errors
- [ ] Load test with 100+ concurrent users
- [ ] Verify database replication

### Post-Deployment

- [ ] Monitor error rates for 1 hour
- [ ] Check response times (p95 < 500ms)
- [ ] Verify Redis is working
- [ ] Test mobile app connectivity
- [ ] Test WebSocket functionality
- [ ] Document any issues
- [ ] Update deployment log

---

## Troubleshooting Guide

### Problem: High latency (P95 > 1000ms)

```
Diagnosis:
├─ Check CPU usage: if > 80% → scale up
├─ Check memory usage: if > 90% → scale up or optimize
├─ Check database queries: slow query log
├─ Check cache hit rate: if < 60% → cache issue
└─ Check network: latency from LB to instances

Solution:
├─ Short term: Scale up instances (temporary)
├─ Medium term: Optimize slow queries (add index?)
├─ Long term: Implement caching for hot data
```

### Problem: Out of memory (OOM kills)

```
Cause:
├─ Memory leak in application
├─ Large in-memory data structures
└─ Node.js heap not sized correctly

Solution:
├─ Increase Node heap: NODE_OPTIONS="--max-old-space-size=512"
├─ Profile memory usage: clinic.js
├─ Fix memory leaks: close connections, cleanup timers
└─ Scale up or split load
```

### Problem: Health checks failing

```
Cause:
├─ Database connection issue
├─ Redis connection issue
├─ Application crash
└─ Port not listening

Solution:
├─ Check database: psql $DATABASE_URL
├─ Check Redis: redis-cli -u $REDIS_URL ping
├─ Check logs: Render Dashboard → Logs
├─ Restart instance: Render Dashboard → Redeploy
```

### Problem: WebSocket connections dropping

```
Cause:
├─ Instance restart during graceful shutdown
├─ Network timeout
├─ Session affinity not working
└─ Redis connection issue

Solution:
├─ Implement auto-reconnect with exponential backoff
├─ Verify sticky sessions enabled
├─ Check Redis is accessible
├─ Increase WebSocket timeouts in nginx.conf
```

---

## References

- Render Documentation: https://render.com/docs
- Node.js Cluster Mode: https://nodejs.org/en/docs/guides/nodejs-performance-clinic/
- Nginx Load Balancing: https://nginx.org/en/docs/http/load_balancing.html
- Kubernetes Deployment: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- WebSocket Best Practices: https://socket.io/docs/v4/socket-io-client-api/
