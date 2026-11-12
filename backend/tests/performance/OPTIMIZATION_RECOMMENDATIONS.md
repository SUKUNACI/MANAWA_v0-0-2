# MANAWA Backend Performance Optimization Recommendations

**Priority Level:** HIGH  
**Estimated Implementation Time:** 8-40 hours  
**Expected Impact:** 30-70% performance improvement

---

## Executive Summary

Based on the performance testing framework and baseline analysis, this document outlines specific, actionable optimizations to improve backend performance. Recommendations are prioritized by impact-to-effort ratio.

---

## 1. Quick Wins (1-2 hours, 20-30% improvement)

### 1.1 Add Database Indexes

**Current State:** Many frequently queried columns lack indexes  
**Impact:** 40-50% reduction in query time for indexed fields  
**Effort:** 30 minutes

**Implementation:**

```sql
-- Projects table
CREATE INDEX CONCURRENTLY idx_projects_status ON projects(status);
CREATE INDEX CONCURRENTLY idx_projects_clientId ON projects("clientId");
CREATE INDEX CONCURRENTLY idx_projects_createdAt ON projects("createdAt" DESC);

-- Professionals table
CREATE INDEX CONCURRENTLY idx_professionals_specialties ON professionals(specialties);
CREATE INDEX CONCURRENTLY idx_professionals_userId ON professionals("userId");
CREATE INDEX CONCURRENTLY idx_professionals_avgRating ON professionals("avgRating" DESC);

-- Bookings table
CREATE INDEX CONCURRENTLY idx_bookings_projectId ON bookings("projectId");
CREATE INDEX CONCURRENTLY idx_bookings_professionalId ON bookings("professionalId");
CREATE INDEX CONCURRENTLY idx_bookings_status ON bookings(status);

-- Messages table
CREATE INDEX CONCURRENTLY idx_messages_conversationId ON messages("conversationId");
CREATE INDEX CONCURRENTLY idx_messages_senderId ON messages("senderId");
CREATE INDEX CONCURRENTLY idx_messages_createdAt ON messages("createdAt" DESC);

-- Quotes table
CREATE INDEX CONCURRENTLY idx_quotes_projectId ON quotes("projectId");
CREATE INDEX CONCURRENTLY idx_quotes_status ON quotes(status);
CREATE INDEX CONCURRENTLY idx_quotes_version ON quotes(version);

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY idx_projects_client_status 
  ON projects("clientId", status);
CREATE INDEX CONCURRENTLY idx_bookings_project_status 
  ON bookings("projectId", status);
```

**Validation:**
```bash
# Before optimization
EXPLAIN ANALYZE SELECT * FROM projects WHERE status = 'active' ORDER BY createdAt DESC;
# Expected: Sequential Scan

# After optimization
# Expected: Index Scan using idx_projects_status
```

---

### 1.2 Enable PostgreSQL Query Plan Caching

**Current State:** Query plans not cached  
**Impact:** 10-15% reduction in parsing overhead  
**Effort:** 15 minutes

**Implementation:**

```javascript
// In config/db.js or Prisma initialization
const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' }
  ]
});

// Enable prepared statements (Prisma does this by default)
// Verify in DATABASE_URL: poolSize=20&sslmode=require
```

**Prisma Configuration:**
```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  binaryTargets = ["native"]
}

model Project {
  id    Int     @id @default(autoincrement())
  // ... fields ...
  
  @@index([status])
  @@index([clientId])
  @@index([clientId, status])  // Composite index
}
```

---

### 1.3 Implement HTTP Response Compression

**Current State:** Responses not compressed  
**Impact:** 70% reduction in response payload size  
**Effort:** 10 minutes

**Implementation:**

