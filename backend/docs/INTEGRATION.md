# MANAWA API Integration Guide

Complete guide for integrating the MANAWA API into your applications.

## Table of Contents

1. [Setup & Installation](#setup--installation)
2. [Authentication](#authentication)
3. [Common Workflows](#common-workflows)
4. [Error Handling](#error-handling)
5. [Rate Limiting](#rate-limiting)
6. [Code Examples](#code-examples)
7. [Testing](#testing)
8. [Debugging](#debugging)

## Setup & Installation

### Backend Dependencies

Required packages are already included in `package.json`:

```json
{
  "swagger-ui-express": "^4.x",
  "swagger-jsdoc": "^6.x",
  "js-yaml": "^4.x"
}
```

If not installed, run:
```bash
npm install swagger-ui-express swagger-jsdoc js-yaml
```

### Configuration

1. **Docs Routes**: Automatically registered in `index.js` on `/docs` path
2. **OpenAPI Specifications**: Available in multiple formats:
   - Swagger UI: `http://localhost:3000/docs`
   - JSON: `http://localhost:3000/docs/swagger.json`
   - YAML: `http://localhost:3000/docs/openapi.yaml`

### File Structure

```
backend/
├── docs/
│   ├── README.md                    # Main documentation
│   ├── INTEGRATION.md               # This file
│   ├── swagger.js                   # Swagger configuration
│   ├── api-endpoints.js             # Endpoint definitions
│   ├── schemas.js                   # Reusable schemas
│   ├── openapi.yaml                 # OpenAPI 3.0 spec
│   └── ENDPOINTS.md                 # Complete endpoint reference
├── routes/
│   ├── docs.js                      # Documentation routes (NEW)
│   ├── auth.js
│   ├── projects.js
│   └── ... (other routes)
└── index.js                         # Main app file (UPDATED)
```

## Authentication

### Token Types

The API uses JWT tokens with two types:

#### Access Token
- **TTL**: 15 minutes
- **Usage**: Include in `Authorization: Bearer <token>` header
- **Purpose**: Authenticate API requests

#### Refresh Token
- **TTL**: 30 days
- **Usage**: Use to obtain new access token
- **Purpose**: Long-term session management

### Getting Tokens

#### Registration

```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "Jean",
  "lastName": "Dupont",
  "role": "CLIENT"
}

HTTP 201
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "Jean",
    "lastName": "Dupont",
    "role": "CLIENT",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "abcd1234efgh5678ijkl9012mnop3456qrst5678"
}
```

#### Login

```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}

HTTP 200
{
  "user": {...},
  "token": "eyJhbGciOi...",
  "refreshToken": "abcd1234..."
}
```

#### Refresh Token

```bash
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "abcd1234efgh5678ijkl9012mnop3456qrst5678"
}

HTTP 200
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Using Tokens

Include in all authenticated requests:

```bash
curl -X GET http://localhost:3000/api/projects/mine \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json"
```

### Token Refresh Flow

Client-side implementation:

```javascript
// Store tokens
localStorage.setItem('accessToken', response.token);
localStorage.setItem('refreshToken', response.refreshToken);

// Automatic refresh on token expiration
async function getAccessToken() {
  const token = localStorage.getItem('accessToken');
  
  // Try to use current token
  try {
    return token;
  } catch (err) {
    // Token expired, refresh it
    const refreshToken = localStorage.getItem('refreshToken');
    const newToken = await fetch('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken })
    }).then(r => r.json());
    
    localStorage.setItem('accessToken', newToken.token);
    return newToken.token;
  }
}
```

## Common Workflows

### 1. User Registration & Profile Setup

```javascript
// Step 1: Register
const registerRes = await fetch('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    email: 'professional@example.com',
    password: 'SecurePass123!',
    firstName: 'Marie',
    lastName: 'Martin',
    role: 'PROFESSIONAL',
    trades: ['Plomberie', 'Chauffage'],
    accountType: 'INDEPENDENT'
  })
});
const { token, user } = await registerRes.json();

// Step 2: Verify email
await fetch('/api/verification/send-email', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});

// Step 3: Complete profile
await fetch('/api/professionals/profile', {
  method: 'PUT',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    bio: 'Expert with 10 years experience',
    yearsExperience: 10,
    accountType: 'INDEPENDENT'
  })
});
```

### 2. Create Project & Receive Quotes

```javascript
// Step 1: Create project
const projectRes = await fetch('/api/projects', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${clientToken}` },
  body: JSON.stringify({
    title: 'Rénovation salle de bain',
    description: 'Carrelage, robinetterie, tuyauterie',
    category: 'Plomberie',
    budget: 5000,
    location: 'Paris',
    deadline: '2024-02-15'
  })
});
const project = await projectRes.json();

// Step 2: Client publishes project
await fetch(`/api/projects/${project.id}`, {
  method: 'PUT',
  headers: { 'Authorization': `Bearer ${clientToken}` },
  body: JSON.stringify({ status: 'PUBLISHED' })
});

// Step 3: Professionals submit quotes
const quoteRes = await fetch('/api/quotes', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${proToken}` },
  body: JSON.stringify({
    projectId: project.id,
    title: 'Devis rénovation salle de bain',
    description: 'Intervention 2 jours',
    amount: 4500,
    tva: 900,
    items: [
      {
        description: 'Démolition carrelage',
        quantity: 1,
        unitPrice: 800
      },
      {
        description: 'Installation robinetterie',
        quantity: 1,
        unitPrice: 1200
      },
      {
        description: 'Tuyauterie + chauffage',
        quantity: 1,
        unitPrice: 2500
      }
    ]
  })
});
const quote = await quoteRes.json();

