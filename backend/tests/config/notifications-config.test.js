'use strict';
/**
 * Tests for config/notifications-config.js
 */

describe('notifications-config', () => {
  let notifConfig;

  beforeEach(() => {
    jest.resetModules();
    notifConfig = require('../../config/notifications-config');
  });

  describe('exports', () => {
    it('exporte config, validateConfig, logConfig', () => {
      expect(notifConfig.config).toBeDefined();
      expect(typeof notifConfig.validateConfig).toBe('function');
      expect(typeof notifConfig.logConfig).toBe('function');
    });
  });

  describe('config.features', () => {
    it('a toutes les features attendues', () => {
      const { features } = notifConfig.config;
      expect(features.deduplication).toBe(true);
      expect(features.batching).toBe(true);
      expect(features.fallback).toBe(true);
      expect(features.preferences).toBe(true);
      expect(features.templates).toBe(true);
      expect(features.multiLanguage).toBe(true);
      expect(features.archival).toBe(true);
    });
  });

  describe('config.deduplication', () => {
    it('a les bonnes propriétés', () => {
      const { deduplication } = notifConfig.config;
      expect(deduplication.enabled).toBe(true);
      expect(typeof deduplication.windowMs).toBe('number');
      expect(typeof deduplication.ttlSeconds).toBe('number');
    });

    it('windowMs par défaut est 5000', () => {
      expect(notifConfig.config.deduplication.windowMs).toBe(5000);
    });
  });

  describe('config.batching', () => {
    it('a les bonnes propriétés', () => {
      const { batching } = notifConfig.config;
      expect(batching.enabled).toBe(true);
      expect(typeof batching.batchSize).toBe('number');
      expect(typeof batching.maxConcurrentBatches).toBe('number');
    });

    it('batchSize par défaut est 100', () => {
      expect(notifConfig.config.batching.batchSize).toBe(100);
    });
  });

  describe('config.fallback', () => {
    it('a la config de retry pour chaque canal', () => {
      const { fallback } = notifConfig.config;
      expect(fallback.enabled).toBe(true);
      expect(fallback.retryConfig).toHaveProperty('fcm');
      expect(fallback.retryConfig).toHaveProperty('expo');
      expect(fallback.retryConfig).toHaveProperty('email');
    });

    it('les retries FCM ont attempts et delayMs', () => {
      const { fcm } = notifConfig.config.fallback.retryConfig;
      expect(typeof fcm.attempts).toBe('number');
      expect(typeof fcm.delayMs).toBe('number');
    });
  });

  describe('config.preferences', () => {
    it('a les types de notifications', () => {
      const { preferences } = notifConfig.config;
      expect(Array.isArray(preferences.notificationTypes)).toBe(true);
      expect(preferences.notificationTypes.length).toBeGreaterThan(0);
      expect(preferences.notificationTypes).toContain('ORDER_CONFIRMED');
      expect(preferences.notificationTypes).toContain('PAYMENT_RECEIVED');
    });

    it('a les canaux de notification', () => {
      expect(notifConfig.config.preferences.channels).toContain('email');
      expect(notifConfig.config.preferences.channels).toContain('push');
    });
  });

  describe('config.multiLanguage', () => {
    it('a les langues supportées', () => {
      const { multiLanguage } = notifConfig.config;
      expect(multiLanguage.languages).toContain('fr');
      expect(multiLanguage.languages).toContain('en');
      expect(typeof multiLanguage.defaultLanguage).toBe('string');
    });
  });

  describe('config.templates', () => {
    it('a la configuration de cache', () => {
      const { templates } = notifConfig.config;
      expect(templates.enabled).toBe(true);
      expect(typeof templates.cacheEnabled).toBe('boolean');
      expect(typeof templates.cacheTtlSeconds).toBe('number');
    });
  });

  describe('validateConfig', () => {
    it('retourne la config si elle est valide', () => {
      const result = notifConfig.validateConfig();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('features');
    });

    it('lève une erreur si batchSize < 10', () => {
      jest.resetModules();
      process.env.NOTIFICATION_BATCH_SIZE = '5';
      const cfg = require('../../config/notifications-config');
      expect(() => cfg.validateConfig()).toThrow('Invalid notification configuration');
      delete process.env.NOTIFICATION_BATCH_SIZE;
    });

    it('lève une erreur si maxConcurrentBatches < 1', () => {
      jest.resetModules();
      process.env.NOTIFICATION_MAX_CONCURRENT_BATCHES = '0';
      const cfg = require('../../config/notifications-config');
      expect(() => cfg.validateConfig()).toThrow('Invalid notification configuration');
      delete process.env.NOTIFICATION_MAX_CONCURRENT_BATCHES;
    });

    it('lève une erreur si la langue par défaut n\'est pas dans la liste', () => {
      jest.resetModules();
      process.env.NOTIFICATION_DEFAULT_LANGUAGE = 'zh';
      const cfg = require('../../config/notifications-config');
      expect(() => cfg.validateConfig()).toThrow('Invalid notification configuration');
      delete process.env.NOTIFICATION_DEFAULT_LANGUAGE;
    });
  });

  describe('logConfig', () => {
    it('ne logue rien si verbose est false', () => {
      // Par défaut verbose est false, logConfig ne fait rien
      expect(() => notifConfig.logConfig()).not.toThrow();
    });

    it('fonctionne quand verbose est true', () => {
      jest.resetModules();
      process.env.NOTIFICATION_VERBOSE_LOGGING = 'true';
      const cfg = require('../../config/notifications-config');
      expect(() => cfg.logConfig()).not.toThrow();
      delete process.env.NOTIFICATION_VERBOSE_LOGGING;
    });
  });
});
