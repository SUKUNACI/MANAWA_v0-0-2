# MANAWA Backend API Documentation

Complete API documentation for MANAWA - Platform de mise en relation particuliers/professionnels du bâtiment.

## Quick Start

### API Versioning

Starting with this release, all endpoints are versioned. The current version is **v1**.

- **Current API Version**: `v1` (stable)
- **API Base URL**: `http://localhost:4000/api/v1`
- **Old Base URL**: `http://localhost:4000/api` (deprecated - redirects to v1)

### Accessing Documentation

- **Interactive Swagger UI**: http://localhost:4000/docs
- **OpenAPI JSON**: http://localhost:4000/docs/swagger.json
- **OpenAPI YAML**: http://localhost:4000/docs/openapi.yaml
- **Documentation Health**: http://localhost:4000/docs/health
- **API Statistics**: http://localhost:4000/docs/stats

### Installation

1. Install required dependencies:

```bash
npm install swagger-ui-express swagger-jsdoc js-yaml
```

2. The documentation routes are automatically registered in `index.js`:

```javascript
const docsRoutes = require('./routes/docs');
app.use('/docs', docsRoutes);
```

## API Overview

### Total Endpoints: 337+

The MANAWA API is organized into 31 route modules covering:

| Module | File | Endpoints | Purpose |
|--------|------|-----------|---------|
| Authentication | auth.js | 10 | User registration, login, token refresh |
| Users | users.js | 12 | User profile management |
| Verification | verification.js | 8 | Email verification |
| Professionals | professionals.js | 15 | Professional profiles and search |
| Projects | projects.js | 25 | Project creation and management |
| Quotes | quotes.js | 22 | Quote generation and management |
| Bookings | bookings.js | 10 | Booking management |
| Payments | payments.js | 12 | Payment processing |
| Finances | finances.js | 8 | Financial transactions |
| Messages | messages.js | 10 | Messaging system |
| Notifications | notifications.js | 8 | Push notifications |
| Reviews | reviews.js | 6 | Project reviews |
| Subscriptions | subscriptions.js | 10 | Subscription plans |
| Portfolio | portfolio-projects.js | 8 | Professional portfolio |
| Companies | companies.js | 6 | Company management |
| Badges | badges.js | 5 | User badges/achievements |
| Referrals | referrals.js | 8 | Referral system |
| Support | support.js | 7 | Support tickets |
| Search | search.js | 12 | Global search |
| Disputes | disputes.js | 8 | Dispute management |
| Admin | admin.js | 25 | Administrative operations |
| Role Permissions | role-permissions.js | 15 | Role-based access control |
| Analytics | analytics.js | 18 | Analytics and reporting |
| Admin Backups | admin-backups.js | 12 | Backup management |
| Admin Recovery | admin-recovery.js | 10 | Data recovery |
| CDN Admin | cdn-admin.js | 15 | CDN management |
| Video Calls | videoCalls.js | 12 | Video calling |
| Webhooks Admin | webhooks-admin.js | 14 | Webhook management |
| Queues Admin | queues-admin.js | 12 | Job queue management |
| Health | health.js | 5 | System health checks |
| Monitoring | monitoring.js | 8 | System monitoring |

## Authentication

All protected endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

### Token Details

- **Access Token TTL**: 15 minutes
- **Refresh Token TTL**: 30 days
- **Token Type**: JWT
- **Signing Algorithm**: HS256

### Obtaining Tokens

1. Register: `POST /auth/register` - Returns `token` and `refreshToken`
2. Login: `POST /auth/login` - Returns `token` and `refreshToken`
3. Refresh: `POST /auth/refresh` - Use expired token to get new one

Example:
```bash
curl -X POST http://localhost:4000/api/v1/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"Password123!"}'
```

## Rate Limiting

API endpoints have rate limiting to prevent abuse:

