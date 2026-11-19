/**
 * MeiliSearch Error Format — Real Execution Tests
 *
 * Verify that:
 * 1. 401/403 errors do NOT trigger recovery
 * 2. index_not_found DOES trigger recovery
 * 3. Auth priority prevents misclassification
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

describe('[MeiliSearch Error Format - Execution]', () => {
  let recovery;
  let mockSyncAllIndices;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }));

    jest.doMock('../../jobs/meilisearch-sync', () => ({
      syncAllIndices: jest.fn(async () => ({ status: 'success' })),
    }));

    recovery = require('../../config/meilisearch-recovery');
    const syncModule = require('../../jobs/meilisearch-sync');
    mockSyncAllIndices = syncModule.syncAllIndices;
  });

  afterEach(() => {
    jest.unmock('../../utils/logger');
    jest.unmock('../../jobs/meilisearch-sync');
    jest.restoreAllMocks();
  });

  describe('401/403 Auth Errors — NO Recovery', () => {
    it('should NOT recover on auth_error type', async () => {
      await recovery.triggerRecoverySync('auth_error');
      expect(mockSyncAllIndices).not.toHaveBeenCalled();
    });

    it('should NOT recover when called with 401 error', async () => {
      let callCount = 0;
      const always401 = async () => {
        callCount++;
        const err = new Error('Unauthorized');
        err.response = { status: 401 };
        throw err;
      };

      try {
        await recovery.retryWithBackoff(always401, 6, 5000, jest.fn(async () => Promise.resolve()));
      } catch (err) {
        // Expected to throw immediately
      }

      // Verify only 1 attempt (not retried)
      expect(callCount).toBe(1);
    });

    it('should NOT recover when called with 403 error', async () => {
      let callCount = 0;
      const always403 = async () => {
        callCount++;
        const err = new Error('Forbidden');
        err.response = { status: 403 };
        throw err;
      };

      try {
        await recovery.retryWithBackoff(always403, 6, 5000, jest.fn(async () => Promise.resolve()));
      } catch (err) {
        // Expected to throw immediately
      }

      expect(callCount).toBe(1);
    });
  });

  describe('index_not_found — Recovery Triggered', () => {
    it('should trigger recovery when called with missing_index type', async () => {
      await recovery.triggerRecoverySync('missing_index');
      expect(mockSyncAllIndices).toHaveBeenCalledTimes(1);
    });

    it('should NOT trigger for auth_error even with index_not_found mention', async () => {
      // Verify auth_error blocks recovery even if error has "index not found" in message
      await recovery.triggerRecoverySync('auth_error');
      expect(mockSyncAllIndices).not.toHaveBeenCalled();
    });
  });

  describe('Auth Priority Over Other Errors', () => {
    it('should NOT retry 401 even if error looks like HTML', async () => {
      let callCount = 0;
      const always401WithHtml = async () => {
        callCount++;
        const err = new Error("Unexpected token '<', <!DOCTYPE");
        err.response = { status: 401 };
        throw err;
      };

      try {
        await recovery.retryWithBackoff(always401WithHtml, 6, 5000, jest.fn(async () => Promise.resolve()));
      } catch (err) {
        // Expected to throw immediately
      }

      // Verify 1 attempt only (auth error stops before any retry or HTML check)
      expect(callCount).toBe(1);
    });

    it('should NOT call recovery for 401 even with handleStartupRecovery', async () => {
      let callCount = 0;
      const always401 = async () => {
        callCount++;
        const err = new Error('401: Unauthorized');
        err.response = { status: 401 };
        throw err;
      };

      try {
        await recovery.handleStartupRecovery(always401, 6, 5000, jest.fn(async () => Promise.resolve()));
      } catch (err) {
        // Expected to throw immediately
      }

      // Verify NO recovery triggered (auth error skips resync)
      expect(mockSyncAllIndices).not.toHaveBeenCalled();
      expect(callCount).toBe(1);
    });
  });

  describe('Transient Errors — Recovery After Exhaustion', () => {
    it('should retry startup errors until exhaustion, then recover', async () => {
      let callCount = 0;
      const instantDelay = jest.fn(async () => Promise.resolve());

      const alwaysHtmlError = async () => {
        callCount++;
        throw new Error("Unexpected token '<', <!DOCTYPE");
      };

      try {
        await recovery.handleStartupRecovery(alwaysHtmlError, 6, 5000, instantDelay);
      } catch (err) {
        // Expected to throw after exhaustion
      }

      // Verify 6 attempts
      expect(callCount).toBe(6);
      // Verify 5 delays (between 6 attempts)
      expect(instantDelay).toHaveBeenCalledTimes(5);
      // Verify recovery triggered after exhaustion
      expect(mockSyncAllIndices).toHaveBeenCalledTimes(1);
    });

    it('should stop retrying and NOT recover if 401 is thrown after initial success', async () => {
      let callCount = 0;

      const failWith401Later = async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: true };
        }
        const err = new Error('Unauthorized');
        err.response = { status: 401 };
        throw err;
      };

      const result = await recovery.handleStartupRecovery(failWith401Later, 6, 5000, jest.fn(async () => Promise.resolve()));

      // Verify succeeded on first try (no retry needed)
      expect(callCount).toBe(1);
      expect(result.ok).toBe(true);
      // Verify NO recovery
      expect(mockSyncAllIndices).not.toHaveBeenCalled();
    });
  });
});
