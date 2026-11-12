# Q57 + Q58 Usage Examples

## Real-World Scenarios

### Scenario 1: Payment Processing During High Load

**Situation**: High traffic causes GeniusPay API to hit rate limit.

**Without Q57/Q58**: Requests fail with 429 errors, users can't pay.

**With Q57/Q58**:
1. First request succeeds → Rate Limiter parses `X-RateLimit-Remaining: 1`
2. Rate Limiter detects remaining < threshold (10)
3. Rate Limiter starts throttling → 500ms delay between requests
4. User 2 tries to pay → Request throttled, still succeeds
5. User 3 tries to pay → Gets 429 response from API
6. Rate Limiter queues User 3's request
7. When limit resets (parse `X-RateLimit-Reset`), queue processes User 3's request
8. User 3 pays successfully

```javascript
// Code
const payment = await createPayment({
  amount: 10000,
  customerEmail: user.email,
  // ...
});
// Behind the scenes:
// - Circuit Breaker: CLOSED (normal)
// - Rate Limiter: Throttling (added 500ms delay)
// - Request succeeds, rate limit parsed
// - User gets payment link
```

---

### Scenario 2: Email Service Outage Recovery

**Situation**: Mailjet goes down, then recovers 5 minutes later.

**Without Q57/Q58**: All email sends fail for 5 minutes, no recovery.

**With Q57/Q58**:
1. Email 1 fails → Circuit Breaker records failure (1/5)
2. Email 2 fails → Circuit Breaker records failure (2/5)
3. Emails 3-5 fail → Circuit Breaker opens after 5th failure
4. Emails 6-100 are rejected immediately (not even tried)
5. Circuit Breaker waits 5 minutes
6. Circuit Breaker transitions to HALF_OPEN → allows 1 test email
7. Test email succeeds → Circuit Breaker closes
8. All queued emails process normally
9. Users never notice the outage

```javascript
// Code
const result = await mailer.sendVerificationEmail(email, code, 'verify');

// During outage:
// Error: Circuit breaker is OPEN
// Response: 503 Service Unavailable
// User sees: "Email sending temporarily unavailable, try again in a moment"

// After recovery:
// Circuit: CLOSED
// Email sends successfully
```

---

### Scenario 3: SMS Verification During Rate Limiting

**Situation**: Multiple users verify phone numbers at same time, hits Twilio limit.

**Without Q57/Q58**: SMS sends fail randomly.

**With Q57/Q58**:
1. User 1 SMS: Success (remaining: 50/50)
2. User 2 SMS: Success (remaining: 49/50)
3. User 3 SMS: Success (remaining: 48/50)
4. ...
5. User 45 SMS: Success (remaining: 6/50)
6. User 46 SMS: Throttled (remaining < 10) → 500ms delay added
7. User 47 SMS: Throttled → 500ms delay
8. ...
9. User 50 SMS: Rate limited (429) → Queued
10. Twilio limit resets in 1 minute
11. Queued SMSes process in order → All succeed

```javascript
// Code
const sms = await sendVerificationSms(phone, code);

// Normal case (remaining=50):
// SMS sends immediately
// success: true

// Throttled case (remaining=3):
// 500ms delay added
// SMS sends successfully after delay
// success: true

// Rate limited case (429 response):
// Request queued automatically
// Promise resolves when limit resets
// success: true (after ~1 minute)
```

---

### Scenario 4: Redis Connection Issues with Auto-Fallback

**Situation**: Redis connection drops, comes back online.

**Without Q57/Q58**: Cache queries fail, app crashes or handles manually.

**With Q57/Q58**:
1. Cache `get('user:123')` succeeds → Redis used
2. Network issue → Redis times out
3. Circuit Breaker records failure (1/10)
4. Cache `get('user:456')` fails → Records failure (2/10)
5. ...after 10 failures in 5 minutes:
6. Circuit Breaker opens
7. Cache `get('*')` → Auto-fallback to in-memory cache
8. In-memory returns cached value (may be stale)
9. Redis reconnects in 10 minutes
10. Circuit Breaker transitions to HALF_OPEN
11. One Redis operation succeeds → Circuit closes
12. Back to using Redis

