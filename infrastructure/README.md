# MANAWA Backend Infrastructure

Complete horizontal scaling and load balancing architecture for MANAWA backend with support for Docker Compose, Render, and Kubernetes.

## Quick Start

### Local Development (Docker Compose)

```bash
cd infrastructure
cp .env.example .env
docker-compose up -d
curl http://localhost/api/health
```

### Production Deployment (Render)

```bash
# 1. Create services in Render dashboard
# 2. Configure environment variables
# 3. Deploy: git push origin main
# 4. Scale: Settings → Num Instances = 4
```

### Kubernetes Deployment

```bash
kubectl apply -f kubernetes.yaml
kubectl get pods -n manawa
```

---

## Architecture

```
┌─────────────────┐
│   Clients       │
└────────┬────────┘
         ↓
    ┌─────────────────────────────┐
    │  Load Balancer (Nginx)      │
    │  - Rate limiting            │
    │  - Sticky sessions          │
    │  - WebSocket support        │
    └──────────┬────────────────┬─┘
               ↓                ↓
    ┌────────────────────────────────┐
    │  Backend Cluster (4 instances) │
    │  ├─ Instance 1 (2 workers)    │
    │  ├─ Instance 2 (2 workers)    │
    │  ├─ Instance 3 (2 workers)    │
    │  └─ Instance 4 (2 workers)    │
    └────────────┬───────────────────┘
                 ↓
    ┌────────────────────┐
    │  Redis Cache       │
    │  - Sessions        │
    │  - JWT blacklist   │
    │  - Rate limits     │
    └────────────┬───────┘
                 ↓
    ┌────────────────────────────┐
    │  PostgreSQL Database       │
    │  - Supabase / Neon         │
    │  - Backups + Replicas      │
    └────────────────────────────┘
```

---

## Files

### Configuration Files

- **`docker-compose.yml`** - Complete multi-container setup
  - 4 backend instances
  - Nginx load balancer
  - Redis cache
  - PostgreSQL database
  - Prometheus monitoring

- **`nginx.conf`** - Nginx reverse proxy configuration
  - Round-robin load balancing
  - Rate limiting (per-IP)
  - Sticky sessions (JWT)
  - WebSocket support
  - SSL termination

- **`.env.example`** - Environment variables template
  - Database configuration
  - Redis settings
  - API keys and secrets
  - Service credentials

### Deployment Guides

- **`ARCHITECTURE.md`** - Complete architecture documentation
  - System overview and diagrams
  - Load balancing strategy
  - Failover procedures
  - Monitoring & observability
  - Cost analysis

- **`DEPLOYMENT_GUIDE.md`** - Step-by-step deployment instructions
  - Local Docker Compose setup
  - Render production deployment
  - VPS/server deployment
  - Kubernetes deployment
  - Troubleshooting guide

- **`render-deployment.md`** - Render-specific deployment guide
  - Single instance setup
  - Horizontal scaling configuration
  - Multi-region deployment
  - Auto-scaling rules
  - Cost estimation

### Infrastructure as Code

- **`kubernetes.yaml`** - Kubernetes deployment manifests
  - Deployment with replicas
  - Service and Ingress
  - Horizontal Pod Autoscaler (HPA)
  - Network policies
  - Pod disruption budget

- **`prometheus.yml`** - Prometheus monitoring configuration
  - Metrics scraping configuration
  - Job definitions for all services

---

## Deployment Options

### 1. Docker Compose (Local Development / Single Server)

```bash
docker-compose up -d
```

**Benefits**: Simple, all-in-one, great for local testing  
**Cost**: Free (self-hosted)  
**Capacity**: ~1000-2000 concurrent users

### 2. Render (Recommended for Production)

```bash
# Deploy via git push
git push origin main

# Scale in dashboard
# Settings → Num Instances = 4
```

**Benefits**: Fully managed, auto-scaling, global CDN, easy SSL  
**Cost**: $263-413/month (4 instances)  
**Capacity**: ~5000-10000 concurrent users

### 3. VPS / Self-Hosted

```bash
docker-compose -f docker-compose.yml up -d
```

**Benefits**: Full control, custom configuration  
**Cost**: $10-100+/month (depends on VPS)  
**Capacity**: Depends on server specs

### 4. Kubernetes (Enterprise)

```bash
kubectl apply -f kubernetes.yaml
```

**Benefits**: True auto-scaling, self-healing, high availability  
**Cost**: $300-1000+/month  
**Capacity**: 100000+ concurrent users

---

## Key Features

### Load Balancing
- ✅ Nginx reverse proxy with least-connections algorithm
- ✅ Automatic instance health checks
- ✅ Graceful failover to healthy instances
- ✅ Sticky sessions for WebSocket connections

### Scalability
- ✅ Horizontal scaling (add/remove instances)
- ✅ Vertical scaling (increase instance size)
- ✅ Auto-scaling based on CPU/memory (Kubernetes)
- ✅ Multi-region deployment support