// Step 4: Client accepts quote
await fetch(`/api/quotes/${quote.id}/accept`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${clientToken}` },
  body: JSON.stringify({
    scheduledDate: '2024-01-20T09:00:00Z'
  })
});
```

### 3. Make Payment

```javascript
// Step 1: Create payment
const paymentRes = await fetch('/api/payments', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${clientToken}` },
  body: JSON.stringify({
    quoteId: quote.id,
    amount: 2250,  // 50% deposit
    method: 'CARD',
    isDeposit: true
  })
});
const payment = await paymentRes.json();

// Step 2: Handle payment redirect
if (payment.geniuspayRef) {
  // Payment gateway will redirect user
  window.location = `/payment-redirect?ref=${payment.geniuspayRef}`;
}

// Step 3: Verify payment status
const statusRes = await fetch(`/api/payments/${payment.id}`, {
  headers: { 'Authorization': `Bearer ${clientToken}` }
});
const paymentStatus = await statusRes.json();

if (paymentStatus.status === 'COMPLETED') {
  console.log('Payment successful!');
}
```

### 4. Messaging Between Parties

```javascript
// Step 1: Send message
const msgRes = await fetch('/api/messages', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${senderToken}` },
  body: JSON.stringify({
    recipientId: recipientUserId,
    content: 'Puis-je venir demain à 10h?',
    conversationId: conversationId  // optional, creates new if omitted
  })
});
const message = await msgRes.json();

// Step 2: Get conversation
const convRes = await fetch(`/api/messages/${conversationId}`, {
  headers: { 'Authorization': `Bearer ${userToken}` }
});
const messages = await convRes.json();

// Step 3: Mark as read
await fetch(`/api/messages/${message.id}/read`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${userToken}` }
});
```

### 5. Leave Review

```javascript
// Step 1: Create review after completion
const reviewRes = await fetch('/api/reviews', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${clientToken}` },
  body: JSON.stringify({
    projectId: project.id,
    professionalId: professional.id,
    rating: 5,
    comment: 'Excellent travail! Très professionnel et rapide.'
  })
});
const review = await reviewRes.json();

// Step 2: View professional reviews
const reviewsRes = await fetch(`/api/reviews/${professional.id}`, {
  headers: { 'Authorization': `Bearer ${userToken}` }
});
const reviews = await reviewsRes.json();
```

## Error Handling

### Error Response Format

```json
{
  "error": "Email already exists",
  "status": 409,
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/auth/register"
}
```

### Validation Error Format

```json
{
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format",
      "value": "invalid-email"
    },
    {
      "field": "password",
      "message": "Password must be at least 8 characters",
      "value": "short"
    }
  ],
  "message": "Validation failed"
}
```

### Status Codes

| Code | Scenario | Action |
|------|----------|--------|
| 200 | Success | Process response |
| 201 | Created | Resource created, use returned ID |
| 204 | No Content | Success, no response body |
| 400 | Bad Request | Check validation errors |
| 401 | Unauthorized | Refresh token and retry |
| 403 | Forbidden | Check permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource exists (e.g., email) |
| 429 | Rate Limited | Wait and retry |
| 500 | Server Error | Log error, retry with backoff |

### Error Handling Implementation

```javascript
async function apiCall(method, path, data, token) {
  try {
    const response = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      body: data ? JSON.stringify(data) : null
    });

    // Handle validation errors
    if (response.status === 400) {
      const error = await response.json();
      if (error.errors) {
        // Handle validation errors
        error.errors.forEach(err => {
          console.error(`${err.field}: ${err.message}`);
        });
      }
      throw new Error(error.error || 'Validation failed');
    }

    // Handle auth errors
    if (response.status === 401) {
      // Refresh token and retry
      await refreshToken();
      return apiCall(method, path, data, await getToken());
    }

    // Handle other errors
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error('API call failed:', err);
    throw err;
  }
}
```

## Rate Limiting

### Limits by Endpoint Type

| Type | Limit | Window | Applies To |
|------|-------|--------|-----------|
| Auth | 10 req | 15 min | /auth/register, /auth/login |
| Read | 30 req | 15 min | GET endpoints |
| Write | 20 req | 15 min | POST, PUT, PATCH |
| Admin | 50 req | 15 min | Admin endpoints |
| Login Attempts | 5 failed | 1 hour | /auth/login (per account) |

### Rate Limit Headers

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 28
X-RateLimit-Reset: 1705314600
Retry-After: 900
```

### Handling Rate Limits

```javascript
async function apiCallWithRetry(method, path, data, token, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall(method, path, data, token);
    } catch (err) {
      if (err.status === 429) {
        const retryAfter = err.headers.get('Retry-After') || 60;
        console.log(`Rate limited. Retrying after ${retryAfter}s`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      throw err;
    }
  }
}
```

## Code Examples

### JavaScript/Fetch API

```javascript
class MANAWAClient {
  constructor(baseUrl = 'http://localhost:3000/api') {
    this.baseUrl = baseUrl;
    this.token = null;
    this.refreshToken = null;
  }

  async register(email, password, firstName, lastName, role) {
    const res = await fetch(`${this.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, firstName, lastName, role })
    });
    const data = await res.json();
    this.token = data.token;
    this.refreshToken = data.refreshToken;
    return data;
  }

  async login(email, password) {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    this.token = data.token;
    this.refreshToken = data.refreshToken;
    return data;
  }

  async createProject(title, description, category, budget) {
    return this._request('POST', '/projects', {
      title, description, category, budget
    });
  }

  async _request(method, path, data) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: data ? JSON.stringify(data) : null
    });

    if (res.status === 401) {
      await this._refreshToken();
      return this._request(method, path, data);
    }

    return await res.json();
  }

  async _refreshToken() {
    const res = await fetch(`${this.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.refreshToken })
    });
    const data = await res.json();
    this.token = data.token;
  }
}

