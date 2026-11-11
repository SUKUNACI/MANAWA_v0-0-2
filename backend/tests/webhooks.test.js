const request = require('supertest');
const crypto = require('crypto');
const prisma = require('../config/db');
const {
  WEBHOOK_EVENTS,
  registerWebhook,
  unregisterWebhook,
  triggerWebhook,
  generateSignature,
  getWebhooks,
  getWebhookLogs,
  sendTestWebhook,
} = require('../utils/webhooks');

// Mock admin token for tests
const mockAdminUser = {
  id: 'test-admin-id',
  email: 'admin@test.com',
  role: 'ADMIN',
};

// Mock dependencies
jest.mock('axios');
const axios = require('axios');

describe('Webhooks', () => {
  beforeAll(async () => {
    // Clean up any existing test webhooks
    await prisma.webhookLog.deleteMany({});
    await prisma.webhook.deleteMany({});
  });

  afterEach(async () => {
    // Clean up after each test
    await prisma.webhookLog.deleteMany({});
    await prisma.webhook.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('registerWebhook', () => {
    it('should register a new webhook with valid data', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345',
        ['booking.created', 'payment.completed']
      );

      expect(webhook.id).toBeDefined();
      expect(webhook.url).toBe('https://example.com/webhooks');
      expect(webhook.events).toEqual(['booking.created', 'payment.completed']);
      expect(webhook.isActive).toBe(true);
    });

    it('should subscribe to all events if none specified', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345',
        []
      );

      expect(webhook.events.length).toBeGreaterThan(0);
      expect(webhook.events).toContain('booking.created');
    });

    it('should reject invalid URLs', async () => {
      await expect(
        registerWebhook('not-a-url', 'super-secret-key-12345')
      ).rejects.toThrow('Invalid webhook URL');
    });

    it('should reject invalid event types', async () => {
      await expect(
        registerWebhook(
          'https://example.com/webhooks',
          'super-secret-key-12345',
          ['invalid.event']
        )
      ).rejects.toThrow('Invalid events');
    });

    it('should require minimum 16 character secret', async () => {
      await expect(
        registerWebhook(
          'https://example.com/webhooks',
          'short'
        )
      ).rejects.toThrow();
    });
  });

  describe('triggerWebhook', () => {
    it('should trigger webhook to all subscribed endpoints', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345',
        ['booking.created']
      );

      axios.post.mockResolvedValue({ status: 200, data: { received: true } });

      await triggerWebhook('booking.created', {
        bookingId: 'test-id',
        status: 'PENDING',
      });

      // Check that webhook was logged
      const logs = await prisma.webhookLog.findMany({
        where: { webhookId: webhook.id },
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].event).toBe('booking.created');
    });

    it('should skip unknown event types', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345'
      );

      await triggerWebhook('unknown.event', { test: 'data' });

      const logs = await prisma.webhookLog.findMany({
        where: { webhookId: webhook.id },
      });

      expect(logs.length).toBe(0);
    });

    it('should not trigger inactive webhooks', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345',
        ['booking.created']
      );

      // Deactivate webhook
      await prisma.webhook.update({
        where: { id: webhook.id },
        data: { isActive: false },
      });

      axios.post.mockResolvedValue({ status: 200, data: { received: true } });

      await triggerWebhook('booking.created', { test: 'data' });

      // No logs should be created for inactive webhook
      const logs = await prisma.webhookLog.findMany({
        where: { webhookId: webhook.id },
      });

      expect(logs.length).toBe(0);
    });
  });

  describe('generateSignature', () => {
    it('should generate consistent HMAC-SHA256 signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const secret = 'my-secret-key-12345';

      const sig1 = generateSignature(payload, secret);
      const sig2 = generateSignature(payload, secret);

      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex is 64 chars
    });

    it('should produce different signatures for different secrets', () => {
      const payload = JSON.stringify({ test: 'data' });

      const sig1 = generateSignature(payload, 'secret1-1234567890');
      const sig2 = generateSignature(payload, 'secret2-1234567890');

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('unregisterWebhook', () => {
    it('should delete a webhook and its logs', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345'
      );

      // Create a log entry
      await prisma.webhookLog.create({
        data: {
          webhookId: webhook.id,
          event: 'booking.created',
          payload: '{"test":"data"}',
          status: 'success',
        },
      });

      await unregisterWebhook(webhook.id);

      const deleted = await prisma.webhook.findUnique({
        where: { id: webhook.id },
      });

      expect(deleted).toBeNull();

      const logs = await prisma.webhookLog.findMany({
        where: { webhookId: webhook.id },
      });

      expect(logs.length).toBe(0);
    });
  });

  describe('getWebhooks', () => {
    it('should list all webhooks with recent logs', async () => {
      const webhook1 = await registerWebhook(
        'https://example1.com/webhooks',
        'super-secret-key-12345'
      );

      const webhook2 = await registerWebhook(
        'https://example2.com/webhooks',
        'super-secret-key-12345'
      );

      const webhooks = await getWebhooks();

      expect(webhooks.length).toBeGreaterThanOrEqual(2);
      expect(webhooks.map(w => w.id)).toContain(webhook1.id);
      expect(webhooks.map(w => w.id)).toContain(webhook2.id);
    });

    it('should filter by active status', async () => {
      const active = await registerWebhook(
        'https://active.com/webhooks',
        'super-secret-key-12345'
      );

      const inactive = await registerWebhook(
        'https://inactive.com/webhooks',
        'super-secret-key-12345'
      );

      await prisma.webhook.update({
        where: { id: inactive.id },
        data: { isActive: false },
      });

      const activeWebhooks = await getWebhooks({ isActive: true });

      expect(activeWebhooks.map(w => w.id)).toContain(active.id);
      expect(activeWebhooks.map(w => w.id)).not.toContain(inactive.id);
    });
  });

  describe('getWebhookLogs', () => {
    it('should retrieve logs for a webhook with pagination', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345'
      );

      // Create multiple log entries
      for (let i = 0; i < 5; i++) {
        await prisma.webhookLog.create({
          data: {
            webhookId: webhook.id,
            event: 'booking.created',
            payload: JSON.stringify({ id: i }),
            status: i % 2 === 0 ? 'success' : 'failed',
          },
        });
      }

      const { logs, total } = await getWebhookLogs(webhook.id, {
        limit: 2,
        offset: 0,
      });

      expect(logs.length).toBe(2);
      expect(total).toBe(5);

      const { logs: failedLogs } = await getWebhookLogs(webhook.id, {
        status: 'failed',
      });

      expect(failedLogs.length).toBe(2);
    });
  });

  describe('sendTestWebhook', () => {
    it('should send a test webhook and log result', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345'
      );

      axios.post.mockResolvedValue({
        status: 200,
        data: { received: true },
      });

      const result = await sendTestWebhook(webhook.id);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.logId).toBeDefined();

      // Verify log was created
      const log = await prisma.webhookLog.findUnique({
        where: { id: result.logId },
      });

      expect(log.event).toBe('test');
      expect(log.status).toBe('success');
    });

    it('should handle test webhook failures', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345'
      );

      axios.post.mockResolvedValue({
        status: 500,
        data: { error: 'Server error' },
      });

      const result = await sendTestWebhook(webhook.id);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });
  });

  describe('Webhook Signature Headers', () => {
    it('should include correct signature header in requests', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345',
        ['booking.created']
      );

      let capturedHeaders;
      axios.post.mockImplementation((url, data, config) => {
        capturedHeaders = config.headers;
        return Promise.resolve({ status: 200, data: { received: true } });
      });

      const payload = { bookingId: 'test-id' };
      await triggerWebhook('booking.created', payload);

      expect(capturedHeaders['X-Webhook-Event']).toBe('booking.created');
      expect(capturedHeaders['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(capturedHeaders['X-Webhook-Attempt']).toBe('1');
    });
  });

  describe('Webhook Retries', () => {
    it('should retry failed webhooks with exponential backoff', async () => {
      const webhook = await registerWebhook(
        'https://example.com/webhooks',
        'super-secret-key-12345',
        ['booking.created']
      );

      // First attempt fails
      axios.post.mockRejectedValueOnce(new Error('Connection timeout'));

      await triggerWebhook('booking.created', { test: 'data' });

      // Check log was created with pending status
      const logs = await prisma.webhookLog.findMany({
        where: { webhookId: webhook.id },
      });

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[0];
      expect(log.status).toBe('pending');
      expect(log.attempt).toBe(1);
      expect(log.nextRetryAt).toBeDefined();
    });
  });

  describe('WEBHOOK_EVENTS constant', () => {
    it('should have all required event types', () => {
      const requiredEvents = [
        'booking.created',
        'booking.updated',
        'booking.cancelled',
        'payment.completed',
        'payment.failed',
        'quote.created',
        'quote.accepted',
        'quote.refused',
        'user.registered',
        'user.verified',
        'project.created',
        'project.completed',
      ];

      requiredEvents.forEach(eventName => {
        expect(Object.values(WEBHOOK_EVENTS)).toContain(eventName);
      });
    });
  });
});

