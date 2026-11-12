# API Versioning - Quick Reference & Examples

## Overview

All MANAWA API endpoints are now versioned under `/api/v1/`. Legacy `/api/` endpoints automatically redirect to v1.

---

## Versioning at a Glance

| Aspect | Value |
|--------|-------|
| Current Version | `v1` |
| Previous Version | `v0` (deprecated) |
| API Base URL | `http://localhost:4000/api/v1` |
| Legacy URL | `http://localhost:4000/api` (redirects to v1) |
| Deprecation Date | 2026-11-10 |
| Sunset Date | 2027-05-10 |
| HTTP Status | 200 OK (v1), 301 Redirect (v0) |

---

## Response Headers

All API responses include versioning information:

### v1 Endpoint Response
```http
HTTP/1.1 200 OK
X-API-Version: v1
Deprecation: false
Content-Type: application/json
```

### Deprecated v0 Endpoint (via redirect)
```http
HTTP/1.1 301 Moved Permanently
Location: /api/v1/bookings
X-API-Version: v1
Deprecation: false
```

---

## Common Endpoints Examples

### Authentication

**Register User**
```bash
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "firstName": "Jean",
    "lastName": "Dupont",
    "role": "CLIENT"
  }'
```

**Response**:
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "Jean",
    "role": "CLIENT"
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "refresh_token_here"
}
```

**Headers**:
```
X-API-Version: v1
Deprecation: false
```

### Projects

**Create Project**
```bash
curl -X POST http://localhost:4000/api/v1/projects \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Rénovation salle de bain",
    "description": "Carrelage neuf, robinetterie",
    "category": "Plomberie",
    "budget": 5000,
    "deadline": "2024-02-15"
  }'
```

**List Projects**
```bash
curl http://localhost:4000/api/v1/projects/mine \
  -H "Authorization: Bearer <token>"
```

### Bookings

**Get All Bookings**
```bash
curl http://localhost:4000/api/v1/bookings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"

# Response headers:
# X-API-Version: v1
# Deprecation: false
```

**Get Booking Details**
```bash
curl http://localhost:4000/api/v1/bookings/{bookingId} \
  -H "Authorization: Bearer <token>"
```

### Payments

**Create Payment**
```bash
curl -X POST http://localhost:4000/api/v1/payments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "quoteId": "uuid",
    "amount": 2500,
    "method": "CARD",
    "isDeposit": true
  }'
```

**Get Payment Status**
```bash
curl http://localhost:4000/api/v1/payments/{paymentId} \
  -H "Authorization: Bearer <token>"
```

### Health Check

**Endpoint Available in Both Paths**
```bash
# New versioned path
curl http://localhost:4000/api/v1/health