// Usage
const client = new MANAWAClient();
await client.register('user@example.com', 'Pass123!', 'Jean', 'Dupont', 'CLIENT');
const project = await client.createProject('Renovation', 'Full renovation...', 'Plomberie', 5000);
```

### Python

```python
import requests
import json
from datetime import datetime, timedelta

class MANAWAClient:
    def __init__(self, base_url='http://localhost:3000/api'):
        self.base_url = base_url
        self.token = None
        self.refresh_token = None
        self.session = requests.Session()

    def register(self, email, password, first_name, last_name, role):
        res = self.session.post(f'{self.base_url}/auth/register', json={
            'email': email,
            'password': password,
            'firstName': first_name,
            'lastName': last_name,
            'role': role
        })
        data = res.json()
        self.token = data['token']
        self.refresh_token = data['refreshToken']
        return data

    def login(self, email, password):
        res = self.session.post(f'{self.base_url}/auth/login', json={
            'email': email,
            'password': password
        })
        data = res.json()
        self.token = data['token']
        self.refresh_token = data['refreshToken']
        return data

    def create_project(self, title, description, category, budget=None):
        return self._request('POST', '/projects', {
            'title': title,
            'description': description,
            'category': category,
            'budget': budget
        })

    def _request(self, method, path, data=None):
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.token}'
        }
        res = self.session.request(method, f'{self.base_url}{path}', json=data, headers=headers)

        if res.status_code == 401:
            self._refresh_token()
            return self._request(method, path, data)

        return res.json()

    def _refresh_token(self):
        res = self.session.post(f'{self.base_url}/auth/refresh', json={
            'refreshToken': self.refresh_token
        })
        data = res.json()
        self.token = data['token']

