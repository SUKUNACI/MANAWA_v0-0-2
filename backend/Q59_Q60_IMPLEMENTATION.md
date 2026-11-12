# Q59 & Q60 Implementation Report

## Overview

Implemented comprehensive timeout and error handling for third-party APIs (GeniusPay, Mailjet, Twilio) in the MANAWA backend.

## Q59: Third-party API Timeout Configuration

### Implementation Files

1. **`/config/timeout-config.js`** - Centralized timeout configuration
   - GeniusPay timeout: 5 seconds
   - Mailjet timeout: 5 seconds
   - Twilio timeout: 5 seconds
   - Express middleware timeouts: 30 seconds (payments, subscriptions)
   - Error codes enumeration (TIMEOUT_ERR, TIMEOUT_ECONNABORTED, TIMEOUT_ETIMEDOUT)

2. **`/middleware/api-timeout.js`** - Express timeout middleware
   - Configurable timeout middleware factory
   - Specific middleware for payments and subscriptions routes
   - Handles ECONNABORTED and ETIMEDOUT socket errors
   - Logs timeouts separately with TIMEOUT_ERR code
   - Returns 504 Gateway Timeout status code

3. **Configuration Updates**
   - `/config/mailer.js` - Added Mailjet 5s timeout
   - `/config/sms.js` - Added Twilio 5s timeout
   - `/utils/geniuspay.js` - Updated to use 5s timeout from config
   - `/index.js` - Applied timeout middleware to `/payments` and `/subscriptions` routes

### Timeout Handling

```javascript
// All third-party API calls now have 5s timeout
- GeniusPay payment creation/retrieval
- Mailjet email sending
- Twilio SMS sending

// Express middleware applies 30s timeout to:
- POST /api/v1/payments/*
- PUT /api/v1/payments/*
- DELETE /api/v1/payments/*
- POST /api/v1/subscriptions/*
- PUT /api/v1/subscriptions/*
```

### Error Classification

Timeouts are classified with specific error codes:
- `TIMEOUT_ERR` - Generic timeout error
- `TIMEOUT_ECONNABORTED` - Connection aborted
- `TIMEOUT_ETIMEDOUT` - Socket timeout

## Q60: Third-party Error Handling & Differentiation

### Implementation Files

1. **`/utils/error-handler-third-party.js`** - Comprehensive error handler
   - Classifies errors into 5 categories:
     * `timeout` - Timeouts with retryable=true
     * `rate_limit` - 429 errors with retryable=true
     * `auth_invalid` - 401/403 errors with retryable=false
     * `server_error` - 5xx errors with retryable=true
     * `network_error` - Connection errors with retryable=true

### Error Differentiation

```javascript
// Different error types return different client messages:

Timeout Error:
- Message: "Délai d'attente dépassé. [Service] a pris trop de temps."
- Status: 504
- Retryable: true

Rate Limit Error:
- Message: "[Service] est temporairement indisponible. Trop de requêtes."
- Status: 429
- Retryable: true

Auth Invalid Error:
- Message: "Configuration [Service] invalide. Vérifiez les clés API."
- Status: 503
- Retryable: false

Server Error:
- Message: "[Service] rencontre une erreur serveur."
- Status: 503
- Retryable: true

Network Error:
- Message: "Impossible de contacter [Service]. Vérifiez votre connexion."
- Status: 503
- Retryable: true
```

### Fallback Mechanisms (Q60)

1. **Twilio SMS Fallback to Email OTP**
   ```javascript
   // When: Twilio SMS sending fails (timeout, rate-limit, etc.)
   // Action: Automatically fallback to Mailjet email OTP
   // Message: "SMS indisponible, code OTP envoyé par email"
   ```

2. **Mailjet Email Fallback to SMS Notification**
   ```javascript
   // When: Mailjet email sending fails
   // Action: Automatically fallback to Twilio SMS notification
   // Message: "Email indisponible, notification envoyée par SMS"
   ```

3. **GeniusPay Payment Clear Error**
   ```javascript
   // When: GeniusPay fails (timeout, auth error, etc.)
   // Action: Return clear error message to client
   // Message: "Paiement échoué. Veuillez réessayer ou utiliser une autre méthode."
   ```

### Clear Client Messages

All errors return clear, non-generic messages:
- ✅ "Délai d'attente dépassé"
- ✅ "Trop de requêtes"
- ✅ "Configuration invalide"
- ❌ NOT "Erreur interne générique"
- ❌ NOT "Internal Server Error"

### Sentry Integration

All third-party errors are logged to Sentry with:
- Service name tag
- Error type tag
- HTTP status code
- Original error message
- Additional context

Excludes rate-limit errors from Sentry (too noisy).

## Files Created

1. `/config/timeout-config.js` - Timeout configuration constants
2. `/middleware/api-timeout.js` - Express timeout middleware
3. `/utils/error-handler-third-party.js` - Error classification and handling
4. `/tests/middleware/api-timeout.test.js` - Middleware tests
5. `/tests/utils/error-handler-third-party.test.js` - Error handler tests

## Files Modified

1. `/config/mailer.js` - Added 5s timeout to Mailjet client
2. `/config/sms.js` - Added 5s timeout to Twilio client
3. `/utils/geniuspay.js` - Updated to use timeout config
4. `/index.js` - Applied timeout middleware to routes

## How to Use

