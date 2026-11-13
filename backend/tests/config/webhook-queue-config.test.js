'use strict';
/**
 * Tests for config/webhook-queue-config.js
 */

const mockQueueInstance = {
  on: jest.fn(),
  add: jest.fn().mockResolvedValue({ id: 'webhook-job-1', data: {} }),
  getJobCounts: jest.fn().mockResolvedValue({ active: 0, completed: 10, failed: 2, delayed: 0, waiting: 1, paused: 0 }),
  getFailed: jest.fn().mockResolvedValue([{ id: 'f1' }]),
  getDelayed: jest.fn().mockResolvedValue([]),
  getActive: jest.fn().mockResolvedValue([]),
  clean: jest.fn().mockResolvedValue([1, 2]),
};

jest.mock('bull', () => jest.fn().mockImplementation(() => mockQueueInstance));

describe('webhook-queue-config', () => {
  let wqc;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('bull', () => jest.fn().mockImplementation(() => mockQueueInstance));
    wqc = require('../../config/webhook-queue-config');
  });

  describe('exports', () => {
    it('exporte webhookQueue, webhookQueueConfig, setupWebhookQueueErrorHandlers', () => {
      expect(wqc.webhookQueue).toBeDefined();
      expect(wqc.webhookQueueConfig).toBeDefined();
      expect(typeof wqc.setupWebhookQueueErrorHandlers).toBe('function');
    });

    it('exporte addWebhookToQueue, getWebhookQueueStats, cleanOldWebhookJobs', () => {
      expect(typeof wqc.addWebhookToQueue).toBe('function');
      expect(typeof wqc.getWebhookQueueStats).toBe('function');
      expect(typeof wqc.cleanOldWebhookJobs).toBe('function');
    });
  });

  describe('webhookQueueConfig', () => {
    it('a la config Redis', () => {
      expect(wqc.webhookQueueConfig).toHaveProperty('redis');
      expect(wqc.webhookQueueConfig.redis).toHaveProperty('host');
      expect(wqc.webhookQueueConfig.redis).toHaveProperty('port');
    });

    it('a les settings de la queue', () => {
      expect(wqc.webhookQueueConfig).toHaveProperty('settings');
      expect(wqc.webhookQueueConfig.settings).toHaveProperty('maxRetries', 3);
      expect(wqc.webhookQueueConfig.settings).toHaveProperty('lockDuration', 30000);
    });

    it('FIFO est activé', () => {
      expect(wqc.webhookQueueConfig.settings.fifo).toBe(true);
    });

    it('la priorité est désactivée pour FIFO strict', () => {
      expect(wqc.webhookQueueConfig.settings.enablePriority).toBe(false);
    });
  });

  describe('setupWebhookQueueErrorHandlers', () => {
    it('enregistre les handlers d\'événements', () => {
      wqc.setupWebhookQueueErrorHandlers();
      expect(mockQueueInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockQueueInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockQueueInstance.on).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(mockQueueInstance.on).toHaveBeenCalledWith('stalled', expect.any(Function));
    });
  });

  describe('addWebhookToQueue', () => {
    it('ajoute un webhook à la queue', async () => {
      const webhookData = {
        webhookId: 'wh-001',
        event: 'payment.created',
        payload: { amount: 100 },
        signature: 'sig123',
        sequence: 1,
        idempotencyKey: 'key-001',
      };
      const job = await wqc.addWebhookToQueue(webhookData);
      expect(job).toBeDefined();
      expect(mockQueueInstance.add).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: 'wh-001',
          event: 'payment.created',
          sequence: 1,
        }),
        expect.objectContaining({
          attempts: 3,
          timeout: 30000,
          jobId: 'webhook-key-001',
        })
      );
    });

    it('utilise sequence=0 et idempotencyKey=null par défaut', async () => {
      const webhookData = {
        webhookId: 'wh-002',
        event: 'order.created',
        payload: {},
        signature: 'sig',
      };
      await wqc.addWebhookToQueue(webhookData);
      const addCall = mockQueueInstance.add.mock.calls[mockQueueInstance.add.mock.calls.length - 1];
      expect(addCall[0].sequence).toBe(0);
      expect(addCall[0].idempotencyKey).toBeNull();
    });

    it('utilise undefined comme jobId si pas d\'idempotencyKey', async () => {
      const webhookData = {
        webhookId: 'wh-003',
        event: 'test.event',
        payload: {},
        signature: 'sig',
        idempotencyKey: null,
      };
      await wqc.addWebhookToQueue(webhookData);
      const addCall = mockQueueInstance.add.mock.calls[mockQueueInstance.add.mock.calls.length - 1];
      expect(addCall[1].jobId).toBeUndefined();
    });

    it('lance si add throw', async () => {
      mockQueueInstance.add.mockRejectedValueOnce(new Error('Queue full'));
      await expect(wqc.addWebhookToQueue({
        webhookId: 'x', event: 'e', payload: {}, signature: 's',
      })).rejects.toThrow('Queue full');
    });
  });

  describe('getWebhookQueueStats', () => {
    it('retourne les statistiques de la queue', async () => {
      const stats = await wqc.getWebhookQueueStats();
      expect(stats.name).toBe('webhooks');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('timestamp');
    });

    it('retourne un objet d\'erreur si la queue throw', async () => {
      mockQueueInstance.getJobCounts.mockRejectedValueOnce(new Error('Redis down'));
      const stats = await wqc.getWebhookQueueStats();
      expect(stats).toHaveProperty('error');
    });
  });

  describe('cleanOldWebhookJobs', () => {
    it('nettoie les vieux jobs', async () => {
      const result = await wqc.cleanOldWebhookJobs(7);
      expect(result).toHaveProperty('completed');
      expect(result).toHaveProperty('failed');
    });

    it('utilise 7 jours par défaut', async () => {
      mockQueueInstance.clean.mockClear();
      await wqc.cleanOldWebhookJobs();
      expect(mockQueueInstance.clean).toHaveBeenCalled();
    });

    it('lance si clean throw', async () => {
      mockQueueInstance.clean.mockRejectedValueOnce(new Error('Clean failed'));
      await expect(wqc.cleanOldWebhookJobs()).rejects.toThrow('Clean failed');
    });
  });
});
