'use strict';
/**
 * Tests for config/notification-batching.js
 */

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ sent: true }),
}));

describe('notification-batching', () => {
  let batching;
  let pushMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../config/pushNotifications', () => ({
      sendPushNotification: jest.fn().mockResolvedValue({ sent: true }),
    }));
    batching = require('../../config/notification-batching');
    pushMock = require('../../config/pushNotifications');
  });

  describe('exports', () => {
    it('exporte les fonctions nécessaires', () => {
      expect(typeof batching.sendNotificationsBatch).toBe('function');
      expect(typeof batching.sendToMultipleWithBatching).toBe('function');
      expect(typeof batching.createBatches).toBe('function');
      expect(typeof batching.processBatch).toBe('function');
      expect(typeof batching.sendSingleNotification).toBe('function');
      expect(typeof batching.aggregateResults).toBe('function');
    });

    it('exporte BATCH_CONFIG', () => {
      expect(batching.BATCH_CONFIG).toBeDefined();
      expect(batching.BATCH_CONFIG.BATCH_SIZE).toBe(100);
      expect(batching.BATCH_CONFIG.MAX_CONCURRENT_BATCHES).toBe(5);
    });
  });

  describe('createBatches', () => {
    it('divise un tableau en batches de la taille donnée', () => {
      const items = Array.from({ length: 250 }, (_, i) => i);
      const batches = batching.createBatches(items, 100);
      expect(batches.length).toBe(3);
      expect(batches[0].length).toBe(100);
      expect(batches[1].length).toBe(100);
      expect(batches[2].length).toBe(50);
    });

    it('retourne un seul batch si items < batchSize', () => {
      const items = [1, 2, 3];
      const batches = batching.createBatches(items, 100);
      expect(batches.length).toBe(1);
      expect(batches[0]).toEqual([1, 2, 3]);
    });

    it('retourne un tableau vide si items est vide', () => {
      const batches = batching.createBatches([], 100);
      expect(batches).toEqual([]);
    });

    it('gère un batchSize de 1', () => {
      const items = [1, 2, 3];
      const batches = batching.createBatches(items, 1);
      expect(batches.length).toBe(3);
    });
  });

  describe('aggregateResults', () => {
    it('agrège les résultats de plusieurs batches', () => {
      const batchResults = [
        { batchNum: 1, sent: 10, failed: 2, total: 12, duration: 100, details: [] },
        { batchNum: 2, sent: 8, failed: 4, total: 12, duration: 150, details: [] },
      ];
      const summary = batching.aggregateResults(batchResults);
      expect(summary.sent).toBe(18);
      expect(summary.failed).toBe(6);
      expect(summary.total).toBe(24);
      expect(summary.batchCount).toBe(2);
    });

    it('retourne des zéros pour un tableau vide', () => {
      const summary = batching.aggregateResults([]);
      expect(summary.sent).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.total).toBe(0);
    });
  });

  describe('sendSingleNotification', () => {
    it('appelle pushNotifications.sendPushNotification', async () => {
      const notif = { userId: 'user1', title: 'Test', body: 'Body', data: {} };
      const result = await batching.sendSingleNotification(notif);
      expect(pushMock.sendPushNotification).toHaveBeenCalledWith('user1', 'Test', 'Body', {});
      expect(result.userId).toBe('user1');
    });

    it('retourne success: true si sent=true', async () => {
      pushMock.sendPushNotification.mockResolvedValueOnce({ sent: true });
      const result = await batching.sendSingleNotification({ userId: 'u1', title: 'T', body: 'B' });
      expect(result.success).toBe(true);
    });

    it('retourne success: false si sent=false', async () => {
      pushMock.sendPushNotification.mockResolvedValueOnce({ sent: false });
      const result = await batching.sendSingleNotification({ userId: 'u1', title: 'T', body: 'B' });
      expect(result.success).toBe(false);
    });

    it('gère les erreurs et retourne success: false', async () => {
      pushMock.sendPushNotification.mockRejectedValueOnce(new Error('Push failed'));
      const result = await batching.sendSingleNotification({ userId: 'u1', title: 'T', body: 'B' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('utilise data={} par défaut si non fourni', async () => {
      const notif = { userId: 'u1', title: 'T', body: 'B' };
      await batching.sendSingleNotification(notif);
      expect(pushMock.sendPushNotification).toHaveBeenCalledWith('u1', 'T', 'B', {});
    });
  });

  describe('processBatch', () => {
    it('traite un batch et retourne les stats', async () => {
      pushMock.sendPushNotification.mockResolvedValue({ sent: true });
      const batch = [
        { userId: 'u1', title: 'T', body: 'B' },
        { userId: 'u2', title: 'T', body: 'B' },
      ];
      const result = await batching.processBatch(batch, 1, 1);
      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
    });

    it('compte les échecs correctement', async () => {
      pushMock.sendPushNotification
        .mockResolvedValueOnce({ sent: true })
        .mockResolvedValueOnce({ sent: false });
      const batch = [
        { userId: 'u1', title: 'T', body: 'B' },
        { userId: 'u2', title: 'T', body: 'B' },
      ];
      const result = await batching.processBatch(batch, 1, 1);
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('sendNotificationsBatch', () => {
    it('retourne {sent:0, failed:0, total:0} si tableau vide', async () => {
      const result = await batching.sendNotificationsBatch([]);
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(0);
    });

    it('retourne le résultat avec le total correct', async () => {
      pushMock.sendPushNotification.mockResolvedValue({ sent: true });
      const notifications = Array.from({ length: 5 }, (_, i) => ({
        userId: `user${i}`,
        title: 'T',
        body: 'B',
      }));
      const result = await batching.sendNotificationsBatch(notifications);
      expect(result.total).toBe(5);
      expect(result.sent).toBe(5);
    });

    it('gère les notifications null/undefined', async () => {
      const result = await batching.sendNotificationsBatch(null);
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('sendToMultipleWithBatching', () => {
    it('envoie à plusieurs utilisateurs', async () => {
      pushMock.sendPushNotification.mockResolvedValue({ sent: true });
      const userIds = ['u1', 'u2', 'u3'];
      const result = await batching.sendToMultipleWithBatching(userIds, 'Title', 'Body', {});
      expect(result.total).toBe(3);
    });
  });
});
