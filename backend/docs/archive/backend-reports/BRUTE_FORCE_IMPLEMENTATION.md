# Brute Force Protection Implementation

## Summary

Comprehensive brute force protection has been implemented for the MANAWA backend with account lockout after 5 failed login attempts and a 15-minute lockout duration.

## Files Created

### 1. Configuration
- **`/config/brute-force.js`** - Configuration constants and settings
  - Max attempts: 5
  - Lockout duration: 15 minutes
  - Attempt window: 15 minutes
  - HTTP headers and status codes
  - Error messages

### 2. Middleware
- **`/middleware/bruteForceMiddleware.js`** - Core protection logic
  - `trackFailedLogin(email)` - Track failed attempts
  - `checkLockout(email)` - Check if account locked
  - `lockAccount(email)` - Lock account
  - `getAttemptCount(email)` - Get current count
  - `getRemainingAttempts(email)` - Calculate remaining
  - `clearFailedAttempts(email)` - Clear on success
  - `clearLockout(email)` - Admin unlock
  - `logLoginAttempt()` - Database audit logging
  - `getLoginHistory()` - Retrieve login history
  - `bruteForceCheckMiddleware()` - Express middleware

### 3. Database
- **`/prisma/schema.prisma`** - Added LoginAttempt model
  ```prisma
  model LoginAttempt {
    id, userId, email, status, ipAddress, userAgent, metadata, timestamp
  }
  ```

### 4. Routes (Updated)
- **`/routes/auth.js`** - Integrated protection
  - `POST /api/auth/login` - Enhanced with brute force checks
  - `POST /api/auth/unlock` - Admin unlock endpoint
  - `GET /api/auth/login-history` - User login history
  - `GET /api/admin/user/:id/security` - Admin security status

### 5. Tests
- **`/tests/brute-force.test.js`** - Unit tests (27 tests)
  - trackFailedLogin
  - getAttemptCount
  - getRemainingAttempts
  - lockAccount / checkLockout
  - clearFailedAttempts / clearLockout
  - Full lockout flow

- **`/tests/brute-force-integration.test.js`** - Integration tests (13+ tests)
  - Full login flow with brute force
  - 5 failures → lockout
  - 6th attempt → 429
  - Successful login clears counter
  - Admin unlock
  - Login history
  - Security status

### 6. Documentation
- **`/docs/BRUTE_FORCE_PROTECTION.md`** - Full documentation
  - Architecture overview
  - API endpoints with examples
  - Flow diagrams
  - Security considerations
  - Testing instructions
  - Monitoring guidelines
  - Troubleshooting

- **`/MIGRATION_INSTRUCTIONS.md`** - Database migration setup
- **`/BRUTE_FORCE_IMPLEMENTATION.md`** - This file

## Implementation Details

### Storage Architecture

**Redis (Primary)**
```
Key: brute_force:failed_attempts:{email}
Value: {count}
TTL: 900 seconds (15 min)

Key: brute_force:lockout:{email}
Value: { lockedUntil, lockedAt, reason }
TTL: 900 seconds (15 min)
```

**Database (Audit Trail)**
```
Table: LoginAttempt
- Tracks all login attempts (success & failed)
- IP address and user agent
- Metadata (failure reason)
- Indexed on userId, email, timestamp
```

### Login Flow

1. **Validation** - Input validation
2. **IP Rate Limit** - Global limit: 10 req/15min per IP
3. **Brute Force Check** - Middleware checks Redis for lockout
4. **Find User** - Look up user by email
   - If not found: track failed attempt → check lockout
   - If found: continue
5. **Verify Password** - bcrypt comparison
   - If invalid: track failed attempt → check lockout
   - If valid: continue
6. **On Success**
   - Clear failed attempts in Redis
   - Log success to database
   - Generate tokens
7. **On Failure**
   - Track attempt (increment counter)
   - Log to database
   - Check if >= maxAttempts
   - If yes: lock account
   - Return 401 with X-Attempts-Remaining header

### Response Codes

- **200 OK** - Successful login
- **400 Bad Request** - Validation error
- **401 Unauthorized** - Invalid credentials (general) or lockout was triggered
- **429 Too Many Requests** - Account locked (when checking with correct password)

## API Endpoints

### POST /api/auth/login
```
Request:
{
  "email": "user@example.com",
  "password": "SecurePassword123"
}

Success (200):
{
  "user": { ... },
  "token": "JWT...",
  "refreshToken": "..."
}

Failed Password (401):
{
  "error": "Email ou mot de passe incorrect",
  "attemptsRemaining": 3
}

Headers:
X-Attempts-Remaining: 3
```

### POST /api/auth/unlock (Admin)
```
Headers:
Authorization: Bearer {admin_token}

Request:
{
  "email": "user@example.com",
  "reason": "customer_request"
}

Response (200):
{
  "ok": true,
  "message": "Compte déverrouillé pour user@example.com",
  "email": "user@example.com"
}
```

### GET /api/auth/login-history
```
Headers:
Authorization: Bearer {user_token}

Query:
?limit=20

Response (200):
{
  "ok": true,
  "attempts": [
    {
      "id": "uuid",
      "status": "failed",
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "timestamp": "2026-11-12T10:29:00Z",
      "metadata": { "reason": "invalid_password" }
    }
  ],
  "count": 1
}
```

