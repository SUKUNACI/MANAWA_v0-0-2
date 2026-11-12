/**
 * Custom Assertions for E2E Tests
 * Provides reusable assertion helpers for common patterns
 */

/**
 * Assert response has correct HTTP status
 */
function assertStatus(response, expectedStatus) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}. ` +
      `Response: ${JSON.stringify(response.data)}`
    );
  }
}

/**
 * Assert response is successful (2xx)
 */
function assertSuccess(response) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Expected successful response (2xx), got ${response.status}. ` +
      `Response: ${JSON.stringify(response.data)}`
    );
  }
}

/**
 * Assert response has error status (4xx/5xx)
 */
function assertError(response, expectedStatus = null) {
  if (response.status < 400) {
    throw new Error(
      `Expected error response (4xx/5xx), got ${response.status}. ` +
      `Response: ${JSON.stringify(response.data)}`
    );
  }
  if (expectedStatus && response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}`
    );
  }
}

/**
 * Assert response contains expected properties
 */
function assertHasProperties(obj, properties) {
  const missing = properties.filter(prop => !(prop in obj));
  if (missing.length > 0) {
    throw new Error(
      `Expected object to have properties: ${missing.join(', ')}. ` +
      `Got: ${JSON.stringify(Object.keys(obj))}`
    );
  }
}

/**
 * Assert response does NOT contain sensitive properties
 */
function assertNoSensitiveData(obj, sensitiveProps = ['password', 'passwordHash', 'token']) {
  const found = sensitiveProps.filter(prop => prop in obj);
  if (found.length > 0) {
    throw new Error(
      `Response should not contain sensitive properties: ${found.join(', ')}`
    );
  }
}

/**
 * Assert data matches type
 */
function assertType(data, expectedType) {
  const actualType = Array.isArray(data) ? 'array' : typeof data;
  const expectedStr = expectedType.toLowerCase();

  if (actualType !== expectedStr) {
    throw new Error(`Expected type ${expectedType}, got ${actualType}`);
  }
}

/**
 * Assert array has items
 */
function assertArrayNotEmpty(arr, message = 'Array should not be empty') {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(message);
  }
}

/**
 * Assert value is valid UUID
 */
function assertValidUUID(value) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new Error(`Expected valid UUID, got: ${value}`);
  }
}

/**
 * Assert value matches regex pattern
 */
function assertMatches(value, pattern, message) {
  if (!pattern.test(value)) {
    throw new Error(
      message || `Value "${value}" does not match pattern ${pattern}`
    );
  }
}

/**
 * Assert value is valid email
 */
function assertValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error(`Expected valid email, got: ${email}`);
  }
}

/**
 * Assert value is valid ISO date
 */
function assertValidDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error(`Expected valid date, got: ${date}`);
  }
}

/**
 * Assert value is within range
 */
function assertInRange(value, min, max, message) {
  if (value < min || value > max) {
    throw new Error(
      message || `Expected value between ${min} and ${max}, got: ${value}`
    );
  }
}

/**
 * Assert user object structure
 */
function assertValidUser(user) {
  assertHasProperties(user, ['id', 'email', 'firstName', 'lastName', 'role', 'createdAt']);
  assertNoSensitiveData(user);
  assertValidEmail(user.email);
  assertValidUUID(user.id);
  assertValidDate(user.createdAt);
}

/**
 * Assert professional object structure
 */
function assertValidProfessional(professional) {
  assertValidUser(professional);
  assertHasProperties(professional, ['businessName', 'businessType', 'rating']);
}

/**
 * Assert project object structure
 */
function assertValidProject(project) {
  assertHasProperties(project, ['id', 'title', 'description', 'clientId', 'status', 'createdAt']);
  assertValidUUID(project.id);
  assertValidUUID(project.clientId);
}

/**
 * Assert quote object structure
 */
function assertValidQuote(quote) {
  assertHasProperties(quote, ['id', 'amount', 'status', 'expiresAt', 'createdAt']);
  assertValidUUID(quote.id);
  assertInRange(quote.amount, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * Assert booking object structure
 */
function assertValidBooking(booking) {
  assertHasProperties(booking, ['id', 'startDate', 'endDate', 'status', 'createdAt']);
  assertValidUUID(booking.id);
  assertValidDate(booking.startDate);
  assertValidDate(booking.endDate);
}

/**
 * Assert message object structure
 */
function assertValidMessage(message) {
  assertHasProperties(message, ['id', 'senderId', 'receiverId', 'content', 'createdAt']);
  assertValidUUID(message.id);
  assertValidUUID(message.senderId);
  assertValidUUID(message.receiverId);
}

/**
 * Assert payment object structure
 */
function assertValidPayment(payment) {
  assertHasProperties(payment, ['id', 'amount', 'status', 'createdAt']);
  assertValidUUID(payment.id);
  assertInRange(payment.amount, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * Assert review object structure
 */
function assertValidReview(review) {
  assertHasProperties(review, ['id', 'rating', 'comment', 'createdAt']);
  assertValidUUID(review.id);
  assertInRange(review.rating, 1, 5);
}

/**
 * Assert error response structure
 */
function assertErrorResponse(response) {
  assertError(response);
  if (!response.data?.error && !response.data?.message) {
    throw new Error(
      'Error response should contain "error" or "message" field. ' +
      `Got: ${JSON.stringify(response.data)}`
    );
  }
}

/**
 * Assert pagination response structure
 */
function assertValidPagination(response) {
  assertSuccess(response);
  assertHasProperties(response.data, ['data', 'pagination']);
  assertArrayNotEmpty(response.data.data || []);
  assertHasProperties(response.data.pagination, ['total', 'page', 'limit']);
}

/**
 * Compound assertions for common flows
 */
const Assertions = {
  // Response assertions
  status: assertStatus,
  success: assertSuccess,
  error: assertError,
  errorResponse: assertErrorResponse,

  // Data structure assertions
  hasProperties: assertHasProperties,
  noSensitiveData: assertNoSensitiveData,
  type: assertType,

  // Collection assertions
  arrayNotEmpty: assertArrayNotEmpty,
  pagination: assertValidPagination,

  // Value assertions
  validUUID: assertValidUUID,
  validEmail: assertValidEmail,
  validDate: assertValidDate,
  matches: assertMatches,
  inRange: assertInRange,

  // Domain model assertions
  validUser: assertValidUser,
  validProfessional: assertValidProfessional,
  validProject: assertValidProject,
  validQuote: assertValidQuote,
  validBooking: assertValidBooking,
  validMessage: assertValidMessage,
  validPayment: assertValidPayment,
  validReview: assertValidReview,
};

module.exports = Assertions;
