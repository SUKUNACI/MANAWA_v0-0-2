'use strict';
/**
 * Tests for config/performance-optimization.js
 */

describe('performance-optimization config', () => {
  let perf;

  beforeEach(() => {
    jest.resetModules();
    perf = require('../../config/performance-optimization');
  });

  describe('CACHE_TTL', () => {
    it('exporte CACHE_TTL comme objet', () => {
      expect(perf.CACHE_TTL).toBeDefined();
      expect(typeof perf.CACHE_TTL).toBe('object');
    });

    it('a toutes les clés de cache attendues', () => {
      const { CACHE_TTL } = perf;
      expect(CACHE_TTL).toHaveProperty('PROFESSIONAL_LIST');
      expect(CACHE_TTL).toHaveProperty('PROFESSIONAL_DETAIL');
      expect(CACHE_TTL).toHaveProperty('USER_PROFILE');
      expect(CACHE_TTL).toHaveProperty('PACKAGES');
      expect(CACHE_TTL).toHaveProperty('ADMIN_STATS');
    });

    it('toutes les valeurs sont des nombres positifs', () => {
      const { CACHE_TTL } = perf;
      for (const key of Object.keys(CACHE_TTL)) {
        expect(typeof CACHE_TTL[key]).toBe('number');
        expect(CACHE_TTL[key]).toBeGreaterThan(0);
      }
    });

    it('PACKAGES a un TTL plus long que PROFESSIONAL_LIST', () => {
      expect(perf.CACHE_TTL.PACKAGES).toBeGreaterThan(perf.CACHE_TTL.PROFESSIONAL_LIST);
    });
  });

  describe('COMPRESSION_CONFIG', () => {
    it('exporte COMPRESSION_CONFIG', () => {
      expect(perf.COMPRESSION_CONFIG).toBeDefined();
    });

    it('a les propriétés requises', () => {
      const { COMPRESSION_CONFIG } = perf;
      expect(COMPRESSION_CONFIG).toHaveProperty('ENABLED');
      expect(COMPRESSION_CONFIG).toHaveProperty('LEVEL');
      expect(COMPRESSION_CONFIG).toHaveProperty('THRESHOLD');
      expect(COMPRESSION_CONFIG).toHaveProperty('TYPE');
    });

    it('TYPE est un tableau de MIME types', () => {
      expect(Array.isArray(perf.COMPRESSION_CONFIG.TYPE)).toBe(true);
      expect(perf.COMPRESSION_CONFIG.TYPE).toContain('application/json');
    });

    it('le niveau est entre 1 et 9', () => {
      expect(perf.COMPRESSION_CONFIG.LEVEL).toBeGreaterThanOrEqual(1);
      expect(perf.COMPRESSION_CONFIG.LEVEL).toBeLessThanOrEqual(9);
    });
  });

  describe('BROTLI_CONFIG', () => {
    it('exporte BROTLI_CONFIG', () => {
      expect(perf.BROTLI_CONFIG).toBeDefined();
      expect(perf.BROTLI_CONFIG).toHaveProperty('ENABLED');
      expect(perf.BROTLI_CONFIG).toHaveProperty('QUALITY');
    });
  });

  describe('QUERY_BATCHING', () => {
    it('exporte QUERY_BATCHING', () => {
      expect(perf.QUERY_BATCHING).toBeDefined();
      expect(perf.QUERY_BATCHING).toHaveProperty('MAX_BATCH_SIZE');
      expect(perf.QUERY_BATCHING).toHaveProperty('TIMEOUT_MS');
    });
  });

  describe('generateCacheKey', () => {
    it('génère une clé avec le prefix', () => {
      const key = perf.generateCacheKey('professionals', null, null);
      expect(key).toBe('professionals');
    });

    it('inclut userId si fourni', () => {
      const key = perf.generateCacheKey('profile', 'user123', null);
      expect(key).toContain('user123');
      expect(key).toContain(':user:');
    });

    it('inclut resourceId si fourni', () => {
      const key = perf.generateCacheKey('projects', null, 'proj456');
      expect(key).toContain('proj456');
    });

    it('inclut userId et resourceId ensemble', () => {
      const key = perf.generateCacheKey('projects', 'user1', 'proj1');
      expect(key).toContain(':user:user1');
      expect(key).toContain(':proj1');
    });

    it('inclut les queryParams si fournis', () => {
      const key = perf.generateCacheKey('search', null, null, { page: 1, limit: 10 });
      expect(key).toContain('page');
    });

    it('génère la même clé pour les mêmes paramètres', () => {
      const key1 = perf.generateCacheKey('test', 'user1', 'res1', { q: 'foo' });
      const key2 = perf.generateCacheKey('test', 'user1', 'res1', { q: 'foo' });
      expect(key1).toBe(key2);
    });
  });

  describe('DASHBOARD_KPI_QUERIES', () => {
    it('exporte DASHBOARD_KPI_QUERIES', () => {
      expect(perf.DASHBOARD_KPI_QUERIES).toBeDefined();
      expect(perf.DASHBOARD_KPI_QUERIES).toHaveProperty('ENDPOINT');
      expect(perf.DASHBOARD_KPI_QUERIES).toHaveProperty('TTL');
      expect(perf.DASHBOARD_KPI_QUERIES).toHaveProperty('QUERIES');
    });

    it('QUERIES contient toutes les métriques dashboard', () => {
      const { QUERIES } = perf.DASHBOARD_KPI_QUERIES;
      expect(Array.isArray(QUERIES)).toBe(true);
      expect(QUERIES).toContain('totalUsers');
      expect(QUERIES).toContain('totalRevenue');
    });
  });

  describe('FULL_PAGE_CACHE', () => {
    it('exporte FULL_PAGE_CACHE', () => {
      expect(perf.FULL_PAGE_CACHE).toBeDefined();
      expect(perf.FULL_PAGE_CACHE).toHaveProperty('ADMIN_DASHBOARD');
      expect(perf.FULL_PAGE_CACHE).toHaveProperty('PROFESSIONAL_PROFILE');
    });

    it('chaque groupe a un TTL et une liste d\'endpoints', () => {
      const { ADMIN_DASHBOARD } = perf.FULL_PAGE_CACHE;
      expect(typeof ADMIN_DASHBOARD.TTL).toBe('number');
      expect(Array.isArray(ADMIN_DASHBOARD.ENDPOINTS)).toBe(true);
    });
  });

  describe('CDN_CACHE', () => {
    it('exporte CDN_CACHE', () => {
      expect(perf.CDN_CACHE).toBeDefined();
      expect(perf.CDN_CACHE).toHaveProperty('IMAGES');
      expect(perf.CDN_CACHE).toHaveProperty('AVATARS');
      expect(perf.CDN_CACHE).toHaveProperty('PORTFOLIO');
    });

    it('les images ont un TTL d\'un an', () => {
      expect(perf.CDN_CACHE.IMAGES.TTL).toBe(31536000);
    });

    it('chaque type a un TTL et des HEADERS', () => {
      const { CDN_CACHE } = perf;
      for (const key of Object.keys(CDN_CACHE)) {
        expect(CDN_CACHE[key]).toHaveProperty('TTL');
        expect(CDN_CACHE[key]).toHaveProperty('HEADERS');
      }
    });
  });

  describe('QUERY_SELECT', () => {
    it('exporte QUERY_SELECT', () => {
      expect(perf.QUERY_SELECT).toBeDefined();
    });

    it('a USER_MINIMAL et USER_FULL', () => {
      const { QUERY_SELECT } = perf;
      expect(QUERY_SELECT).toHaveProperty('USER_MINIMAL');
      expect(QUERY_SELECT).toHaveProperty('USER_FULL');
    });

    it('USER_MINIMAL a les champs attendus', () => {
      const { USER_MINIMAL } = perf.QUERY_SELECT;
      expect(USER_MINIMAL.id).toBe(true);
      expect(USER_MINIMAL.firstName).toBe(true);
      expect(USER_MINIMAL.email).toBe(true);
    });
  });
});
