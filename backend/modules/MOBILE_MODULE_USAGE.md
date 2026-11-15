# MobileModule Usage Guide

## Overview

The `MobileModule` consolidates all mobile-specific batch queries, caching strategies, and offline support logic. It manages the dashboard, notifications, profile summary, and delta sync (incremental sync) endpoints.

**Key Features:**
- Batch queries (4 queries in parallel for dashboard)
- ETag-based caching for HTTP 304 Not Modified responses
- Cache-Control headers with stale-while-revalidate
- Slim mode (conditional fields for bandwidth optimization)
- Delta sync with conflict resolution policies
- Comprehensive error logging

---

## Installation

The module is already exported in `/modules/index.js`:

```javascript
const { MobileModule, createModules } = require('./modules');

// Option 1: Manual instantiation
const mobileModule = new MobileModule(prisma, mobileImagesConfig);

// Option 2: Via createModules factory
const modules = createModules(prisma, stripe);
const mobileModule = modules.mobile;
```

---

## API Methods

### 1. getDashboard(userId, slim = false)

Fetches mobile dashboard with 4 batch queries in parallel:
- User profile with conditional professional details
- Unread notifications (top 5)
- Active projects
- Unread message count

**Parameters:**
- `userId` (string): User ID
- `slim` (boolean): If true, omits heavy fields (professional bio, etc)

**Returns:**
```javascript
{
  user: { id, firstName, lastName, avatarUrl, role, emailVerified, city, professional? },
  unreadNotifications: 1,
  recentNotifications: [...],
  activeProjects: [...],
  unreadMessages: 3,
  fetchedAt: "2026-11-15T12:00:00.000Z"
}
```

**Example:**
```javascript
const dashboard = await mobileModule.getDashboard('user-1', false);
```

---

### 2. getNotifications(userId, limit = 20, page = 1, unreadOnly = false)

Fetches paginated notifications with optional filtering.

**Parameters:**
- `userId` (string): User ID
- `limit` (number): Max results per page (1–50, default 20)
- `page` (number): Page number (default 1)
- `unreadOnly` (boolean): If true, return only unread notifications

**Returns:**
```javascript
{
  notifications: [...],
  total: 42,
  page: 1,
  limit: 20,
  unreadCount: 5  // Only if unreadOnly=true
}
```

**Example:**
```javascript
const notifs = await mobileModule.getNotifications('user-1', 20, 2, false);
```

---

### 3. getETag(userId, data)

Generates an ETag hash for caching. Used for HTTP 304 Not Modified responses.

**Parameters:**
- `userId` (string): User ID
- `data` (object): Data object with timestamp (e.g., `{ fetchedAt: "..." }`)

**Returns:**
```javascript
"mobile-user-1-2026-11-15T12:00:00Z"
```

**Example:**
```javascript
const etag = mobileModule.getETag('user-1', dashboard);
```

---

### 4. applyCacheHeaders(res, userId, data, maxAge = 60)

Applies cache headers to Express response.

**Parameters:**
- `res` (object): Express response object
- `userId` (string): User ID
- `data` (object): Response data for ETag generation
- `maxAge` (number): Cache duration in seconds (default 60)

**Side Effects:** Sets HTTP headers:
- `ETag`: ETag value
- `Cache-Control`: `private, max-age=X, stale-while-revalidate=5X`
- `Last-Modified`: Current time in UTC

**Example:**
```javascript
mobileModule.applyCacheHeaders(res, 'user-1', dashboard, 120);
// Sets Cache-Control: private, max-age=120, stale-while-revalidate=600
```

---

### 5. isCacheFresh(clientETag, serverETag)

Checks if client has fresh cache (ETag comparison).

**Parameters:**
- `clientETag` (string): ETag from `If-None-Match` header
- `serverETag` (string): Server-generated ETag

**Returns:**
```javascript
true  // Cache is fresh, send 304 Not Modified
```

**Example:**
```javascript
if (mobileModule.isCacheFresh(req.headers['if-none-match'], serverETag)) {
  return res.status(304).end();
}
```

---

### 6. getProfileSummary(userId, slim = false)

Fetches user profile with professional details.

**Parameters:**
- `userId` (string): User ID
- `slim` (boolean): If true, omits professional bio and trades

**Returns:**
```javascript
{
  id, firstName, lastName, email, phone, avatarUrl, role, city,
  emailVerified, phoneVerified, twoFAEnabled, locale, createdAt,
  professional: { id, bio?, verified, rating, reviewCount, trades?, city, photoUrl }
}
```

**Throws:**
- Error with status 404 if user not found

**Example:**
```javascript
const profile = await mobileModule.getProfileSummary('user-1', true);
```

