'use strict';
/**
 * Tests for config/queue.js
 */

// Mock Bull to avoid real Redis connections
const mockQueueInstance = {
  on: jest.fn(),
  add: jest.fn().mockResolvedValue({ id: 'job1' }),
  getJobCounts: jest.fn().mockResolvedValue({ active: 0, completed: 5, failed: 1, delayed: 0, waiting: 2 }),
  getFailed: jest.fn().mockResolvedValue([]),
  getDelayed: jest.fn().mockResolvedValue([]),
  clean: jest.fn().mockResolvedValue([]),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('bull', () => jest.fn().mockImplementation(() => mockQueueInstance));
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../../config/webhook-queue-config', () => ({
  webhookQueue: { on: jest.fn() },
}));

describe('queue config', () => {
  let queue;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('bull', () => jest.fn().mockImplementation(() => mockQueueInstance));
    jest.mock('redis', () => ({
      createClient: jest.fn().mockReturnValue({ on: jest.fn(), connect: jest.fn().mockResolvedValue(undefined) }),
    }));
    jest.mock('../../config/webhook-queue-config', () => ({
      webhookQueue: { on: jest.fn() },
    }));
    queue = require('../../config/queue');
  });

  describe('exports', () => {
    it('exporte toutes les queues', () => {
      expect(queue.emailQueue).toBeDefined();
      expect(queue.pdfQueue).toBeDefined();
      expect(queue.analyticsQueue).toBeDefined();
      expect(queue.paymentQueue).toBeDefined();
      expect(queue.badgesQueue).toBeDefined();
    });

    it('exporte les fonctions helper', () => {
      expect(typeof queue.getQueueStats).toBe('function');
      expect(typeof queue.retryFailedJobs).toBe('function');
      expect(typeof queue.cleanOldJobs).toBe('function');
    });

    it('exporte webhookQueue (peut être null si charge échoue)', () => {
      // webhookQueue peut être null si la charge échoue, ou l'objet mock
      expect(queue.webhookQueue !== undefined).toBe(true);
    });
  });

  describe('getQueueStats', () => {
    it('retourne les statistiques de la queue', async () => {
      const stats = await queue.getQueueStats(mockQueueInstance, 'emails');
      expect(stats).toHaveProperty('name', 'emails');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('timestamp');
    });

    it('retourne un objet d\'erreur si la queue throw', async () => {
      const failingQueue = {
        getJobCounts: jest.fn().mockRejectedValue(new Error('Redis down')),
        getFailed: jest.fn().mockRejectedValue(new Error()),
        getDelayed: jest.fn().mockRejectedValue(new Error()),
      };
      const stats = await queue.getQueueStats(failingQueue, 'test');
      expect(stats).toHaveProperty('error');
      expect(stats.name).toBe('test');
    });
  });

  describe('retryFailedJobs', () => {
    it('retente les jobs échoués', async () => {
      const mockJob = { id: 'j1', data: { foo: 'bar' }, retry: jest.fn().mockResolvedValue(undefined) };
      const mockQ = {
        getFailed: jest.fn().mockResolvedValue([mockJob]),
      };
      const retried = await queue.retryFailedJobs(mockQ, 'emails', 10);
      expect(retried.length).toBe(1);
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('retourne un tableau vide si aucun job échoué', async () => {
      const mockQ = {
        getFailed: jest.fn().mockResolvedValue([]),
      };
      const retried = await queue.retryFailedJobs(mockQ, 'emails', 10);
      expect(retried).toEqual([]);
    });

    it('lance si getFailed throw', async () => {
      const mockQ = {
        getFailed: jest.fn().mockRejectedValue(new Error('Redis error')),
      };
      await expect(queue.retryFailedJobs(mockQ, 'emails')).rejects.toThrow('Redis error');
    });
  });

  describe('cleanOldJobs', () => {
    it('nettoie les vieux jobs', async () => {
      const mockQ = {
        clean: jest.fn().mockResolvedValue([1, 2, 3]),
      };
      const result = await queue.cleanOldJobs(mockQ, 'emails', 7);
      expect(result).toHaveProperty('completed');
      expect(result).toHaveProperty('failed');
      expect(result.completed).toBe(3); // mock returns [1,2,3] → length 3
    });

    it('lance si clean throw', async () => {
      const mockQ = {
        clean: jest.fn().mockRejectedValue(new Error('Clean failed')),
      };
      await expect(queue.cleanOldJobs(mockQ, 'emails')).rejects.toThrow('Clean failed');
    });
  });
});
