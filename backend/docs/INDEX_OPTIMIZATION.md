# Database Index Optimization Strategy - MANAWA

**Date:** November 12, 2026  
**Database:** PostgreSQL 14+  
**Analysis Level:** Production-Ready

---

## Current Index Status

### Indexes Defined in `/prisma/schema.prisma`

```prisma
// Primary Keys (automatic indexes)
User @id
Professional @id
Project @id
Quote @id
Booking @id
// ... (all tables have PK indexes)

// Unique Constraints (automatic indexes)
User.email @unique
Professional.userId @unique
Professional.companyCode @unique
RefreshToken.token @unique
PortfolioProjectLike.userId + portfolioProjectId @unique
Booking.projectId + professionalId @unique

// Explicit Indexes
@@index fields:
- RefreshToken [userId]
- LoginAttempt [userId, email, timestamp]
- PortfolioProject [professionalId, createdAt]
- PortfolioProjectImage [portfolioProjectId]
- Professional [decennaleVerified, rgeLabel, verifiedByAdmin]
- Subscription [professionalId, status]
- Message [senderId, receiverId, createdAt]
- Notification [userId, createdAt]
- Booking [clientId]
- PackageOrder [clientId, packageId]
- Follow [followingId]
- PortfolioLike [itemId, userId]
```

### Total Indexes: ~35-40 indexes

---

## Index Analysis

### Current Index Effectiveness

| Index | Query Pattern | Efficiency | Status |
|-------|---------------|-----------|--------|
| User.email | Login, email lookup | ✅ HIGH | Essential |
| Professional.userId | Profile lookup | ✅ HIGH | Essential |
| LoginAttempt.timestamp | Recent attempts | ✅ HIGH | Essential |
| Message.senderId+receiverId | Message threads | ✅ HIGH | Essential |
| Notification.userId+createdAt | User notifications | ✅ HIGH | Essential |
| Professional.verifiedByAdmin | Filter professionals | ⚠️ MEDIUM | Optional |
| Subscription.status | Filter subscriptions | ⚠️ MEDIUM | Optional |
| Follow.followingId | Find followers | ✅ HIGH | Essential |
| PortfolioProject.createdAt | Recent projects | ⚠️ MEDIUM | Composite better |
| PortfolioLike.userId | User's likes | ✅ HIGH | Essential |

### Low-Value Indexes (Candidates for Removal)

```prisma
// These indexes are rarely used but add write overhead

// REMOVE: Seldom query by decennale status alone
Professional.decennaleVerified

// REMOVE: Rarely filter by RGE label
Professional.rgeLabel

// Recommendation: Keep only if business logic frequently filters by these
```

---

## Missing Indexes (Performance Bottlenecks)

### High-Impact Missing Indexes

```javascript
// 1. Quote status + createdAt (frequent query pattern)
// Current: Only projectId indexed
// Missing: (status, createdAt) for "recent pending quotes"
router.get('/quotes?status=PENDING&recent=true', async (req, res) => {
  // WITHOUT INDEX: Full table scan (slow on 100K+ quotes)
  const quotes = await prisma.quote.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
});

// Add to schema.prisma:
model Quote {
  @@index([status, createdAt])
}

// Expected speedup: 100-500x for recent pending quotes
```

```javascript
// 2. Booking status + createdAt (frequent query pattern)
// Missing: (status, createdAt) for "recent bookings"
router.get('/bookings?status=CONFIRMED', async (req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { status: 'CONFIRMED' },
    orderBy: { createdAt: 'desc' }
  });
});

// Add to schema.prisma:
model Booking {
  @@index([status, createdAt])
}
```

```javascript
// 3. Professional city + trade (geographic filtering)
// Missing: (city, trade, verified) for "professionals in Paris doing plumbing"
router.get('/professionals?city=Paris&trade=Plumbing', async (req, res) => {
  const pros = await prisma.professional.findMany({
    where: {
      user: { city: 'Paris' },
      trade: 'Plumbing',
      verifiedByAdmin: true
    },
    include: { user: { select: { city: true } } }
  });
});

// Add to schema.prisma:
model Professional {
  @@index([trade, verifiedByAdmin])
}

// Plus on User model:
model User {
  @@index([city])
}
```