```javascript
// routes/middleware/compression.js
const compression = require('compression');

// Add to index.js before routes
app.use(compression({
  level: 6,           // Balance: 1-9 (6 is typical)
  threshold: 1024,    // Only compress responses >1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// For large responses that need streaming
app.use((req, res, next) => {
  // Pre-compress common responses
  if (req.path.includes('/api/search') || req.path.includes('/admin/kpis')) {
    res.setHeader('Content-Encoding', 'gzip');
  }
  next();
});
```

**Performance Impact:**
```
Before: 500KB response
After:  150KB response (70% reduction)
Network time: 1000ms → 300ms (at 4G)
```

---

### 1.4 Add Response Caching Headers

**Current State:** No cache control headers  
**Impact:** 50% reduction in repeat requests from clients  
**Effort:** 20 minutes

**Implementation:**

```javascript
// middleware/cacheHeaders.js
function setCacheHeaders(req, res, next) {
  // Public endpoints - cache for 5 minutes
  if (req.path.match(/\/api\/(projects|professionals|search)/) && req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    res.setHeader('Vary', 'Accept-Encoding');
  }
  
  // User-specific - cache for 1 minute
  else if (req.path.match(/\/api\/me/) && req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, max-age=60');
  }
  
  // Sensitive data - no cache
  else if (req.path.match(/\/api\/(payments|auth)/) || req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  
  next();
}

app.use(setCacheHeaders);
```

---

## 2. Medium Effort (4-8 hours, 40-50% improvement)

### 2.1 Fix N+1 Query Problems

**Current Issues:**

```javascript
// ❌ BEFORE: N+1 queries
async function getProjectsWithQuotes() {
  const projects = await prisma.project.findMany();
  
  for (const project of projects) {
    project.quotes = await prisma.quote.findMany({
      where: { projectId: project.id }
    });
    // This runs N additional queries!
  }
  
  return projects;
}

// ✅ AFTER: Single efficient query
async function getProjectsWithQuotes() {
  return prisma.project.findMany({
    include: {
      quotes: true  // Joined efficiently
    }
  });
}
```

**Audit Script:**

```javascript
// scripts/audit-n-plus-one.js
const prisma = require('../config/db');

// Enable query logging
let queryCount = 0;
prisma.$on('query', (e) => {
  queryCount++;
  console.log(`[${queryCount}] ${e.query}`);
});

// Test suspicious endpoints
async function audit() {
  console.log('Testing: GET /api/projects');
  queryCount = 0;
  await getProjectsWithDetails();
  console.log(`Total queries: ${queryCount}\n`);
}
```

**Common N+1 Patterns in MANAWA:**

1. **Projects with quotes:**
```javascript
// Fix this pattern throughout codebase
include: {
  quotes: {
    include: {
      professional: {
        include: { user: true }
      },
      items: true,
      payments: true
    }
  }
}
```

2. **Messages with users:**
```javascript
include: {
  sender: { include: { user: true } },
  receiver: { include: { user: true } }
}
```

3. **Bookings with relationships:**
```javascript
include: {
  project: { include: { client: true } },
  professional: { include: { user: true } },
  payments: true
}
```

**Implementation Steps:**
1. Identify all N+1 patterns using query logging
2. Add proper `include` statements in Prisma queries
3. Test with performance suite
4. Document patterns in team guide

---

### 2.2 Implement Distributed Caching Strategy

**Current State:** Cache inconsistently used  
**Impact:** 50-70% reduction in database load  
**Effort:** 4 hours

**Implementation:**

