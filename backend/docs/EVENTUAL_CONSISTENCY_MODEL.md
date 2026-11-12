# Eventual Consistency Model - MANAWA

**Date:** November 12, 2026  
**Database:** PostgreSQL 14+ with read replicas  
**Configuration File:** `/config/database-replication.js`

---

## Overview

Eventual consistency means that if no new writes are made, all reads will eventually return the same value (after replication lag resolves). MANAWA uses this model strategically for read replicas.

---

## When Eventual Consistency Applies

### 1. Read Replicas Are Always Eventually Consistent

```
Primary Database (Authoritative):
  UPDATE professional SET averageRating = 4.8 WHERE id = 'pro-123'
  
Write-Ahead Log (WAL):
  Replicates to replicas asynchronously
  
Read Replica 1:
  Receives replication: avgRating = 4.8 (arrives after ~50ms)
  
Read Replica 2:
  Receives replication: avgRating = 4.8 (arrives after ~100ms)
```

**Replication Lag Ranges:**
- Typical: 50-200ms (LAN/same cloud region)
- Acceptable: < 500ms
- Concerning: 500ms - 5s
- Critical: > 5s (replica out of sync)

### 2. When Eventual Consistency is Acceptable

```javascript
// ✅ Analytics queries (eventual consistency fine)
router.get('/analytics/top-professionals', async (req, res) => {
  // Use read replica - data 100ms old is acceptable
  const replicas = await prisma.professional.findMany({
    where: { verified: true },
    orderBy: { averageRating: 'desc' },
    take: 10
  });
  res.json(replicas);
});

// ✅ Public profile views (eventual consistency acceptable)
router.get('/professionals/:id/public', async (req, res) => {
  // Profile may be slightly stale - acceptable
  const pro = await prisma.professional.findUnique({
    where: { id: req.params.id }
  });
  res.json(pro);
});

// ✅ Follower counts (eventual consistency acceptable)
router.get('/professionals/:id/followers', async (req, res) => {
  const count = await prisma.professional.findUnique({
    where: { id: req.params.id },
    select: { _count: { select: { followers: true } } }
  });
  // Follower count 100ms old is fine
  res.json(count);
});

// ✅ Feed/timeline (eventual consistency by design)
router.get('/feed', requireAuth, async (req, res) => {
  // Feed can be 100ms+ stale (common in all apps)
  const posts = await prisma.portfolio.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  res.json(posts);
});
```

### 3. When Eventual Consistency is NOT Acceptable

```javascript
// ❌ MUST use primary for these (strong consistency required)

// User payment confirmation
router.post('/payments/:id/confirm', requireAuth, async (req, res) => {
  // Get current status from PRIMARY (not replica)
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id }
  });
  // Cannot use stale data - payment already confirmed?
  if (payment.status !== 'PENDING') {
    return res.status(409).json({ error: 'Payment already confirmed' });
  }
  // ✅ Use primary read
});

// Check booking availability
router.get('/availability/:slotId', requireAuth, async (req, res) => {
  // Must be current - slot may have been booked in last 50ms
  const slot = await prisma.availabilitySlot.findUnique({
    where: { id: req.params.slotId }
  });
  // ✅ Use primary read
});

// User authentication / session validation
router.get('/me', requireAuth, async (req, res) => {
  // Must be fresh - permissions may have changed seconds ago
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });
  // ✅ Use primary read for critical auth checks
});
```

---

## Replication Lag Strategy

### Monitoring Replication Lag

```javascript
// File: /config/database-replication.js
async function monitorReplicationLag() {
  for (let replica of readReplicas) {
    const result = await replica.$queryRaw`
      SELECT
        slot_name,
        write_lag,
        flush_lag,
        replay_lag
      FROM pg_replication_slots
    `;
    
    console.log(`Replica ${replica.id} lag: ${result.replay_lag}ms`);
  }
}
```

### Lag Scenarios

| Lag Duration | Status | Action |
|--------------|--------|--------|
| 0-100ms | ✅ HEALTHY | Use normally for reads |
| 100-500ms | ⚠️ ACCEPTABLE | Use for non-critical reads |
| 500ms-5s | ⚠️ CONCERNING | Monitor for issues, use primary for critical |
| > 5s | 🔴 CRITICAL | Read replica unhealthy, use primary only |

### Fallback Strategy

```javascript
// Auto-fallback to primary if replica lag too high
function getReadConnection(maxLagMs = 500) {
  for (let replica of readReplicas) {
    if (replica.lag <= maxLagMs && replica.connected) {
      return replica.prisma;  // Use replica
    }
  }
  // All replicas too laggy or disconnected
  return primaryPrisma;  // Fallback to primary
}
```

---

## Use Cases: Read Replica vs Primary

### Decision Matrix