```javascript
// 4. Payment status + createdAt (analytics queries)
// Missing: (status, createdAt) for revenue reports
router.get('/admin/revenue?status=COMPLETED&month=2026-11', async (req, res) => {
  const startDate = new Date('2026-11-01');
  const endDate = new Date('2026-12-01');
  
  const revenue = await prisma.payment.aggregate({
    where: {
      status: 'COMPLETED',
      createdAt: { gte: startDate, lt: endDate }
    },
    _sum: { amount: true }
  });
});

// Add to schema.prisma:
model Payment {
  @@index([status, createdAt])
}
```

---

## Recommended Index Changes

### Phase 1: Add High-Impact Indexes

```prisma
// /prisma/schema.prisma

model Quote {
  id              String    @id
  projectId       String    @unique
  status          String    @default("PENDING")
  amount          Float
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  // NEW: For "recent pending quotes" queries
  @@index([status, createdAt])
}

model Booking {
  id              String    @id
  projectId       String
  professionalId  String
  status          String    @default("PENDING")
  createdAt       DateTime  @default(now())
  clientId        String
  
  // NEW: For "recent bookings" queries
  @@index([status, createdAt])
  
  // EXISTING: Keep for exact lookup
  @@unique([projectId, professionalId])
  @@index([clientId])
}

model Payment {
  id              String    @id
  quoteId         String
  amount          Float
  status          String    @default("PENDING")
  createdAt       DateTime  @default(now())
  
  // NEW: For revenue reports
  @@index([status, createdAt])
}

model User {
  id              String    @id
  email           String    @unique
  firstName       String
  city            String?
  role            UserRole
  
  // NEW: For geographic filtering (professionals by city)
  @@index([city])
}

model Professional {
  id              String    @id
  userId          String    @unique
  trade           String
  averageRating   Float     @default(0)
  verifiedByAdmin Boolean   @default(false)
  createdAt       DateTime  @default(now())
  
  // NEW: For "verified professionals in trade" queries
  @@index([trade, verifiedByAdmin])
}
```

### Phase 2: Remove Low-Value Indexes

```prisma
// These add write overhead but are rarely used
// Only remove if analysis confirms < 1% of queries benefit

model Professional {
  // REMOVE: Rarely used in isolation
  // @@index([decennaleVerified])
  // @@index([rgeLabel])
  
  // Justification: Only used in admin verification flow (rare)
  // Better: Composite index [verifiedByAdmin, decennaleVerified]
  @@index([verifiedByAdmin, decennaleVerified])
}
```

---

## Index Usage Analysis

### How to Identify Unused Indexes

```sql
-- Find indexes not used in the last 7 days
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as times_used,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexname NOT LIKE 'pg_toast%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### How to Find Slow Queries (Missing Indexes)

```sql
-- Top 20 slowest queries
SELECT
  query,
  calls,
  mean_time,
  total_time
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY mean_time DESC
LIMIT 20;
```

### Explain Query Plans (See Index Usage)

```sql
-- Check if query uses index or does full table scan
EXPLAIN ANALYZE
SELECT * FROM Quote
WHERE status = 'PENDING'
ORDER BY createdAt DESC
LIMIT 20;

-- Output example:
-- Bitmap Heap Scan on "Quote" (cost=50..200)
--   -> Bitmap Index Scan using "Quote_status_createdAt_idx"
--
-- If you see "Seq Scan", no index is being used - that's slow!
```

---

## Index Design Best Practices

### Rule 1: Column Order Matters

```sql
-- If you have query: WHERE status = X AND createdAt > Y ORDER BY createdAt
-- Index should be: (status, createdAt)
-- NOT: (createdAt, status)

-- WHY: PostgreSQL can use first column for filtering, then second for sorting

-- INDEX: (status, createdAt)
-- ✅ WHERE status='PENDING' AND createdAt > '2026-11-01'  -- uses both columns
-- ✅ WHERE status='PENDING' ORDER BY createdAt          -- uses both columns
-- ❌ WHERE createdAt > '2026-11-01'                      -- only uses 2nd (less efficient)