```javascript
// middleware/advancedCache.js
const redis = require('../config/redis');

// Cache wrapper with TTL management
const cacheManager = {
  // Get with fallback to database
  async get(key, fetcher, ttl = 300) {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
    
    const data = await fetcher();
    await redis.setex(key, ttl, JSON.stringify(data));
    return data;
  },
  
  // Invalidate related cache entries
  async invalidate(pattern) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  },
  
  // Batch operations with cache
  async batch(key, fetcher, options = {}) {
    const { ttl = 300, useRefresh = false } = options;
    
    let cached = await redis.get(key);
    if (cached && !useRefresh) {
      return JSON.parse(cached);
    }
    
    // Background refresh if approaching expiration
    if (cached && useRefresh) {
      const data = await fetcher();
      await redis.setex(key, ttl, JSON.stringify(data));
    }
    
    return JSON.parse(cached);
  }
};

// Usage in routes
router.get('/projects', async (req, res) => {
  const projects = await cacheManager.get(
    'projects:list',
    async () => {
      return prisma.project.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' }
      });
    },
    300  // 5 minute TTL
  );
  
  res.json(projects);
});

// Invalidate on update
router.put('/projects/:id', async (req, res) => {
  const project = await prisma.project.update({
    where: { id: parseInt(req.params.id) },
    data: req.body
  });
  
  // Invalidate related caches
  await cacheManager.invalidate('projects:*');
  await cacheManager.invalidate(`project:${project.id}:*`);
  
  res.json(project);
});
```

**Cache Key Strategy:**
```javascript
const cacheKeys = {
  // Lists with pagination
  projects: (page = 1, limit = 20) => `projects:list:${page}:${limit}`,
  professionals: (filter = '') => `professionals:list:${filter}`,
  
  // Individual resources
  project: (id) => `project:${id}`,
  professional: (id) => `professional:${id}`,
  
  // Aggregations
  kpis: () => 'admin:kpis',
  stats: (period) => `admin:stats:${period}`,
  
  // Search
  search: (query, category) => `search:${query}:${category}`,
};
```

---

### 2.3 Implement Connection Pooling

**Current State:** Default pooling insufficient  
**Impact:** 30% reduction in connection overhead  
**Effort:** 1 hour

**Implementation:**

```javascript
// config/db.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  // Connection pool settings
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?connection_limit=20&pool_size=15'
    }
  },
  
  // Log slow queries
  log: [
    {
      emit: 'event',
      level: 'query',
    },
    {
      emit: 'stdout',
      level: 'error',
    }
  ]
});

// Monitor pool status
prisma.$on('query', (e) => {
  if (e.duration > 1000) {
    console.warn(`Slow query (${e.duration}ms): ${e.query}`);
  }
});

// Graceful connection management
process.on('SIGTERM', async () => {
  console.log('Closing database connections...');
  await prisma.$disconnect();
});
```

**Environment Configuration:**
```bash
# .env
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=20&pool_size=15&max_cached_statement_lifetime=600&max_idle_in_transaction_session_duration=600000"
```

---

### 2.4 Add Request Validation Middleware

**Current State:** Validation scattered  
**Impact:** 15% reduction in bad requests to database  
**Effort:** 2 hours

**Implementation:**

```javascript
// middleware/validateInput.js
const { body, param, query, validationResult } = require('express-validator');

// Centralized validation rules
const validationRules = {
  projectId: param('id')
    .isInt()
    .withMessage('Project ID must be integer'),
  
  page: query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be positive integer'),
  
  limit: query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  projectCreate: [
    body('title')
      .trim()
      .isLength({ min: 5, max: 200 })
      .withMessage('Title must be 5-200 characters'),
    body('description')
      .trim()
      .isLength({ min: 20, max: 5000 })
      .withMessage('Description must be 20-5000 characters'),
    body('budget')
      .isFloat({ min: 0, max: 1000000 })
      .withMessage('Budget must be valid number'),
  ]
};

// Validation handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Usage
router.post(
  '/projects',
  validationRules.projectCreate,
  validate,
  async (req, res) => {
    // Handler
  }
);
```

---

## 3. Major Changes (1-2 days, 50-70% improvement)

### 3.1 Implement Database Read Replicas

**Current State:** All traffic hits primary database  
**Impact:** 3-5x throughput increase for read-heavy workloads  
**Effort:** 8 hours

**Architecture:**
```
                    Primary DB
                   (Write/Read)
                        |
            ____________|____________
           /             |             \
          /              |              \
    Replica 1       Replica 2      Replica 3
    (Read-only)     (Read-only)     (Read-only)
```

