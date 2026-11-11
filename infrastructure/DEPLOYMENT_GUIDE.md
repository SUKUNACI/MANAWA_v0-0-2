# MANAWA Backend - Complete Deployment Guide

## Quick Start (5 minutes)

### Deploy to Render (Easiest)

```bash
# 1. Push code to main branch
git add .
git commit -m "feat: add load balancing configuration"
git push origin main

# 2. Create service on Render
#    - Go to render.com → New → Web Service
#    - Connect MANAWA repository
#    - Select main branch
#    - Build: npm install
#    - Start: node index.js

# 3. Set environment variables
#    - Render Dashboard → Environment
#    - Add all variables from infrastructure/.env.example

# 4. Verify deployment
curl https://your-render-service.onrender.com/api/health
# Response: {"status":"ok"}
```

---

## Local Development with Docker Compose

### Prerequisites

- Docker Desktop installed
- Docker Compose v2+
- Git

### Steps

```bash
cd infrastructure

# 1. Copy environment template
cp .env.example .env
# Edit .env with your local values (or use defaults)

# 2. Build and start all services
docker-compose up -d

# 3. Verify services are healthy
docker-compose ps
# All services should show "healthy" or "running"

# 4. Check logs
docker-compose logs -f backend-1

# 5. Test the API
curl http://localhost/api/health
# Response: {"status":"ok"}

# 6. Stop all services
docker-compose down
```

### Accessing Services

- **Backend API**: http://localhost/api
- **Nginx Status**: http://localhost/nginx_status
- **Prometheus**: http://localhost:9090
- **Redis**: localhost:6379 (redis-cli required)
- **PostgreSQL**: localhost:5432 (psql required)

### Common Commands

```bash
# View logs for specific service
docker-compose logs backend-1 -f

# Restart a service
docker-compose restart redis

# Scale backend instances
docker-compose up -d --scale backend=6

# Execute command in container
docker-compose exec backend-1 npm run migrate

# Remove all containers and volumes
docker-compose down -v
```

---

## Production Deployment on Render

### Step 1: Create PostgreSQL Database

```bash
# Use existing Supabase / Neon database, or:
# 1. Go to render.com → New → PostgreSQL
# 2. Name: manawa-postgres
# 3. Plan: Standard ($15/month)
# 4. Region: Singapore
# 5. Copy connection string to DATABASE_URL
```

### Step 2: Create Redis Cache

```bash
# 1. Go to render.com → New → Redis
# 2. Name: manawa-redis
# 3. Plan: Standard ($15/month)
# 4. Region: Singapore
# 5. Copy connection string to REDIS_URL
```

### Step 3: Deploy Backend (Single Instance)

```bash
# 1. Go to render.com → New → Web Service
# 2. Connect GitHub repo
# 3. Configure:
#    Name: manawa-api
#    Root Directory: backend
#    Build Command: npm install && npx prisma migrate deploy
#    Start Command: node index.js
#    Plan: Standard ($12/month)
#    Region: Singapore
#    Auto-Deploy: On

# 4. Add Environment Variables (from .env.example)
#    - DATABASE_URL
#    - JWT_SECRET
#    - REDIS_URL
#    - NODE_ENV=production
#    - All email, SMS, payment keys

# 5. Configure Health Check:
#    Path: /api/health
#    Check interval: 30 seconds
#    Timeout: 10 seconds

# 6. Deploy button → Deploy
```

### Step 4: Scale to Multiple Instances

```bash
# In Render Dashboard → Settings:
# Set "Num Instances" = 4

# This will create 4 instances behind Render's load balancer
# Cost: $48/month (4 × $12)
```

### Step 5: Setup Custom Domain

```bash
# 1. In Render Dashboard → Settings → Custom Domain
# 2. Add: api.manawa.app
# 3. Point DNS to Render CNAME:
#    api.manawa.app CNAME manawa-api.onrender.com
# 4. Wait 5-10 minutes for DNS propagation

# Verify:
curl https://api.manawa.app/api/health
```

