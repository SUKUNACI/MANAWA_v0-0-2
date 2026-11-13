'use strict';
/**
 * Tests for config/query-timeout.js
 */

describe('query-timeout config', () => {
  let queryTimeout;

  beforeEach(() => {
    jest.resetModules();
    queryTimeout = require('../../config/query-timeout');
  });

  describe('getQueryTimeouts', () => {
    it('retourne les configurations de timeout', () => {
      const timeouts = queryTimeout.getQueryTimeouts();
      expect(timeouts).toHaveProperty('default');
      expect(timeouts).toHaveProperty('interactive');
      expect(timeouts).toHaveProperty('batch');
      expect(timeouts).toHaveProperty('analytics');
      expect(timeouts).toHaveProperty('readReplica');
    });

    it('chaque timeout a milliseconds et seconds cohérents', () => {
      const timeouts = queryTimeout.getQueryTimeouts();
      for (const key of Object.keys(timeouts)) {
        const t = timeouts[key];
        expect(t.milliseconds).toBe(t.seconds * 1000);
      }
    });

    it('le timeout par défaut est 30 secondes', () => {
      const { default: def } = queryTimeout.getQueryTimeouts();
      expect(def.milliseconds).toBe(30000);
      expect(def.seconds).toBe(30);
    });

    it('le timeout interactif est 5 secondes', () => {
      const { interactive } = queryTimeout.getQueryTimeouts();
      expect(interactive.milliseconds).toBe(5000);
    });

    it('le timeout batch est 120 secondes', () => {
      const { batch } = queryTimeout.getQueryTimeouts();
      expect(batch.milliseconds).toBe(120000);
    });
  });

  describe('getLockTimeouts', () => {
    it('retourne les timeouts de verrous', () => {
      const locks = queryTimeout.getLockTimeouts();
      expect(locks).toHaveProperty('rowLock');
      expect(locks).toHaveProperty('statementLock');
      expect(locks).toHaveProperty('transactionLock');
      expect(locks).toHaveProperty('deadlockDetection');
    });

    it('chaque verrou a une commande SQL', () => {
      const locks = queryTimeout.getLockTimeouts();
      for (const key of Object.keys(locks)) {
        expect(typeof locks[key].sql).toBe('string');
        expect(locks[key].sql.length).toBeGreaterThan(0);
      }
    });

    it('le deadlock timeout est 1 seconde', () => {
      const { deadlockDetection } = queryTimeout.getLockTimeouts();
      expect(deadlockDetection.milliseconds).toBe(1000);
    });
  });

  describe('getTransactionTimeouts', () => {
    it('retourne les timeouts de transactions', () => {
      const txTimeouts = queryTimeout.getTransactionTimeouts();
      expect(txTimeouts).toHaveProperty('default');
      expect(txTimeouts).toHaveProperty('quick');
      expect(txTimeouts).toHaveProperty('longRunning');
    });

    it('les transactions longues ont un timeout de 300s', () => {
      const { longRunning } = queryTimeout.getTransactionTimeouts();
      expect(longRunning.seconds).toBe(300);
    });
  });

  describe('timeoutMiddleware', () => {
    it('retourne une fonction middleware', () => {
      const middleware = queryTimeout.timeoutMiddleware(5000);
      expect(typeof middleware).toBe('function');
    });

    it('le middleware attache queryTimeout à req', () => {
      const middleware = queryTimeout.timeoutMiddleware(5000);
      const req = {};
      const res = { setTimeout: jest.fn() };
      const next = jest.fn();
      middleware(req, res, next);
      expect(req.queryTimeout).toBe(5000);
      expect(req.queryTimeoutSeconds).toBe(5);
      expect(next).toHaveBeenCalled();
    });

    it('le middleware configure un timeout sur la réponse', () => {
      const middleware = queryTimeout.timeoutMiddleware(10000);
      const req = {};
      const res = { setTimeout: jest.fn() };
      const next = jest.fn();
      middleware(req, res, next);
      expect(res.setTimeout).toHaveBeenCalledWith(15000, expect.any(Function));
    });

    it('la callback de timeout retourne 408', () => {
      const middleware = queryTimeout.timeoutMiddleware(5000);
      const req = { queryTimeoutSeconds: 5 };
      let timeoutCallback;
      const res = {
        setTimeout: jest.fn((_, cb) => { timeoutCallback = cb; }),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();
      middleware(req, res, next);
      timeoutCallback();
      expect(res.status).toHaveBeenCalledWith(408);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Request timeout' }));
    });

    it('utilise 30000ms par défaut', () => {
      const middleware = queryTimeout.timeoutMiddleware();
      const req = {};
      const res = { setTimeout: jest.fn() };
      const next = jest.fn();
      middleware(req, res, next);
      expect(req.queryTimeout).toBe(30000);
    });
  });

  describe('getTimeoutRecommendations', () => {
    it('retourne des recommandations pour différents types d\'opérations', () => {
      const recs = queryTimeout.getTimeoutRecommendations();
      expect(recs).toHaveProperty('User Authentication');
      expect(recs).toHaveProperty('Payment Processing');
      expect(recs).toHaveProperty('Analytics Query');
      expect(recs).toHaveProperty('Data Migration');
    });

    it('chaque recommandation a query_timeout et lock_timeout', () => {
      const recs = queryTimeout.getTimeoutRecommendations();
      for (const key of Object.keys(recs)) {
        expect(recs[key]).toHaveProperty('query_timeout');
        expect(recs[key]).toHaveProperty('lock_timeout');
        expect(recs[key]).toHaveProperty('reason');
      }
    });
  });

  describe('getTimeoutSetupSQL', () => {
    it('retourne le SQL de configuration des timeouts', () => {
      const sql = queryTimeout.getTimeoutSetupSQL(30000, 5000);
      expect(typeof sql).toBe('string');
      expect(sql).toContain('30000');
      expect(sql).toContain('5000');
    });

    it('utilise les valeurs par défaut', () => {
      const sql = queryTimeout.getTimeoutSetupSQL();
      expect(sql).toContain('statement_timeout');
      expect(sql).toContain('lock_timeout');
    });
  });

  describe('getDeadlockRecoveryStrategy', () => {
    it('retourne la stratégie de récupération des deadlocks', () => {
      const strategy = queryTimeout.getDeadlockRecoveryStrategy();
      expect(strategy).toHaveProperty('detection');
      expect(strategy).toHaveProperty('victim_selection');
      expect(strategy).toHaveProperty('retry_strategy');
      expect(strategy).toHaveProperty('prevention');
    });

    it('la retry_strategy a les bonnes propriétés', () => {
      const { retry_strategy } = queryTimeout.getDeadlockRecoveryStrategy();
      expect(retry_strategy).toHaveProperty('max_retries');
      expect(retry_strategy).toHaveProperty('initial_backoff_ms');
      expect(retry_strategy.max_retries).toBe(3);
    });

    it('prevention est un tableau de stratégies', () => {
      const { prevention } = queryTimeout.getDeadlockRecoveryStrategy();
      expect(Array.isArray(prevention)).toBe(true);
      expect(prevention.length).toBeGreaterThan(0);
    });
  });
});
