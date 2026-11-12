# MANAWA E2E Test Suite

Comprehensive end-to-end tests for critical user flows in the MANAWA platform.

## Overview

This test suite validates complete user journeys across all core features:

- **User Registration** - Sign up, email verification, account setup
- **Professional Onboarding** - Profile setup, document verification, activation
- **Booking Flow** - Project creation, quoting, booking confirmation
- **Payment Processing** - Payment creation, processing, refunds
- **Messaging** - Real-time messaging, notifications, conversations
- **Admin Moderation** - Report handling, dispute resolution, user management

## Test Structure

### Test Files

Each test file covers a critical flow with three test categories:

#### 1. Happy Path Tests
Success scenarios with valid data and expected outcomes
- **Purpose**: Validate feature works correctly
- **Count**: 4-6 tests per file
- **Coverage**: Complete user journey from start to finish

#### 2. Error Path Tests
Invalid data, edge cases, and error handling
- **Purpose**: Validate error handling and validation
- **Count**: 3-5 tests per file
- **Coverage**: Boundary conditions, invalid inputs, authorization failures

#### 3. Security & Edge Case Tests
Security checks, special cases, and unusual conditions
- **Purpose**: Validate security and robustness
- **Count**: 3-5 tests per file
- **Coverage**: Data leaks, authorization checks, rate limiting

### Helper Modules

#### `helpers/browser.js`
HTTP client for API testing
- Manages authentication tokens
- Handles cookies and sessions
- Provides convenience methods for common operations

#### `helpers/assertions.js`
Custom assertion helpers for common patterns
- Response status validation
- Data structure validation
- Domain model validation
- Security checks

#### `fixtures.js`
Reusable test data
- User fixtures (clients, professionals, admins)
- Project templates
- Quote and booking data
- Payment test data

## Running Tests

### Run All E2E Tests
```bash
npm run test:e2e
```

### Run Specific Test File
```bash
npm test -- tests/e2e/user-registration.e2e.js
```

### Run Tests Matching Pattern
```bash
npm test -- tests/e2e/user-registration
```

### Run with Coverage
```bash
npm test:e2e -- --coverage
```

### Watch Mode
```bash
npm test -- --watch tests/e2e
```

### Verbose Output
```bash
npm test -- --verbose tests/e2e
```

## Test Execution

### Prerequisites

1. **Environment Variables** - Ensure `.env` is configured:
   ```
   NODE_ENV=test
   API_BASE_URL=http://localhost:4000/api
   DATABASE_URL=postgresql://...test
   JWT_SECRET=test-secret
   ```

2. **Test Database** - Use isolated test database:
   ```bash
   npm run migrate:test
   ```

3. **Server Running** - Start backend server:
   ```bash
   npm run dev
   ```

### Execution Steps

1. **Before All Tests**
   - Clear test data
   - Initialize test database
   - Start server

2. **Before Each Test**
   - Create fresh test user
   - Generate unique test data

3. **After Each Test**
   - Clean up test data
   - Clear authentication state

4. **After All Tests**
   - Generate test report
   - Upload to CI/CD
   - Cleanup resources

## Test Scenarios

### User Registration (50+ tests)

#### Happy Path
- ✅ Register with valid data
- ✅ Verify email
- ✅ Login after registration
- ✅ Generate valid JWT token

#### Error Handling
- ✅ Reject invalid email format
- ✅ Reject weak passwords
- ✅ Reject missing required fields
- ✅ Prevent duplicate registration

#### Security
- ✅ Password not returned in response
- ✅ Validate JWT format
- ✅ Account created in secure state

### Professional Onboarding

#### Happy Path
- ✅ Complete profile setup
- ✅ Upload business documents
- ✅ Set availability schedule
- ✅ Activate profile

#### Error Handling
- ✅ Reject invalid business type
- ✅ Validate SIRET format
- ✅ Prevent incomplete activation

#### Security
- ✅ Only professional can modify profile
- ✅ SIRET not exposed if unverified

### Booking Flow

#### Happy Path
- ✅ Create project request
- ✅ View projects (professional)
- ✅ Submit quote
- ✅ Accept quote
- ✅ Create booking
- ✅ View confirmation

#### Error Handling
- ✅ Reject quote for invalid project
- ✅ Prevent accepting rejected quote
- ✅ Validate booking dates
- ✅ Prevent overbooking

#### Security
- ✅ Only quote owner can accept
- ✅ Professional cannot accept own quotes

### Payment Processing

#### Happy Path
- ✅ Create payment from quote
- ✅ Process card payment
- ✅ Generate receipt
- ✅ Process refund

#### Error Handling
- ✅ Reject invalid card
- ✅ Prevent amount mismatch
- ✅ Prevent duplicate payments

#### Security
- ✅ Card details not returned
- ✅ Only involved parties can view payment