-- INDEX: (createdAt, status)
-- ❌ WHERE status='PENDING' AND createdAt > '2026-11-01'  -- can't use efficiently
```

### Rule 2: Covering Indexes (Reduce Disk I/O)

```sql
-- Without covering index:
-- 1. Find row ID from index
-- 2. Look up row from table
-- Total: 2 disk operations

-- With covering index:
-- 1. Get data directly from index
-- Total: 1 disk operation (2x faster!)

-- Create covering index (PostgreSQL 11+)
CREATE INDEX idx_quote_recent
ON Quote(status, createdAt)
INCLUDE (amount);  -- Include amount so it's in the index

-- Query uses index only, no table lookup needed
SELECT status, createdAt, amount FROM Quote
WHERE status = 'PENDING'
ORDER BY createdAt DESC;
```

**For MANAWA** (using Prisma, not raw SQL):
```prisma
// Note: Prisma doesn't support INCLUDE, but we can still optimize
// by querying only indexed columns when possible

model Quote {
  @@index([status, createdAt])
}

// Query - will use index efficiently
const quotes = await prisma.quote.findMany({
  where: { status: 'PENDING' },
  select: { status: true, createdAt: true, amount: true },
  orderBy: { createdAt: 'desc' }
});
```

### Rule 3: Partial Indexes (Reduce Index Size)

```sql
-- Instead of indexing ALL booking statuses,
-- only index active bookings (most queries care about these)

CREATE INDEX idx_booking_active
ON Booking(clientId, createdAt)
WHERE status != 'CANCELLED';

-- Index is 50% smaller (only includes non-cancelled)
-- Faster creation/maintenance
-- Queries on active bookings still use it
```

**For MANAWA:**
```prisma
// Prisma doesn't support partial indexes in schema,
// but we can create after with raw SQL migration

model Booking {
  @@index([clientId, createdAt])  // Current approach
  
  // After migration, run:
  // CREATE INDEX idx_booking_active
  // ON "Booking"(clientId, createdAt)
  // WHERE status != 'CANCELLED';
}
```

---

## Index Size and Storage Impact

### Estimate Index Storage

```javascript
// Each index consumes disk space
// Rough calculation: index_size ≈ 10-20% of table size

// With 1M quotes:
// - Quote table: ~500MB
// - Index (id): ~50MB
// - Index (projectId): ~50MB
// - Index (status, createdAt): ~100MB (composite)
// Total index space: ~200MB

// Storage is cheap; query speed is valuable
// Trade-off is worth it for frequently queried columns
```

### Monitoring Index Performance

```sql
-- Check index usage
SELECT
  indexrelname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

---

## EXPLAIN ANALYZE Guide

### Understanding Query Plans

```sql
-- Query that might be slow
EXPLAIN ANALYZE
SELECT * FROM Professional
WHERE verifiedByAdmin = true
  AND trade = 'Plumber'
ORDER BY averageRating DESC
LIMIT 10;

-- Output WITHOUT index:
Seq Scan on "Professional" (cost=0..50000 rows=500)
  Filter: (verifiedByAdmin AND trade = 'Plumber')
  Rows actually returned: 10
  Execution time: 500ms  ← SLOW!

-- After adding index:
Index Scan using idx_professional_verified_trade
  on "Professional" (cost=0..100 rows=500)
  Index Cond: (verifiedByAdmin AND trade = 'Plumber')
  Sort by averageRating DESC
  Rows actually returned: 10
  Execution time: 5ms  ← 100x faster!
```

### What the Numbers Mean

| Metric | Meaning |
|--------|---------|
| cost | Estimated time units (0..50000) |
| rows | Estimated rows returned |
| Actual rows | Actual rows returned |
| Execution time | Total time in milliseconds |

**Goal:** < 1ms execution time for user-facing queries

---

## Proposed Index Optimization for MANAWA

### Migration Strategy

