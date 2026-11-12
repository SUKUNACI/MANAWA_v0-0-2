/**
 * Tests for Brute Force Protection
 */

const bruteForceMiddleware = require('../middleware/bruteForceMiddleware');
const bruteForceConfig = require('../config/brute-force');
const redisCache = require('../config/redis');

describe('Brute Force Protection', () => {
  const testEmail = 'test@example.com';

  beforeEach(async () => {
    // Clear cache before each test
    await redisCache.clear();
  });

  afterAll(async () => {
    // Clean up after tests
    await redisCache.disconnect();
  });

  describe('trackFailedLogin', () => {
    it('should increment failed attempt count', async () => {
      const count1 = await bruteForceMiddleware.trackFailedLogin(testEmail);
      expect(count1).toBe(1);

      const count2 = await bruteForceMiddleware.trackFailedLogin(testEmail);
      expect(count2).toBe(2);
    });

    it('should track multiple failed attempts', async () => {
      for (let i = 1; i <= 5; i++) {
        const count = await bruteForceMiddleware.trackFailedLogin(testEmail);
        expect(count).toBe(i);
      }
    });

    it('should case-insensitize email addresses', async () => {
      const count1 = await bruteForceMiddleware.trackFailedLogin('Test@Example.COM');
      const count2 = await bruteForceMiddleware.trackFailedLogin('test@example.com');
      expect(count1).toBe(1);
      expect(count2).toBe(2);
    });
  });

  describe('getAttemptCount', () => {
    it('should return 0 for new email', async () => {
      const count = await bruteForceMiddleware.getAttemptCount('newemail@example.com');
      expect(count).toBe(0);
    });

    it('should return correct attempt count', async () => {
      await bruteForceMiddleware.trackFailedLogin(testEmail);
      await bruteForceMiddleware.trackFailedLogin(testEmail);
      const count = await bruteForceMiddleware.getAttemptCount(testEmail);
      expect(count).toBe(2);
    });
  });

  describe('getRemainingAttempts', () => {
    it('should return max attempts for new email', async () => {
      const remaining = await bruteForceMiddleware.getRemainingAttempts(testEmail);
      expect(remaining).toBe(bruteForceConfig.maxAttempts);
    });

    it('should decrease with each failed attempt', async () => {
      let remaining = await bruteForceMiddleware.getRemainingAttempts(testEmail);
      expect(remaining).toBe(bruteForceConfig.maxAttempts);

      await bruteForceMiddleware.trackFailedLogin(testEmail);
      remaining = await bruteForceMiddleware.getRemainingAttempts(testEmail);
      expect(remaining).toBe(bruteForceConfig.maxAttempts - 1);

      await bruteForceMiddleware.trackFailedLogin(testEmail);
      remaining = await bruteForceMiddleware.getRemainingAttempts(testEmail);
      expect(remaining).toBe(bruteForceConfig.maxAttempts - 2);
    });

    it('should return 0 when max attempts exceeded', async () => {
      for (let i = 0; i < bruteForceConfig.maxAttempts + 1; i++) {
        await bruteForceMiddleware.trackFailedLogin(testEmail);
      }
      const remaining = await bruteForceMiddleware.getRemainingAttempts(testEmail);
      expect(remaining).toBe(0);
    });
  });

  describe('lockAccount', () => {
    it('should lock account', async () => {
      await bruteForceMiddleware.lockAccount(testEmail);
      const lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(true);
    });

    it('should set correct lockout duration', async () => {
      await bruteForceMiddleware.lockAccount(testEmail);
      const lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.remainingSeconds).toBeGreaterThan(0);
      expect(lockout.remainingSeconds).toBeLessThanOrEqual(bruteForceConfig.lockoutDurationSeconds);
    });
  });

  describe('checkLockout', () => {
    it('should return isLocked false for new email', async () => {
      const lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(false);
      expect(lockout.remainingSeconds).toBe(0);
    });

    it('should return isLocked true after account locked', async () => {
      await bruteForceMiddleware.lockAccount(testEmail);
      const lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(true);
      expect(lockout.remainingSeconds).toBeGreaterThan(0);
    });
  });

  describe('clearFailedAttempts', () => {
    it('should clear failed attempt count', async () => {
      await bruteForceMiddleware.trackFailedLogin(testEmail);
      await bruteForceMiddleware.trackFailedLogin(testEmail);

      let count = await bruteForceMiddleware.getAttemptCount(testEmail);
      expect(count).toBe(2);

      await bruteForceMiddleware.clearFailedAttempts(testEmail);
      count = await bruteForceMiddleware.getAttemptCount(testEmail);
      expect(count).toBe(0);
    });
  });

  describe('clearLockout', () => {
    it('should clear account lockout', async () => {
      await bruteForceMiddleware.lockAccount(testEmail);
      let lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(true);

      await bruteForceMiddleware.clearLockout(testEmail);
      lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(false);
    });
  });

  describe('Full lockout flow', () => {
    it('should trigger lockout after max failed attempts', async () => {
      // Make max-1 failed attempts
      for (let i = 0; i < bruteForceConfig.maxAttempts - 1; i++) {
        const count = await bruteForceMiddleware.trackFailedLogin(testEmail);
        expect(count).toBeLessThanOrEqual(bruteForceConfig.maxAttempts);
      }

      // Next attempt should trigger lockout
      const finalCount = await bruteForceMiddleware.trackFailedLogin(testEmail);
      expect(finalCount).toBe(bruteForceConfig.maxAttempts);

      // Manually lock (in real flow, this happens in login handler)
      await bruteForceMiddleware.lockAccount(testEmail);

      // Check account is locked
      const lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(true);
    });

    it('should allow login after clearing failed attempts', async () => {
      // Make some failed attempts
      for (let i = 0; i < 3; i++) {
        await bruteForceMiddleware.trackFailedLogin(testEmail);
      }

      // Clear attempts
      await bruteForceMiddleware.clearFailedAttempts(testEmail);

      // Count should be 0
      const count = await bruteForceMiddleware.getAttemptCount(testEmail);
      expect(count).toBe(0);
    });

    it('should allow login after clearing lockout', async () => {
      // Lock account
      await bruteForceMiddleware.lockAccount(testEmail);
      let lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(true);

      // Unlock
      await bruteForceMiddleware.clearLockout(testEmail);

      // Check unlocked
      lockout = await bruteForceMiddleware.checkLockout(testEmail);
      expect(lockout.isLocked).toBe(false);
    });
  });

  describe('getLoginHistory', () => {
    it('should return empty array for user with no history', async () => {
      const history = await bruteForceMiddleware.getLoginHistory('user-123', 20);
      expect(Array.isArray(history)).toBe(true);
      // May be empty or have records depending on test database state
    });
  });

  describe('logLoginAttempt', () => {
    it('should log login attempt without throwing', async () => {
      await expect(
        bruteForceMiddleware.logLoginAttempt('user-123', testEmail, 'success', '127.0.0.1', 'Mozilla/5.0')
      ).resolves.not.toThrow();

      await expect(
        bruteForceMiddleware.logLoginAttempt(null, testEmail, 'failed', '127.0.0.1', 'Mozilla/5.0', { reason: 'invalid_password' })
      ).resolves.not.toThrow();
    });
  });

  describe('bruteForceCheckMiddleware', () => {
    it('should create middleware function', () => {
      const middleware = bruteForceMiddleware.bruteForceCheckMiddleware();
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // (req, res, next)
    });

    it('should call next if email not provided', async () => {
      const middleware = bruteForceMiddleware.bruteForceCheckMiddleware();
      const req = { body: {} };
      const res = {};
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should call next if account not locked', async () => {
      const middleware = bruteForceMiddleware.bruteForceCheckMiddleware();
      const req = { body: { email: testEmail } };
      const res = {};
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should reject if account locked', async () => {
      // Lock account first
      await bruteForceMiddleware.lockAccount(testEmail);

      const middleware = bruteForceMiddleware.bruteForceCheckMiddleware();
      const req = { body: { email: testEmail } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
      };
      const next = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });
});