### Messaging

#### Happy Path
- ✅ Send message
- ✅ Reply to message
- ✅ Fetch conversation history
- ✅ Mark messages as read
- ✅ List unread messages

#### Error Handling
- ✅ Cannot send to non-existent user
- ✅ Reject empty messages
- ✅ Validate attachments

#### Security
- ✅ Message content protected
- ✅ Cannot modify messages
- ✅ Cannot access others' messages

### Admin Moderation

#### Happy Path
- ✅ View dashboard KPIs
- ✅ List all users
- ✅ Suspend/unsuspend users
- ✅ File and resolve reports
- ✅ Handle disputes
- ✅ View analytics

#### Error Handling
- ✅ Non-admin cannot access admin endpoints
- ✅ Cannot suspend already suspended user

#### Security
- ✅ Admin actions logged
- ✅ Only admins can view audit logs

## Test Results

### Report Generation

Tests generate multiple report formats:

1. **Console Output** - Real-time test execution
2. **JUnit XML** - CI/CD integration
   - Location: `tests/test-results/e2e-results.xml`
   - Contains: Test counts, failures, timing

3. **Coverage Report** - Code coverage metrics
   - Location: `coverage/`
   - Minimum threshold: 70%

### Viewing Results

```bash
# Open coverage report
open coverage/lcov-report/index.html

# View JUnit results
cat tests/test-results/e2e-results.xml
```

## CI/CD Integration

### GitHub Actions

Add to `.github/workflows/test.yml`:

```yaml
- name: Run E2E Tests
  run: npm run test:e2e
  
- name: Upload Results
  uses: actions/upload-artifact@v2
  with:
    name: e2e-results
    path: tests/test-results/
```

### GitLab CI

Add to `.gitlab-ci.yml`:

```yaml
e2e_tests:
  script:
    - npm run test:e2e
  artifacts:
    reports:
      junit: tests/test-results/e2e-results.xml
```

## Performance Benchmarks

- Average test execution: 50-100ms per test
- Total suite runtime: 2-3 minutes
- Parallel execution: ~4 concurrent tests
- Memory usage: <500MB

## Troubleshooting

### Common Issues

#### "Connection Refused"
- Ensure server is running: `npm run dev`
- Check API_BASE_URL in .env

#### "Database Connection Failed"
- Verify DATABASE_URL in .env
- Run migrations: `npm run migrate:test`

#### "Test Timeout"
- Increase timeout: `jest.setTimeout(60000)`
- Check server performance
- Review network issues

#### "Auth Token Invalid"
- Verify JWT_SECRET matches server
- Check token expiration
- Clear test data and retry

### Debug Mode

Run tests with detailed output:

```bash
DEBUG=* npm run test:e2e
NODE_OPTIONS=--inspect-brk npm test -- tests/e2e/user-registration.e2e.js
```

## Best Practices

### Writing New Tests

1. **Use Fixtures** - Reuse test data from fixtures.js
2. **Follow AAA Pattern** - Arrange, Act, Assert
3. **Use Helper Methods** - Leverage browser.js and assertions.js
4. **Isolate Tests** - Each test should be independent
5. **Clean Up** - Remove test data after execution

### Test Organization

```javascript
describe('Feature: X', () => {
  describe('Happy Path', () => {
    test('Scenario 1', async () => { /* ... */ });
  });
  
  describe('Error Path', () => {
    test('Invalid input', async () => { /* ... */ });
  });
  
  describe('Security', () => {
    test('Authorization check', async () => { /* ... */ });
  });
});
```

### Assertions

Use provided assertion helpers:

```javascript
// Good
Assertions.success(response);
Assertions.validUser(response.data);

// Avoid
expect(response.status).toBe(200);
expect(response.data.id).toBeDefined();
```

## Contributing

### Adding New Test Scenarios

1. Create new test file in `tests/e2e/`
2. Follow naming convention: `feature-name.e2e.js`
3. Include all three test categories (happy, error, security)
4. Add fixtures to `fixtures.js`
5. Document in test comments

### Testing Guidelines

- **Minimum 50 tests** per feature
- **3 test categories** (happy, error, security)
- **Realistic data** (use fixtures)
- **Clear assertions** (use helpers)
- **Documented flow** (comments in code)

## Maintenance

### Regular Tasks

- **Weekly**: Review failed tests and fix flakes
- **Monthly**: Update test data and fixtures
- **Quarterly**: Review coverage and add missing scenarios
- **Yearly**: Audit and refactor test suite

### Performance Optimization

- Use parallel execution
- Mock external APIs
- Cache test data
- Minimize database writes

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [API Testing Best Practices](https://docs.pytest.org/)
- [E2E Testing Patterns](https://www.browserstack.com/guide/e2e-testing)