---

### 7. getDeltaSync(userId, sinceTimestamp, slim = false)

Fetches only entities modified since a given timestamp (delta/incremental sync).

Implements conflict resolution:
- `profile`: last-write-wins
- `projects`, `payments`, `notifications`: server-wins

**Parameters:**
- `userId` (string): User ID
- `sinceTimestamp` (string): ISO 8601 timestamp (e.g., `"2026-11-15T00:00:00Z"`)
- `slim` (boolean): If true, uses reduced limits (20 notifications, 5 projects, 10 messages)

**Returns:**
```javascript
{
  notifications: [...],
  projects: [...],
  messages: [...],
  profile: { id, firstName, lastName, avatarUrl, updatedAt } | null,
  syncedAt: "2026-11-15T12:00:00.000Z",
  sinceUsed: "2026-11-15T00:00:00Z",
  conflictPolicy: {
    profile: "last-write-wins",
    projects: "server-wins",
    payments: "server-wins",
    notifications: "server-wins"
  },
  counts: {
    notifications: 5,
    projects: 2,
    messages: 3,
    profileUpdated: true
  }
}
```

**Throws:**
- Error with status 400 if `sinceTimestamp` is invalid

**Example:**
```javascript
const delta = await mobileModule.getDeltaSync(
  'user-1',
  '2026-11-15T00:00:00Z',
  false
);
```

---

## Integration Example: Route Handler

```javascript
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createModules } = require('../modules');

const router = express.Router();
const prisma = require('../config/db');
const { mobile } = createModules(prisma);

// GET /api/v1/mobile/dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const slim = req.mobileOptimized;

    const dashboard = await mobile.getDashboard(userId, slim);

    // Apply cache headers
    mobile.applyCacheHeaders(res, userId, dashboard, 60);

    // Check for 304 Not Modified
    if (mobile.isCacheFresh(req.headers['if-none-match'], mobile.getETag(userId, dashboard))) {
      return res.status(304).end();
    }

    return res.json({ success: true, data: dashboard });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /api/v1/mobile/notifications
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const unreadOnly = req.query.unread === 'true';

    const result = await mobile.getNotifications(userId, limit, page, unreadOnly);

    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /api/v1/mobile/sync?since=<ISO8601>
router.get('/sync', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const sinceRaw = req.query.since;

    if (!sinceRaw) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre "since" requis (ex: ?since=2026-11-01T00:00:00Z)',
      });
    }

    const delta = await mobile.getDeltaSync(userId, sinceRaw, req.mobileOptimized);

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Sync-Timestamp', delta.syncedAt);

    return res.json({ success: true, data: delta });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
```

---

## Performance Considerations

### Batch Queries
`getDashboard()` uses `Promise.all()` to fetch 4 queries in parallel:
- Single user query
- Notifications (unread, top 5)
- Projects (active, top 3–5)
- Message count

This reduces latency compared to sequential queries.

### ETag Caching
- Clients can check `If-None-Match` header against cached ETag
- Server returns 304 Not Modified without body
- Reduces bandwidth significantly for unchanged data

### Slim Mode
- Reduces data size by omitting heavy fields
- Professional bio, trades, project budgets excluded
- Useful for low-bandwidth scenarios

### Delta Sync
- Only fetches entities modified since timestamp
- Clients maintain local state, reducing network traffic
- Supports offline conflict resolution strategies

---

## Testing

Unit tests are in `/tests/modules/mobile.test.js` (24 tests, all passing):

```bash
npm test -- tests/modules/mobile.test.js
```

Integration tests for routes are in `/tests/routes/mobile.test.js` (39 tests).

---

## Logging

The module logs key operations via the logger utility:

```javascript
logger.info('[MobileModule] Dashboard fetched', { userId, slim });
logger.error('[MobileModule] Failed to fetch dashboard', { userId, error: err.message });
```

All errors are logged with context for debugging.

---

## Error Handling

All methods throw descriptive errors:

```javascript
try {
  const profile = await mobile.getProfileSummary('nonexistent');
} catch (err) {
  // Error with status 404: "Utilisateur introuvable"
  console.error(err.message, err.status);
}

try {
  const delta = await mobile.getDeltaSync('user-1', 'invalid-date');
} catch (err) {
  // Error with status 400: Invalid timestamp message
  console.error(err.message, err.status);
}
```

---

## Future Enhancements

Potential improvements:
1. **Push token management** — Integrate with notification preferences
2. **Device sync tracking** — Track last sync per device
3. **Bandwidth estimation** — Adaptive slim mode based on signal strength
4. **Conflict resolution UI** — Return conflict details for client-side resolution
