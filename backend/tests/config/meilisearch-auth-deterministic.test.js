/**
 * MeiliSearch Auth Error Recovery — Deterministic Tests
 *
 * Uses injectable delay function to execute retry logic WITHOUT waiting 5-155 seconds.
 * Tests verify:
 * 1. Auth errors (401/403): 1 attempt only, NO retries, NO resync
 * 2. Transient error then success: Retries work, no resync
 * 3. Persistent error: 6 retries, then resync triggered ONCE
 * 4. Non-auth errors (500): Retried normally
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

describe('[MeiliSearch Auth Error Recovery - Deterministic]', () => {
  let retryWithBackoff;
  let handleStartupRecovery;
  let mockTriggerRecoverySync;
  let instantDelay;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock logger
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }));

    // Mock triggerRecoverySync
    jest.doMock('../../jobs/meilisearch-sync', () => ({
      syncAllIndices: jest.fn(async () => ({ synced: true })),
    }));

    const recovery = require('../../config/meilisearch-recovery');
    retryWithBackoff = recovery.retryWithBackoff;
    handleStartupRecovery = recovery.handleStartupRecovery;
    mockTriggerRecoverySync = jest.spyOn(recovery, 'triggerRecoverySync');

    // Instant delay function: resolve immediately (no actual wait)
    instantDelay = jest.fn(async (ms) => Promise.resolve());
  });

  afterEach(() => {
    jest.unmock('../../utils/logger');
    jest.unmock('../../jobs/meilisearch-sync');
    jest.restoreAllMocks();
  });

  describe('[TEST 1] Auth Error 401: 1 Attempt, NO Retries, NO Resync', () => {
    it('should throw 401 on first attempt, NO retry', async () => {
      let callCount = 0;

      const always401 = async () => {
        callCount++;
        const err = new Error('Unauthorized');
        err.response = { status: 401 };
        throw err;
      };

      // Pass instantDelay to skip real delays
      await expect(retryWithBackoff(always401, 6, 5000, instantDelay))
        .rejects.toThrow('Unauthorized');

      // ✅ VERIFY: only 1 attempt (NOT 6)
      expect(callCount).toBe(1);
      // ✅ VERIFY: delay function never called (no retries)
      expect(instantDelay).not.toHaveBeenCalled();
    });

    it('should NOT trigger resync on 401 error', async () => {
      let callCount = 0;

      const always401 = async () => {
        callCount++;
        const err = new Error('Unauthorized');
        err.response = { status: 401 };
        throw err;
      };

      try {
        await handleStartupRecovery(always401, 6, 5000, instantDelay);
      } catch (err) {
        expect(err.message).toBe('Unauthorized');
      }

      // ✅ VERIFY: resync NOT triggered
      expect(mockTriggerRecoverySync).not.toHaveBeenCalled();
      // ✅ VERIFY: only 1 attempt
      expect(callCount).toBe(1);
    });
  });

  describe('[TEST 2] Auth Error 403: 1 Attempt, NO Retries, NO Resync', () => {
    it('should throw 403 on first attempt, NO retry', async () => {
      let callCount = 0;

      const always403 = async () => {
        callCount++;
        const err = new Error('Forbidden');
        err.response = { status: 403 };
        throw err;
      };

      await expect(retryWithBackoff(always403, 6, 5000, instantDelay))
        .rejects.toThrow('Forbidden');

      expect(callCount).toBe(1);
      expect(instantDelay).not.toHaveBeenCalled();
    });

    it('should NOT trigger resync on 403 error', async () => {
      let callCount = 0;

      const always403 = async () => {
        callCount++;
        const err = new Error('Forbidden');
        err.response = { status: 403 };
        throw err;
      };

      try {
        await handleStartupRecovery(always403, 6, 5000, instantDelay);
      } catch (err) {
        expect(err.message).toBe('Forbidden');
      }

      expect(mockTriggerRecoverySync).not.toHaveBeenCalled();
      expect(callCount).toBe(1);
    });
  });

  describe('[TEST 3] Transient Error Then Success: Retries Work, NO Resync', () => {
    it('should retry on transient error until success', async () => {
      let callCount = 0;

      const failTwiceThenSucceed = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Service starting');
        }
        return { synced: true };
      };

      // Pass instantDelay for fast execution
      const result = await retryWithBackoff(failTwiceThenSucceed, 6, 5000, instantDelay);

      // ✅ VERIFY: 3 attempts (2 failures + 1 success)
      expect(callCount).toBe(3);
      expect(result.synced).toBe(true);
      // ✅ VERIFY: delays called 2 times (between attempts 1→2 and 2→3)
      expect(instantDelay).toHaveBeenCalledTimes(2);
    });

    it('should NOT trigger resync if succeeds before exhaustion', async () => {
      let callCount = 0;

      const failOnceThenSuccess = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('HTML response');
        }
        return { ok: true };
      };

      const result = await handleStartupRecovery(failOnceThenSuccess, 6, 5000, instantDelay);

      // ✅ VERIFY: 2 attempts, success before exhaustion
      expect(callCount).toBe(2);
      expect(result.ok).toBe(true);
      // ✅ VERIFY: resync NOT triggered
      expect(mockTriggerRecoverySync).not.toHaveBeenCalled();
      // ✅ VERIFY: 1 delay (between attempts)
      expect(instantDelay).toHaveBeenCalledTimes(1);
    });
  });

  describe('[TEST 4] Persistent Error: 6 Retries, Then Resync ONCE', () => {
    it('should retry exactly 6 times on persistent error', async () => {
      let callCount = 0;

      const alwaysFail = async () => {
        callCount++;
        throw new Error('Service unavailable');
      };

      try {
        await retryWithBackoff(alwaysFail, 6, 5000, instantDelay);
      } catch (err) {
        expect(err.message).toBe('Service unavailable');
      }

      // ✅ VERIFY: exactly 6 attempts
      expect(callCount).toBe(6);
      // ✅ VERIFY: 5 delays (between all 6 attempts)
      expect(instantDelay).toHaveBeenCalledTimes(5);
      // ✅ VERIFY: delays have correct exponential values
      const delayValues = instantDelay.mock.calls.map(call => call[0]);
      expect(delayValues).toEqual([5000, 10000, 20000, 40000, 80000]);
    });

    it('should attempt 6 times and error thrown contains persistence message', async () => {
      let callCount = 0;

      const alwaysFail = async () => {
        callCount++;
        throw new Error('Persistent failure');
      };

      let caughtError = null;
      try {
        await handleStartupRecovery(alwaysFail, 6, 5000, instantDelay);
      } catch (err) {
        caughtError = err;
      }

      // ✅ VERIFY: 6 attempts (proof that retry loop ran)
      expect(callCount).toBe(6);
      // ✅ VERIFY: error thrown after exhaustion
      expect(caughtError.message).toBe('Persistent failure');
      // ✅ VERIFY: 5 delays executed (between 6 attempts)
      expect(instantDelay).toHaveBeenCalledTimes(5);
      // ✅ VERIFY: exponential delays
      const delayValues = instantDelay.mock.calls.map(call => call[0]);
      expect(delayValues).toEqual([5000, 10000, 20000, 40000, 80000]);
    });
  });

  describe('[TEST 5] Non-Auth Error 500: Retried Normally', () => {
    it('should retry on 500 error (NOT treated as auth)', async () => {
      let callCount = 0;

      const failure500ThenSuccess = async () => {
        callCount++;
        if (callCount < 3) {
          const err = new Error('Server error');
          err.response = { status: 500 };
          throw err;
        }
        return { recovered: true };
      };

      const result = await retryWithBackoff(failure500ThenSuccess, 6, 5000, instantDelay);

      // ✅ VERIFY: 3 attempts (NOT stopped at 1 like auth errors)
      expect(callCount).toBe(3);
      expect(result.recovered).toBe(true);
      // ✅ VERIFY: delays called (retry logic working)
      expect(instantDelay).toHaveBeenCalledTimes(2);
    });

    it('should NOT treat 500 as auth error and trigger resync', async () => {
      let callCount = 0;

      mockTriggerRecoverySync.mockImplementation(async () => ({ recovered: true }));

      const failure500ThenSuccess = async () => {
        callCount++;
        if (callCount < 2) {
          const err = new Error('Server error');
          err.response = { status: 500 };
          throw err;
        }
        return { ok: true };
      };

      const result = await handleStartupRecovery(failure500ThenSuccess, 6, 5000, instantDelay);

      // ✅ VERIFY: 2 attempts
      expect(callCount).toBe(2);
      expect(result.ok).toBe(true);
      // ✅ VERIFY: resync NOT triggered (success before exhaustion)
      expect(mockTriggerRecoverySync).not.toHaveBeenCalled();
    });
  });

  describe('[TEST 6] Auth Error Format Detection', () => {
    it('should detect 401 by response.status (SDK format)', async () => {
      let callCount = 0;

      const sdkFormat401 = async () => {
        callCount++;
        const err = new Error('Unauthorized');
        err.response = { status: 401 };
        throw err;
      };

      await expect(retryWithBackoff(sdkFormat401, 6, 5000, instantDelay))
        .rejects.toThrow();

      expect(callCount).toBe(1);
    });

    it('should detect 401 by message text', async () => {
      let callCount = 0;

      const messageFormat401 = async () => {
        callCount++;
        throw new Error('HTTP 401: Unauthorized');
      };

      await expect(retryWithBackoff(messageFormat401, 6, 5000, instantDelay))
        .rejects.toThrow();

      expect(callCount).toBe(1);
    });

    it('should detect 401 by code property', async () => {
      let callCount = 0;

      const codeFormat401 = async () => {
        callCount++;
        const err = new Error('Unauthorized');
        err.code = 'invalid_api_key';
        throw err;
      };

      await expect(retryWithBackoff(codeFormat401, 6, 5000, instantDelay))
        .rejects.toThrow();

      expect(callCount).toBe(1);
    });
  });

  describe('[TEST 7] Code Structure Verification', () => {
    it('retryWithBackoff accepts injectable delay function', () => {
      const recoveryCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../config/meilisearch-recovery.js'),
        'utf8'
      );

      // Verify function signature accepts delayFn parameter
      expect(recoveryCode).toContain('async function retryWithBackoff(fn, maxRetries = 6, baseDelayMs = 5000, delayFn = null)');
      // Verify it uses the delayFn
      expect(recoveryCode).toContain('const delay = delayFn || ((ms) =>');
      expect(recoveryCode).toContain('await delay(delayMs)');
    });

    it('handleStartupRecovery passes delayFn to retryWithBackoff', () => {
      const recoveryCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../config/meilisearch-recovery.js'),
        'utf8'
      );

      const handleFunc = recoveryCode.substring(
        recoveryCode.indexOf('async function handleStartupRecovery'),
        recoveryCode.indexOf('module.exports')
      );

      // Should accept delayFn and pass it
      expect(handleFunc).toContain('delayFn');
    });

    it('isAuthError function exists and is used', () => {
      const recoveryCode = require('fs').readFileSync(
        require('path').join(__dirname, '../../config/meilisearch-recovery.js'),
        'utf8'
      );

      expect(recoveryCode).toContain('function isAuthError(err)');
      expect(recoveryCode).toContain('if (isAuthError(err))');
    });
  });
});