```
Question: Should I read from replica or primary?

1. Do I need real-time data (< 100ms old)?
   NO  → Use replica (eventually consistent)
   YES → Use primary

2. Is this user-facing and critical?
   NO  → Use replica (analytics, public data)
   YES → Consider primary

3. Is data freshness guaranteed elsewhere?
   YES (e.g., cache revalidation) → Use replica
   NO  → Use primary

4. High throughput read (> 1000 QPS)?
   YES → Use replicas (load balancing)
   NO  → Either is fine
```

### Example Implementations

#### Case 1: Professional Profile Page

```javascript
router.get('/professionals/:id', async (req, res) => {
  // Strategy: Use read replica (public page, eventual consistency fine)
  const professional = await replication.getReadReplica().professional.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { firstName: true, lastName: true } },
      portfolio: true
    }
  });
  
  // Cache result for 60 seconds
  res.set('Cache-Control', 'public, max-age=60');
  res.json(professional);
});
```

#### Case 2: Payment Verification

```javascript
router.post('/quotes/:id/convert-to-payment', requireAuth, async (req, res) => {
  // Strategy: Always use primary (financial data needs strong consistency)
  const quote = await replication.getPrimary().quote.findUnique({
    where: { id: req.params.id }
  });
  
  if (!quote || quote.status !== 'ACCEPTED') {
    return res.status(400).json({ error: 'Quote not valid' });
  }
  
  const payment = await replication.getPrimary().$transaction(async (tx) => {
    return tx.payment.create({
      data: { quoteId: quote.id, amount: quote.amount }
    });
  });
  
  res.json(payment);
});
```

#### Case 3: Analytics Dashboard

```javascript
router.get('/admin/analytics/revenue', requireAuth, async (req, res) => {
  // Strategy: Use read replica (analytics eventual consistency acceptable)
  const stats = await replication.getReadReplica().payment.aggregate({
    where: { status: 'COMPLETED' },
    _sum: { amount: true },
    _count: true
  });
  
  // Cache result for 5 minutes (lag acceptable)
  res.set('Cache-Control', 'private, max-age=300');
  res.json({
    totalRevenue: stats._sum.amount,
    paymentCount: stats._count
  });
});
```

#### Case 4: User Feed

```javascript
router.get('/feed', requireAuth, async (req, res) => {
  // Strategy: Use read replica (feed eventual consistency by design)
  const posts = await replication.getReadReplica().portfolio.findMany({
    where: { professional: { user: { suspendedAt: null } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      professional: {
        include: { user: { select: { firstName: true, lastName: true } } }
      },
      _count: { select: { likes: true, comments: true } }
    }
  });
  
  // Cache for 30 seconds (refresh regularly)
  res.set('Cache-Control', 'private, max-age=30');
  res.json(posts);
});
```

---

## Handling Replication Lag in User Experience

### Strategy 1: Accept Eventual Consistency

```javascript
// Tell user data may be delayed
router.get('/notifications', requireAuth, async (req, res) => {
  const notifications = await replication.getReadReplica().notification.findMany({
    where: { userId: req.user.id },
    take: 20
  });
  
  res.json({
    notifications,
    note: 'Data may be up to 100ms old'  // Transparency
  });
});
```

### Strategy 2: Read-After-Write Consistency

```javascript
// After user performs action, ensure read sees their own write

router.post('/portfolio-projects', requireAuth, async (req, res) => {
  // Write to primary
  const project = await replication.getPrimary().portfolioProject.create({
    data: {
      professionalId: req.user.professional.id,
      title: req.body.title
    }
  });
  
  // Return written data immediately (no read needed)
  // User sees their own write immediately
  res.json(project);
});
```

### Strategy 3: Refresh on Critical Changes

```javascript
router.post('/quotes/:id/accept', requireAuth, async (req, res) => {
  // Write to primary
  const updatedQuote = await replication.getPrimary().quote.update({
    where: { id: req.params.id },
    data: { status: 'ACCEPTED' }
  });
  
  // Wait briefly for replication to complete (50-100ms)
  await new Promise(r => setTimeout(r, 150));
  
  // Re-read from primary to ensure user sees consistent view
  const fresh = await replication.getPrimary().quote.findUnique({
    where: { id: req.params.id }
  });
  
  res.json(fresh);
});
```

---

## Data Consistency Patterns

### Pattern 1: Cache Invalidation on Write