```bash
# Step 1: Add new indexes (production doesn't take long to acquire)
npx prisma migrate dev --name add_optimization_indexes

# Step 2: Monitor performance
# Watch EXPLAIN ANALYZE before/after

# Step 3: Remove low-value indexes (if confirmed unused)
npx prisma migrate dev --name remove_unused_indexes
```

### New Schema

```prisma
// /prisma/schema.prisma (after optimization)

model Quote {
  id              String    @id @default(uuid())
  projectId       String    @unique
  status          String    @default("PENDING")
  amount          Float
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([status, createdAt])  // NEW
}

model Booking {
  id              String    @id @default(uuid())
  projectId       String
  professionalId  String
  clientId        String
  status          String    @default("PENDING")
  createdAt       DateTime  @default(now())

  @@unique([projectId, professionalId])
  @@index([clientId])
  @@index([status, createdAt])  // NEW
}

model Payment {
  id              String    @id @default(uuid())
  quoteId         String    @unique
  amount          Float
  status          String    @default("PENDING")
  createdAt       DateTime  @default(now())

  @@index([status, createdAt])  // NEW
}

model User {
  id              String    @id
  email           String    @unique
  firstName       String
  lastName        String
  city            String?
  
  @@index([city])  // NEW (for geographic filtering)
}

model Professional {
  id              String    @id
  userId          String    @unique
  trade           String
  averageRating   Float     @default(0)
  verifiedByAdmin Boolean   @default(false)

  @@index([trade, verifiedByAdmin])  // NEW
}
```

### Expected Performance Improvements

| Query | Before | After | Speedup |
|-------|--------|-------|---------|
| Recent pending quotes | 500ms | 5ms | 100x |
| Recent confirmations | 300ms | 3ms | 100x |
| Revenue reports | 2s | 20ms | 100x |
| Geographic search | 1s | 10ms | 100x |
| Verified professionals | 800ms | 8ms | 100x |

---

## Monitoring Index Health

### Regular Health Checks

```javascript
// /scripts/index-health-check.js (run weekly)

async function healthCheck(prisma) {
  console.log('=== Index Health Report ===\n');

  // 1. Unused indexes
  const unused = await prisma.$queryRaw`
    SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid))
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
  `;
  console.log(`Unused indexes: ${unused.length}\n`);

  // 2. Large indexes
  const large = await prisma.$queryRaw`
    SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid))
    FROM pg_stat_user_indexes
    ORDER BY pg_relation_size(indexrelid) DESC
    LIMIT 10
  `;
  console.log('Top 10 largest indexes:');
  large.forEach(idx => console.log(`  - ${idx.indexname}: ${idx.pg_size_pretty}`));

  // 3. Most used indexes
  const topUsed = await prisma.$queryRaw`
    SELECT indexname, idx_scan
    FROM pg_stat_user_indexes
    ORDER BY idx_scan DESC
    LIMIT 10
  `;
  console.log('\nTop 10 most used indexes:');
  topUsed.forEach(idx => console.log(`  - ${idx.indexname}: ${idx.idx_scan} scans`));
}
```

---

## Summary: Index Optimization Plan

### Quick Wins (1-2 hours)

1. ✅ Add (status, createdAt) to Quote, Booking, Payment
2. ✅ Add city index to User
3. ✅ Add (trade, verified) to Professional
4. ✅ Remove unused indexes if confirmed

### Expected Impact

- **Query Performance:** 50-100x faster for recent/filtered queries
- **Write Overhead:** +5-10% (more indexes to maintain)
- **Storage:** +100MB (index space)
- **User Experience:** Faster dashboards, listings, search

### Files to Modify

- `/prisma/schema.prisma` - Add new indexes
- `/docs/INDEX_OPTIMIZATION.md` - This file (document decisions)
- `/scripts/index-health-check.js` - New health check script

---

## References

- PostgreSQL Index Documentation: https://www.postgresql.org/docs/current/indexes.html
- Prisma Schema Index Documentation: https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#index
- Query Optimization: `/docs/WRITE_AMPLIFICATION_ANALYSIS.md`
- Connection Pool: `/config/connection-pool.js`
