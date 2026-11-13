/**
 * Tests for utils/packageThresholds.js
 * Module: getThresholds, getThresholdForCategory, clearCache,
 *         DEFAULT_THRESHOLDS, detectAbuseFlags
 * No prior tests (0% coverage).
 */

jest.mock('../../config/db', () => ({
  packageSuspensionThreshold: {
    findMany: jest.fn().mockResolvedValue([]),
  },
}));

const prisma = require('../../config/db');
const {
  getThresholds,
  getThresholdForCategory,
  clearCache,
  DEFAULT_THRESHOLDS,
  detectAbuseFlags,
} = require('../../utils/packageThresholds');

describe('packageThresholds utils', () => {
  beforeEach(() => {
    clearCache();
    prisma.packageSuspensionThreshold.findMany.mockResolvedValue([]);
  });

  describe('DEFAULT_THRESHOLDS', () => {
    it('should export default thresholds object', () => {
      expect(DEFAULT_THRESHOLDS).toBeDefined();
      expect(DEFAULT_THRESHOLDS.maxDisputeRatePercent).toBe(20);
      expect(DEFAULT_THRESHOLDS.maxPrice).toBe(5000000);
      expect(DEFAULT_THRESHOLDS.minPrice).toBe(1000);
      expect(DEFAULT_THRESHOLDS.inactiveDaysThreshold).toBe(180);
    });
  });

  describe('getThresholds', () => {
    it('should fetch from DB on first call', async () => {
      const result = await getThresholds();
      expect(prisma.packageSuspensionThreshold.findMany).toHaveBeenCalledTimes(1);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should use cache on second call within TTL', async () => {
      await getThresholds();
      await getThresholds();
      expect(prisma.packageSuspensionThreshold.findMany).toHaveBeenCalledTimes(1);
    });

    it('should return empty array on DB error', async () => {
      prisma.packageSuspensionThreshold.findMany.mockRejectedValueOnce(new Error('DB error'));
      const result = await getThresholds();
      expect(result).toEqual([]);
    });

    it('should re-fetch after cache clear', async () => {
      await getThresholds();
      clearCache();
      await getThresholds();
      expect(prisma.packageSuspensionThreshold.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('getThresholdForCategory', () => {
    it('should return DEFAULT_THRESHOLDS when allThresholds is null', () => {
      const result = getThresholdForCategory('plomberie', null);
      expect(result).toBe(DEFAULT_THRESHOLDS);
    });

    it('should return DEFAULT_THRESHOLDS when no match found', () => {
      const result = getThresholdForCategory('plomberie', []);
      expect(result).toBe(DEFAULT_THRESHOLDS);
    });

    it('should return category-specific threshold', () => {
      const specific = { category: 'plomberie', maxDisputeRatePercent: 15, maxPrice: 1000000 };
      const result = getThresholdForCategory('plomberie', [specific]);
      expect(result).toBe(specific);
    });

    it('should return global threshold when no category match', () => {
      const global = { category: '*', maxDisputeRatePercent: 25 };
      const result = getThresholdForCategory('electricite', [global]);
      expect(result).toBe(global);
    });

    it('should prefer specific over global', () => {
      const specific = { category: 'plomberie', maxDisputeRatePercent: 10 };
      const global = { category: '*', maxDisputeRatePercent: 25 };
      const result = getThresholdForCategory('plomberie', [specific, global]);
      expect(result).toBe(specific);
    });
  });

  describe('detectAbuseFlags', () => {
    const basePkg = {
      category: 'plomberie',
      price: 50000,
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      professional: { userId: 'pro-1' },
      orders: [],
    };

    it('should return no flags for clean package', async () => {
      const result = await detectAbuseFlags(basePkg, new Set(), []);
      expect(result.isFlagged).toBe(false);
      expect(result.flags).toHaveLength(0);
    });

    it('should flag suspended professional', async () => {
      const suspendedProIds = new Set(['pro-1']);
      const result = await detectAbuseFlags(basePkg, suspendedProIds, []);
      expect(result.isFlagged).toBe(true);
      expect(result.flags).toContain('Professionnel suspendu');
    });

    it('should flag high dispute rate', async () => {
      const pkgWithDisputes = {
        ...basePkg,
        orders: [
          { status: 'DISPUTED' },
          { status: 'DISPUTED' },
          { status: 'DISPUTED' },
          { status: 'COMPLETED' },
          { status: 'COMPLETED' },
        ],
      };
      const result = await detectAbuseFlags(pkgWithDisputes, new Set(), []);
      expect(result.isFlagged).toBe(true);
      expect(result.disputeRate).toBe(60);
    });

    it('should flag excessive price', async () => {
      const expensive = { ...basePkg, price: 6000000 };
      const result = await detectAbuseFlags(expensive, new Set(), []);
      expect(result.flags.some(f => f.includes('Prix excessif'))).toBe(true);
    });

    it('should flag abnormally low price', async () => {
      const cheap = { ...basePkg, price: 500 };
      const result = await detectAbuseFlags(cheap, new Set(), []);
      expect(result.flags.some(f => f.includes('Prix anormalement bas'))).toBe(true);
    });

    it('should flag inactive package', async () => {
      const old = {
        ...basePkg,
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000), // 200 days ago
        orders: [],
      };
      const result = await detectAbuseFlags(old, new Set(), []);
      expect(result.flags.some(f => f.includes('Inactif'))).toBe(true);
    });

    it('should not flag active package with orders', async () => {
      const active = {
        ...basePkg,
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        orders: [{ status: 'COMPLETED' }],
      };
      const result = await detectAbuseFlags(active, new Set(), []);
      expect(result.flags.some(f => f.includes('Inactif'))).toBe(false);
    });
  });
});
