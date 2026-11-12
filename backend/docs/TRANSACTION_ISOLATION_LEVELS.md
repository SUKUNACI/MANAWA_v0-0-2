# Transaction Isolation Levels Strategy - MANAWA

**Date:** November 12, 2026  
**Database:** PostgreSQL 14+  
**Configuration File:** `/config/query-timeout.js`

---

## Overview

PostgreSQL supports 4 SQL isolation levels. Each provides different protections against concurrent transaction anomalies.

---

## 1. READ_UNCOMMITTED

**Definition:** Lowest isolation; transactions can see uncommitted (dirty) changes.

### PostgreSQL Implementation
- PostgreSQL treats READ_UNCOMMITTED the same as READ_COMMITTED
- True dirty reads are not possible

### Usage in MANAWA
- **NOT USED** (PostgreSQL prevents true dirty reads)
- No configuration needed

### Anomalies Protected Against
- None (lowest protection)

---

## 2. READ_COMMITTED (Default)

**Definition:** Transactions can only see committed data; provides basic isolation.

### PostgreSQL Implementation
- Uses MVCC (Multi-Version Concurrency Control)
- Each query sees only committed rows
- Other transactions' uncommitted changes remain invisible

### Protection Against Anomalies

| Anomaly | Protected? | Explanation |
|---------|-----------|-------------|
| Dirty reads | ✅ YES | Cannot see uncommitted changes |
| Non-repeatable reads | ❌ NO | Can see row updates from other transactions |
| Phantom reads | ❌ NO | Can see new rows inserted by other transactions |
| Lost updates | ⚠️ RISKY | Needs explicit handling |

### Real-World Example: User Profile Update

```javascript
// Transaction 1: Fetch user profile
const user1 = await prisma.user.findUnique({ where: { id: 'user-123' } });
console.log(user1.phone);  // "+33 1 23 45 67 89"

// Meanwhile...
// Transaction 2: Updates phone
await prisma.user.update({
  where: { id: 'user-123' },
  data: { phone: '+33 9 87 65 43 21' }
});

// Back to Transaction 1: Fetch again
const user2 = await prisma.user.findUnique({ where: { id: 'user-123' } });
console.log(user2.phone);  // "+33 9 87 65 43 21" (CHANGED! Non-repeatable read)
```

### When to Use READ_COMMITTED

```javascript
// MANAWA Operations using READ_COMMITTED

// ✅ Profile page views (can tolerate slight staleness)
router.get('/professionals/:id', async (req, res) => {
  const pro = await prisma.professional.findUnique({
    where: { id: req.params.id },
    include: { user: true }  // READ_COMMITTED default
  });
  res.json(pro);
});

// ✅ Listing projects (eventual consistency acceptable)
router.get('/projects', async (req, res) => {
  const projects = await prisma.project.findMany({
    take: 50,
    orderBy: { createdAt: 'desc' }
  });
  res.json(projects);
});

// ✅ Analytics queries (eventual consistency)
router.get('/analytics/revenue', async (req, res) => {
  const revenue = await prisma.payment.aggregate({
    _sum: { amount: true },
    where: { status: 'COMPLETED' }
  });
  res.json(revenue);
});
```

### Configuration

```javascript
// Default for all queries
await prisma.$transaction(
  async (tx) => {
    return tx.user.findUnique({ where: { id: 'user-123' } });
  }
  // isolationLevel defaults to 'ReadCommitted'
);
```

---

## 3. REPEATABLE_READ

**Definition:** Once transaction reads a row, it always sees the same version.

### PostgreSQL Implementation
- Snapshot isolation: Each transaction gets consistent view of database
- At transaction START, a snapshot is taken
- All subsequent reads see this snapshot
- Other commits don't affect the snapshot

### Protection Against Anomalies

| Anomaly | Protected? | Explanation |
|---------|-----------|-------------|
| Dirty reads | ✅ YES | Cannot see uncommitted |
| Non-repeatable reads | ✅ YES | Rows don't change within transaction |
| Phantom reads | ❌ NO | New rows from other transactions visible |
| Lost updates | ✅ YES | Guaranteed (with MVCC) |

### Real-World Example: Quote Pricing Validation

```javascript
// PROBLEM: Quote amount changes during transaction
await prisma.$transaction(async (tx) => {
  // Read 1: Get current price
  const package1 = await tx.servicePackage.findUnique({
    where: { id: 'pkg-123' }
  });
  console.log(package1.pricePerHour);  // €75

  // Meanwhile, admin updates price to €85
  // (This commit is visible to READ_COMMITTED, invisible to REPEATABLE_READ)

  // Read 2: Get price again
  const package2 = await tx.servicePackage.findUnique({
    where: { id: 'pkg-123' }
  });
  
  if (package1.pricePerHour !== package2.pricePerHour) {
    // READ_COMMITTED: prices differ (NON-REPEATABLE READ)
    // REPEATABLE_READ: prices match (snapshot consistency)
  }
});
```