```javascript
// Code during normal operation:
const user = await redis.get('user:123');
// Uses Redis, fast

// Code during Redis outage:
const user = await redis.get('user:123');
// Circuit: OPEN
// Fallback: In-memory cache
// Same interface, automatic fallback
// No error thrown, app continues

// Code after recovery:
const user = await redis.get('user:123');
// Circuit: HALF_OPEN → allows test
// Test succeeds → Circuit closes
// Back to Redis normally
```

---

### Scenario 5: Cascading Failures Prevented

**Situation**: Multiple payment failures cause cascade of requests to GeniusPay.

**Without Q57/Q58**:
```
User tries payment → Timeout (15s)
User retries → Timeout (15s)
User retries → Timeout (15s)
...repeat 50 times...
Each timeout = 15s = 750 seconds = user sees broken app
GeniusPay sees 50 identical requests flooding API
```

**With Q57/Q58**:
```
User tries payment → Timeout (15s) → Circuit records failure (1/5)
User retries immediately → Timeout (15s) → Failure (2/5)
User retries immediately → Timeout (15s) → Failure (3/5)
User retries immediately → Timeout (15s) → Failure (4/5)
User retries immediately → Timeout (15s) → Failure (5/5)
Circuit opens → immediately reject
User retries → "Circuit breaker open" (instant, no timeout)
Circuit waits 5 minutes → transitions to HALF_OPEN
One test call succeeds (GeniusPay recovered)
Circuit closes → users can retry successfully

Total: ~90 seconds instead of 750+ seconds
GeniusPay only sees 5 attempts instead of 50+
```

---

### Scenario 6: Monitoring Production Issues

**Endpoint**: `GET /health/third-party-apis`

**Response during normal operation**:
```json
{
  "geniuspay": {
    "circuitBreaker": {
      "state": "CLOSED",
      "totalRequests": 1250,
      "successfulRequests": 1245,
      "failedRequests": 5,
      "rejectedRequests": 0
    },
    "rateLimiter": {
      "remaining": 45,
      "limit": 100,
      "throttledRequests": 12,
      "queuedRequests": 0,
      "isRateLimited": false
    }
  },
  "mailjet": {
    "circuitBreaker": {
      "state": "CLOSED",
      "totalRequests": 850,
      "successfulRequests": 848,
      "failedRequests": 2,
      "rejectedRequests": 0
    },
    "rateLimiter": {
      "remaining": 95,
      "limit": 100,
      "throttledRequests": 0,
      "queuedRequests": 0,
      "isRateLimited": false
    }
  },
  "redis": {
    "circuitBreaker": {
      "state": "CLOSED",
      "totalRequests": 50000,
      "successfulRequests": 49900,
      "failedRequests": 100,
      "rejectedRequests": 0
    }
  }
}
```

**Response during GeniusPay outage**:
```json
{
  "geniuspay": {
    "circuitBreaker": {
      "state": "OPEN",
      "totalRequests": 1255,
      "successfulRequests": 1245,
      "failedRequests": 10,
      "rejectedRequests": 8,
      "openedAt": "2024-11-12T10:30:00Z"
    },
    "rateLimiter": {
      "remaining": null,
      "isRateLimited": true,
      "queuedRequests": 15
    }
  }
}
```

**Alert** → Operations team sees GeniusPay circuit is OPEN with 8 rejected requests.

---

### Scenario 7: Graceful Degradation

**Example: User Registration Flow**

1. **Phone Verification** (Twilio):
   ```javascript
   try {
     await sms.sendVerificationSms(phone, code);
   } catch (err) {
     if (err.code === 'CIRCUIT_BREAKER_OPEN') {
       // Fallback to email verification
       await mailer.sendVerificationEmail(email, code, 'verify');
     }
   }
   ```

2. **If Email Also Down**:
   ```javascript
   try {
     await mailer.sendVerificationEmail(email, code, 'verify');
   } catch (err) {
     if (err.code === 'CIRCUIT_BREAKER_OPEN') {
       // Fall back to manual verification
       return {
         success: true,
         message: 'Manual verification: call +1-555-MANAWA to verify',
       };
     }
   }
   ```

