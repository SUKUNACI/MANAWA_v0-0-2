'use strict';
/**
 * Tests for config/monitoring-config.js
 */

describe('monitoring-config', () => {
  let config;

  beforeEach(() => {
    jest.resetModules();
    config = require('../../config/monitoring-config');
  });

  describe('structure générale', () => {
    it('exporte un objet de configuration', () => {
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('a toutes les sections requises', () => {
      expect(config).toHaveProperty('alertThresholds');
      expect(config).toHaveProperty('metricsRetention');
      expect(config).toHaveProperty('alertDestinations');
      expect(config).toHaveProperty('metricsExport');
      expect(config).toHaveProperty('middleware');
      expect(config).toHaveProperty('features');
      expect(config).toHaveProperty('logging');
    });
  });

  describe('alertThresholds', () => {
    it('a toutes les métriques d\'alertes', () => {
      const { alertThresholds } = config;
      expect(alertThresholds).toHaveProperty('errorRate');
      expect(alertThresholds).toHaveProperty('apiResponseTime');
      expect(alertThresholds).toHaveProperty('dbConnectionPoolUsage');
      expect(alertThresholds).toHaveProperty('paymentFailureRate');
      expect(alertThresholds).toHaveProperty('queueDepth');
      expect(alertThresholds).toHaveProperty('memoryUsage');
      expect(alertThresholds).toHaveProperty('cpuUsage');
    });

    it('les valeurs sont des nombres', () => {
      const { alertThresholds } = config;
      expect(typeof alertThresholds.errorRate).toBe('number');
      expect(typeof alertThresholds.apiResponseTime).toBe('number');
      expect(typeof alertThresholds.memoryUsage).toBe('number');
      expect(typeof alertThresholds.cpuUsage).toBe('number');
    });

    it('les valeurs par défaut sont correctes', () => {
      const { alertThresholds } = config;
      expect(alertThresholds.errorRate).toBe(5);
      expect(alertThresholds.apiResponseTime).toBe(2000);
      expect(alertThresholds.dbConnectionPoolUsage).toBe(80);
      expect(alertThresholds.paymentFailureRate).toBe(10);
      expect(alertThresholds.queueDepth).toBe(1000);
      expect(alertThresholds.memoryUsage).toBe(80);
      expect(alertThresholds.cpuUsage).toBe(90);
    });
  });

  describe('metricsRetention', () => {
    it('a les bonnes propriétés de rétention', () => {
      const { metricsRetention } = config;
      expect(metricsRetention).toHaveProperty('dailyMetricsReset');
      expect(metricsRetention).toHaveProperty('alertDeduplicationWindow');
      expect(metricsRetention).toHaveProperty('activeUsersTrackingWindow');
    });

    it('les valeurs sont correctes', () => {
      const { metricsRetention } = config;
      expect(metricsRetention.dailyMetricsReset).toBe(24 * 60 * 60 * 1000);
      expect(metricsRetention.alertDeduplicationWindow).toBe(5 * 60 * 1000);
      expect(metricsRetention.activeUsersTrackingWindow).toBe(60 * 60 * 1000);
    });
  });

  describe('alertDestinations', () => {
    it('a les trois canaux d\'alerte', () => {
      const { alertDestinations } = config;
      expect(alertDestinations).toHaveProperty('email');
      expect(alertDestinations).toHaveProperty('slack');
      expect(alertDestinations).toHaveProperty('logs');
    });

    it('la destination email a les bonnes propriétés', () => {
      const { email } = config.alertDestinations;
      expect(email).toHaveProperty('enabled');
      expect(email).toHaveProperty('recipients');
      expect(email).toHaveProperty('from');
      expect(Array.isArray(email.recipients)).toBe(true);
    });

    it('la destination slack a les bonnes propriétés', () => {
      const { slack } = config.alertDestinations;
      expect(slack).toHaveProperty('enabled');
      expect(slack).toHaveProperty('channel');
    });

    it('les logs sont toujours activés', () => {
      const { logs } = config.alertDestinations;
      expect(logs.enabled).toBe(true);
      expect(logs.level).toBe('warn');
    });
  });

  describe('metricsExport', () => {
    it('a les bonnes propriétés d\'export', () => {
      const { metricsExport } = config;
      expect(metricsExport.prometheusFormat).toBe(true);
      expect(metricsExport.includeBusiness).toBe(true);
      expect(metricsExport.includeSystem).toBe(true);
    });
  });

  describe('middleware', () => {
    it('le middleware est activé par défaut', () => {
      const { middleware } = config;
      expect(middleware.enabled).toBe(true);
      expect(middleware.recordAllRequests).toBe(true);
    });

    it('les chemins exclus sont définis', () => {
      const { excludePaths } = config.middleware;
      expect(Array.isArray(excludePaths)).toBe(true);
      expect(excludePaths.length).toBeGreaterThan(0);
      expect(excludePaths).toContain('/api/monitoring/health');
    });
  });

  describe('features', () => {
    it('les features sont activées par défaut', () => {
      const { features } = config;
      expect(features).toHaveProperty('enableAlerts');
      expect(features).toHaveProperty('enableMetrics');
      expect(features).toHaveProperty('enableDashboard');
    });

    it('les features sont des booléens', () => {
      const { features } = config;
      expect(typeof features.enableAlerts).toBe('boolean');
      expect(typeof features.enableMetrics).toBe('boolean');
      expect(typeof features.enableDashboard).toBe('boolean');
    });
  });

  describe('logging', () => {
    it('a les options de logging', () => {
      const { logging } = config;
      expect(logging).toHaveProperty('verbose');
      expect(logging).toHaveProperty('logMetricsCollection');
      expect(logging).toHaveProperty('logAlertTriggers');
    });

    it('logAlertTriggers est vrai par défaut', () => {
      expect(config.logging.logAlertTriggers).toBe(true);
    });
  });

  describe('variables d\'environnement', () => {
    it('les seuils peuvent être configurés via env vars', () => {
      jest.resetModules();
      process.env.ALERT_ERROR_RATE = '10';
      process.env.ALERT_CPU = '95';
      const cfg = require('../../config/monitoring-config');
      expect(cfg.alertThresholds.errorRate).toBe(10);
      expect(cfg.alertThresholds.cpuUsage).toBe(95);
      delete process.env.ALERT_ERROR_RATE;
      delete process.env.ALERT_CPU;
    });

    it('ENABLE_ALERTS=false désactive les alertes', () => {
      jest.resetModules();
      process.env.ENABLE_ALERTS = 'false';
      const cfg = require('../../config/monitoring-config');
      expect(cfg.features.enableAlerts).toBe(false);
      delete process.env.ENABLE_ALERTS;
    });

    it('ALERT_EMAIL active la destination email', () => {
      jest.resetModules();
      process.env.ALERT_EMAIL = 'admin@test.com,other@test.com';
      const cfg = require('../../config/monitoring-config');
      expect(cfg.alertDestinations.email.enabled).toBe(true);
      expect(cfg.alertDestinations.email.recipients).toContain('admin@test.com');
      delete process.env.ALERT_EMAIL;
    });
  });
});