### For Payment Routes
```javascript
// Automatically applies 30s timeout
POST /api/v1/payments/create
PUT /api/v1/payments/:id
DELETE /api/v1/payments/:id

// Response on timeout (504):
{
  "error": "Délai d'attente dépassé. Paiement a pris trop de temps.",
  "code": "TIMEOUT_ERR",
  "retryable": true
}
```

### For Subscription Routes
```javascript
// Automatically applies 30s timeout
POST /api/v1/subscriptions/create
PUT /api/v1/subscriptions/:id
DELETE /api/v1/subscriptions/:id
```

### For Error Handling in Routes
```javascript
const { classifyError, getFallbackStrategy, formatErrorResponse } = require('./utils/error-handler-third-party');

try {
  // Call third-party API (GeniusPay, Mailjet, Twilio)
  const result = await geniuspay.createPayment(payload);
} catch (error) {
  // Classify error
  const classified = classifyError(error, 'geniuspay');
  
  // Get fallback if needed
  const fallback = getFallbackStrategy('geniuspay', 'payment');
  
  // Format response
  const response = formatErrorResponse(error, 'geniuspay', classified.statusCode);
  
  // Send to client
  return res.status(classified.statusCode).json(response);
}
```

## Logging & Monitoring

### Timeout Logging
Timeouts are logged separately with TIMEOUT_ERR code:
```
[TIMEOUT_ERR] geniuspay timeout
[TIMEOUT] payments endpoint timeout
[TIMEOUT] subscriptions socket error: ECONNABORTED
```

### Error Logging
All errors logged to console and Sentry:
```
[RateLimit] mailjet rate limit exceeded
[AuthError] twilio authentication failed
[ServerError] geniuspay server error
[NetworkError] twilio network error
```

## Testing

### Test Coverage

**Middleware Tests** (`api-timeout.test.js`):
- ✅ Timeout after specified duration
- ✅ No timeout if request completes in time
- ✅ Correct 504 status code
- ✅ Timeout cleanup on response finish
- ✅ Service name included in error

**Error Handler Tests** (`error-handler-third-party.test.js`):
- ✅ Timeout error classification
- ✅ Rate-limit error classification
- ✅ Auth error classification
- ✅ Server error classification
- ✅ Network error classification
- ✅ ECONNABORTED as timeout
- ✅ ETIMEDOUT as timeout
- ✅ Fallback strategies (SMS ↔ Email)
- ✅ Clear error messages (no generic "Internal Error")
- ✅ Error differentiation (timeout ≠ rate-limit ≠ auth)

### Running Tests
```bash
npm test -- api-timeout.test.js
npm test -- error-handler-third-party.test.js
npm test -- --coverage # Full coverage report
```

## Configuration

### Environment Variables (Already Required)
```env
# Third-party API credentials (already required)
GENIUSPAY_API_KEY=***
GENIUSPAY_API_SECRET=***
MAILJET_API_KEY=***
MAILJET_SECRET_KEY=***
TWILIO_ACCOUNT_SID=***
TWILIO_AUTH_TOKEN=***
TWILIO_PHONE_NUMBER=***

# Sentry integration (optional but recommended)
SENTRY_DSN=***
```

### Timeout Configuration (Q59)
All timeouts are centralized in `/config/timeout-config.js`:
```javascript
// Third-party API timeouts (milliseconds)
GENIUSPAY_TIMEOUT: 5000,      // 5 seconds
MAILJET_TIMEOUT: 5000,         // 5 seconds
TWILIO_TIMEOUT: 5000,          // 5 seconds

// Express middleware timeouts (milliseconds)
EXPRESS_PAYMENT_TIMEOUT: 30000,      // 30 seconds
EXPRESS_SUBSCRIPTION_TIMEOUT: 30000, // 30 seconds
```

To adjust timeouts, modify `/config/timeout-config.js`.

## Best Practices

1. **Always classify errors** before sending to client
2. **Use fallback strategies** for critical notifications (email/SMS)
3. **Return clear messages** - never generic "Internal Error"
4. **Log all timeouts separately** with TIMEOUT_ERR code
5. **Include retryable flag** in error responses
6. **Monitor with Sentry** for production issues
7. **Test both timeout and error paths** in unit tests

## Compliance with Q59 & Q60 Requirements

### Q59 Compliance
- ✅ Configured timeout 5s for: GeniusPay, Mailjet, Twilio
- ✅ Configured Express middleware timeout 30s on /payments, /subscriptions
- ✅ Handles ECONNABORTED, ETIMEDOUT as specific errors
- ✅ Logs timeout separately (code: TIMEOUT_ERR)
- ✅ Fallback mechanisms implemented (email fallback, SMS fallback)

### Q60 Compliance
- ✅ Differentiates error types: timeout ≠ rate-limit ≠ auth-invalid ≠ server-error
- ✅ Clear client messages (not "Erreur interne générique")
- ✅ Twilio SMS fail → fallback email OTP
- ✅ Mailjet fail → fallback SMS notification
- ✅ GeniusPay fail → clear "Paiement échoué" message
- ✅ Logs all timeouts + errors on Sentry

## Next Steps

1. Deploy to production
2. Monitor Sentry for third-party errors
3. Adjust timeouts if needed based on real-world performance
4. Add integration tests with mock third-party APIs
5. Document in API reference for frontend teams
