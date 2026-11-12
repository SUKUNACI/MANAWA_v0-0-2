const request = require('supertest');
const crypto = require('crypto');
const prisma = require('../config/db');
const geniuspay = require('../utils/geniuspay');

// Mock GeniusPay module
jest.mock('../utils/geniuspay');

describe('GeniusPay Webhooks - Q51', () => {
  let app;
  let testPayment;
  let testQuote;
  let testClient;

  beforeAll(async () => {
    // Create test app instance (simplified for testing)
    const express = require('express');
    app = express();
    app.use(express.json());

    const webhookRoutes = require('../routes/webhooks-geniuspay');
    app.use('/webhooks/geniuspay', webhookRoutes);
  });

  beforeEach(async () => {
    // Create test data
    testClient = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        firstName: 'Test',
        lastName: 'Client',
        passwordHash: 'hashed',
        role: 'CLIENT',
      },
    });

    const testProfessional = await prisma.user.create({
      data: {
        email: `pro-${Date.now()}@example.com`,
        firstName: 'Test',
        lastName: 'Pro',
        passwordHash: 'hashed',
        role: 'PROFESSIONAL',
      },
    });

    await prisma.professional.create({
      data: {
        userId: testProfessional.id,
        trade: 'Electrician',
      },
    });

    const testProject = await prisma.project.create({
      data: {
        title: 'Test Project',
        description: 'Test',
        clientId: testClient.id,
        budget: 1000,
        status: 'ACTIVE',
      },
    });

    testQuote = await prisma.quote.create({
      data: {
        projectId: testProject.id,
        professionalId: testProfessional.id,
        clientId: testClient.id,
        title: 'Test Quote',
        description: 'Test',
        amount: 500,
        status: 'ACCEPTED',
      },
    });

    testPayment = await prisma.payment.create({
      data: {
        quoteId: testQuote.id,
        amount: 500,
        status: 'pending',
        geniuspayRef: 'test-ref-123',
        isDeposit: true,
      },
    });
  });

  afterEach(async () => {
    // Cleanup
    await prisma.paymentAuditLog.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.quote.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.professional.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('POST /webhooks/geniuspay', () => {
    it('should process payment.succeeded event', async () => {
      // Mock GeniusPay signature verification
      const payload = {
        event: { type: 'payment.succeeded' },
        data: {
          reference: 'test-ref-123',
          amount: 500,
          status: 'completed',
        },
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac('sha256', process.env.GENIUSPAY_WEBHOOK_SECRET || 'test-secret')
        .update(`${timestamp}.${JSON.stringify(payload)}`)
        .digest('hex');

      geniuspay.verifyWebhookSignature.mockReturnValue(true);
      geniuspay.verifyWebhookTimestamp.mockReturnValue(true);

      const res = await request(app)
        .post('/webhooks/geniuspay')
        .set('x-geniuspay-signature', signature)
        .set('x-geniuspay-timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      // Verify payment status updated
      const updatedPayment = await prisma.payment.findUnique({
        where: { id: testPayment.id },
      });
      expect(updatedPayment.status).toBe('succeeded');
      expect(updatedPayment.completedAt).toBeTruthy();
    });

    it('should detect amount mismatch', async () => {
      const payload = {
        event: { type: 'payment.succeeded' },
        data: {
          reference: 'test-ref-123',
          amount: 501, // Mismatch > 1 XOF
          status: 'completed',
        },
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac('sha256', process.env.GENIUSPAY_WEBHOOK_SECRET || 'test-secret')
        .update(`${timestamp}.${JSON.stringify(payload)}`)
        .digest('hex');

      geniuspay.verifyWebhookSignature.mockReturnValue(true);
      geniuspay.verifyWebhookTimestamp.mockReturnValue(true);

      const res = await request(app)
        .post('/webhooks/geniuspay')
        .set('x-geniuspay-signature', signature)
        .set('x-geniuspay-timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);

      // Payment should be marked as failed due to mismatch
      const updatedPayment = await prisma.payment.findUnique({
        where: { id: testPayment.id },
      });
      expect(updatedPayment.status).toBe('failed');
    });

    it('should process payment.failed event', async () => {
      const payload = {
        event: { type: 'payment.failed' },
        data: {
          reference: 'test-ref-123',
          failure_reason: 'Card declined',
        },
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac('sha256', process.env.GENIUSPAY_WEBHOOK_SECRET || 'test-secret')
        .update(`${timestamp}.${JSON.stringify(payload)}`)
        .digest('hex');

      geniuspay.verifyWebhookSignature.mockReturnValue(true);
      geniuspay.verifyWebhookTimestamp.mockReturnValue(true);

      const res = await request(app)
        .post('/webhooks/geniuspay')
        .set('x-geniuspay-signature', signature)
        .set('x-geniuspay-timestamp', timestamp.toString())
        .send(payload);

      expect(res.status).toBe(200);

      const updatedPayment = await prisma.payment.findUnique({
        where: { id: testPayment.id },
      });
      expect(updatedPayment.status).toBe('failed');
    });

    it('should reject invalid signature', async () => {
      const payload = {
        event: { type: 'payment.succeeded' },
        data: { reference: 'test-ref-123' },
      };

      geniuspay.verifyWebhookSignature.mockReturnValue(false);

      const res = await request(app)
        .post('/webhooks/geniuspay')
        .set('x-geniuspay-signature', 'invalid-sig')
        .set('x-geniuspay-timestamp', Math.floor(Date.now() / 1000).toString())
        .send(payload);

      expect(res.status).toBe(401);
    });

    it('should create notification on payment success', async () => {
      const payload = {
        event: { type: 'payment.succeeded' },
        data: {
          reference: 'test-ref-123',
          amount: 500,
          status: 'completed',
        },
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac('sha256', process.env.GENIUSPAY_WEBHOOK_SECRET || 'test-secret')
        .update(`${timestamp}.${JSON.stringify(payload)}`)
        .digest('hex');

      geniuspay.verifyWebhookSignature.mockReturnValue(true);
      geniuspay.verifyWebhookTimestamp.mockReturnValue(true);

      await request(app)
        .post('/webhooks/geniuspay')
        .set('x-geniuspay-signature', signature)
        .set('x-geniuspay-timestamp', timestamp.toString())
        .send(payload);

      const notifications = await prisma.notification.findMany({
        where: { userId: testClient.id },
      });

      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0].type).toBe('PAYMENT_RECEIVED');
    });
  });

  describe('Payment Audit Logging', () => {
    it('should log payment status changes', async () => {
      const payload = {
        event: { type: 'payment.succeeded' },
        data: {
          reference: 'test-ref-123',
          amount: 500,
          status: 'completed',
        },
      };

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac('sha256', process.env.GENIUSPAY_WEBHOOK_SECRET || 'test-secret')
        .update(`${timestamp}.${JSON.stringify(payload)}`)
        .digest('hex');

      geniuspay.verifyWebhookSignature.mockReturnValue(true);
      geniuspay.verifyWebhookTimestamp.mockReturnValue(true);

      await request(app)
        .post('/webhooks/geniuspay')
        .set('x-geniuspay-signature', signature)
        .set('x-geniuspay-timestamp', timestamp.toString())
        .send(payload);

      const auditLogs = await prisma.paymentAuditLog.findMany({
        where: { paymentId: testPayment.id },
      });

      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[auditLogs.length - 1].toStatus).toBe('succeeded');
      expect(auditLogs[auditLogs.length - 1].reason).toBe('webhook');
    });
  });
});