| Limiter | Limit | Window | Applies To |
|---------|-------|--------|-----------|
| authLimiter | 10 requests | 15 minutes | /auth/* (register, login) |
| readLimiter | 30 requests | 15 minutes | GET endpoints |
| writeLimiter | 20 requests | 15 minutes | POST, PUT, PATCH endpoints |
| adminLimiter | 50 requests | 15 minutes | Admin endpoints |
| accountLimiter | 5 failed | 1 hour | Failed login attempts |

Rate limit exceeded returns HTTP 429 with error message.

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "Error message",
  "status": 400,
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/v1/v1/projects"
}
```

### Common Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No content |
| 400 | Bad request / Validation error |
| 401 | Unauthorized (authentication required) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 409 | Conflict (e.g., email exists) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

## Core Concepts

### User Roles

- **CLIENT**: Person requesting services
- **PROFESSIONAL**: Service provider
- **ADMIN**: Platform administrator

### Project Status Flow

1. DRAFT - Initial state
2. PUBLISHED - Listed for professionals to bid
3. MATCHED - Professional accepted quote
4. IN_PROGRESS - Service being delivered
5. COMPLETED - Service completed
6. CANCELLED - Project cancelled

### Quote Status Flow

1. DRAFT - Being prepared
2. SENT - Sent to client
3. ACCEPTED - Client accepted
4. REJECTED - Client rejected
5. EXPIRED - Expiration date passed

### Payment Flow

1. PENDING - Payment initiated
2. COMPLETED - Payment successful
3. FAILED - Payment failed
4. REFUNDED - Payment refunded

## Pagination

List endpoints support pagination:

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)

**Response Format:**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## File Structure

```
docs/
├── README.md              # This file
├── swagger.js             # Swagger/OpenAPI configuration
├── openapi.yaml           # OpenAPI 3.0 specification (YAML)
├── api-endpoints.js       # Detailed endpoint documentation
├── schemas.js             # Reusable schema definitions
├── INTEGRATION.md         # Integration guide
└── ENDPOINTS.md           # Complete endpoint reference
```

## Key Schemas

### User
```json
{
  "id": "uuid",
  "email": "string",
  "firstName": "string",
  "lastName": "string",
  "role": "CLIENT|PROFESSIONAL|ADMIN",
  "phone": "string|null",
  "city": "string|null",
  "avatarUrl": "uri|null",
  "emailVerified": "boolean",
  "createdAt": "date-time",
  "updatedAt": "date-time"
}
```

### Project
```json
{
  "id": "uuid",
  "clientId": "uuid",
  "title": "string",
  "description": "string",
  "category": "string",
  "status": "DRAFT|PUBLISHED|MATCHED|IN_PROGRESS|COMPLETED|CANCELLED",
  "budget": "number|null",
  "location": "string|null",
  "deadline": "date|null",
  "photos": ["uri"],
  "quotes": [Quote],
  "review": "Review|null",
  "createdAt": "date-time"
}
```

### Quote
```json
{
  "id": "uuid",
  "projectId": "uuid",
  "professionalId": "uuid",
  "title": "string",
  "description": "string",
  "amount": "number",
  "tva": "number|null",
  "status": "DRAFT|SENT|ACCEPTED|REJECTED|EXPIRED",
  "items": [QuoteItem],
  "validUntil": "date-time|null",
  "createdAt": "date-time"
}
```

### Payment
```json
{
  "id": "uuid",
  "quoteId": "uuid|null",
  "bookingId": "uuid|null",
  "amount": "number",
  "status": "PENDING|COMPLETED|FAILED|REFUNDED",
  "method": "CARD|BANK_TRANSFER|WALLET",
  "geniuspayRef": "string|null",
  "isDeposit": "boolean",
  "createdAt": "date-time"
}
```

## Common Workflows

### 1. User Registration & Login

```bash
# Register
POST /api/v1/v1/auth/register
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "Jean",
  "lastName": "Dupont",
  "role": "CLIENT"
}

# Response
{
  "user": {...},
  "token": "eyJhbGciOi...",
  "refreshToken": "abcd1234..."
}

# Login
POST /api/v1/v1/auth/login
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### 2. Create Project & Get Quotes

```bash
# Create project
POST /api/v1/v1/projects
Authorization: Bearer <token>
{
  "title": "Rénovation salle de bain",
  "description": "Carrelage neuf, robinetterie...",
  "category": "Plomberie",
  "budget": 5000,
  "deadline": "2024-02-15"
}

# Get project quotes
GET /api/v1/v1/projects/{projectId}
Authorization: Bearer <token>

# Accept quote
POST /api/v1/quotes/{quoteId}/accept
Authorization: Bearer <token>
{
  "scheduledDate": "2024-02-01T14:00:00Z"
}
```

### 3. Make Payment

```bash
# Create payment
POST /api/v1/payments
Authorization: Bearer <token>
{
  "quoteId": "uuid",
  "amount": 2500,
  "method": "CARD",
  "isDeposit": true
}

# Response includes payment URL or reference
{
  "id": "uuid",
  "status": "PENDING",
  "geniuspayRef": "GP-123456"
}
```

### 4. Leave Review

```bash
# Create review
POST /api/v1/reviews
Authorization: Bearer <token>
{
  "projectId": "uuid",
  "professionalId": "uuid",
  "rating": 5,
  "comment": "Excellent work, highly recommended!"
}
```

## Security Features

- **JWT Authentication**: Secure token-based authentication
- **Email Verification**: Required before account activation
- **Password Hashing**: bcryptjs with 10 salt rounds
- **Rate Limiting**: Prevents brute force and abuse
- **CORS**: Restricted to allowed origins
- **Helmet**: Security headers
- **Input Validation**: express-validator
- **SQL Injection Prevention**: Prisma ORM with parameterized queries
- **CSRF Protection**: Token-based validation

## Integration Examples

### JavaScript/Node.js

```javascript
const token = 'eyJhbGciOi...';

// Get projects
const response = await fetch('http://localhost:4000/api/v1/v1/projects/mine', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const projects = await response.json();
```

### Python

```python
import requests

headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}

response = requests.get(
    'http://localhost:4000/api/v1/v1/projects/mine',
    headers=headers
)

projects = response.json()
```

### cURL

```bash
curl -X GET http://localhost:4000/api/v1/v1/projects/mine \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -H "Content-Type: application/json"
```

## Testing

Use Swagger UI to test endpoints directly:

1. Open http://localhost:4000/docs
2. Click "Authorize" button
3. Enter your Bearer token
4. Click on endpoint to expand
5. Fill in parameters and request body
6. Click "Try it out"

## Support

For API support and documentation:
- Email: support@manawa.app
- Documentation: http://localhost:4000/docs
- Specification: http://localhost:4000/docs/openapi.yaml

## Versioning

Current API Version: 1.0.0

Breaking changes will increment major version (e.g., 2.0.0).
Non-breaking additions increment minor version (e.g., 1.1.0).

## Changelog

### v1.0.0 (2024-01-15)
- Initial API release with 337+ endpoints
- JWT authentication
- Rate limiting
- Comprehensive documentation
- Swagger UI integration
