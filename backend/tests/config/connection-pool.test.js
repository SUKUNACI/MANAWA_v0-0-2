'use strict';
/**
 * Tests for config/connection-pool.js
 */

describe('connection-pool config', () => {
  let poolConfig;

  beforeEach(() => {
    jest.resetModules();
  });

  describe('getPoolConfig', () => {
    it('lève une erreur si DATABASE_URL est absent', () => {
      const savedUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      expect(() => pool.getPoolConfig()).toThrow('DATABASE_URL not configured');
      process.env.DATABASE_URL = savedUrl;
    });

    it('retourne un objet url + pool en mode dev', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'test';
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.getPoolConfig();
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('pool');
      expect(typeof result.url).toBe('string');
      expect(result.url).toContain('connection_limit=');
    });

    it('utilise la configuration production quand NODE_ENV=production', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.getPoolConfig();
      expect(result.pool.min).toBe(10);
      expect(result.pool.max).toBe(30);
      process.env.NODE_ENV = 'test';
    });

    it('utilise la configuration dev quand NODE_ENV=development', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.getPoolConfig();
      expect(result.pool.min).toBe(2);
      expect(result.pool.max).toBe(5);
      process.env.NODE_ENV = 'test';
    });
  });

  describe('getReadReplicaPoolConfig', () => {
    it('retourne null si DATABASE_REPLICA_URLS est absent', () => {
      delete process.env.DATABASE_REPLICA_URLS;
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.getReadReplicaPoolConfig();
      expect(result).toBeNull();
    });

    it('retourne la config du replica si l\'URL est présente', () => {
      process.env.DATABASE_REPLICA_URLS = 'postgresql://user:pass@replica:5432/testdb';
      process.env.NODE_ENV = 'test';
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.getReadReplicaPoolConfig();
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('pool');
      delete process.env.DATABASE_REPLICA_URLS;
    });

    it('utilise plus de connexions en production pour les replicas', () => {
      process.env.DATABASE_REPLICA_URLS = 'postgresql://user:pass@replica:5432/testdb';
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.getReadReplicaPoolConfig();
      expect(result.pool.max).toBe(50);
      delete process.env.DATABASE_REPLICA_URLS;
      process.env.NODE_ENV = 'test';
    });
  });

  describe('getPoolRecommendations', () => {
    it('retourne les recommandations pour chaque env', () => {
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const recs = pool.getPoolRecommendations();
      expect(recs).toHaveProperty('production');
      expect(recs).toHaveProperty('development');
      expect(recs).toHaveProperty('testing');
    });

    it('la config production a minPoolSize et maxPoolSize', () => {
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const recs = pool.getPoolRecommendations();
      expect(recs.production.minPoolSize).toBe(10);
      expect(recs.production.maxPoolSize).toBe(30);
    });
  });

  describe('calculateOptimalPoolSize', () => {
    it('calcule une taille optimale pour un QPS donné', () => {
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.calculateOptimalPoolSize(100, 50);
      expect(result).toHaveProperty('queriesPerSecond', 100);
      expect(result).toHaveProperty('avgQueryTimeMs', 50);
      expect(result).toHaveProperty('calculatedSize');
      expect(result).toHaveProperty('formula');
      expect(typeof result.calculatedSize).toBe('number');
    });

    it('la taille calculée est au minimum 2', () => {
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.calculateOptimalPoolSize(1, 1);
      expect(result.calculatedSize).toBeGreaterThanOrEqual(2);
    });

    it('la taille calculée ne dépasse pas 50', () => {
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.calculateOptimalPoolSize(10000, 100);
      expect(result.calculatedSize).toBeLessThanOrEqual(50);
    });

    it('utilise les valeurs par défaut pour avgQueryTimeMs et buffer', () => {
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const result = pool.calculateOptimalPoolSize(50);
      expect(result).toHaveProperty('calculatedSize');
    });
  });

  describe('getHealthCheckQuery', () => {
    it('retourne une chaîne SQL', () => {
      jest.resetModules();
      const pool = require('../../config/connection-pool');
      const sql = pool.getHealthCheckQuery();
      expect(typeof sql).toBe('string');
      expect(sql).toContain('pg_stat_activity');
    });
  });
});