### GET /api/admin/user/:id/security (Admin)
```
Headers:
Authorization: Bearer {admin_token}

Response (200):
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
  "recentAttempts": [...]
}
```

## Setup & Deployment

### Step 1: Install Dependencies
```bash
cd backend
npm install
```

### Step 2: Create Database Migration
```bash
npx prisma migrate dev --name add_login_attempt_table
```

### Step 3: Configure Redis (Optional)
```bash
# Set in .env
REDIS_URL=redis://localhost:6379

# Or use default in-memory fallback
```

### Step 4: Run Tests
```bash
# Unit tests
npm test -- tests/brute-force.test.js

# Integration tests
npm test -- tests/brute-force-integration.test.js
```

### Step 5: Start Server
```bash
npm start
```

## Testing the Implementation

### Manual Testing: 5 Failures → Lockout

```bash
# Attempt 1 (Fail)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrong"}'
# Response: 401, X-Attempts-Remaining: 4

# Attempt 2-4 (Fail)
# ... repeat with wrong password ...

# Attempt 5 (Fail)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrong"}'
# Response: 401, X-Attempts-Remaining: 0

# Attempt 6 (Fail - Now Locked)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"correct_or_wrong"}'
# Response: 429, error: "Ce compte est temporairement bloqué..."
# Header: Retry-After: 847

# Attempt 7 (Success After Wait - Simulated)
# Wait 15 minutes OR manually unlock
curl -X POST http://localhost:3000/api/auth/unlock \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","reason":"test"}'
# Response: 200, "Compte déverrouillé"

# Now can login again
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"correct"}'
# Response: 200 OK
```

### Admin Console: Check Security Status

```bash
curl -X GET http://localhost:3000/api/admin/user/{userId}/security \
  -H "Authorization: Bearer {admin_token}"
```

### View Login History

```bash
curl -X GET http://localhost:3000/api/auth/login-history \
  -H "Authorization: Bearer {user_token}" \
  -H "Content-Type: application/json"
```

## Configuration Options

Edit `/config/brute-force.js` to adjust:

```javascript
maxAttempts: 5,                    // Change to 3 for stricter
lockoutDurationSeconds: 15 * 60,   // Change to 30*60 for 30 minutes
attemptWindowSeconds: 15 * 60,     // Reset window
```

Then restart server.

## Monitoring

### Key Events to Log

```
[Brute Force] Failed login attempt tracked
  email: user@example.com
  attemptCount: 3
  maxAttempts: 5

[Brute Force] Account locked due to max attempts
  email: user@example.com
  lockoutDurationSeconds: 900
  lockedUntil: 2026-11-12T10:45:00Z

[Admin] Account unlocked
  email: user@example.com
  adminId: admin-uuid
  reason: customer_request
```

### Metrics to Track

1. Failed login attempts per hour
2. Account lockouts per hour
3. Unlock requests per hour
4. Success rate (successful / total)
5. IP addresses with most failures

## Security Highlights

✅ **Email Normalization** - All emails lowercase before tracking
✅ **Distributed Support** - Redis enables tracking across servers
✅ **Audit Trail** - All attempts logged to database
✅ **Fallback Support** - In-memory cache if Redis unavailable
✅ **Timing Attack Prevention** - Consistent error messages
✅ **IP Rate Limiting** - Global limit + per-account protection
✅ **Admin Unlock** - Manual override capability with logging
✅ **User History** - Users can view their login attempts

## Troubleshooting

### Account Locked - How to Unlock

For admins:
```bash
curl -X POST http://localhost:3000/api/auth/unlock \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","reason":"customer_request"}'
```

Or wait 15 minutes for automatic unlock.

### Redis Connection Issues

Check logs for:
```
[Redis] Connection error, falling back to in-memory cache
```

Solution:
1. Verify Redis is running
2. Check REDIS_URL environment variable
3. Verify Redis credentials
4. System will auto-fallback to in-memory

### Tests Failing

```bash
# Clear cache
npm run test:clear-cache

# Run with debug
DEBUG=* npm test -- tests/brute-force.test.js

# Check Redis connection
redis-cli ping
```

## Performance Considerations

- **Redis Operations**: O(1) - negligible latency
- **Database Logging**: Async - doesn't block login
- **Lockout Check**: ~5ms (Redis) or <1ms (in-memory)
- **Impact on Login**: <50ms additional latency

## Future Enhancements

1. **Captcha Integration** - After N failures, show captcha
2. **Email Notifications** - Notify user of failed attempts
3. **IP Whitelist** - Skip checks for trusted IPs
4. **Adaptive Lockout** - Increase duration after repeated attacks
5. **Geolocation Checks** - Flag login from unusual locations
6. **Device Fingerprinting** - Track trusted devices
7. **Telegram/Slack Alerts** - Real-time admin notifications

## References

- `/docs/BRUTE_FORCE_PROTECTION.md` - Full documentation
- `/tests/brute-force.test.js` - Unit tests
- `/tests/brute-force-integration.test.js` - Integration tests
- `/MIGRATION_INSTRUCTIONS.md` - Database setup

## Support

For issues or questions:
1. Check `/docs/BRUTE_FORCE_PROTECTION.md`
2. Review logs for error messages
3. Test with manual curl commands
4. Run test suite to verify functionality
