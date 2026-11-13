/**
 * Tests for experiment-engine.js
 * Tests getVariant, isUserInExperiment, recordMetric, calculateExperimentStats,
 * testSignificance, hashUserExperiment
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('ExperimentEngine', () => {
  let engine;
  let mockPrisma;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = require('../../utils/experiment-engine');

    mockPrisma = {
      experimentMetric: {
        create: jest.fn().mockResolvedValue({}),
      },
      experimentVariant: {
        findMany: jest.fn(),
      },
    };
  });

  // ─────────────────────────────────────────────
  // Exports
  // ─────────────────────────────────────────────
  describe('Exports', () => {
    const expectedExports = [
      'getVariant',
      'isUserInExperiment',
      'recordMetric',
      'calculateExperimentStats',
      'testSignificance',
      'hashUserExperiment',
    ];

    expectedExports.forEach(fn => {
      it(`should export ${fn}`, () => {
        expect(typeof engine[fn]).toBe('function');
      });
    });
  });

  // ─────────────────────────────────────────────
  // hashUserExperiment
  // ─────────────────────────────────────────────
  describe('hashUserExperiment', () => {
    it('should return a positive integer', () => {
      // Act
      const hash = engine.hashUserExperiment('user-1', 'experiment-a');

      // Assert
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThan(0);
    });

    it('should be deterministic', () => {
      // Act
      const h1 = engine.hashUserExperiment('user-abc', 'exp-x');
      const h2 = engine.hashUserExperiment('user-abc', 'exp-x');

      // Assert
      expect(h1).toBe(h2);
    });

    it('should differ for different users', () => {
      // Act
      const h1 = engine.hashUserExperiment('user-1', 'exp-x');
      const h2 = engine.hashUserExperiment('user-2', 'exp-x');

      // Assert
      expect(h1).not.toBe(h2);
    });

    it('should differ for different experiments', () => {
      // Act
      const h1 = engine.hashUserExperiment('user-1', 'exp-a');
      const h2 = engine.hashUserExperiment('user-1', 'exp-b');

      // Assert
      expect(h1).not.toBe(h2);
    });
  });

  // ─────────────────────────────────────────────
  // getVariant
  // ─────────────────────────────────────────────
  describe('getVariant', () => {
    const variants = [
      { name: 'control', weight: 50 },
      { name: 'variant_a', weight: 50 },
    ];

    it('should return a valid variant name', () => {
      // Act
      const variant = engine.getVariant('user-1', 'experiment-ab', variants);

      // Assert
      expect(['control', 'variant_a']).toContain(variant);
    });

    it('should be deterministic — same user+experiment returns same variant', () => {
      // Act
      const v1 = engine.getVariant('user-stable', 'exp-stable', variants);
      const v2 = engine.getVariant('user-stable', 'exp-stable', variants);

      // Assert
      expect(v1).toBe(v2);
    });

    it('should return null for empty variants array', () => {
      // Act
      const variant = engine.getVariant('user-1', 'exp', []);

      // Assert
      expect(variant).toBeNull();
    });

    it('should return null for null variants', () => {
      // Act
      const variant = engine.getVariant('user-1', 'exp', null);

      // Assert
      expect(variant).toBeNull();
    });

    it('should return first variant name when total weight is 0', () => {
      // Arrange
      const zeroWeightVariants = [
        { name: 'control', weight: 0 },
        { name: 'variant_a', weight: 0 },
      ];

      // Act
      const variant = engine.getVariant('user-1', 'exp', zeroWeightVariants);

      // Assert
      expect(variant).toBe('control');
    });

    it('should respect weight ratios — 100% weight variant always wins', () => {
      // Arrange
      const heavyVariants = [
        { name: 'control', weight: 0 },
        { name: 'winner', weight: 100 },
      ];

      // Act — test with multiple users to confirm
      const results = new Set();
      for (let i = 0; i < 20; i++) {
        results.add(engine.getVariant(`user-${i}`, 'exp-100', heavyVariants));
      }

      // Assert — only 'winner' should appear
      expect(results.has('winner')).toBe(true);
      expect(results.has('control')).toBe(false);
    });

    it('should handle single variant', () => {
      // Arrange
      const singleVariant = [{ name: 'only', weight: 100 }];

      // Act
      const variant = engine.getVariant('user-1', 'exp', singleVariant);

      // Assert
      expect(variant).toBe('only');
    });

    it('should distribute assignments across a population', () => {
      // Arrange — test statistical distribution with 1000 users
      const users = Array.from({ length: 1000 }, (_, i) => `user-${i}`);
      const countA = users.filter(
        u => engine.getVariant(u, 'dist-test', variants) === 'control'
      ).length;

      // Assert — with 50/50 split, control should be roughly 40-60%
      expect(countA).toBeGreaterThan(350);
      expect(countA).toBeLessThan(650);
    });
  });

  // ─────────────────────────────────────────────
  // isUserInExperiment
  // ─────────────────────────────────────────────
  describe('isUserInExperiment', () => {
    it('should return false for non-ACTIVE experiment', () => {
      // Arrange
      const experiment = {
        name: 'exp-paused',
        status: 'PAUSED',
        trafficPercentage: 100,
      };

      // Act
      const result = engine.isUserInExperiment('user-1', experiment);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for DRAFT experiment', () => {
      // Arrange
      const experiment = {
        name: 'exp-draft',
        status: 'DRAFT',
        trafficPercentage: 100,
      };

      // Act
      const result = engine.isUserInExperiment('user-1', experiment);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true for ACTIVE experiment at 100% traffic', () => {
      // Arrange
      const experiment = {
        name: 'exp-full',
        status: 'ACTIVE',
        trafficPercentage: 100,
      };

      // Act
      const result = engine.isUserInExperiment('user-1', experiment);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for ACTIVE experiment at 0% traffic', () => {
      // Arrange
      const experiment = {
        name: 'exp-zero',
        status: 'ACTIVE',
        trafficPercentage: 0,
      };

      // Act — test with many users to be sure
      const results = new Set();
      for (let i = 0; i < 50; i++) {
        results.add(engine.isUserInExperiment(`user-${i}`, experiment));
      }

      // Assert — at 0% traffic no user should be included
      expect(results.has(true)).toBe(false);
    });

    it('should be deterministic for the same user and experiment', () => {
      // Arrange
      const experiment = {
        name: 'exp-consistent',
        status: 'ACTIVE',
        trafficPercentage: 50,
      };

      // Act
      const r1 = engine.isUserInExperiment('user-stable', experiment);
      const r2 = engine.isUserInExperiment('user-stable', experiment);

      // Assert
      expect(r1).toBe(r2);
    });
  });

  // ─────────────────────────────────────────────
  // recordMetric
  // ─────────────────────────────────────────────
  describe('recordMetric', () => {
    it('should create an experimentMetric record', async () => {
      // Act
      await engine.recordMetric(mockPrisma, 'variant-1', 'click', 1, { page: 'home' });

      // Assert
      expect(mockPrisma.experimentMetric.create).toHaveBeenCalledWith({
        data: {
          variantId: 'variant-1',
          metricName: 'click',
          value: 1,
          metadata: JSON.stringify({ page: 'home' }),
        },
      });
    });

    it('should store null metadata when metadata object is empty', async () => {
      // Act
      await engine.recordMetric(mockPrisma, 'variant-2', 'conversion', 1, {});

      // Assert
      const callData = mockPrisma.experimentMetric.create.mock.calls[0][0].data;
      expect(callData.metadata).toBeNull();
    });

    it('should not throw when DB create fails', async () => {
      // Arrange
      mockPrisma.experimentMetric.create.mockRejectedValueOnce(
        new Error('DB write error')
      );

      // Act & Assert — should not throw
      await expect(
        engine.recordMetric(mockPrisma, 'variant-1', 'click', 1)
      ).resolves.toBeUndefined();
    });

    it('should use default empty metadata when not provided', async () => {
      // Act
      await engine.recordMetric(mockPrisma, 'variant-3', 'view', 1);

      // Assert
      expect(mockPrisma.experimentMetric.create).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // calculateExperimentStats
  // ─────────────────────────────────────────────
  describe('calculateExperimentStats', () => {
    it('should calculate mean, stdDev, min, max correctly', async () => {
      // Arrange
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        {
          name: 'control',
          metrics: [{ value: 10 }, { value: 20 }, { value: 30 }],
        },
      ]);

      // Act
      const stats = await engine.calculateExperimentStats(mockPrisma, 'exp-1');

      // Assert
      expect(stats['control']).toEqual({
        count: 3,
        mean: 20,
        stdDev: expect.any(Number),
        min: 10,
        max: 30,
      });
      expect(stats['control'].mean).toBeCloseTo(20, 2);
    });

    it('should return zero stats for variant with no metrics', async () => {
      // Arrange
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        { name: 'empty-variant', metrics: [] },
      ]);

      // Act
      const stats = await engine.calculateExperimentStats(mockPrisma, 'exp-empty');

      // Assert
      expect(stats['empty-variant']).toEqual({
        count: 0,
        mean: 0,
        stdDev: 0,
        min: 0,
        max: 0,
      });
    });

    it('should return stats for multiple variants', async () => {
      // Arrange
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        {
          name: 'control',
          metrics: [{ value: 1 }, { value: 2 }],
        },
        {
          name: 'variant_a',
          metrics: [{ value: 3 }, { value: 4 }],
        },
      ]);

      // Act
      const stats = await engine.calculateExperimentStats(mockPrisma, 'exp-multi');

      // Assert
      expect(stats['control']).toBeDefined();
      expect(stats['variant_a']).toBeDefined();
      expect(stats['control'].mean).toBeCloseTo(1.5, 2);
      expect(stats['variant_a'].mean).toBeCloseTo(3.5, 2);
    });

    it('should return empty object on DB error', async () => {
      // Arrange
      mockPrisma.experimentVariant.findMany.mockRejectedValue(new Error('DB error'));

      // Act
      const stats = await engine.calculateExperimentStats(mockPrisma, 'exp-error');

      // Assert
      expect(stats).toEqual({});
    });

    it('should compute standard deviation correctly for identical values', async () => {
      // Arrange — all values identical, stdDev should be 0
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        {
          name: 'uniform',
          metrics: [{ value: 5 }, { value: 5 }, { value: 5 }],
        },
      ]);

      // Act
      const stats = await engine.calculateExperimentStats(mockPrisma, 'exp-uniform');

      // Assert
      expect(stats['uniform'].stdDev).toBe(0);
    });
  });

  // ─────────────────────────────────────────────
  // testSignificance
  // ─────────────────────────────────────────────
  describe('testSignificance', () => {
    it('should return not significant for identical distributions', async () => {
      // Arrange — same values → no difference
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        {
          name: 'control',
          metrics: [{ value: 1 }, { value: 1 }, { value: 1 }, { value: 1 }],
        },
        {
          name: 'variant_a',
          metrics: [{ value: 1 }, { value: 1 }, { value: 1 }, { value: 1 }],
        },
      ]);

      // Act
      const result = await engine.testSignificance(
        mockPrisma,
        'exp-1',
        'control',
        'variant_a'
      );

      // Assert
      expect(result.significant).toBe(false);
    });

    it('should return significant for very different distributions', async () => {
      // Arrange — group A: all 0, group B: all 100 → very significant
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        {
          name: 'control',
          metrics: Array.from({ length: 50 }, () => ({ value: 0 })),
        },
        {
          name: 'variant_a',
          metrics: Array.from({ length: 50 }, () => ({ value: 100 })),
        },
      ]);

      // Act
      const result = await engine.testSignificance(
        mockPrisma,
        'exp-2',
        'control',
        'variant_a'
      );

      // Assert
      expect(result.significant).toBe(true);
      expect(result.pValue).toBeLessThan(0.05);
    });

    it('should return significant:false with pValue 1 when less than 2 variants found', async () => {
      // Arrange — only 1 variant found
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        {
          name: 'control',
          metrics: [{ value: 1 }],
        },
      ]);

      // Act
      const result = await engine.testSignificance(
        mockPrisma,
        'exp-3',
        'control',
        'missing'
      );

      // Assert
      expect(result.significant).toBe(false);
      expect(result.pValue).toBe(1);
    });

    it('should return insufficient samples message when < 2 data points per variant', async () => {
      // Arrange
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        { name: 'control', metrics: [{ value: 5 }] },
        { name: 'variant_a', metrics: [{ value: 10 }] },
      ]);

      // Act
      const result = await engine.testSignificance(
        mockPrisma,
        'exp-4',
        'control',
        'variant_a'
      );

      // Assert
      expect(result.significant).toBe(false);
      expect(result.message).toMatch(/insufficient/i);
    });

    it('should include stats for both variants in result', async () => {
      // Arrange
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        {
          name: 'control',
          metrics: [{ value: 2 }, { value: 4 }, { value: 6 }],
        },
        {
          name: 'variant_a',
          metrics: [{ value: 8 }, { value: 10 }, { value: 12 }],
        },
      ]);

      // Act
      const result = await engine.testSignificance(
        mockPrisma,
        'exp-5',
        'control',
        'variant_a'
      );

      // Assert
      expect(result.stats).toBeDefined();
      expect(result.stats['control']).toHaveProperty('mean');
      expect(result.stats['variant_a']).toHaveProperty('mean');
      expect(result.stats['control'].n).toBe(3);
    });

    it('should return error result on DB failure', async () => {
      // Arrange
      mockPrisma.experimentVariant.findMany.mockRejectedValue(
        new Error('DB unavailable')
      );

      // Act
      const result = await engine.testSignificance(
        mockPrisma,
        'exp-err',
        'control',
        'variant_a'
      );

      // Assert
      expect(result.significant).toBe(false);
      expect(result.pValue).toBe(1);
      expect(result.error).toBe('DB unavailable');
    });

    it('should return a pValue between 0 and 1', async () => {
      // Arrange
      mockPrisma.experimentVariant.findMany.mockResolvedValue([
        {
          name: 'control',
          metrics: [{ value: 1 }, { value: 2 }, { value: 1 }, { value: 2 }],
        },
        {
          name: 'variant_a',
          metrics: [{ value: 5 }, { value: 6 }, { value: 5 }, { value: 6 }],
        },
      ]);

      // Act
      const result = await engine.testSignificance(
        mockPrisma,
        'exp-6',
        'control',
        'variant_a'
      );

      // Assert
      expect(result.pValue).toBeGreaterThanOrEqual(0);
      expect(result.pValue).toBeLessThanOrEqual(1);
    });
  });
});
