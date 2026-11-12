/**
 * E2E Tests: User Registration Flow
 * Tests complete user registration, email verification, and account setup
 */

const { createTestClient } = require('./helpers/browser');
const Assertions = require('./helpers/assertions');
const fixtures = require('./fixtures');

describe('E2E: User Registration Flow', () => {
  let client;

  beforeEach(() => {
    client = createTestClient();
  });

  describe('Happy Path: Complete Registration', () => {
    test('1. Client can register successfully with all required fields', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('client'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      // Assertions
      Assertions.status(response, 201);
      Assertions.hasProperties(response.data, ['token', 'user']);
      Assertions.validUser(response.data.user);
      Assertions.noSensitiveData(response.data.user);

      expect(response.data.user.email).toBe(userData.email);
      expect(response.data.user.firstName).toBe('Jean');
      expect(response.data.user.lastName).toBe('Dupont');
      expect(response.data.user.role).toBe('CLIENT');
      expect(response.data.user.emailVerified).toBe(false); // Not verified yet
      expect(response.data.token).toBeTruthy();
    });

    test('2. Professional can register with business details', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('pro'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Pierre',
        lastName: 'Boulanger',
        role: 'PROFESSIONAL',
        businessName: 'Plomberie Boulanger',
        businessType: 'PLUMBING',
        siret: '12345678901234',
      };

      const response = await client.register(userData);

      Assertions.status(response, 201);
      Assertions.validUser(response.data.user);
      expect(response.data.user.role).toBe('PROFESSIONAL');
    });

    test('3. Registered user can immediately login', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('login-test'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Test',
        lastName: 'User',
        role: 'CLIENT',
      };

      // Register
      const registerRes = await client.register(userData);
      Assertions.status(registerRes, 201);

      // Create new client for login
      const loginClient = createTestClient();
      const loginRes = await loginClient.login(userData.email, userData.password);

      Assertions.status(loginRes, 200);
      Assertions.hasProperties(loginRes.data, ['token', 'user']);
      expect(loginRes.data.user.email).toBe(userData.email);
    });

    test('4. Registration generates valid authentication token', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail('token-test'),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Token',
        lastName: 'Test',
        role: 'CLIENT',
      };

      const response = await client.register(userData);
      Assertions.status(response, 201);

      const token = response.data.token;
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT format: header.payload.signature
    });
  });

  describe('Error Path: Invalid Input Validation', () => {
    test('1. Reject registration with invalid email format', async () => {
      const userData = {
        email: 'invalid-email',
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      Assertions.error(response, 400);
      Assertions.errorResponse(response);
    });

    test('2. Reject registration with weak password', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail(),
        password: '123', // Too weak
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      Assertions.error(response, 400);
    });

    test('3. Reject registration with missing required fields', async () => {
      const testCases = [
        { email: 'test@test.com' }, // Missing password, firstName, lastName
        { email: 'test@test.com', password: fixtures.TEST_PASSWORD }, // Missing firstName, lastName
        { firstName: 'Jean', lastName: 'Dupont', role: 'CLIENT' }, // Missing email, password
      ];

      for (const userData of testCases) {
        const response = await client.register(userData);
        Assertions.error(response, 400);
      }
    });

    test('4. Reject registration with invalid role', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail(),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'INVALID_ROLE',
      };

      const response = await client.register(userData);

      Assertions.error(response, 400);
    });

    test('5. Reject registration with empty strings', async () => {
      const userData = {
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      Assertions.error(response, 400);
    });
  });

  describe('Edge Cases: Boundary Conditions', () => {
    test('1. Prevent duplicate email registration', async () => {
      const email = fixtures.generateUniqueEmail('duplicate');
      const userData1 = {
        email,
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };
      const userData2 = {
        email, // Same email
        password: 'DifferentPassword@123',
        firstName: 'Marie',
        lastName: 'Martin',
        role: 'CLIENT',
      };

      // First registration succeeds
      const res1 = await client.register(userData1);
      Assertions.status(res1, 201);

      // Second registration with same email fails
      const res2 = await client.register(userData2);
      Assertions.status(res2, 409); // Conflict
    });

    test('2. Handle very long names gracefully', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail(),
        password: fixtures.TEST_PASSWORD,
        firstName: 'A'.repeat(100),
        lastName: 'B'.repeat(100),
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      // Should either succeed or fail with clear error, not crash
      expect([201, 400]).toContain(response.status);
    });

    test('3. Handle SQL injection attempts in registration', async () => {
      const userData = {
        email: "test'--; DROP TABLE users; -- @test.com",
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      // Should reject as invalid email
      Assertions.error(response, 400);
    });

    test('4. Handle XSS attempts in name fields', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail(),
        password: fixtures.TEST_PASSWORD,
        firstName: '<script>alert("xss")</script>',
        lastName: '"><img src=x onerror=alert("xss")>',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      // Should either sanitize or reject
      if (response.status === 201) {
        // If accepted, verify data is sanitized
        expect(response.data.user.firstName).not.toContain('<script>');
        expect(response.data.user.lastName).not.toContain('onerror');
      }
    });

    test('5. Handle concurrent registrations with same data', async () => {
      const email = fixtures.generateUniqueEmail('concurrent');
      const userData = {
        email,
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };

      const client1 = createTestClient();
      const client2 = createTestClient();

      // Attempt concurrent registration
      const [res1, res2] = await Promise.all([
        client1.register(userData),
        client2.register(userData),
      ]);

      // One should succeed, one should fail (409 conflict)
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);
    });
  });

  describe('Security: Registration Security Checks', () => {
    test('1. Password not returned in response', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail(),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      Assertions.hasProperties(response.data, ['user']);
      Assertions.noSensitiveData(response.data.user, [
        'password',
        'passwordHash',
        'passwordSalt',
      ]);
    });

    test('2. Token is valid JWT format', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail(),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      Assertions.status(response, 201);
      const token = response.data.token;

      // Verify JWT structure
      const parts = token.split('.');
      expect(parts.length).toBe(3);

      // Each part should be valid base64
      parts.forEach((part) => {
        expect(() => {
          Buffer.from(part, 'base64').toString('utf-8');
        }).not.toThrow();
      });
    });

    test('3. User account is created in secure state', async () => {
      const userData = {
        email: fixtures.generateUniqueEmail(),
        password: fixtures.TEST_PASSWORD,
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'CLIENT',
      };

      const response = await client.register(userData);

      Assertions.status(response, 201);
      const user = response.data.user;

      // Verify secure initial state
      expect(user.emailVerified).toBe(false);
      expect(user.phoneVerified).toBeFalsy();
      expect(user.status).not.toBe('SUSPENDED');
      expect(user.status).not.toBe('DELETED');
    });
  });
});