### When to Use REPEATABLE_READ

```javascript
// MANAWA Financial Operations

// ✅ Quote creation (prices must not change)
router.post('/quotes', requireAuth, async (req, res) => {
  const quote = await prisma.$transaction(
    async (tx) => {
      // Get consistent snapshot of service, rates
      const service = await tx.servicePackage.findUnique({
        where: { id: req.body.serviceId }
      });

      // Calculate based on snapshot (rates won't change)
      const estimatedHours = req.body.scope / service.hoursPerUnit;
      const amount = estimatedHours * service.pricePerHour;

      // Create quote at locked price
      return tx.quote.create({
        data: {
          projectId: req.body.projectId,
          amount,
          serviceId: service.id
        }
      });
    },
    { isolationLevel: 'RepeatableRead' }
  );
  res.json(quote);
});

// ✅ Subscription upgrade (check balance consistency)
router.post('/subscriptions/upgrade', requireAuth, async (req, res) => {
  const result = await prisma.$transaction(
    async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id: req.body.subscriptionId }
      });

      // Ensure balance hasn't changed
      const subAgain = await tx.subscription.findUnique({
        where: { id: req.body.subscriptionId }
      });

      if (sub.balance !== subAgain.balance) {
        throw new Error('Balance changed during upgrade');
      }

      return tx.subscription.update({
        where: { id: req.body.subscriptionId },
        data: { tier: req.body.newTier }
      });
    },
    { isolationLevel: 'RepeatableRead' }
  );
  res.json(result);
});
```

### Configuration

```javascript
await prisma.$transaction(
  async (tx) => {
    // Transaction body
  },
  { isolationLevel: 'RepeatableRead' }
);
```

### Phantom Read Scenario (Still Possible)

```javascript
// Transaction with REPEATABLE_READ
await prisma.$transaction(
  async (tx) => {
    // Count 1: How many professionals in Paris?
    const count1 = await tx.professional.count({
      where: { city: 'Paris' }
    });
    console.log(count1);  // 1250

    // Meanwhile, another transaction inserts 50 new Paris professionals
    
    // Count 2: Recount professionals in Paris
    const count2 = await tx.professional.count({
      where: { city: 'Paris' }
    });
    console.log(count2);  // 1300 (PHANTOM READ - new rows visible)
  },
  { isolationLevel: 'RepeatableRead' }
);
```

**Impact on MANAWA:** Low risk (analytics accept phantom reads; business logic avoids range queries in transactions)

---

## 4. SERIALIZABLE

**Definition:** Strongest isolation; transactions behave as if they execute sequentially.

### PostgreSQL Implementation
- Detects serialization conflicts automatically
- If conflict detected: Transaction aborted with error
- Application must retry on serialization conflict

### Protection Against Anomalies

| Anomaly | Protected? | Explanation |
|---------|-----------|-------------|
| Dirty reads | ✅ YES | Cannot see uncommitted |
| Non-repeatable reads | ✅ YES | Rows don't change |
| Phantom reads | ✅ YES | No new rows possible |
| Lost updates | ✅ YES | Guaranteed |

### Real-World Example: Double-Booking Prevention

```javascript
// PROBLEM: Two transactions book same slot simultaneously
// Solution: Use SERIALIZABLE isolation

router.post('/bookings', requireAuth, async (req, res) => {
  let retries = 0;
  const maxRetries = 3;

  while (retries < maxRetries) {
    try {
      const booking = await prisma.$transaction(
        async (tx) => {
          // Check slot not already booked
          const existing = await tx.booking.findFirst({
            where: {
              availabilitySlotId: req.body.slotId,
              status: { not: 'CANCELLED' }
            }
          });

          if (existing) {
            throw new Error('Slot already booked');
          }

          // Create booking
          return tx.booking.create({
            data: {
              availabilitySlotId: req.body.slotId,
              clientId: req.user.id,
              status: 'CONFIRMED'
            }
          });
        },
        { isolationLevel: 'Serializable' }
      );

      res.json(booking);
      return;

    } catch (err) {
      if (err.code === 'P2034') {  // Serialization conflict
        retries++;
        if (retries >= maxRetries) {
          throw new Error('Booking failed after retries (slot unavailable)');
        }
        // Exponential backoff before retry
        await new Promise(r => setTimeout(r, Math.pow(2, retries) * 100));
      } else {
        throw err;  // Other error
      }
    }
  }
});
```

### When to Use SERIALIZABLE

