'use strict';
/**
 * Tests for config/pushNotifications.js
 *
 * Note: setup.js globally mocks the entire pushNotifications module.
 * These tests verify the module structure and pure functions only.
 */

describe('pushNotifications config', () => {
  const pushNotifs = require('../../config/pushNotifications');

  describe('module exports', () => {
    it('exporte setMessaging', () => {
      expect(typeof pushNotifs.setMessaging).toBe('function');
    });

    it('exporte sendPushNotification', () => {
      expect(typeof pushNotifs.sendPushNotification).toBe('function');
    });

    it('exporte sendPushToMultiple', () => {
      expect(typeof pushNotifs.sendPushToMultiple).toBe('function');
    });

    it('exporte sendViaFCM', () => {
      expect(typeof pushNotifs.sendViaFCM).toBe('function');
    });

    it('exporte sendViaExpo', () => {
      expect(typeof pushNotifs.sendViaExpo).toBe('function');
    });

    it('exporte detectTokenType', () => {
      expect(typeof pushNotifs.detectTokenType).toBe('function');
    });
  });

  describe('detectTokenType (pure function)', () => {
    const { detectTokenType } = pushNotifs;

    it('détecte les tokens Expo', () => {
      expect(detectTokenType('ExponentPushToken[abc123]')).toBe('EXPO');
    });

    it('détecte les tokens APNs (64 hex chars)', () => {
      expect(detectTokenType('a1b2c3d4'.repeat(8))).toBe('APNs');
    });

    it('détecte les tokens FCM (>100 chars non-hex)', () => {
      expect(detectTokenType('fcm_prefix_' + 'x'.repeat(100))).toBe('FCM');
    });

    it('retourne null pour un token court', () => {
      expect(detectTokenType('short')).toBeNull();
    });

    it('retourne null pour 64 chars non-hex', () => {
      expect(detectTokenType('g'.repeat(64))).toBeNull();
    });
  });

  describe('mocked functions (from setup.js)', () => {
    it('sendPushNotification est mockée et fonctionnelle', async () => {
      const result = await pushNotifs.sendPushNotification('user1', 'Test', 'Body', {});
      expect(result).toHaveProperty('sent');
    });

    it('sendPushToMultiple est mockée et retourne un objet', async () => {
      const result = await pushNotifs.sendPushToMultiple(['u1', 'u2'], 'T', 'B', {});
      expect(typeof result).toBe('object');
    });

    it('sendViaFCM est mockée et retourne null par défaut', async () => {
      const result = await pushNotifs.sendViaFCM('token', 'T', 'B', {});
      expect(result).toBeNull();
    });

    it('sendViaExpo est mockée et retourne null par défaut', async () => {
      const result = await pushNotifs.sendViaExpo('ExponentPushToken[test]', 'T', 'B', {});
      expect(result).toBeNull();
    });

    it('setMessaging est mockée', () => {
      expect(() => pushNotifs.setMessaging(null)).not.toThrow();
    });
  });
});
