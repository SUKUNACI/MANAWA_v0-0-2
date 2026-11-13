'use strict';
/**
 * Tests for config/pushNotifications.js
 *
 * Note: setup.js globally mocks pushNotifications with jest.mock() (hoisted).
 * We bypass this using jest.isolateModules() inside each test.
 * All variables used inside jest.mock() factories MUST be prefixed with "mock".
 */

describe('pushNotifications config', () => {
  describe('detectTokenType', () => {
    it('détecte les tokens Expo', () => {
      let detectTokenType;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        detectTokenType = require('../../config/pushNotifications').detectTokenType;
      });
      expect(detectTokenType('ExponentPushToken[abc123]')).toBe('EXPO');
    });

    it('détecte les tokens APNs (64 hex chars)', () => {
      let detectTokenType;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        detectTokenType = require('../../config/pushNotifications').detectTokenType;
      });
      expect(detectTokenType('a1b2c3d4'.repeat(8))).toBe('APNs');
    });

    it('détecte les tokens FCM (>100 chars non-hex)', () => {
      let detectTokenType;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        detectTokenType = require('../../config/pushNotifications').detectTokenType;
      });
      expect(detectTokenType('fcm_prefix_' + 'x'.repeat(100))).toBe('FCM');
    });

    it('retourne null pour un token court', () => {
      let detectTokenType;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        detectTokenType = require('../../config/pushNotifications').detectTokenType;
      });
      expect(detectTokenType('short')).toBeNull();
    });

    it('retourne null pour 64 chars non-hex', () => {
      let detectTokenType;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        detectTokenType = require('../../config/pushNotifications').detectTokenType;
      });
      expect(detectTokenType('g'.repeat(64))).toBeNull();
    });
  });

  describe('sendViaFCM', () => {
    it('retourne null si messaging est null', async () => {
      let sendViaFCM, setMessaging;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        const mod = require('../../config/pushNotifications');
        sendViaFCM = mod.sendViaFCM;
        setMessaging = mod.setMessaging;
      });
      setMessaging(null);
      const result = await sendViaFCM('token', 'Title', 'Body', {});
      expect(result).toBeNull();
    });

    it('retourne sent:true si messaging.send réussit', async () => {
      let sendViaFCM, setMessaging;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        const mod = require('../../config/pushNotifications');
        sendViaFCM = mod.sendViaFCM;
        setMessaging = mod.setMessaging;
      });
      const mockSend = jest.fn().mockResolvedValue('msg-id');
      setMessaging({ send: mockSend });
      const result = await sendViaFCM('token', 'Hello', 'World', {});
      expect(result).toHaveProperty('sent', true);
      expect(result).toHaveProperty('type', 'FCM');
    });

    it('retourne null si messaging.send échoue', async () => {
      let sendViaFCM, setMessaging;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        const mod = require('../../config/pushNotifications');
        sendViaFCM = mod.sendViaFCM;
        setMessaging = mod.setMessaging;
      });
      setMessaging({ send: jest.fn().mockRejectedValue(new Error('fail')) });
      const result = await sendViaFCM('token', 'T', 'B', {});
      expect(result).toBeNull();
    });
  });

  describe('sendViaExpo', () => {
    it('appelle l\'API Expo et retourne sent:true', async () => {
      let sendViaExpo;
      const mockPost = jest.fn().mockResolvedValue({ data: { data: [{ status: 'ok' }] } });
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: mockPost }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        sendViaExpo = require('../../config/pushNotifications').sendViaExpo;
      });
      const result = await sendViaExpo('ExponentPushToken[test]', 'Title', 'Body', {});
      expect(result).toHaveProperty('sent', true);
      expect(result).toHaveProperty('type', 'EXPO');
    });

    it('retourne null si axios throw', async () => {
      let sendViaExpo;
      const mockFailPost = jest.fn().mockRejectedValue(new Error('Network'));
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: mockFailPost }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        sendViaExpo = require('../../config/pushNotifications').sendViaExpo;
      });
      const result = await sendViaExpo('ExponentPushToken[test]', 'T', 'B', {});
      expect(result).toBeNull();
    });
  });

  describe('sendPushNotification', () => {
    it('retourne sent:false si notification dupliquée', async () => {
      let sendPushNotification;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: true, marked: false }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        sendPushNotification = require('../../config/pushNotifications').sendPushNotification;
      });
      const result = await sendPushNotification('user1', 'T', 'B', {});
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('duplicate');
    });

    it('retourne sent:false si aucun token et pas d\'email', async () => {
      let sendPushNotification;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        const mockDb = require('../../config/__mocks__/db');
        mockDb.pushToken.findMany.mockResolvedValue([]);
        mockDb.user.findUnique.mockResolvedValue(null);
        jest.mock('../../config/db', () => mockDb);
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        sendPushNotification = require('../../config/pushNotifications').sendPushNotification;
      });
      const result = await sendPushNotification('user1', 'T', 'B', {});
      expect(result.sent).toBe(false);
    });

    it('utilise email fallback si aucun token mais user a email', async () => {
      let sendPushNotification;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        const mockDb = require('../../config/__mocks__/db');
        mockDb.pushToken.findMany.mockResolvedValue([]);
        mockDb.user.findUnique.mockResolvedValue({ email: 'u@test.com' });
        jest.mock('../../config/db', () => mockDb);
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn().mockResolvedValue(undefined) }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        sendPushNotification = require('../../config/pushNotifications').sendPushNotification;
      });
      const result = await sendPushNotification('user1', 'T', 'B', {});
      expect(result.method).toBe('EMAIL_FALLBACK');
    });

    it('retourne sent:false en cas d\'erreur DB', async () => {
      let sendPushNotification;
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        const mockDb = require('../../config/__mocks__/db');
        mockDb.pushToken.findMany.mockRejectedValue(new Error('DB down'));
        jest.mock('../../config/db', () => mockDb);
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({
          sendNotificationsBatch: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
        }));
        sendPushNotification = require('../../config/pushNotifications').sendPushNotification;
      });
      const result = await sendPushNotification('user1', 'T', 'B', {});
      expect(result.sent).toBe(false);
    });
  });

  describe('sendPushToMultiple', () => {
    it('délègue à sendNotificationsBatch', async () => {
      let sendPushToMultiple;
      const mockBatchFn = jest.fn().mockResolvedValue({ sent: 3, failed: 0, total: 3 });
      jest.isolateModules(() => {
        jest.mock('axios', () => ({ post: jest.fn() }));
        jest.mock('../../config/db', () => require('../../config/__mocks__/db'));
        jest.mock('../../utils/notification-deduplication', () => ({
          checkAndMark: jest.fn().mockResolvedValue({ isDuplicate: false, marked: true }),
        }));
        jest.mock('../../config/push-notification-fallback', () => ({ sendEmailFallback: jest.fn() }));
        jest.mock('../../config/notification-batching', () => ({ sendNotificationsBatch: mockBatchFn }));
        sendPushToMultiple = require('../../config/pushNotifications').sendPushToMultiple;
      });
      const result = await sendPushToMultiple(['u1', 'u2', 'u3'], 'T', 'B', {});
      expect(result).toHaveProperty('total', 3);
      expect(mockBatchFn).toHaveBeenCalled();
    });
  });
});