# Usage
client = MANAWAClient()
client.register('user@example.com', 'Pass123!', 'Jean', 'Dupont', 'CLIENT')
project = client.create_project('Renovation', 'Full renovation...', 'Plomberie', 5000)
print(project)
```

### cURL

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "firstName": "Jean",
    "lastName": "Dupont",
    "role": "CLIENT"
  }'

# Extract token from response and save
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Create project
curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Renovation",
    "description": "Full renovation...",
    "category": "Plomberie",
    "budget": 5000
  }'
```

## Testing

### Using Swagger UI

1. Open http://localhost:3000/docs
2. Click **Authorize** button
3. Enter your Bearer token: `Bearer <your_token>`
4. Click **Authorize**
5. Expand endpoint and click **Try it out**
6. Fill in parameters and click **Execute**

### Using Postman

1. Import OpenAPI specification: http://localhost:3000/docs/swagger.json
2. Create environment with variables:
   - `baseUrl`: http://localhost:3000/api
   - `token`: (your JWT token)
3. Use `{{baseUrl}}` and `Authorization: Bearer {{token}}`

### Unit Testing

```javascript
describe('MANAWA API', () => {
  let client;
  let token;

  beforeAll(async () => {
    client = new MANAWAClient('http://localhost:3000/api');
    const res = await client.register('test@example.com', 'Pass123!', 'Test', 'User', 'CLIENT');
    token = res.token;
  });

  test('Create project', async () => {
    const project = await client.createProject(
      'Test Project',
      'Description',
      'Plomberie',
      5000
    );
    expect(project.id).toBeDefined();
    expect(project.status).toBe('DRAFT');
  });

  test('Get projects', async () => {
    const res = await client._request('GET', '/projects/mine');
    expect(Array.isArray(res.data)).toBe(true);
  });
});
```

## Debugging

### Enable Debug Logging

```javascript
// Add to client initialization
const originalFetch = window.fetch;
window.fetch = function(...args) {
  console.log('REQUEST:', args);
  return originalFetch.apply(this, args)
    .then(res => {
      console.log('RESPONSE:', res.status, res.statusText);
      return res;
    })
    .catch(err => {
      console.error('FETCH ERROR:', err);
      throw err;
    });
};
```

### Check Token Claims

```javascript
function decodeToken(token) {
  const parts = token.split('.');
  const payload = JSON.parse(atob(parts[1]));
  console.log('Token expires at:', new Date(payload.exp * 1000));
  console.log('User ID:', payload.id);
  console.log('Role:', payload.role);
  return payload;
}
```

### Common Issues

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Token expired or invalid. Refresh or login again |
| 403 Forbidden | User lacks permission. Check role and permissions |
| 429 Rate Limited | Wait for rate limit window or use exponential backoff |
| 400 Validation Error | Check request format and required fields |
| CORS Error | Ensure origin is in CORS whitelist |
| Token Not Refreshing | Check refresh token validity and TTL |

---

For more information, visit http://localhost:3000/docs