3. **If Payment Processing Down**:
   ```javascript
   try {
     const payment = await geniuspay.createPayment(payload);
   } catch (err) {
     if (err.code === 'CIRCUIT_BREAKER_OPEN') {
       // Use manual payment processing
       return {
         success: true,
         manual: true,
         message: 'Invoice will be generated, payment details sent by email',
       };
     }
   }
   ```

---

### Scenario 8: Rate Limit Header Handling

**Mailjet Response Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 8
X-RateLimit-Reset: 1700000000 (Unix timestamp)
```

**Rate Limiter Action**:
1. Parses headers
2. Remaining (8) < Threshold (20) → Start throttling
3. Calculates delay:
   - 60 seconds until reset
   - 8 remaining requests
   - Delay = (60 / 8) * 1000 = 7500ms ≈ 7.5 seconds between requests
4. Next email request: waits 7.5 seconds before sending

**Result**: Spreads 8 requests evenly over 60 seconds, no 429 errors.

---

### Scenario 9: Configuration per Environment

**Development** (`.env.development`):
```bash
GENIUSPAY_CB_FAILURE_THRESHOLD=3      # Fail faster
GENIUSPAY_CB_RESET_TIMEOUT=60000      # 1 min recovery
MAILJET_RL_MIN_REMAINING=5            # Throttle earlier
```

**Production** (`.env.production`):
```bash
GENIUSPAY_CB_FAILURE_THRESHOLD=10     # More tolerant
GENIUSPAY_CB_RESET_TIMEOUT=600000     # 10 min recovery
MAILJET_RL_MIN_REMAINING=20           # Conservative throttling
```

---

### Scenario 10: Debugging Circuit Breaker

**Logs during issue**:
```
[CircuitBreaker] GeniusPay - Request rejected (OPEN)
  state: OPEN
  openedAt: 2024-11-12T10:30:00.000Z
  failureCount: 5
  rejectedCount: 12

[CircuitBreaker] GeniusPay - Circuit HALF_OPEN (testing recovery)
  state: HALF_OPEN

[CircuitBreaker] GeniusPay - Circuit CLOSED (recovered)
  state: CLOSED

[RateLimiter] GeniusPay - Approaching rate limit
  remaining: 5
  limit: 100
  resetAt: 2024-11-12T10:35:00Z

[RateLimiter] GeniusPay - Throttling request
  delay: 500ms
  remaining: 5
  queued: 2
```

**Diagnosis**:
- `OPEN` state → Something failed 5+ times
- Check logs before for errors
- `HALF_OPEN` → Testing recovery
- `CLOSED` → Recovered successfully

---

## Integration Checklist

- [ ] All services have Circuit Breaker + Rate Limiter
- [ ] Configuration loaded from env variables
- [ ] Health endpoint added to monitoring
- [ ] Alert set for Circuit Breaker OPEN state
- [ ] Team trained on understanding logs
- [ ] Runbook created for manual circuit reset (if needed)
- [ ] Dashboard shows third-party API health
- [ ] Load testing validates resilience
- [ ] Fallback logic tested for each service
- [ ] Production thresholds tuned for SLO

---

## Best Practices

1. **Monitor Continuously**
   - Watch circuit breaker states
   - Track rate limiter queues
   - Alert on state changes

2. **Tune Thresholds**
   - Use production data to tune
   - Lower for critical services (payments)
   - Higher for non-critical (analytics)

3. **Test Failures**
   - Simulate each service failure
   - Verify fallback behavior
   - Load test with realistic traffic

4. **Document Dependencies**
   - Which services depend on which APIs
   - Fallback chains
   - Impact of each outage

5. **Communicate**
   - Tell users about outages
   - Graceful degradation messaging
   - "Service temporarily unavailable"

---

## References

- Implementation: `/docs/Q57-Q58-IMPLEMENTATION.md`
- Circuit Breaker Pattern: https://martinfowler.com/bliki/CircuitBreaker.html
- Rate Limit Headers: https://tools.ietf.org/html/draft-polli-ratelimit-headers