### Reliability
- ✅ Health checks every 30 seconds
- ✅ Automatic instance restart on failure
- ✅ Graceful shutdown (finish in-flight requests)
- ✅ Database backups and replication
- ✅ Redis persistence (AOF)

### Performance
- ✅ Request rate limiting (100 req/s per IP)
- ✅ Redis caching layer
- ✅ Gzip compression
- ✅ Connection pooling
- ✅ WebSocket support (Socket.io)

### Security
- ✅ SSL/TLS termination
- ✅ CORS validation
- ✅ Rate limiting
- ✅ Admin panel IP restriction
- ✅ Secret management
- ✅ Network policies (K8s)

### Monitoring
- ✅ Prometheus metrics
- ✅ Sentry error tracking
- ✅ Health check endpoint
- ✅ Structured logging
- ✅ Grafana dashboards

---

## Getting Started

### Option 1: Local Development (Fastest)

```bash
# Setup
cd infrastructure
cp .env.example .env
docker-compose up -d

# Verify
curl http://localhost/api/health

# Monitor
docker-compose logs -f backend-1
```

**Time**: 5 minutes  
**Prerequisites**: Docker Desktop

### Option 2: Render Deployment (Recommended)

```bash
# 1. Create account at render.com
# 2. Connect GitHub repository
# 3. Create Web Service (follow DEPLOYMENT_GUIDE.md)
# 4. Scale to 4 instances
# 5. Setup custom domain

# Deploy
git push origin main
```

**Time**: 15 minutes  
**Cost**: $263-413/month  
**Uptime**: 99.9%

### Option 3: VPS Deployment

```bash
# 1. Rent Ubuntu 22.04 VPS
# 2. Install Docker
# 3. Clone repository
# 4. Setup environment
# 5. Run docker-compose

cd backend/infrastructure
cp .env.example .env
nano .env  # Edit values
docker-compose up -d
```

**Time**: 30 minutes  
**Cost**: $10-50/month  
**Setup**: More manual work

### Option 4: Kubernetes Deployment

```bash
# 1. Create Kubernetes cluster (EKS, GKE, etc.)
# 2. Install kubectl
# 3. Create namespace
# 4. Apply manifests

kubectl apply -f kubernetes.yaml -n manawa
kubectl get pods -n manawa
```

**Time**: 60 minutes  
**Cost**: $300-1000+/month  
**Benefits**: Full auto-scaling, enterprise-grade

---

## Monitoring & Troubleshooting

### Health Checks

```bash
# API health endpoint
curl http://localhost/api/health

# Instance logs
docker-compose logs backend-1

# All services status
docker-compose ps
```

### Performance Monitoring

```bash
# Prometheus metrics
http://localhost:9090

# Resource usage
docker stats

# Real-time logs
docker-compose logs -f
```

### Common Issues

| Issue | Solution |
|-------|----------|
| "Service Unavailable" | Check health endpoint, verify database connection |
| High latency | Scale up instances, check database performance |
| Memory leak | Profile with clinic.js, check for unclosed connections |
| WebSocket drops | Verify Redis connection, check sticky sessions |

---

## Performance Targets

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Response Time (P95) | < 500ms | > 1s |
| Error Rate | < 0.1% | > 1% |
| CPU Usage | 40-70% | > 80% |
| Memory Usage | 50-70% | > 90% |
| Uptime | > 99.9% | < 99.5% |
| Cache Hit Rate | > 80% | < 60% |

---

## Cost Estimation

### Monthly Costs (4 instances)

| Component | Plan | Cost |
|-----------|------|------|
| Backend (4 × Render Standard) | $12/mo each | $48 |
| Redis Cache (1GB) | Standard | $15 |
| PostgreSQL | Supabase Pro | $150-200 |
| File Storage (Cloudinary) | - | $50-100 |
| **Total** | - | **$263-413** |

### Cost Optimization

- **Off-peak scaling**: $12-24/month savings
- **Use cheaper DB**: Neon instead of Supabase: $50-100/month savings
- **Single instance**: $77-127/month baseline

---

## Next Steps

1. **Choose deployment model** (Render recommended)
2. **Follow DEPLOYMENT_GUIDE.md** for your choice
3. **Monitor for 24 hours** after deployment
4. **Setup alerts** in Sentry/Prometheus
5. **Scale as needed** based on metrics

---

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - Deep dive into system design
- [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md) - Step-by-step deployment
- [`render-deployment.md`](./render-deployment.md) - Render-specific guide
- [`nginx.conf`](./nginx.conf) - Load balancer configuration
- [`docker-compose.yml`](./docker-compose.yml) - Container orchestration
- [`kubernetes.yaml`](./kubernetes.yaml) - K8s deployment

---

## Support

For issues:
1. Check logs: `docker-compose logs backend-1`
2. Review DEPLOYMENT_GUIDE.md troubleshooting section
3. Check Render dashboard (if using Render)
4. Enable debug logging: `NODE_ENV=development`

---

## License

Part of MANAWA project. Internal use only.