---

## Production Deployment with Docker (VPS/Server)

### Prerequisites

- Ubuntu 22.04 LTS server
- 4GB RAM minimum (8GB recommended)
- 50GB disk space
- Docker and Docker Compose installed

### Installation

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# 3. Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 4. Clone repository
git clone https://github.com/manawa/backend.git
cd backend/infrastructure

# 5. Setup environment
cp .env.example .env
nano .env  # Edit with production values
```

### Deployment

```bash
# 1. Build images (optional, if not using pre-built)
docker-compose build

# 2. Start all services
docker-compose up -d

# 3. Verify health
docker-compose ps
curl http://localhost/api/health

# 4. Check logs
docker-compose logs -f backend-1

# 5. Setup SSL (Let's Encrypt)
sudo apt install certbot python3-certbot-nginx -y
sudo certbot certonly --standalone -d api.manawa.app
# Copy certificates to ./ssl/

# 6. Restart Nginx with SSL
docker-compose restart nginx
```

### Maintenance

```bash
# Update code
git pull origin main
docker-compose build
docker-compose up -d

# Backup database
docker-compose exec postgres pg_dump -U postgres manawa > backup.sql

# Restore database
docker-compose exec -T postgres psql -U postgres manawa < backup.sql

# Monitor logs
docker-compose logs -f --tail=100

# Scale instances (temporary)
docker-compose up -d --scale backend=6

# Cleanup old images
docker image prune -f
```

---

## Kubernetes Deployment (Advanced)

### Prerequisites

- Kubernetes cluster (EKS, GKE, or local minikube)
- kubectl installed
- Helm installed (optional)

### Setup

```bash
# 1. Create namespace
kubectl create namespace manawa

# 2. Create secrets
kubectl create secret generic manawa-secrets \
  --from-literal=DATABASE_URL=postgresql://... \
  --from-literal=JWT_SECRET=... \
  -n manawa

# 3. Apply configuration
kubectl apply -f kubernetes.yaml -n manawa

# 4. Verify deployment
kubectl get pods -n manawa
kubectl get svc -n manawa

# 5. Check logs
kubectl logs -n manawa -l app=manawa -f

# 6. Scale manually
kubectl scale deployment manawa-backend --replicas=5 -n manawa
```

### Monitoring

```bash
# View metrics
kubectl top pods -n manawa
kubectl top nodes

# Describe pod
kubectl describe pod manawa-backend-xyz -n manawa

# SSH into pod
kubectl exec -it manawa-backend-xyz -n manawa -- /bin/sh

# Port forwarding
kubectl port-forward -n manawa svc/manawa-backend 4000:80
curl http://localhost:4000/api/health
```

### Debugging

```bash
# Get events
kubectl get events -n manawa

# Check pod logs
kubectl logs manawa-backend-xyz -n manawa --previous
# (if pod crashed)

# Check resource constraints
kubectl top pods -n manawa

# Describe HPA status
kubectl describe hpa manawa-backend-hpa -n manawa
```

---

## Monitoring Setup

### Prometheus + Grafana Stack

```bash
# Deploy Prometheus (already in docker-compose)
# Access: http://localhost:9090

# 1. Query metrics
# - http_requests_total
# - http_request_duration_seconds
# - nodejs_memory_heap_used_bytes

# Create alerts:
# - Error rate > 1%
# - Response time p95 > 1s
# - Memory usage > 90%
```

### Sentry Error Tracking

```bash
# 1. Go to sentry.io
# 2. Create project for Node.js
# 3. Copy DSN to SENTRY_DSN environment variable
# 4. Errors automatically tracked
```

### Manual Monitoring

```bash
# Check instance health
curl http://backend-1:4000/api/health
curl http://backend-2:4001/api/health
curl http://backend-3:4002/api/health
curl http://backend-4:4003/api/health

# Check Redis
redis-cli -h redis PING
redis-cli -h redis INFO