**Implementation:**

```javascript
// config/dbReplicas.js
const { PrismaClient } = require('@prisma/client');

// Primary connection (writes)
const primaryPrisma = new PrismaClient({
  datasources: {
    db: { url: process.env.PRIMARY_DATABASE_URL }
  }
});

// Read replicas
const readReplicas = [
  new PrismaClient({
    datasources: {
      db: { url: process.env.REPLICA_1_DATABASE_URL }
    }
  }),
  new PrismaClient({
    datasources: {
      db: { url: process.env.REPLICA_2_DATABASE_URL }
    }
  })
];

let replicaIndex = 0;

// Load balancer
function getReadClient() {
  const replica = readReplicas[replicaIndex];
  replicaIndex = (replicaIndex + 1) % readReplicas.length;
  return replica;
}

module.exports = {
  primary: primaryPrisma,
  read: () => getReadClient(),
  
  // Helper for read-heavy operations
  async readWithFallback(operation) {
    try {
      return await operation(getReadClient());
    } catch (err) {
      // Fallback to primary if replica fails
      return operation(primaryPrisma);
    }
  }
};
```

**Usage:**
```javascript
// routes/projects.js
const db = require('../config/dbReplicas');

router.get('/projects', async (req, res) => {
  // Read from replica
  const projects = await db.read().project.findMany({
    take: 20
  });
  res.json(projects);
});

router.post('/projects', async (req, res) => {
  // Write to primary
  const project = await db.primary.project.create({
    data: req.body
  });
  res.status(201).json(project);
});
```

---

### 3.2 Implement Horizontal Scaling with Load Balancing

**Current State:** Single instance  
**Impact:** Linear scalability with instance count  
**Effort:** 12 hours

**Architecture with Nginx:**

```nginx
# /etc/nginx/nginx.conf
upstream manawa_backend {
  server localhost:4001;
  server localhost:4002;
  server localhost:4003;
  
  # Health checks
  check interval=3000 rise=2 fall=5 timeout=1000;
  
  # Load balancing method
  least_conn;
}

server {
  listen 80;
  server_name api.manawa.app;
  
  location / {
    proxy_pass http://manawa_backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    
    # Connection pooling
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    
    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
  }
  
  # Health check endpoint
  location /health {
    access_log off;
    proxy_pass http://manawa_backend;
  }
}
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  backend-1:
    image: manawa-backend:latest
    ports: ['4001:4000']
    environment:
      - NODE_ENV=production
      - INSTANCE_ID=1
    
  backend-2:
    image: manawa-backend:latest
    ports: ['4002:4000']
    environment:
      - NODE_ENV=production
      - INSTANCE_ID=2
  
  backend-3:
    image: manawa-backend:latest
    ports: ['4003:4000']
    environment:
      - NODE_ENV=production
      - INSTANCE_ID=3
  
  nginx:
    image: nginx:latest
    ports: ['80:80']
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - backend-1
      - backend-2
      - backend-3
```

---

### 3.3 Implement Async Job Queue for Long Operations

**Current State:** Long operations block requests  
**Impact:** Improved response times for users, better resource utilization  
**Effort:** 6 hours

**Implementation:**

```javascript
// config/queue.js
const Queue = require('bull');
const redis = require('./redis');

// Create job queues
const queues = {
  email: new Queue('email', {
    redis: redis.getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    }
  }),
  
  export: new Queue('export', {
    redis: redis.getConnection(),
    defaultJobOptions: {
      attempts: 2,
      timeout: 60000  // 1 minute max
    }
  }),
  
  analytics: new Queue('analytics', {
    redis: redis.getConnection()
  })
};

// Process jobs
queues.email.process(async (job) => {
  const { to, subject, template } = job.data;
  return await sendEmail(to, subject, template);
});

queues.export.process(async (job) => {
  const { projectId, format } = job.data;
  return await generateExport(projectId, format);
});

module.exports = queues;
```