```javascript
// Invalidate cache when data changes
router.put('/professionals/:id', requireAuth, async (req, res) => {
  // Update in primary
  const updated = await replication.getPrimary().professional.update({
    where: { id: req.params.id },
    data: req.body
  });
  
  // Invalidate cache (force refresh from DB next read)
  await redis.del(`professional:${req.params.id}`);
  
  res.json(updated);
});

// Read from cache or replica
router.get('/professionals/:id', async (req, res) => {
  // Check cache first
  const cached = await redis.get(`professional:${req.params.id}`);
  if (cached) {
    res.set('X-Cache', 'HIT');
    return res.json(JSON.parse(cached));
  }
  
  // Cache miss - read from replica
  const pro = await replication.getReadReplica().professional.findUnique({
    where: { id: req.params.id }
  });
  
  // Cache for 5 minutes
  await redis.setex(
    `professional:${req.params.id}`,
    300,
    JSON.stringify(pro)
  );
  
  res.set('X-Cache', 'MISS');
  res.json(pro);
});
```

### Pattern 2: Versioning for Consistency

```javascript
// Include version number to detect stale reads
model Professional {
  id        String    @id
  name      String
  rating    Float
  version   Int       @default(1)  // Increment on update
  updatedAt DateTime  @updatedAt
}

// On write: increment version
await prisma.professional.update({
  where: { id },
  data: {
    rating: newRating,
    version: { increment: 1 }
  }
});

// On read: include version
const pro = await replication.getReadReplica().professional.findUnique({
  where: { id }
});

// Client-side consistency check
if (clientVersion === serverVersion) {
  // Data is current
} else {
  // Stale data detected - refresh from primary
}
```

### Pattern 3: Async Updates (Delayed Consistency)

```javascript
// Some operations can be delayed (eventually consistent)

// Increment follow count asynchronously
router.post('/users/:id/follow', requireAuth, async (req, res) => {
  // Create follow relationship immediately
  const follow = await replication.getPrimary().follow.create({
    data: {
      followerId: req.user.id,
      followingId: req.params.id
    }
  });
  
  // Queue async job to update follower count
  // (happens in background, eventual consistency)
  queue.add('updateFollowerCount', {
    userId: req.params.id
  });
  
  res.json({ success: true });
});

// Job runs asynchronously
jobs.on('updateFollowerCount', async (data) => {
  // Count followers
  const count = await prisma.follow.count({
    where: { followingId: data.userId }
  });
  
  // Update counter (eventual consistency ok here)
  await prisma.professional.update({
    where: { userId: data.userId },
    data: { followerCount: count }
  });
});
```

---

## Monitoring Consistency

```javascript
// Health check: Verify replicas are in sync
async function monitorConsistency() {
  // Get count from primary
  const primaryCount = await replication.getPrimary().user.count();
  
  // Get count from each replica
  for (let replica of replication.readReplicas) {
    const replicaCount = await replica.prisma.user.count();
    
    if (primaryCount !== replicaCount) {
      console.warn('Consistency lag detected', {
        primary: primaryCount,
        replica: replicaCount,
        diff: primaryCount - replicaCount
      });
    }
  }
}

// Run every 60 seconds
setInterval(monitorConsistency, 60000);
```

---

## Configuration Best Practices

### `.env` Configuration

```bash
# Replication settings
DATABASE_PRIMARY_URL=postgresql://...@primary.db:5432/manawa
DATABASE_REPLICA_URLS=postgresql://...@replica1.db:5432/manawa,postgresql://...@replica2.db:5432/manawa

# Tuning for consistency
REPLICATION_LAG_THRESHOLD_MS=500  # Alert if lag > 500ms
REPLICA_FALLBACK_TIMEOUT_MS=2000  # Timeout before fallback to primary
```

### Code Configuration

```javascript
// Get replica with fallback to primary if lag too high
function getConsistentReadConnection(maxLagMs = 100) {
  if (maxLagMs <= 0) {
    return replication.getPrimary();  // Force primary
  }
  
  return replication.getReadReplica();  // Get replica (handles fallback)
}
```

---

## Summary: When to Use What

| Scenario | Connection | Lag Tolerance | Reasoning |
|----------|-----------|---------------|-----------|
| Public profile view | Replica | 100ms-1s | Cache covers lag |
| User's own profile | Primary | Real-time | Strong consistency |
| Payment history | Primary | Real-time | Financial data |
| Analytics dashboard | Replica | 5-60s | Eventual consistency ok |
| Notification feed | Replica | 100ms-500ms | Cache revalidates |
| Booking availability | Primary | Real-time | Cannot be stale |
| Badge list | Replica | 1-5s | Static data |
| User follows | Primary | Real-time | User experiences immediately |
| Comments on post | Replica | 500ms-1s | Eventual consistency fine |
| Like count | Replica | 1-5s | Approximation acceptable |

---

## References

- Replication Configuration: `/config/database-replication.js`
- Transaction Isolation: `/docs/TRANSACTION_ISOLATION_LEVELS.md`
- ACID Verification: `/docs/ACID_VERIFICATION.md`
- PostgreSQL Replication: https://www.postgresql.org/docs/current/warm-standby.html
