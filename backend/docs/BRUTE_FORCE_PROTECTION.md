# Brute Force Protection

## Overview

The MANAWA backend implements comprehensive brute force protection to prevent account takeover attacks through credential stuffing and password guessing. The system tracks failed login attempts per email address and enforces temporary account lockouts after exceeding the maximum allowed failures.

## Configuration

Configuration is managed in `/config/brute-force.js`:

```javascript
{
  maxAttempts: 5,                    // Max failed attempts before lockout
  lockoutDurationSeconds: 900,       // 15 minutes
  attemptWindowSeconds: 900,         // 15 minutes - only count recent attempts
  keyPrefixes: {
    failedAttempts: 'brute_force:failed_attempts:',
    lockout: 'brute_force:lockout:',
    loginLog: 'login_log:',
  },
  headers: {
    attemptsRemaining: 'X-Attempts-Remaining',
    retryAfter: 'Retry-After',
  },
  statusCodes: {
    tooManyRequests: 429,
  },
  messages: {
    accountLocked: 'Ce compte est temporairement bloqué...',
    loginFailed: 'Email ou mot de passe incorrect',
  }
}
```

## Architecture

### Storage

- **Redis**: Primary storage for fast, distributed tracking
- **Fallback**: In-memory cache if Redis is unavailable
- **Database**: PostgreSQL LoginAttempt table for audit trail

### Key Components

#### 1. Middleware (`/middleware/bruteForceMiddleware.js`)

Core functions for brute force protection:

- `trackFailedLogin(email)` - Increment failed attempt count
- `checkLockout(email)` - Check if account is locked
- `lockAccount(email)` - Lock account for specified duration
- `getAttemptCount(email)` - Get current attempt count
- `getRemainingAttempts(email)` - Calculate remaining attempts before lockout
- `clearFailedAttempts(email)` - Reset attempts (on successful login)
- `clearLockout(email)` - Unlock account (manual admin action)
- `logLoginAttempt(userId, email, status, ipAddress, userAgent, metadata)` - Audit logging
- `getLoginHistory(userId, limit)` - Retrieve user's login history
- `bruteForceCheckMiddleware()` - Express middleware to check lockout before login

#### 2. Database Model

`LoginAttempt` table in Prisma schema:

```prisma
model LoginAttempt {
  id        String   @id @default(uuid())
  userId    String?  // Null if user not found
  email     String
  status    String   // 'success' or 'failed'
  ipAddress String?
  userAgent String?
  metadata  String?  // JSON metadata
  timestamp DateTime @default(now())

  @@index([userId])
  @@index([email])
  @@index([timestamp])
}
```

#### 3. Login Flow Integration

The protection is integrated into the login endpoint (`POST /api/auth/login`):

```
1. Validate input
2. Check lockout middleware → 429 if locked
3. Look up user → track failed attempt if not found
4. Verify password → track failed attempt if incorrect
5. On success → clear failed attempts, log success
6. Return token or error with attempt count
```

## API Endpoints

### POST /api/auth/login

Login endpoint with integrated brute force protection.

**Response Headers:**
- `X-Attempts-Remaining` (number) - Attempts left before lockout on failed login
- `Retry-After` (seconds) - Time to wait before retrying when locked

**Response on Success (200):**
```json
{
  "user": { ... },
  "token": "JWT_TOKEN",
  "refreshToken": "REFRESH_TOKEN"
}
```

**Response on Failed Password (401):**
```json
{
  "error": "Email ou mot de passe incorrect",
  "attemptsRemaining": 3
}
```

**Response on Account Locked (429):**
```json
{
  "error": "Ce compte est temporairement bloqué...",
  "code": "ACCOUNT_LOCKED",
  "remainingSeconds": 847
}
```

### POST /api/auth/unlock

Unlock a locked account (Admin only).

**Authentication:** Bearer token (Admin role required)

**Request Body:**
```json
{
  "email": "user@example.com",
  "reason": "customer_request" // Optional
}
```

**Response (200):**
```json
{
  "ok": true,
  "message": "Compte déverrouillé pour user@example.com",
  "email": "user@example.com"
}
```

**Errors:**
- 404: User not found
- 403: Not authorized (non-admin)
- 500: Server error

### GET /api/auth/login-history

Retrieve the authenticated user's login history.

**Authentication:** Bearer token required

**Query Parameters:**
- `limit` (number, default: 20, max: 100) - Number of records to retrieve

**Response (200):**
```json
{
  "ok": true,
  "attempts": [
    {
      "id": "uuid",
      "status": "success",
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "timestamp": "2026-11-12T10:30:00Z",
      "metadata": null
    },
    {
      "id": "uuid",
      "status": "failed",
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "timestamp": "2026-11-12T10:29:00Z",
      "metadata": { "reason": "invalid_password" }
    }
  ],
  "count": 2
}
```

**Errors:**
- 401: Not authenticated
- 500: Server error

### GET /api/admin/user/:id/security

Get security status for a user (Admin only).

**Authentication:** Bearer token (Admin role required)

**URL Parameters:**
- `id` (string) - User UUID

**Response (200):**
```json
{
  "ok": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "lastLoginAt": "2026-11-12T10:30:00Z",
    "suspended": false
  },
  "security": {
    "failedAttempts": 2,
    "isLocked": false,
    "lockoutRemaining": 0,
    "maxAttempts": 5,
    "lockoutDuration": 900
  },
  "recentAttempts": [
    {
      "id": "uuid",
      "status": "failed",
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "timestamp": "2026-11-12T10:29:00Z"
    }
  ]
}
```