# Old path (redirects)
curl -i http://localhost:4000/api/health
# HTTP/1.1 301 Moved Permanently
# Location: /api/v1/health
```

---

## Backwards Compatibility Examples

### Client Using Old Endpoint (Still Works)

```javascript
// Old code - still works but redirects
const response = await fetch('http://localhost:4000/api/bookings', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

// The server returns:
// HTTP 301 Redirect to /api/v1/bookings
// Most HTTP clients follow automatically
// Final response is from /api/v1/bookings
```

### Client Using New Endpoint (Recommended)

```javascript
// New code - direct path, no redirect needed
const response = await fetch('http://localhost:4000/api/v1/bookings', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

// HTTP 200 OK from /api/v1/bookings
// Headers include: X-API-Version: v1, Deprecation: false
```

---

## Query Parameters Preserved in Redirect

```bash
# Old endpoint with query parameters
curl "http://localhost:4000/api/bookings?page=2&limit=10&status=CONFIRMED"

# Server redirects to:
# Location: /api/v1/bookings?page=2&limit=10&status=CONFIRMED

# Final response uses the v1 path with all parameters preserved
```

---

## Complete v1 Route Structure

```
/api/v1/
├── /auth              # Authentication (register, login, refresh, etc.)
├── /users             # User profiles and management
├── /projects          # Project creation and management
├── /quotes            # Quote generation and management
├── /bookings          # Booking management
├── /payments          # Payment processing
├── /messages          # Messaging system
├── /notifications     # Push notifications
├── /professionals     # Professional profiles
├── /companies         # Company management
├── /finances          # Financial data
├── /reviews           # Project reviews
├── /subscriptions     # Subscription management
├── /portfolio-projects # Professional portfolio
├── /badges            # User badges/achievements
├── /referrals         # Referral system
├── /support           # Support tickets
├── /search            # Global search
├── /disputes          # Dispute management
├── /availability      # Availability management
├── /packages          # Service packages
├── /analytics         # Analytics and reporting
├── /video-calls       # Video calling
├── /admin             # Admin operations (with sub-routes)
│   ├── /badges        # Badge administration
│   ├── /referrals     # Referral administration
│   ├── /kpis          # KPI management
│   ├── /webhooks      # Webhook management
│   ├── /queues        # Job queue management
│   └── /backups       # Backup management
├── /role-permissions  # Role-based access control
├── /verification      # Email verification
├── /health            # System health checks
├── /monitoring        # System monitoring
└── /docs              # API documentation (not versioned)
```

---

## Migration Timeline

### Phase 1: Now (2026-11-12)
- ✅ v1 endpoints live at `/api/v1/`
- ✅ v0 endpoints still work via 301 redirects
- ✅ All new features use v1

### Phase 2: Over Next 6 Months
- Notify all API consumers
- Monitor v0 usage (should decrease)
- Support both versions

### Phase 3: Sunset (2027-05-10)
- Remove v0 redirect middleware
- Return 410 Gone for old endpoints
- Force remaining clients to v1

---

## Testing Versioning

### Test 1: Verify v1 Access
```bash
curl -i http://localhost:4000/api/v1/health
# Expected: 200 OK with X-API-Version: v1
```

### Test 2: Verify Redirect
```bash
curl -i http://localhost:4000/api/health
# Expected: 301 Moved Permanently to /api/v1/health
```

### Test 3: Follow Redirect
```bash
curl -L http://localhost:4000/api/health
# Expected: 200 OK (curl follows redirect automatically)
```

### Test 4: Check Headers
```bash
curl -i http://localhost:4000/api/v1/bookings \
  -H "Authorization: Bearer <token>"
# Expected headers:
# X-API-Version: v1
# Deprecation: false
```

### Test 5: Verify Query Parameters
```bash
curl -L "http://localhost:4000/api/bookings?page=1&limit=20"
# Expected: Redirects with parameters preserved
# Final URL: /api/v1/bookings?page=1&limit=20
```

---

## Swagger/OpenAPI Documentation

Access the interactive API documentation:

- **Swagger UI**: http://localhost:4000/docs
- **OpenAPI JSON**: http://localhost:4000/docs/swagger.json
- **OpenAPI YAML**: http://localhost:4000/docs/openapi.yaml

The Swagger documentation now:
- Shows `/api/v1/` endpoints as primary
- Includes deprecation information
- Documents v0 as "Deprecated"
- Provides migration guidance

---

## Version Header Details

### X-API-Version Header

**Value**: `v1`

**Sent With**: Every API response

**Usage**: Clients can verify which API version they're consuming

```javascript
// Check version in response
fetch('http://localhost:4000/api/v1/bookings')
  .then(res => {
    const version = res.headers.get('x-api-version');
    console.log(`API Version: ${version}`); // Outputs: "API Version: v1"
    return res.json();
  });
```

### Deprecation Header

**Values**: `true` or `false`

**Sent With**: Every API response

**Meaning**:
- `Deprecation: false` - Endpoint is current (v1)
- `Deprecation: true` - Endpoint is deprecated (would be v0)

```javascript
// Check if endpoint is deprecated
fetch('http://localhost:4000/api/v1/bookings')
  .then(res => {
    const deprecated = res.headers.get('deprecation') === 'true';
    if (deprecated) {
      console.warn('Using deprecated endpoint!');
    }
  });
```

### Sunset Header

**Value**: HTTP date string

**Sent With**: Deprecated endpoints only

**Example**:
```
Sunset: Thu, 10 May 2027 00:00:00 GMT
```

**Usage**: Clients know exact date when endpoint will be removed

---

## SDK/Library Examples

### JavaScript/Node.js

```javascript
const API_BASE = 'http://localhost:4000/api/v1';
const token = 'your_jwt_token';

async function getBookings() {
  const response = await fetch(`${API_BASE}/bookings`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  const version = response.headers.get('x-api-version');
  console.log(`Using API: ${version}`);
  
  return response.json();
}
```

### Python

```python
import requests

API_BASE = 'http://localhost:4000/api/v1'
token = 'your_jwt_token'

headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}

response = requests.get(f'{API_BASE}/bookings', headers=headers)
version = response.headers.get('x-api-version')
print(f'Using API: {version}')  # Prints: Using API: v1
data = response.json()
```

### cURL

```bash
curl -X GET 'http://localhost:4000/api/v1/bookings' \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -i
```

---

## Troubleshooting

### Issue: Still Getting Old Endpoints

**Solution**: Update base URL to include `/v1`
```javascript
// Before
const API = 'http://localhost:4000/api';

// After
const API = 'http://localhost:4000/api/v1';
```

### Issue: Missing X-API-Version Header

**Solution**: Ensure your client is receiving the response headers
```javascript
const response = await fetch('http://localhost:4000/api/v1/bookings');
const version = response.headers.get('x-api-version');
console.log(version); // Should print: v1
```

### Issue: Redirect Loops

**Solution**: Most HTTP clients follow redirects automatically. If you're getting loops:
1. Use client following redirects (most do by default)
2. Or update directly to v1 URLs

---

## Support & Documentation

- **Swagger UI**: http://localhost:4000/docs
- **Full Docs**: `/docs/README.md`
- **Endpoints Reference**: `/docs/ENDPOINTS.md`
- **Versioning Report**: `/API_VERSIONING_REPORT.md`
- **Support Email**: support@manawa.app

---

## Summary

| Component | Status |
|-----------|--------|
| v1 Endpoints | ✅ Live |
| v0 Redirects | ✅ Working (301) |
| Documentation | ✅ Updated |
| Headers | ✅ Added |
| Tests | ✅ Created |
| Backwards Compatibility | ✅ Maintained |

**All endpoints are now versioned and ready for production.**
