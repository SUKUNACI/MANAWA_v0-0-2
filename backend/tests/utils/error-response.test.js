const { sendError, sendSuccess, sendPaginated, validateRequest, ERROR_CODES } = require('../../utils/error-response');

describe('error-response.js', () => {
  let mockRes;

  beforeEach(() => {
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('sendError', () => {
    test('should send error with code and status', () => {
      sendError(mockRes, ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'fr');

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AUTH_001',
          status: 401,
          retryable: false,
        })
      );
    });

    test('should support i18n with locale', () => {
      sendError(mockRes, ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'en');

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AUTH_001',
          error: expect.any(String),
        })
      );
    });

    test('should pass variables to i18n', () => {
      sendError(mockRes, ERROR_CODES.VAL_MIN_LENGTH, 'fr', { min: 8 });

      const call = mockRes.json.mock.calls[0][0];
      expect(call.error).toContain('8');
    });

    test('should set correct status codes', () => {
      sendError(mockRes, ERROR_CODES.RES_NOT_FOUND, 'fr');
      expect(mockRes.status).toHaveBeenCalledWith(404);

      mockRes.status.mockClear();
      sendError(mockRes, ERROR_CODES.PAY_INSUFFICIENT_FUNDS, 'fr');
      expect(mockRes.status).toHaveBeenCalledWith(402);
    });

    test('should indicate retryable errors', () => {
      sendError(mockRes, ERROR_CODES.SVC_TIMEOUT, 'fr');

      const call = mockRes.json.mock.calls[0][0];
      expect(call.retryable).toBe(true);
    });

    test('should handle missing error code gracefully', () => {
      sendError(mockRes, null, 'fr');

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SVC_004',
        })
      );
    });
  });

  describe('sendSuccess', () => {
    test('should send success response with data', () => {
      const data = { userId: 123, name: 'John' };
      sendSuccess(mockRes, data, 200);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data,
      });
    });

    test('should default to status 200', () => {
      sendSuccess(mockRes, { test: 'data' });

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test('should support custom status codes', () => {
      sendSuccess(mockRes, { id: '123' }, 201);

      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    test('should handle null data', () => {
      sendSuccess(mockRes, null);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: null,
      });
    });
  });

  describe('sendPaginated', () => {
    test('should send paginated response with metadata', () => {
      const data = [{ id: 1 }, { id: 2 }];
      sendPaginated(mockRes, data, 100, 1, 10);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data,
        meta: {
          total: 100,
          page: 1,
          limit: 10,
          pages: 10,
        },
      });
    });

    test('should calculate correct page count', () => {
      sendPaginated(mockRes, [], 105, 1, 10);

      const call = mockRes.json.mock.calls[0][0];
      expect(call.meta.pages).toBe(11);
    });
  });

  describe('validateRequest', () => {
    test('should pass valid data', () => {
      const data = { email: 'user@example.com', age: 25 };
      const rules = [
        { field: 'email', required: true, type: 'string' },
        { field: 'age', required: true, type: 'number' },
      ];

      const result = validateRequest(data, rules);
      expect(result).toBeNull();
    });

    test('should reject missing required fields', () => {
      const data = { email: '' };
      const rules = [{ field: 'email', required: true }];

      const result = validateRequest(data, rules);
      expect(result).toEqual(ERROR_CODES.VAL_MISSING_FIELDS);
    });

    test('should reject wrong types', () => {
      const data = { age: 'twenty' };
      const rules = [{ field: 'age', type: 'number' }];

      const result = validateRequest(data, rules);
      expect(result).toEqual(ERROR_CODES.VAL_INVALID_FORMAT);
    });

    test('should validate min length', () => {
      const data = { password: 'abc' };
      const rules = [{ field: 'password', min: 8 }];

      const result = validateRequest(data, rules);
      expect(result).toEqual(ERROR_CODES.VAL_MIN_LENGTH);
    });

    test('should validate max length', () => {
      const data = { name: 'a'.repeat(300) };
      const rules = [{ field: 'name', max: 100 }];

      const result = validateRequest(data, rules);
      expect(result).toEqual(ERROR_CODES.VAL_MAX_LENGTH);
    });

    test('should allow optional fields', () => {
      const data = { email: 'user@example.com' };
      const rules = [
        { field: 'email', required: true },
        { field: 'phone', required: false },
      ];

      const result = validateRequest(data, rules);
      expect(result).toBeNull();
    });

    test('should send error response if res provided', () => {
      const data = { email: '' };
      const rules = [{ field: 'email', required: true }];

      validateRequest(data, rules, mockRes, 'fr');

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalled();
    });
  });

  describe('error code mapping', () => {
    test('should have all error codes available', () => {
      expect(ERROR_CODES.AUTH_INVALID_CREDENTIALS).toBeDefined();
      expect(ERROR_CODES.VAL_MISSING_FIELDS).toBeDefined();
      expect(ERROR_CODES.PAY_INSUFFICIENT_FUNDS).toBeDefined();
      expect(ERROR_CODES.RES_NOT_FOUND).toBeDefined();
      expect(ERROR_CODES.SVC_TIMEOUT).toBeDefined();
    });

    test('should have status codes for all error types', () => {
      Object.values(ERROR_CODES).forEach(errorCode => {
        expect(errorCode.status).toBeDefined();
        expect(typeof errorCode.status).toBe('number');
        expect(errorCode.status).toBeGreaterThanOrEqual(400);
        expect(errorCode.status).toBeLessThan(600);
      });
    });
  });

  describe('response structure consistency', () => {
    test('error responses should have required fields', () => {
      sendError(mockRes, ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'fr');

      const response = mockRes.json.mock.calls[0][0];
      expect(response).toHaveProperty('error');
      expect(response).toHaveProperty('code');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('retryable');
    });

    test('success responses should have required fields', () => {
      sendSuccess(mockRes, { test: 'data' });

      const response = mockRes.json.mock.calls[0][0];
      expect(response).toHaveProperty('success');
      expect(response).toHaveProperty('data');
    });

    test('paginated responses should have metadata', () => {
      sendPaginated(mockRes, [], 10, 1, 10);

      const response = mockRes.json.mock.calls[0][0];
      expect(response).toHaveProperty('meta');
      expect(response.meta).toHaveProperty('total');
      expect(response.meta).toHaveProperty('page');
      expect(response.meta).toHaveProperty('limit');
      expect(response.meta).toHaveProperty('pages');
    });
  });
});