**Errors:**
- 404: User not found
- 403: Not authorized (non-admin)
- 500: Server error

## Flow Diagrams

### Successful Login Flow

```
POST /api/auth/login
    ↓
[Validation]
    ↓
[Brute Force Check Middleware]
    ↓ (Not locked)
[Find User]
    ↓ (User found)
[Verify Password]
    ↓ (Password valid)
[Clear Failed Attempts]
[Log Success]
[Generate Tokens]
    ↓
200 OK + Tokens
```

### Failed Password Flow

```
POST /api/auth/login
    ↓
[Validation]
    ↓
[Brute Force Check Middleware]
    ↓ (Not locked)
[Find User]
    ↓ (User found)
[Verify Password]
    ↓ (Password invalid)
[Track Failed Attempt]
    ↓
Count = 1-4?
    ↓ Yes
401 Unauthorized
+ X-Attempts-Remaining: (5 - count)

Count = 5?
    ↓ Yes
[Lock Account]
401 Unauthorized
(Implicit lockout - next request will get 429)
```

### Locked Account Access

```
POST /api/auth/login
    ↓
[Validation]
    ↓
[Brute Force Check Middleware]
    ↓ (Account is locked)
429 Too Many Requests
+ Retry-After: (remaining_seconds)
+ ACCOUNT_LOCKED code
```

## Security Considerations

### 1. Email Case Sensitivity

All email addresses are normalized to lowercase before tracking to prevent bypass attempts using different casing:

```javascript
email.toLowerCase()
```

### 2. IP-Based Rate Limiting

In addition to per-account protection, a global IP-based rate limit is applied:

```javascript
authLimiter: max 10 requests per 15 minutes per IP
```

### 3. Timing Attack Prevention

Responses use consistent error messages to avoid timing-based enumeration:

```
"Email ou mot de passe incorrect"  // User not found OR password wrong
```

### 4. Distributed System Support

Using Redis allows lockout enforcement across multiple servers:

- Request 1 (Server A): Track attempt #1
- Request 2 (Server B): Track attempt #2
- Request 3 (Server C): Lock account
- Request 4 (Server A): 429 locked (via Redis)

### 5. Fallback to In-Memory Cache

If Redis is unavailable, protection continues using in-memory cache with TTL:

- Each server maintains its own cache
- Different servers may have slight variations
- Still prevents obvious brute force attacks

### 6. Audit Trail

All login attempts are logged to the database with:

- User ID (or null if not found)
- Email address
- Status (success/failed)
- IP address
- User agent
- Metadata (failure reason)
- Timestamp

Admins can review suspicious activity via the security endpoint.

## Testing

### Unit Tests

Located in `/tests/brute-force.test.js`:

- `trackFailedLogin` - Increment tracking
- `getAttemptCount` - Count retrieval
- `getRemainingAttempts` - Remaining calculation
- `lockAccount` - Lockout enforcement
- `checkLockout` - Lockout checking
- `clearFailedAttempts` - Reset on success
- `clearLockout` - Admin unlock
- Full flow tests

Run:
```bash
npm test -- tests/brute-force.test.js
```

### Integration Tests

Located in `/tests/brute-force-integration.test.js`:

- Full login flow with brute force
- 5 failed attempts → lockout
- 6th attempt → 429
- Successful login clears counter
- Admin unlock works
- Login history retrieval
- Security status endpoint

Run:
```bash
npm test -- tests/brute-force-integration.test.js
```

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Failed Login Attempts**
   - Track spike patterns
   - Alert if > 1000 failed attempts in 5 minutes

2. **Account Lockouts**
   - Count per hour/day
   - Alert if > 50 lockouts in 1 hour

3. **Unlock Requests**
   - Who requested unlock and when
   - Correlate with lockout times

4. **Login Success Rate**
   - Track success vs failure ratio
   - Alert if success rate drops below 95%

### Logging

All brute force events are logged with context:

```
[Brute Force] Failed login attempt tracked
[Brute Force] Account locked due to max attempts
[Brute Force] Lockout expired
[Admin] Account unlocked
```

## Maintenance

### Clearing Cache

To clear all brute force data:

```bash
# Via Redis
FLUSHDB

# Via API (implementation specific)
DELETE /api/admin/cache/brute-force
```

### Adjusting Configuration

To change settings, edit `/config/brute-force.js`:

```javascript
maxAttempts: 5,                  // Reduce to 3 for stricter policy
lockoutDurationSeconds: 15 * 60  // Increase to 30 minutes for longer lockout
```

Then restart the server.

### Database Cleanup

Archive or delete old login attempts:

```sql
DELETE FROM "LoginAttempt" 
WHERE timestamp < NOW() - INTERVAL '90 days'
AND status = 'failed';
```

## Troubleshooting

### Users Getting Locked Out Too Frequently

1. Check attempt count threshold (`maxAttempts`)
2. Review login history for patterns
3. Check if legitimate users share IP addresses
4. Consider adjusting window size

### Lockout Not Being Enforced

1. Verify Redis is connected
2. Check `bruteForceCheckMiddleware()` is registered
3. Review logs for errors
4. Verify cache TTL settings

### Admin Can't Unlock Accounts

1. Verify admin user has ADMIN role
2. Check unlock endpoint authentication
3. Review admin logs for unlock attempts
4. Verify email address is correct

## References

- [OWASP: Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP: Credential Stuffing](https://owasp.org/www-community/attacks/Credential_stuffing)
- [CWE-307: Improper Restriction of Rendered UI Layers or Frames](https://cwe.mitre.org/data/definitions/307.html)
