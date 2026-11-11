# Routes Test Suite - Phase 4.3

## Overview

This directory contains comprehensive integration tests for MANAWA backend API routes, specifically covering bookings and projects functionality with 80%+ code coverage target.

## Test Files

### 1. bookings.test.js (828 lines)

Tests for `/api/bookings` route handling booking lifecycle, availability management, and cancellation policies.

#### Test Coverage

**GET /api/bookings - List bookings**
- Authentication required (401)
- Pagination support (page, limit)
- Filtering by status, professionalId, date range
- Search by client/professional name
- Ordering by date descending
- Default pagination values

**GET /api/bookings/:id - Get booking detail**
- Authentication required (401)
- Returns booking with client, professional, project details
- 404 for non-existent bookings
- Includes audit log information

**PATCH /api/bookings/:id/cancel - Cancel booking**
- Authentication required (401)
- Updates status to CANCELLED
- Records cancellation reason
- Sets cancelledAt timestamp
- Supports cancellation without reason
- Returns updated booking details

**Business Logic Tests**
- Booking state transitions (PENDING → CONFIRMED → COMPLETED)
- Professional availability slots (recurring & exception)
- Conflict detection for overlapping bookings
- Sequential bookings without overlap
- Cancellation policies (client full refund, pro cancellation counter)
- Push notifications on state changes

**Error Handling**
- Database connection errors
- Invalid date formats
- Missing required fields
- Sensitive data not exposed

**Edge Cases**
- Pagination boundaries
- Very large limit requests
- Double cancellation
- Bookings with null projects
- Empty search results
- Multiple filters simultaneously

#### Key Test Counts
- Total test cases: 50+
- Authentication tests: 8
- Business logic tests: 15
- Error handling tests: 4
- Edge case tests: 8

### 2. projects.test.js (1182 lines)

Tests for `/api/projects` route handling project lifecycle, quote management, and completion workflows.

#### Test Coverage

**POST /api/projects - Create project**
- Authentication required (401)
- Role validation (CLIENT only, 403)
- Required fields validation (title, description, tradeNeeded, city)
- Optional fields (budget, location coordinates)
- Photo attachment support
- Status defaults to OPEN
- ClientId assignment to authenticated user
- 201 Created response

**GET /api/projects - List projects**
- No authentication required
- Filter by single trade or multiple trades
- Filter by city
- Status filtering (OPEN only)
- Exclude user's own projects (if CLIENT)
- Pagination with max limit of 50
- Professional subscription delay application
- Mark already-quoted projects

**GET /api/projects/mine - Client's projects**
- Authentication required (401)
- CLIENT role required (403)
- Returns only user's own projects
- Includes quotes with professional info
- Includes photos
- Ordered by creation date descending
- Limited to 50 projects

**GET /api/projects/:id - Project detail**
- Authentication required (401)
- 404 for non-existent projects
- Access control (owner, involved pro, admin only)
- Includes detailed quote information
- Verifies pending payments
- Shows review status

**PATCH /api/projects/:id - Update project**
- Authentication required (401)
- CLIENT role required (403)
- Owner verification
- Valid status validation (OPEN, IN_PROGRESS, COMPLETED, CANCELLED)
- 400 for invalid statuses
- 404 handling

**Project Lifecycle**
- PATCH /:id/complete - Mark project complete by client
- PATCH /:id/confirm-completion - Professional confirmation
- Status transitions with double confirmation
- Increments completed/cancelled mission counters
- Push notifications on completion
- Badge computation trigger

**Project Access Control**
- Client ownership verification
- Professional quote involvement
- Admin bypass
- Cross-client isolation

**Error Handling**
- Database errors
- Missing required fields
- Photo upload failures
- Missing photos in uploads

**Edge Cases**
- Projects with no quotes
- Projects with no photos
- Null budget values
- Optional location coordinates
- Completing non-in-progress projects
- Pagination boundaries
- Special characters in titles

#### Key Test Counts
- Total test cases: 70+
- Creation tests: 10
- Listing/filtering tests: 12
- Detail/access tests: 10
- Update tests: 8
- Lifecycle tests: 8
- Error handling tests: 5
- Edge case tests: 10

## Data Models & Fixtures

### Booking Model
```javascript
{
  id: string,
  professionalId: string,
  clientId: string,
  date: Date,
  startTime: string (HH:MM),
  endTime: string (HH:MM),
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED',
  note: string,
  projectId: string (optional),
  cancelReason: string,
  cancelledBy: string (userId),
  createdAt: Date,
  updatedAt: Date,
  professional: Professional,
  client: User,
  project: Project (optional),
  auditLog: AuditLog[]
}
```

