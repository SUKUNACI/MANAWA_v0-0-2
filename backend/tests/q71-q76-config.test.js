/**
 * Tests Q71-Q76: Feature Flags, A/B Testing, Deployment Strategies,
 * Environment Parity, Configuration Hot Reload
 */

const { hashUserFlag } = require('../utils/feature-flag-manager');
const {
  getVariant,
  isUserInExperiment,
  calculateExperimentStats,
  hashUserExperiment,
} = require('../utils/experiment-engine');
const {
  DEFAULT_FLAGS,
  FEATURE_FLAG_CACHE_KEY,
  FEATURE_FLAG_TTL,
  CONFIG_RELOAD_CHANNEL,
  getCacheTTL,
  publishHotReload,
  subscribeToHotReload,
} = require('../config/feature-flags');

// ─── Q71: Feature Flags System ───────────────────────────────────────────────

describe('Q71: Feature Flags System', () => {
  describe('hashUserFlag', () => {
    it('returns a number between 0 and 99', () => {
      const hash = hashUserFlag('user-123', 'new-dashboard-ui');
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(100);
    });

    it('is deterministic for same userId + flagName', () => {
      const h1 = hashUserFlag('user-abc', 'video-calls-beta');
      const h2 = hashUserFlag('user-abc', 'video-calls-beta');
      expect(h1).toBe(h2);
    });

    it('produces different values for different users', () => {
      const h1 = hashUserFlag('user-001', 'some-flag');
      const h2 = hashUserFlag('user-999', 'some-flag');
      expect(h1).not.toBe(h2);
    });

    it('produces different values for different flags on same user', () => {
      const h1 = hashUserFlag('user-abc', 'flag-one');
      const h2 = hashUserFlag('user-abc', 'flag-two');
      expect(h1).not.toBe(h2);
    });

    it('50% rollout distributes users roughly equally', () => {
      let inGroup = 0;
      const total = 1000;
      for (let i = 0; i < total; i++) {
        const hash = hashUserFlag(`user-${i}`, 'half-rollout-flag');
        if (hash < 50) inGroup++;
      }
      expect(inGroup).toBeGreaterThan(total * 0.45);
      expect(inGroup).toBeLessThan(total * 0.55);
    });
  });

  describe('DEFAULT_FLAGS', () => {
    it('contains expected default flags', () => {
      expect(DEFAULT_FLAGS).toHaveProperty('new-dashboard-ui');
      expect(DEFAULT_FLAGS).toHaveProperty('advanced-search');
      expect(DEFAULT_FLAGS).toHaveProperty('video-calls-beta');
    });

    it('each flag has required properties with valid values', () => {
      for (const [name, flag] of Object.entries(DEFAULT_FLAGS)) {
        expect(flag).toHaveProperty('name', name);
        expect(typeof flag.enabled).toBe('boolean');
        expect(typeof flag.rolloutPercentage).toBe('number');
        expect(flag.rolloutPercentage).toBeGreaterThanOrEqual(0);
        expect(flag.rolloutPercentage).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('Config constants', () => {
    it('FEATURE_FLAG_CACHE_KEY is a non-empty string', () => {
      expect(typeof FEATURE_FLAG_CACHE_KEY).toBe('string');
      expect(FEATURE_FLAG_CACHE_KEY.length).toBeGreaterThan(0);
    });

    it('FEATURE_FLAG_TTL is 300 seconds', () => {
      expect(FEATURE_FLAG_TTL).toBe(300);
      expect(getCacheTTL()).toBe(300);
    });
  });
});

// ─── Q72: A/B Testing Framework ──────────────────────────────────────────────

describe('Q72: A/B Testing Framework', () => {
  describe('hashUserExperiment', () => {
    it('is deterministic', () => {
      const h1 = hashUserExperiment('user-abc', 'checkout-flow');
      const h2 = hashUserExperiment('user-abc', 'checkout-flow');
      expect(h1).toBe(h2);
    });

    it('returns a non-negative number', () => {
      const h = hashUserExperiment('user-123', 'experiment-1');
      expect(typeof h).toBe('number');
      expect(h).toBeGreaterThanOrEqual(0);
    });

    it('varies by userId', () => {
      const h1 = hashUserExperiment('user-001', 'exp');
      const h2 = hashUserExperiment('user-002', 'exp');
      expect(h1).not.toBe(h2);
    });
  });

  describe('getVariant', () => {
    const variants = [
      { name: 'control', weight: 50 },
      { name: 'variant_a', weight: 50 },
    ];

    it('returns a valid variant name', () => {
      const variant = getVariant('user-123', 'test-exp', variants);
      expect(['control', 'variant_a']).toContain(variant);
    });

    it('is deterministic for same user + experiment', () => {
      const v1 = getVariant('user-abc', 'checkout-test', variants);
      const v2 = getVariant('user-abc', 'checkout-test', variants);
      expect(v1).toBe(v2);
    });

    it('returns null when no variants provided', () => {
      const variant = getVariant('user-123', 'exp', []);
      expect(variant).toBeNull();
    });

    it('distributes users roughly equally with equal weights', () => {
      const counts = { control: 0, variant_a: 0 };
      for (let i = 0; i < 1000; i++) {
        const v = getVariant(`user-${i}`, 'split-test', variants);
        counts[v]++;
      }
      expect(counts.control).toBeGreaterThan(400);
      expect(counts.variant_a).toBeGreaterThan(400);
    });

    it('respects variant weights proportionally', () => {
      const weightedVariants = [
        { name: 'control', weight: 70 },
        { name: 'variant_a', weight: 30 },
      ];
      const counts = { control: 0, variant_a: 0 };
      for (let i = 0; i < 1000; i++) {
        const v = getVariant(`user-${i}`, 'weighted-test', weightedVariants);
        counts[v]++;
      }
      expect(counts.control).toBeGreaterThan(600);
      expect(counts.variant_a).toBeLessThan(400);
    });
  });

  describe('isUserInExperiment', () => {
    it('returns false when experiment status is not ACTIVE', () => {
      const exp = { name: 'test', status: 'DRAFT', trafficPercentage: 100 };
      expect(isUserInExperiment('user-1', exp)).toBe(false);
    });

    it('returns true when status is ACTIVE and trafficPercentage=100', () => {
      const exp = { name: 'test', status: 'ACTIVE', trafficPercentage: 100 };
      expect(isUserInExperiment('user-1', exp)).toBe(true);
    });

    it('returns consistent result for same user', () => {
      const exp = { name: 'test', status: 'ACTIVE', trafficPercentage: 50 };
      const r1 = isUserInExperiment('user-abc', exp);
      const r2 = isUserInExperiment('user-abc', exp);
      expect(r1).toBe(r2);
    });

    it('roughly 50% of users included with 50% traffic', () => {
      const exp = { name: 'traffic-test', status: 'ACTIVE', trafficPercentage: 50 };
      let included = 0;
      for (let i = 0; i < 1000; i++) {
        if (isUserInExperiment(`user-${i}`, exp)) included++;
      }
      expect(included).toBeGreaterThan(400);
      expect(included).toBeLessThan(600);
    });
  });

  describe('calculateExperimentStats', () => {
    it('handles empty metrics array', async () => {
      const mockPrisma = {
        experimentVariant: {
          findMany: jest.fn().mockResolvedValue([
            { name: 'control', metrics: [] },
          ]),
        },
      };
      const stats = await calculateExperimentStats(mockPrisma, 'exp-id-1');
      expect(stats.control).toEqual({ count: 0, mean: 0, stdDev: 0, min: 0, max: 0 });
    });

    it('calculates mean, min, max correctly', async () => {
      const mockPrisma = {
        experimentVariant: {
          findMany: jest.fn().mockResolvedValue([
            {
              name: 'control',
              metrics: [{ value: 1 }, { value: 2 }, { value: 3 }],
            },
          ]),
        },
      };
      const stats = await calculateExperimentStats(mockPrisma, 'exp-id-2');
      expect(stats.control.mean).toBe(2);
      expect(stats.control.count).toBe(3);
      expect(stats.control.min).toBe(1);
      expect(stats.control.max).toBe(3);
    });
  });
});

// ─── Q73: Canary Deployment ───────────────────────────────────────────────────

describe('Q73: Canary Deployment', () => {
  const fs = require('fs');
  const path = require('path');

  it('canary-deployment.md exists in backend/infrastructure/', () => {
    expect(fs.existsSync(path.join(__dirname, '../infrastructure/canary-deployment.md'))).toBe(true);
  });

  it('canary deployment doc mentions rollback strategy', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../infrastructure/canary-deployment.md'),
      'utf8'
    );
    expect(content).toMatch(/canary/i);
    expect(content).toMatch(/rollback/i);
  });
});

// ─── Q74: Blue-Green Deployment ──────────────────────────────────────────────

describe('Q74: Blue-Green Deployment', () => {
  const fs = require('fs');
  const path = require('path');

  it('blue-green-deployment.md exists in backend/infrastructure/', () => {
    expect(fs.existsSync(path.join(__dirname, '../infrastructure/blue-green-deployment.md'))).toBe(true);
  });

  it('blue-green doc describes traffic switch process', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../infrastructure/blue-green-deployment.md'),
      'utf8'
    );
    expect(content).toMatch(/blue/i);
    expect(content).toMatch(/green/i);
    expect(content).toMatch(/switch|swap|traffic/i);
  });
});

// ─── Q75: Environment Parity ─────────────────────────────────────────────────

describe('Q75: Environment Parity', () => {
  const fs = require('fs');
  const path = require('path');

  it('.env.dev template exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../.env.dev'))).toBe(true);
  });

  it('.env.staging template exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../.env.staging'))).toBe(true);
  });

  it('.env.dev contains required variables', () => {
    const content = fs.readFileSync(path.join(__dirname, '../.env.dev'), 'utf8');
    expect(content).toMatch(/DATABASE_URL/);
    expect(content).toMatch(/JWT_SECRET/);
    expect(content).toMatch(/NODE_ENV/);
    expect(content).toMatch(/REDIS_URL/);
  });

  it('.env.staging contains required variables', () => {
    const content = fs.readFileSync(path.join(__dirname, '../.env.staging'), 'utf8');
    expect(content).toMatch(/DATABASE_URL/);
    expect(content).toMatch(/JWT_SECRET/);
    expect(content).toMatch(/NODE_ENV/);
  });

  it('.env.dev sets NODE_ENV to development', () => {
    const content = fs.readFileSync(path.join(__dirname, '../.env.dev.example'), 'utf8');
    expect(content).toMatch(/NODE_ENV=development/);
  });

  it('.env.staging sets NODE_ENV to staging', () => {
    const content = fs.readFileSync(path.join(__dirname, '../.env.staging.example'), 'utf8');
    expect(content).toMatch(/NODE_ENV=staging/);
  });
});

// ─── Q76: Configuration Hot Reload ───────────────────────────────────────────

describe('Q76: Configuration Hot Reload', () => {
  it('CONFIG_RELOAD_CHANNEL is defined and matches expected pattern', () => {
    expect(typeof CONFIG_RELOAD_CHANNEL).toBe('string');
    expect(CONFIG_RELOAD_CHANNEL).toMatch(/config.*reload.*feature/);
  });

  it('subscribeToHotReload is a function', () => {
    expect(typeof subscribeToHotReload).toBe('function');
  });

  it('publishHotReload is a function', () => {
    expect(typeof publishHotReload).toBe('function');
  });

  it('publishHotReload handles redis errors gracefully without throwing', async () => {
    await expect(publishHotReload('test-flag')).resolves.not.toThrow();
  });
});