# Check PostgreSQL
psql $DATABASE_URL -c "SELECT 1"

# Monitor in real-time
docker-compose logs -f
```

---

## Troubleshooting

### Service Won't Start

```bash
# 1. Check logs
docker-compose logs backend-1

# 2. Common issues:
#    - DATABASE_URL not set → set env var
#    - Redis not connecting → check REDIS_URL
#    - Port already in use → change PORT env var

# 3. Rebuild and restart
docker-compose down
docker-compose up -d --build
```

### Health Checks Failing

```bash
# 1. Test endpoint directly
curl http://localhost:4000/api/health

# 2. Check database
docker-compose exec backend-1 npm run prisma -- db execute

# 3. Check Redis
docker-compose exec redis redis-cli ping

# 4. Check network
docker network ls
docker network inspect infrastructure_manawa-network
```

### Performance Issues

```bash
# 1. Check resource usage
docker stats

# 2. If CPU high:
#    - Scale up instances
#    - Optimize slow queries
#    - Add caching

# 3. If memory high:
#    - Check for memory leaks
#    - Increase memory limit in docker-compose.yml
#    - Profile with: node --inspect

# 4. If database slow:
#    - Check active connections
#    - Add indexes for slow queries
#    - Use read replicas for scaling
```

### Data Loss Concerns

```bash
# Redis persistence (already configured)
docker-compose exec redis redis-cli BGSAVE

# PostgreSQL backups
docker-compose exec postgres pg_dump -U postgres manawa > backup.sql

# Restore from backup
docker-compose exec -T postgres psql -U postgres manawa < backup.sql
```

---

## Scaling Strategies

### Vertical Scaling (Make instances bigger)

```bash
# Increase memory limit
# docker-compose.yml → backend → deploy → resources → limits
# Then restart: docker-compose restart
```

### Horizontal Scaling (Add more instances)

```bash
# Docker Compose
docker-compose up -d --scale backend=6

# Render
# Settings → Plan → Num Instances = 6

# Kubernetes
kubectl scale deployment manawa-backend --replicas=6 -n manawa
```

### Database Scaling

```bash
# Read replicas (Neon / Supabase)
# 1. Create read replica in different region
# 2. Use replica for SELECT queries
# 3. Keep primary for writes

# Connection pooling
# Already configured with PgBouncer in Neon
```

---

## Security Checklist

- [ ] All secrets in environment variables (not in code)
- [ ] SSL/TLS certificate installed and valid
- [ ] Rate limiting enabled
- [ ] CORS restricted to known origins
- [ ] Database backups configured
- [ ] Regular security updates applied
- [ ] Logs retention policy set (90 days)
- [ ] Admin panel IP-restricted
- [ ] Database credentials rotated
- [ ] Redis password set (if production)

---

## Rollback Procedure

### If deployment breaks production:

```bash
# 1. Identify last working version
git log --oneline

# 2. Revert to previous commit
git revert HEAD
git push origin main

# 3. Render auto-redeploys (or manual trigger)
# Or manual rollback:
git reset --hard <commit-hash>
git push origin main --force

# 4. Verify rollback
curl https://api.manawa.app/api/health

# 5. Database migration rollback (if needed)
# This requires prisma migrate revert (be careful!)
```

---

## Performance Targets

- **Response Time P95**: < 500ms
- **Error Rate**: < 0.1%
- **Uptime**: > 99.9%
- **Cache Hit Rate**: > 80%
- **CPU Usage**: 40-70%
- **Memory Usage**: 50-70%
- **Connection Count**: < 1000 per instance

---

## Support & Next Steps

1. **Local testing**: Follow "Local Development with Docker Compose"
2. **Staging deployment**: Use Render to test in production-like environment
3. **Production launch**: Follow "Production Deployment on Render"
4. **Monitoring**: Setup Prometheus and Sentry
5. **Auto-scaling**: Configure based on metrics
6. **Documentation**: Update runbooks and procedures

For issues, check Render logs or Docker Compose logs first.