```javascript
// CRITICAL: Operations that CANNOT tolerate any race conditions

// ✅ Payment processing (no double-charges)
async function processPayment(quoteId, amount) {
  return await prisma.$transaction(
    async (tx) => {
      // Check payment not already made
      const existing = await tx.payment.findFirst({
        where: { quoteId }
      });

      if (existing) throw new Error('Already paid');

      // Create payment
      return tx.payment.create({
        data: { quoteId, amount, status: 'PENDING' }
      });
    },
    { isolationLevel: 'Serializable' }
  );
}

// ✅ Booking confirmation (prevent double-booking)
async function confirmBooking(slotId, clientId) {
  return await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { availabilitySlotId: slotId, status: { not: 'CANCELLED' } }
      });

      if (booking) throw new Error('Slot taken');

      return tx.booking.create({
        data: { availabilitySlotId: slotId, clientId }
      });
    },
    { isolationLevel: 'Serializable' }
  );
}

// ✅ Referral redemption (one-time per referral)
async function redeemReferral(referralCode, userId) {
  return await prisma.$transaction(
    async (tx) => {
      const referral = await tx.referral.findUnique({
        where: { code: referralCode }
      });

      if (referral.redeemedBy) throw new Error('Already redeemed');

      return tx.referral.update({
        where: { code: referralCode },
        data: { redeemedBy: userId, redeemedAt: new Date() }
      });
    },
    { isolationLevel: 'Serializable' }
  );
}
```

### Configuration

```javascript
await prisma.$transaction(
  async (tx) => {
    // Transaction body
  },
  { isolationLevel: 'Serializable' }
);
```

### Handling Serialization Conflicts

PostgreSQL returns error: `P2034 - Transaction aborted due to serialization failure`

```javascript
// Automatic retry helper
async function withSerializableRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'P2034' && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 50 + Math.random() * 50;
        await new Promise(r => setTimeout(r, backoffMs));
      } else {
        throw err;
      }
    }
  }
}

// Usage
const booking = await withSerializableRetry(
  () => confirmBooking(slotId, clientId)
);
```

### Performance Impact

| Level | Latency | Throughput | Best For |
|-------|---------|-----------|----------|
| READ_COMMITTED | Fastest | Highest | Reads, non-critical operations |
| REPEATABLE_READ | Slightly slower | High | Financial calculations |
| SERIALIZABLE | Slowest | Lower | Critical business logic |

---

## MANAWA Isolation Level Strategy

### Decision Tree

```
Decision: Choosing isolation level for transaction

1. Is this a READ-ONLY query?
   → Use READ_COMMITTED (no special handling needed)

2. Is data correctness critical (money, bookings)?
   → YES: Use REPEATABLE_READ for consistency
   → NO: Use READ_COMMITTED

3. Could race condition cause business harm?
   → YES: Use SERIALIZABLE with retry logic
   → NO: Use REPEATABLE_READ

4. Is this a high-volume operation?
   → YES: Prefer READ_COMMITTED to reduce conflicts
   → NO: Prefer REPEATABLE_READ for safety
```

### Recommended Isolation Levels by Feature

| Feature | Level | Reasoning |
|---------|-------|-----------|
| User registration | READ_COMMITTED | Quick, no critical consistency |
| User profile view | READ_COMMITTED | Read-only, eventual consistency |
| Project creation | READ_COMMITTED | Write once, no dependencies |
| Quote creation | REPEATABLE_READ | Prices must remain consistent |
| Booking confirmation | SERIALIZABLE | Cannot double-book slots |
| Payment processing | SERIALIZABLE | Cannot double-charge |
| Analytics/Reporting | READ_COMMITTED | Eventual consistency acceptable |
| Professional verification | REPEATABLE_READ | Audit trail consistency |
| Referral redemption | SERIALIZABLE | One-time only |
| Subscription renewal | REPEATABLE_READ | Balance consistency |
| Badge award | READ_COMMITTED | Order doesn't matter |
| Message sending | READ_COMMITTED | Idempotency handled elsewhere |

---

## Monitoring Isolation Level Usage

```sql
-- Check active transactions and their isolation levels
SELECT
  pid,
  usename,
  isolation_level,
  query,
  query_start
FROM pg_stat_activity
WHERE state != 'idle';

-- Monitor serialization conflicts
-- Enable in postgresql.conf: log_min_duration_statement = 100
-- Search logs for "serialization failure" or "P2034"

-- Check transaction duration (potential long locks)
SELECT
  pid,
  usename,
  query,
  xact_start,
  NOW() - xact_start as transaction_duration
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;
```

---

## Configuration Files

- **Query Timeout:** `/config/query-timeout.js` - Timeout policies per operation
- **Replication:** `/config/database-replication.js` - Primary/replica strategy
- **Connection Pool:** `/config/connection-pool.js` - Connection pooling

---

## References

- PostgreSQL Isolation Levels: https://www.postgresql.org/docs/current/transaction-iso.html
- Prisma Transaction API: https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#transaction
- MANAWA Schema: `/prisma/schema.prisma`
- ACID Verification: `/docs/ACID_VERIFICATION.md`