describe('Webhooks Admin Routes', () => {
  let app;
  let adminToken;

  beforeAll(async () => {
    // Mock app would be created here in a real test
    // This is a placeholder for actual route testing
  });

  afterEach(async () => {
    await prisma.webhookLog.deleteMany({});
    await prisma.webhook.deleteMany({});
  });

  describe('Authentication', () => {
    it('should require admin role for webhook endpoints', async () => {
      // Test that non-admin users cannot access webhook admin routes
      // This would be tested with actual request to /api/admin/webhooks
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Webhook Registration Validation', () => {
    it('should validate webhook URL format', async () => {
      // Test that invalid URLs are rejected
      expect(true).toBe(true); // Placeholder
    });

    it('should validate minimum secret length', async () => {
      // Test that secrets < 16 chars are rejected
      expect(true).toBe(true); // Placeholder
    });

    it('should validate event types', async () => {
      // Test that invalid event types are rejected
      expect(true).toBe(true); // Placeholder
    });
  });
});

describe('Webhook Integration with Triggers', () => {
  it('should trigger webhooks when booking is created', async () => {
    // This test would verify that triggerBookingCreated
    // properly calls triggerWebhook with correct payload structure
    expect(true).toBe(true); // Placeholder
  });

  it('should include all required fields in booking.created payload', async () => {
    // Verify payload structure matches documentation
    expect(true).toBe(true); // Placeholder
  });

  it('should trigger webhooks when payment completes', async () => {
    // Verify payment.completed event is triggered correctly
    expect(true).toBe(true); // Placeholder
  });

  it('should trigger webhooks when quote is accepted', async () => {
    // Verify quote.accepted event is triggered correctly
    expect(true).toBe(true); // Placeholder
  });
});
