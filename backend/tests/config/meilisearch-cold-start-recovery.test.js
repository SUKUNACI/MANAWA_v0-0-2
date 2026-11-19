/**
 * MeiliSearch Cold Start Recovery — Execution Tests
 *
 * Verify:
 * 1. Initial sync failure with HTML triggers recovery
 * 2. Recovery retries with backoff
 * 3. Recovery flag prevents concurrent syncs
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

describe('[MeiliSearch Cold Start - Initial Sync & Recovery Path]', () => {
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

  describe('Initial Sync Failure → Recovery Retry', () => {
    it('should retry initial sync with HTML error', async () => {
      let callCount = 0;
      const instantDelay = jest.fn(async () => Promise.resolve());

      const htmlStartupError = async () => {
        callCount++;
        throw new Error("Unexpected token '<', <!DOCTYPE");
      };

      try {
        await recovery.handleStartupRecovery(htmlStartupError, 6, 5000, instantDelay);
      } catch (err) {
        // Expected to throw after exhaustion, recovery triggered
      }

      // Verify 6 retries attempted
      expect(callCount).toBe(6);
      // Verify 5 delays between attempts
      expect(instantDelay).toHaveBeenCalledTimes(5);
      // Verify recovery triggered after exhaustion
      expect(mockSyncAllIndices).toHaveBeenCalledTimes(1);
    });

    it('should succeed early if service recovers before exhaustion', async () => {
      let callCount = 0;

      const eventuallySucceed = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error("Unexpected token '<', <!DOCTYPE");
        }
        return { hits: [{ id: 1 }] };
      };

      const result = await recovery.handleStartupRecovery(
        eventuallySucceed,
        6,
        5000,
        jest.fn(async () => Promise.resolve())
      );

      // Verify succeeded on 2nd attempt
      expect(callCount).toBe(2);
      expect(result.hits).toHaveLength(1);
      // Verify NO recovery triggered (success before exhaustion)
      expect(mockSyncAllIndices).not.toHaveBeenCalled();
    });

    it('should NOT retry if 401 error is thrown', async () => {
      let callCount = 0;

      const always401 = async () => {
        callCount++;
        const err = new Error('Unauthorized');
        err.response = { status: 401 };
        throw err;
      };

      try {
        await recovery.handleStartupRecovery(
          always401,
          6,
          5000,
          jest.fn(async () => Promise.resolve())
        );
      } catch (err) {
        // Expected to throw immediately
      }

      // Verify only 1 attempt (auth error stops immediately)
      expect(callCount).toBe(1);
      // Verify NO recovery
      expect(mockSyncAllIndices).not.toHaveBeenCalled();
    });
  });

  describe('Recovery Concurrency Prevention', () => {
    it('should prevent parallel resync with flag', async () => {
      let syncStarted = false;
      let syncBlocked = false;

      mockSyncAllIndices.mockImplementation(async () => {
        if (syncStarted) {
          syncBlocked = true;
        }
        syncStarted = true;
        await new Promise(resolve => setTimeout(resolve, 10));
        syncStarted = false;
        return { status: 'success' };
      });

      // Start first resync
      const promise1 = recovery.triggerRecoverySync('missing_index');
      // Try second immediately (should be blocked)
      const promise2 = recovery.triggerRecoverySync('missing_index');

      await Promise.all([promise1, promise2]);

      // Verify only 1 execution (second blocked by flag)
      expect(mockSyncAllIndices).toHaveBeenCalledTimes(1);
      expect(syncBlocked).toBe(false);
    });

    it('should throttle recovery calls within 60 seconds', async () => {
      // First call
      await recovery.triggerRecoverySync('missing_index');
      expect(mockSyncAllIndices).toHaveBeenCalledTimes(1);

      // Second call immediately (should be throttled)
      await recovery.triggerRecoverySync('missing_index');
      expect(mockSyncAllIndices).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
  });
});
