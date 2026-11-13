/**
 * Tests for webhook-queue-manager.js (Q56)
 * Tests FIFO queue, sequence numbers, job processing, and idempotency keys
 */

jest.mock('../../config/db', () => ({
  webhook: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  webhookLog: {
    create: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/webhooks', () => ({
  WEBHOOK_EVENTS: {
    BOOKING_CREATED: 'booking.created',
    BOOKING_UPDATED: 'booking.updated',
    BOOKING_CANCELLED: 'booking.cancelled',
    PAYMENT_COMPLETED: 'payment.completed',
    PAYMENT_FAILED: 'payment.failed',
    QUOTE_CREATED: 'quote.created',
    QUOTE_ACCEPTED: 'quote.accepted',
    QUOTE_REFUSED: 'quote.refused',
    USER_REGISTERED: 'user.registered',
    USER_VERIFIED: 'user.verified',
    PROJECT_CREATED: 'project.created',
    PROJECT_COMPLETED: 'project.completed',
  },
}));

jest.mock('../../config/webhook-queue-config', () => ({
  webhookQueue: {
    process: jest.fn(),
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  },
  setupWebhookQueueErrorHandlers: jest.fn(),
  addWebhookToQueue: jest.fn().mockResolvedValue({ id: 'job-1' }),
  getWebhookQueueStats: jest.fn().mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 10,
    failed: 0,
  }),
  cleanOldWebhookJobs: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('axios', () => ({
  post: jest.fn(),
}));

describe('WebhookQueueManager', () => {
  let manager;
  let prismaDb;
  let webhookQueueConfig;
  let axios;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    prismaDb = require('../../config/db');
    webhookQueueConfig = require('../../config/webhook-queue-config');
    axios = require('axios');

    manager = require('../../utils/webhook-queue-manager');
    // Reset sequence counter before each test
    manager.resetSequenceCounter();
  });

  // ─────────────────────────────────────────────
  // Exports
  // ─────────────────────────────────────────────
  describe('Exports', () => {
    const expectedExports = [
      'initializeWebhookQueue',
      'triggerWebhookQueued',
      'processWebhookJob',
      'getWebhookQueueStatus',
      'getNextSequenceNumber',
      'resetSequenceCounter',
    ];

    expectedExports.forEach(fn => {
      it(`should export ${fn}`, () => {
        expect(typeof manager[fn]).toBe('function');
      });
    });
  });

  // ─────────────────────────────────────────────
  // getNextSequenceNumber
  // ─────────────────────────────────────────────
  describe('getNextSequenceNumber', () => {
    it('should return 1 on first call after reset', async () => {
      // Act
      const seq = await manager.getNextSequenceNumber();

      // Assert
      expect(seq).toBe(1);
    });

    it('should increment on each call', async () => {
      // Act
      const seq1 = await manager.getNextSequenceNumber();
      const seq2 = await manager.getNextSequenceNumber();
      const seq3 = await manager.getNextSequenceNumber();

      // Assert
      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });
  });

  // ─────────────────────────────────────────────
  // resetSequenceCounter
  // ─────────────────────────────────────────────
  describe('resetSequenceCounter', () => {
    it('should reset counter to 0', async () => {
      // Arrange
      await manager.getNextSequenceNumber();
      await manager.getNextSequenceNumber();

      // Act
      manager.resetSequenceCounter();

      // Assert
      const seq = await manager.getNextSequenceNumber();
      expect(seq).toBe(1);
    });
  });

  // ─────────────────────────────────────────────
  // initializeWebhookQueue
  // ─────────────────────────────────────────────
  describe('initializeWebhookQueue', () => {
    it('should setup error handlers and register processor', async () => {
      // Act
      await manager.initializeWebhookQueue();

      // Assert
      expect(webhookQueueConfig.setupWebhookQueueErrorHandlers).toHaveBeenCalled();
      expect(webhookQueueConfig.webhookQueue.process).toHaveBeenCalledWith(
        1,
        expect.any(Function)
      );
    });

    it('should throw when setupWebhookQueueErrorHandlers fails', async () => {
      // Arrange
      webhookQueueConfig.setupWebhookQueueErrorHandlers.mockImplementationOnce(() => {
        throw new Error('Redis connection failed');
      });

      // Act & Assert
      await expect(manager.initializeWebhookQueue()).rejects.toThrow(
        'Redis connection failed'
      );
    });
  });

  // ─────────────────────────────────────────────
  // triggerWebhookQueued
  // ─────────────────────────────────────────────
  describe('triggerWebhookQueued', () => {
    it('should do nothing for unknown events', async () => {
      // Act
      await manager.triggerWebhookQueued('unknown.event', { data: 'test' });

      // Assert
      expect(prismaDb.webhook.findMany).not.toHaveBeenCalled();
    });

    it('should do nothing when no active webhooks are subscribed', async () => {
      // Arrange
      prismaDb.webhook.findMany.mockResolvedValue([]);

      // Act
      await manager.triggerWebhookQueued('booking.created', { bookingId: '1' });

      // Assert
      expect(prismaDb.webhookLog.create).not.toHaveBeenCalled();
      expect(webhookQueueConfig.addWebhookToQueue).not.toHaveBeenCalled();
    });

    it('should create a WebhookLog with sequence number for each active webhook', async () => {
      // Arrange
      const webhooks = [
        { id: 'wh-1', secret: 'secret-1', url: 'https://example.com/webhook' },
      ];
      prismaDb.webhook.findMany.mockResolvedValue(webhooks);
      prismaDb.webhookLog.create.mockResolvedValue({ id: 'log-1' });

      // Act
      await manager.triggerWebhookQueued('booking.created', { bookingId: '123' });

      // Assert
      expect(prismaDb.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            webhookId: 'wh-1',
            event: 'booking.created',
            status: 'pending',
            sequence: 1,
          }),
        })
      );
    });

    it('should add job to queue via addWebhookToQueue', async () => {
      // Arrange
      const webhooks = [
        { id: 'wh-2', secret: 'my-secret', url: 'https://hooks.test/endpoint' },
      ];
      prismaDb.webhook.findMany.mockResolvedValue(webhooks);
      prismaDb.webhookLog.create.mockResolvedValue({ id: 'log-2' });

      // Act
      await manager.triggerWebhookQueued('payment.completed', { amount: 100 });

      // Assert
      expect(webhookQueueConfig.addWebhookToQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: 'wh-2',
          event: 'payment.completed',
          sequence: 1,
          logId: 'log-2',
        })
      );
    });

    it('should include idempotencyKey in webhook log', async () => {
      // Arrange
      prismaDb.webhook.findMany.mockResolvedValue([
        { id: 'wh-3', secret: 's3cr3t', url: 'https://hooks.test/ep' },
      ]);
      prismaDb.webhookLog.create.mockResolvedValue({ id: 'log-3' });

      // Act
      await manager.triggerWebhookQueued('user.registered', { userId: 'u-1' });

      // Assert
      const callData = prismaDb.webhookLog.create.mock.calls[0][0].data;
      expect(callData.idempotencyKey).toContain('wh-3');
      expect(callData.idempotencyKey).toContain('user.registered');
    });

    it('should process multiple webhooks and return results for each', async () => {
      // Arrange
      prismaDb.webhook.findMany.mockResolvedValue([
        { id: 'wh-a', secret: 'sa', url: 'https://a.test' },
        { id: 'wh-b', secret: 'sb', url: 'https://b.test' },
      ]);
      prismaDb.webhookLog.create
        .mockResolvedValueOnce({ id: 'log-a' })
        .mockResolvedValueOnce({ id: 'log-b' });

      // Act
      await manager.triggerWebhookQueued('booking.created', { bookingId: 'b-99' });

      // Assert
      expect(prismaDb.webhookLog.create).toHaveBeenCalledTimes(2);
      expect(webhookQueueConfig.addWebhookToQueue).toHaveBeenCalledTimes(2);
    });

    it('should continue processing remaining webhooks when one fails', async () => {
      // Arrange
      prismaDb.webhook.findMany.mockResolvedValue([
        { id: 'wh-fail', secret: 's', url: 'https://fail.test' },
        { id: 'wh-ok', secret: 's2', url: 'https://ok.test' },
      ]);
      prismaDb.webhookLog.create
        .mockRejectedValueOnce(new Error('DB write error'))
        .mockResolvedValueOnce({ id: 'log-ok' });

      // Act — should not throw
      await expect(
        manager.triggerWebhookQueued('quote.created', { quoteId: 'q-1' })
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────
  // processWebhookJob
  // ─────────────────────────────────────────────
  describe('processWebhookJob', () => {
    const buildJob = (overrides = {}) => ({
      id: 'job-test',
      data: {
        webhookId: 'wh-1',
        event: 'booking.created',
        payload: JSON.stringify({ bookingId: '123' }),
        signature: 'sha256abc',
        sequence: 1,
        idempotencyKey: 'wh-1-booking.created-1-12345',
        logId: 'log-1',
        attempt: 1,
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
      ...overrides,
    });

    it('should deliver webhook successfully for 2xx response', async () => {
      // Arrange
      const job = buildJob();
      prismaDb.webhook.findUnique.mockResolvedValue({
        id: 'wh-1',
        url: 'https://hooks.test/ep',
        isActive: true,
      });
      prismaDb.webhookLog.update.mockResolvedValue({});
      axios.post.mockResolvedValue({ status: 200, data: { ok: true } });

      // Act
      const result = await manager.processWebhookJob(job);

      // Assert
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('should include FIFO sequence headers in the HTTP call', async () => {
      // Arrange
      const job = buildJob();
      prismaDb.webhook.findUnique.mockResolvedValue({
        id: 'wh-1',
        url: 'https://hooks.test/ep',
        isActive: true,
      });
      prismaDb.webhookLog.update.mockResolvedValue({});
      axios.post.mockResolvedValue({ status: 200, data: {} });

      // Act
      await manager.processWebhookJob(job);

      // Assert
      const axiosCall = axios.post.mock.calls[0];
      const headers = axiosCall[2].headers;
      expect(headers['X-Webhook-Sequence']).toBe('1');
      expect(headers['X-Idempotency-Key']).toBe('wh-1-booking.created-1-12345');
      expect(headers['X-Webhook-Signature']).toBe('sha256=sha256abc');
    });

    it('should throw when webhook is not found', async () => {
      // Arrange
      const job = buildJob();
      prismaDb.webhook.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(manager.processWebhookJob(job)).rejects.toThrow('wh-1 not found');
    });

    it('should mark log as failed and throw when webhook is inactive', async () => {
      // Arrange
      const job = buildJob();
      prismaDb.webhook.findUnique.mockResolvedValue({
        id: 'wh-1',
        url: 'https://hooks.test/ep',
        isActive: false,
      });
      prismaDb.webhookLog.update.mockResolvedValue({});

      // Act & Assert
      await expect(manager.processWebhookJob(job)).rejects.toThrow('inactive');

      expect(prismaDb.webhookLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        })
      );
    });

    it('should throw and update log to pending on non-2xx response (attempt <= 3)', async () => {
      // Arrange
      const job = buildJob();
      prismaDb.webhook.findUnique.mockResolvedValue({
        id: 'wh-1',
        url: 'https://hooks.test/ep',
        isActive: true,
      });
      prismaDb.webhookLog.update.mockResolvedValue({});
      axios.post.mockResolvedValue({ status: 500, data: 'Internal Server Error' });

      // Act & Assert
      await expect(manager.processWebhookJob(job)).rejects.toThrow('HTTP 500');

      expect(prismaDb.webhookLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending' }),
        })
      );
    });

    it('should mark log as failed when max retries exceeded (attempt > 3)', async () => {
      // Arrange
      const job = buildJob({ data: { ...buildJob().data, attempt: 4 } });
      prismaDb.webhook.findUnique.mockResolvedValue({
        id: 'wh-1',
        url: 'https://hooks.test/ep',
        isActive: true,
      });
      prismaDb.webhookLog.update.mockResolvedValue({});
      axios.post.mockResolvedValue({ status: 503, data: 'Unavailable' });

      // Act & Assert
      await expect(manager.processWebhookJob(job)).rejects.toThrow();

      expect(prismaDb.webhookLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        })
      );
    });

    it('should update log to success status on 201 response', async () => {
      // Arrange
      const job = buildJob();
      prismaDb.webhook.findUnique.mockResolvedValue({
        id: 'wh-1',
        url: 'https://hooks.test/ep',
        isActive: true,
      });
      prismaDb.webhookLog.update.mockResolvedValue({});
      axios.post.mockResolvedValue({ status: 201, data: { created: true } });

      // Act
      await manager.processWebhookJob(job);

      // Assert
      expect(prismaDb.webhookLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'success' }),
        })
      );
    });
  });

  // ─────────────────────────────────────────────
  // getWebhookQueueStatus
  // ─────────────────────────────────────────────
  describe('getWebhookQueueStatus', () => {
    it('should return queue stats', async () => {
      // Act
      const result = await manager.getWebhookQueueStatus();

      // Assert
      expect(result).toHaveProperty('waiting');
      expect(result).toHaveProperty('active');
      expect(result).toHaveProperty('completed');
    });

    it('should return error object when stats fetching fails', async () => {
      // Arrange
      webhookQueueConfig.getWebhookQueueStats.mockRejectedValueOnce(
        new Error('Redis down')
      );

      // Act
      const result = await manager.getWebhookQueueStatus();

      // Assert
      expect(result.error).toBe('Redis down');
    });
  });
});
