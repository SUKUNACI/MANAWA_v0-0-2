'use strict';
/**
 * Tests for config/scaling.js
 */

describe('scaling config', () => {
  let scaling;

  beforeEach(() => {
    jest.resetModules();
    scaling = require('../../config/scaling');
  });

  describe('exports', () => {
    it('exporte getEcosystemConfig', () => {
      expect(typeof scaling.getEcosystemConfig).toBe('function');
    });

    it('exporte healthCheckConfig', () => {
      expect(scaling.healthCheckConfig).toBeDefined();
      expect(typeof scaling.healthCheckConfig).toBe('object');
    });

    it('exporte GracefulShutdown', () => {
      expect(typeof scaling.GracefulShutdown).toBe('function');
    });

    it('exporte WorkerManager', () => {
      expect(typeof scaling.WorkerManager).toBe('function');
    });

    it('exporte sessionAffinityConfig', () => {
      expect(scaling.sessionAffinityConfig).toBeDefined();
    });

    it('exporte numWorkers', () => {
      expect(typeof scaling.numWorkers).toBe('number');
      expect(scaling.numWorkers).toBeGreaterThan(0);
    });
  });

  describe('getEcosystemConfig', () => {
    it('retourne la config PM2', () => {
      const config = scaling.getEcosystemConfig();
      expect(config).toHaveProperty('apps');
      expect(Array.isArray(config.apps)).toBe(true);
      expect(config.apps.length).toBeGreaterThan(0);
    });

    it('la première app a les propriétés requises', () => {
      const { apps } = scaling.getEcosystemConfig();
      const app = apps[0];
      expect(app.name).toBe('manawa-api');
      expect(app.exec_mode).toBe('cluster');
      expect(app.autorestart).toBe(true);
    });
  });

  describe('healthCheckConfig', () => {
    it('a un endpoint de health check', () => {
      expect(scaling.healthCheckConfig.endpoint).toBe('/api/health');
    });

    it('a les seuils healthy/unhealthy', () => {
      expect(scaling.healthCheckConfig.unhealthyThreshold).toBe(3);
      expect(scaling.healthCheckConfig.healthyThreshold).toBe(2);
    });

    it('a un timeout et intervalle définis', () => {
      expect(typeof scaling.healthCheckConfig.timeout).toBe('number');
      expect(typeof scaling.healthCheckConfig.interval).toBe('number');
    });
  });

  describe('GracefulShutdown', () => {
    it('peut être instancié avec un faux server', () => {
      const mockServer = {
        on: jest.fn(),
        close: jest.fn(),
      };
      const shutdown = new scaling.GracefulShutdown(mockServer);
      expect(shutdown).toBeDefined();
      expect(shutdown.isShuttingDown).toBe(false);
    });

    it('initialize attache les handlers', () => {
      const mockServer = {
        on: jest.fn(),
        close: jest.fn(),
      };
      const shutdown = new scaling.GracefulShutdown(mockServer);
      shutdown.initialize();
      expect(mockServer.on).toHaveBeenCalledWith('request', expect.any(Function));
    });

    it('getStats retourne les stats courantes', () => {
      const mockServer = { on: jest.fn(), close: jest.fn() };
      const shutdown = new scaling.GracefulShutdown(mockServer);
      const stats = shutdown.getStats();
      expect(stats).toHaveProperty('activeConnections', 0);
      expect(stats).toHaveProperty('isShuttingDown', false);
    });

    it('shutdown ne s\'exécute pas deux fois', async () => {
      const mockServer = {
        on: jest.fn(),
        close: jest.fn(),
      };
      const mockLogger = { info: jest.fn(), warn: jest.fn() };
      const shutdown = new scaling.GracefulShutdown(mockServer, { logger: mockLogger, timeout: 100 });
      shutdown.isShuttingDown = true;
      await shutdown.shutdown('SIGTERM');
      expect(mockServer.close).not.toHaveBeenCalled();
    });

    it('utilise le timeout par défaut de 30000ms', () => {
      const mockServer = { on: jest.fn(), close: jest.fn() };
      const shutdown = new scaling.GracefulShutdown(mockServer);
      expect(shutdown.options.timeout).toBe(30000);
    });
  });

  describe('WorkerManager', () => {
    it('peut être instancié', () => {
      const manager = new scaling.WorkerManager();
      expect(manager).toBeDefined();
    });

    it('getWorkerInfo retourne les infos du worker', () => {
      const manager = new scaling.WorkerManager();
      const info = manager.getWorkerInfo();
      expect(info).toHaveProperty('pid');
      expect(info).toHaveProperty('uptime');
      expect(info).toHaveProperty('memory');
      expect(info).toHaveProperty('cpus');
    });

    it('getConfig retourne la configuration', () => {
      const manager = new scaling.WorkerManager();
      const cfg = manager.getConfig();
      expect(cfg).toHaveProperty('numWorkers');
      expect(cfg).toHaveProperty('nodeVersion');
      expect(cfg).toHaveProperty('platform');
    });
  });

  describe('sessionAffinityConfig', () => {
    it('a les bonnes propriétés', () => {
      const { sessionAffinityConfig } = scaling;
      expect(sessionAffinityConfig).toHaveProperty('cookieName');
      expect(sessionAffinityConfig).toHaveProperty('ttl');
      expect(sessionAffinityConfig).toHaveProperty('hashAlgorithm');
    });
  });
});