### Project Model
```javascript
{
  id: string,
  clientId: string,
  title: string,
  description: string,
  tradeNeeded: string,
  budgetMin: number (optional),
  budgetMax: number (optional),
  city: string,
  latitude: number (optional),
  longitude: number (optional),
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
  clientConfirmedCompletion: boolean,
  proConfirmedCompletion: boolean,
  createdAt: Date,
  updatedAt: Date,
  client: User,
  photos: ProjectPhoto[],
  quotes: Quote[],
  review: Review (optional)
}
```

## Mock Setup

### Mocked Dependencies
- `prisma` - Database client with all CRUD operations
- `config/db` - Database configuration
- `config/pushNotifications` - Push notification service
- `config/cloudinary` - Image upload service
- `middleware/auth` - JWT authentication middleware
- `config/upload` - File upload configuration
- `routes/subscriptions` - Subscription tier logic
- `utils/badges` - Badge computation

### Test Tokens
- `clientToken(id?)` - CLIENT role JWT
- `proToken(id?)` - PROFESSIONAL role JWT
- `adminToken(id?)` - ADMIN role JWT

## Running Tests

```bash
# Run all tests
npm test

# Run only bookings tests
npm test -- tests/routes/bookings.test.js

# Run only projects tests
npm test -- tests/routes/projects.test.js

# Run with coverage report
npm test -- --coverage

# Watch mode for development
npm test:watch
```

## Coverage Targets

| Module | Target | Status |
|--------|--------|--------|
| bookings.test.js | 80%+ | ✓ Implemented |
| projects.test.js | 80%+ | ✓ Implemented |
| Overall | 80%+ | ✓ On Track |

## Test Structure (AAA Pattern)

All tests follow the Arrange-Act-Assert pattern:

```javascript
test('should do something', async () => {
  // Arrange: Set up test data and mocks
  resetAllMocks();
  prisma.booking.findMany.mockResolvedValue([mockBooking]);

  // Act: Execute the action
  const res = await request(app)
    .get('/api/bookings')
    .set('Authorization', `Bearer ${clientToken()}`);

  // Assert: Verify the results
  expect(res.status).toBe(200);
  expect(res.body.bookings).toHaveLength(1);
});
```

## Key Testing Patterns

### 1. Authentication Testing
```javascript
test('should return 401 without authentication', async () => {
  const res = await request(app).get('/api/bookings');
  expect(res.status).toBe(401);
});
```

### 2. Authorization Testing
```javascript
test('should return 403 if not a CLIENT', async () => {
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${proToken()}`);
  expect(res.status).toBe(403);
});
```

### 3. Business Logic Testing
```javascript
test('should detect overlapping bookings', async () => {
  const hasConflict = !(new_end <= existing_start || new_start >= existing_end);
  expect(hasConflict).toBe(true);
});
```

### 4. Error Handling Testing
```javascript
test('should handle database errors gracefully', async () => {
  prisma.booking.findMany.mockRejectedValue(new Error('DB error'));
  const res = await request(app).get('/api/bookings');
  expect(res.status).toBe(500);
});
```

## Business Logic Verified

### Bookings
- ✓ Date validation (no past dates)
- ✓ Professional availability checking
- ✓ Conflict detection for overlapping bookings
- ✓ Cancellation policies (refunds, counters)
- ✓ Notification triggers on state changes
- ✓ Audit logging of changes

### Projects
- ✓ Project creation with validation
- ✓ Status lifecycle (OPEN → IN_PROGRESS → COMPLETED)
- ✓ Dual confirmation for completion
- ✓ Professional mission counter updates
- ✓ Access control (owner/involved/admin)
- ✓ Quote and payment management
- ✓ Photo attachment support

## Common Issues & Solutions

### Issue: Mock not working
**Solution**: Always call `resetAllMocks()` in beforeEach() hook.

### Issue: Token verification fails
**Solution**: Ensure `process.env.JWT_SECRET` is set in test environment.

### Issue: Prisma mock doesn't have method
**Solution**: Add the method to the jest.mock() block at top of file.

### Issue: Tests timeout
**Solution**: Ensure all async operations are mocked to return immediately.

## Notes for Developers

1. **Always mock external dependencies** - Don't make real DB calls
2. **Use realistic test data** - Fixtures should match schema
3. **Test happy path AND error cases** - Coverage includes both
4. **Check access control first** - Security tests run early
5. **Use descriptive test names** - Name explains what is tested
6. **Group related tests** - Use describe() blocks for organization
7. **Verify both status AND response body** - Don't just check status codes

## Future Enhancements

- [ ] Integration tests with real database
- [ ] Performance benchmarks
- [ ] Load testing for concurrent bookings
- [ ] Payment flow integration tests
- [ ] Quote acceptance workflow tests
- [ ] Notification delivery verification
- [ ] Badge achievement verification
- [ ] Rate limiting tests

## Related Documentation

- Project Schema: `../../prisma/schema.prisma`
- Routes: `../../src/routes/bookings.js`, `../../src/routes/projects.js`
- Authentication: `../../src/middleware/auth.js`
- Notifications: `../../src/config/pushNotifications.js`