**Usage in Routes:**

```javascript
// Before: Blocks request
router.post('/export', async (req, res) => {
  const file = generateLargeExport(req.body);  // 10 seconds!
  res.download(file);
});

// After: Async queue
router.post('/export', async (req, res) => {
  const job = await queues.export.add({
    projectId: req.body.projectId,
    format: req.body.format
  });
  
  res.json({
    message: 'Export started',
    jobId: job.id,
    statusUrl: `/api/exports/${job.id}`
  });
});

// Check status
router.get('/export/:id', async (req, res) => {
  const job = await queues.export.getJob(req.params.id);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const state = await job.getState();
  const progress = job._progress;
  
  res.json({
    state,
    progress,
    result: job.returnvalue
  });
});
```

---

## 4. Monitoring & Metrics

### 4.1 Add Performance Monitoring

```javascript
// middleware/performanceMonitoring.js
const prometheus = require('prom-client');

const httpDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status']
});

const httpRequestTotal = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    
    httpDuration
      .labels(req.method, route, res.statusCode)
      .observe(duration);
    
    httpRequestTotal
      .labels(req.method, route, res.statusCode)
      .inc();
  });
  
  next();
});

// Expose metrics
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(await prometheus.register.metrics());
});
```

---

## 5. Implementation Priority Matrix

```
                High Impact
                     ↑
                     │
      3.2 Scaling ────┼──── 3.1 Read Replicas
      (70% impact)    │     (50% impact)
                     │
     2.1 N+1 Query ───┼──── 2.2 Caching
     (40-50% impact)  │     (40-50% impact)
                     │
    1.1 Indexing ─────┼──── 1.4 Cache Headers
    (40% impact)      │     (20% impact)
                     │
Low Impact ┌──────────┼──────────┐ High Impact
          │           │          │
   Low →  │        1.2, 1.3     │  ← High
         │      (15-20%)        │
```

**Implementation Order:**
1. **Week 1:** Quick wins (1.1-1.4)
2. **Week 2:** N+1 fixes (2.1)
3. **Week 3:** Caching (2.2)
4. **Week 4:** Scaling (3.1, 3.2)

---

## 6. Validation & Testing

After each optimization:

```bash
# Run performance test
k6 run --vus 100 --duration 5m k6-load-test.js

# Compare results
node analyze-results.js baseline.json optimized.json

# Monitor system
node monitor.js --duration 5m
```

**Success Criteria:**
- p95 response time <500ms (baseline)
- p95 response time <1s (peak)
- Error rate <1%
- Throughput >1000 req/sec

---

**Total Expected Improvement:** 30-70%  
**Total Implementation Time:** 8-40 hours  
**ROI:** High - addresses core performance bottlenecks

---

## Appendix: Code Templates

### Template 1: Cached Endpoint

```javascript
router.get('/api/data/:id', async (req, res) => {
  const cacheKey = `data:${req.params.id}`;
  
  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) return res.json(JSON.parse(cached));
  
  // Fetch from database
  const data = await prisma.data.findUnique({
    where: { id: parseInt(req.params.id) }
  });
  
  // Cache for 5 minutes
  await redis.setex(cacheKey, 300, JSON.stringify(data));
  
  res.json(data);
});
```

### Template 2: Async Job with Status

```javascript
router.post('/api/long-operation', async (req, res) => {
  const job = await queues.process.add({
    data: req.body
  });
  
  res.json({
    jobId: job.id,
    status: 'queued'
  });
});

router.get('/api/long-operation/:jobId', async (req, res) => {
  const job = await queues.process.getJob(req.params.jobId);
  res.json({
    id: job.id,
    status: await job.getState(),
    progress: job._progress,
    result: job.returnvalue
  });
});
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-11-12  
**Review Schedule:** Every 30 days or after 10% performance change
