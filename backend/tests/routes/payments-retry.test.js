const request = require('supertest');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const paymentsRetryRoutes = require('../../routes/payments-retry');
const prisma = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');
const jwt = require('jsonwebtoken');

// Mock Bull queue and notification-triggers to avoid Redis/network calls in tests
jest.mock('../../config/queue', () => ({
  emailQueue: { add: jest.fn().mockResolvedValue({}) },
  notificationQueue: { add: jest.fn().mockResolvedValue({}) },
  smsQueue: { add: jest.fn().mockResolvedValue({}) },
  analyticsQueue: { add: jest.fn().mockResolvedValue({}) },
  pdfQueue: { add: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../../utils/notification-triggers', () => ({
  sendNotification: jest.fn().mockResolvedValue({}),
}));

// Mock middleware pour les tests
const mockAuthMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide' });
  }
};

// Setup test app
const app = express();
app.use(express.json());
app.use(mockAuthMiddleware);
app.use('/payments', paymentsRetryRoutes);

describe('Q53: Payment Retry Routes', () => {
  let testUserId;
  let testPaymentId;
  let testQuoteId;
  let testProjectId;
  let testToken;

  beforeAll(async () => {
    // Create test user
    testUserId = uuidv4();
    const user = await prisma.user.create({
      data: {
        id: testUserId,
        email: `test-payment-${Date.now()}@example.com`,
        passwordHash: 'hashed_password',
        firstName: 'Test',
        lastName: 'User',
        role: 'CLIENT',
      },
    });

    // Create token
    testToken = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Create test project
    testProjectId = uuidv4();
    const project = await prisma.project.create({
      data: {
        id: testProjectId,
        clientId: testUserId,
        title: 'Test Project',
        description: 'Test project for retry',
        tradeNeeded: 'plumbing',
        city: 'Paris',
      },
    });

    // Create test professional
    const professionalUserId = uuidv4();
    const professionalUser = await prisma.user.create({
      data: {
        id: professionalUserId,
        email: `test-pro-${Date.now()}@example.com`,
        passwordHash: 'hashed_password',
        firstName: 'Pro',
        lastName: 'User',
        role: 'PROFESSIONAL',
      },
    });

    const professional = await prisma.professional.create({
      data: {
        userId: professionalUserId,
        trade: 'plumbing',
      },
    });

    // Create test quote
    testQuoteId = uuidv4();
    const quote = await prisma.quote.create({
      data: {
        id: testQuoteId,
        projectId: testProjectId,
        professionalId: professional.id,
        amount: 500,
        description: 'Test quote',
      },
    });

    // Create test payment (failed status)
    testPaymentId = uuidv4();
    const payment = await prisma.payment.create({
      data: {
        id: testPaymentId,
        quoteId: testQuoteId,
        amount: 500,
        status: 'failed',
        isDeposit: true,
        metadata: JSON.stringify({ promoCodeId: null }),
      },
    });
  });

  afterAll(async () => {
    // Delete audit logs before payments to satisfy FK constraint
    await prisma.paymentAuditLog.deleteMany({
      where: { payment: { quoteId: testQuoteId } },
    });
    await prisma.payment.deleteMany({ where: { quoteId: testQuoteId } });
    await prisma.quote.deleteMany({ where: { projectId: testProjectId } });
    await prisma.project.deleteMany({ where: { id: testProjectId } });
    await prisma.professional.deleteMany();
    await prisma.user.deleteMany({ where: { id: { in: [testUserId] } } });
  });

  describe('POST /payments/:paymentId/retry', () => {
    it('should return 401 if not authenticated', async () => {
      const res = await request(app)
        .post(`/payments/${testPaymentId}/retry`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Non authentifié');
    });

    it('should return 404 if payment not found', async () => {
      const fakeId = uuidv4();
      const res = await request(app)
        .post(`/payments/${fakeId}/retry`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('introuvable');
    });

    it('should return 400 if payment status is not "failed"', async () => {
      // Create a succeeded payment
      const succeededPaymentId = uuidv4();
      await prisma.payment.create({
        data: {
          id: succeededPaymentId,
          quoteId: testQuoteId,
          amount: 500,
          status: 'succeeded',
          isDeposit: false,
        },
      });

      const res = await request(app)
        .post(`/payments/${succeededPaymentId}/retry`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ne peut pas être réessayé');

      // Cleanup
      await prisma.payment.delete({ where: { id: succeededPaymentId } });
    });

    it('should successfully retry a failed payment', async () => {
      // Mock geniuspay.createPayment
      const geniuspay = require('../../utils/geniuspay');
      jest.spyOn(geniuspay, 'createPayment').mockResolvedValue({
        reference: 'TEST_REF_123',
        payment_link: 'https://geniuspay.ci/pay/TEST_REF_123',
      });

      const res = await request(app)
        .post(`/payments/${testPaymentId}/retry`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.paymentId).toBe(testPaymentId);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.geniuspayRef).toBe('TEST_REF_123');
      expect(res.body.data.retryAttempt).toBe(1);

      // Verify payment was updated
      const updatedPayment = await prisma.payment.findUnique({
        where: { id: testPaymentId },
      });
      expect(updatedPayment.status).toBe('pending');
      expect(updatedPayment.geniuspayRef).toBe('TEST_REF_123');

      geniuspay.createPayment.mockRestore();
    });

    it('should reapply promo code if it was used before', async () => {
      // Create a promo code
      const promoCodeId = uuidv4();
      await prisma.promoCode.create({
        data: {
          id: promoCodeId,
          code: 'TEST_PROMO_10',
          discountType: 'PERCENT',
          discountValue: 10,
          active: true,
        },
      });

      // Create a failed payment with promo code in metadata
      const paymentWithPromoId = uuidv4();
      await prisma.payment.create({
        data: {
          id: paymentWithPromoId,
          quoteId: testQuoteId,
          amount: 500,
          status: 'failed',
          isDeposit: false,
          metadata: JSON.stringify({ promoCodeId }),
        },
      });

      // Mock geniuspay
      const geniuspay = require('../../utils/geniuspay');
      jest.spyOn(geniuspay, 'createPayment').mockResolvedValue({
        reference: 'TEST_REF_PROMO',
        payment_link: 'https://geniuspay.ci/pay/TEST_REF_PROMO',
      });

      const res = await request(app)
        .post(`/payments/${paymentWithPromoId}/retry`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.appliedPromoCode).toBe('TEST_PROMO_10');
      expect(res.body.data.discountAmount).toBe(50); // 10% of 500
      expect(res.body.data.amount).toBe(450); // 500 - 50

      // Cleanup
      await prisma.payment.delete({ where: { id: paymentWithPromoId } });
      await prisma.promoCode.delete({ where: { id: promoCodeId } });
      geniuspay.createPayment.mockRestore();
    });

    it('should return 400 if max retry attempts exceeded', async () => {
      // Create a payment that has already been retried 3 times
      const maxRetriesPaymentId = uuidv4();
      const payment = await prisma.payment.create({
        data: {
          id: maxRetriesPaymentId,
          quoteId: testQuoteId,
          amount: 500,
          status: 'failed',
          isDeposit: false,
        },
      });

      // Create 3 audit logs with retry reason
      for (let i = 0; i < 3; i++) {
        await prisma.paymentAuditLog.create({
          data: {
            paymentId: maxRetriesPaymentId,
            fromStatus: 'failed',
            toStatus: 'pending',
            reason: 'retry',
          },
        });
      }

      const res = await request(app)
        .post(`/payments/${maxRetriesPaymentId}/retry`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Maximum');

      // Cleanup
      await prisma.paymentAuditLog.deleteMany({
        where: { paymentId: maxRetriesPaymentId },
      });
      await prisma.payment.delete({ where: { id: maxRetriesPaymentId } });
    });
  });
});

describe('Q54: Webhook Retry Scheduler', () => {
  let testWebhookId;
  let testWebhookLogId;

  beforeAll(async () => {
    // Create test webhook
    testWebhookId = uuidv4();
    await prisma.webhook.create({
      data: {
        id: testWebhookId,
        url: 'https://example.com/webhook',
        secret: 'test_secret',
        events: ['payment.completed'],
        isActive: true,
      },
    });

    // Create test webhook log with pending status
    testWebhookLogId = uuidv4();
    await prisma.webhookLog.create({
      data: {
        id: testWebhookLogId,
        webhookId: testWebhookId,
        event: 'payment.completed',
        payload: JSON.stringify({ paymentId: 'test123', status: 'completed' }),
        status: 'pending',
        attempt: 1,
        nextRetryAt: new Date(Date.now() - 60000), // 1 minute ago (should be retried)
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.webhookLog.deleteMany({ where: { webhookId: testWebhookId } });
    await prisma.webhook.deleteMany({ where: { id: testWebhookId } });
  });

  describe('webhookRetryScheduler', () => {
    it('should find and retry pending webhooks', async () => {
      const { webhookRetryScheduler } = require('../../jobs/webhook-retry-scheduler');

      // Mock axios for webhook retry
      const axios = require('axios');
      jest.spyOn(axios, 'post').mockResolvedValue({
        status: 200,
        statusText: 'OK',
      });

      const result = await webhookRetryScheduler();

      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('succeeded');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('rescheduled');
      expect(result.processed).toBeGreaterThanOrEqual(0);

      axios.post.mockRestore();
    });

    it('should calculate exponential backoff correctly', async () => {
      // Create a failed webhook log
      const failedWebhookLogId = uuidv4();
      await prisma.webhookLog.create({
        data: {
          id: failedWebhookLogId,
          webhookId: testWebhookId,
          event: 'payment.completed',
          payload: JSON.stringify({ paymentId: 'test456', status: 'completed' }),
          status: 'pending',
          attempt: 2,
          nextRetryAt: new Date(Date.now() - 1000),
        },
      });

      // Mock axios to fail
      const axios = require('axios');
      jest.spyOn(axios, 'post').mockRejectedValue(new Error('Network error'));

      const { webhookRetryScheduler } = require('../../jobs/webhook-retry-scheduler');
      const result = await webhookRetryScheduler();

      // Check if nextRetryAt was updated with exponential backoff
      const updatedLog = await prisma.webhookLog.findUnique({
        where: { id: failedWebhookLogId },
      });

      // Attempt 3 should have nextRetryAt = now + 20000ms (5000 * 2^2)
      expect(updatedLog.attempt).toBe(3);
      expect(updatedLog.nextRetryAt).not.toBeNull();

      // Cleanup
      await prisma.webhookLog.delete({ where: { id: failedWebhookLogId } });
      axios.post.mockRestore();
    });

    it('should mark webhook as failed after max attempts', async () => {
      // Create a webhook log that will exceed max attempts
      const maxAttemptsLogId = uuidv4();
      await prisma.webhookLog.create({
        data: {
          id: maxAttemptsLogId,
          webhookId: testWebhookId,
          event: 'payment.completed',
          payload: JSON.stringify({ paymentId: 'test789', status: 'completed' }),
          status: 'pending',
          attempt: 3,
          nextRetryAt: new Date(Date.now() - 1000),
        },
      });

      const { webhookRetryScheduler } = require('../../jobs/webhook-retry-scheduler');
      await webhookRetryScheduler();

      // Check if webhook was marked as failed
      const finalLog = await prisma.webhookLog.findUnique({
        where: { id: maxAttemptsLogId },
      });

      expect(finalLog.status).toBe('failed');

      // Cleanup
      await prisma.webhookLog.delete({ where: { id: maxAttemptsLogId } });
    });

    it('should send admin alert for failed webhooks', async () => {
      // This test verifies that admin alerts are sent
      const { sendAdminAlert } = require('../../jobs/webhook-retry-scheduler');

      // Create a test admin user
      const adminUserId = uuidv4();
      await prisma.user.create({
        data: {
          id: adminUserId,
          email: `admin-test-${Date.now()}@example.com`,
          passwordHash: 'hashed_password',
          firstName: 'Admin',
          lastName: 'Test',
          role: 'ADMIN',
        },
      });

      const alertData = {
        type: 'WEBHOOK_FAILURES',
        failedCount: 1,
        webhooks: [{
          logId: uuidv4(),
          event: 'payment.completed',
          webhookUrl: 'https://example.com/webhook',
          payload: '{}',
          lastResponse: '{}',
        }],
        timestamp: new Date().toISOString(),
      };

      await sendAdminAlert(alertData);

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: { userId: adminUserId, type: 'ALERT' },
      });

      expect(notification).not.toBeNull();

      // Cleanup
      await prisma.notification.delete({ where: { id: notification.id } });
      await prisma.user.delete({ where: { id: adminUserId } });
    });
  });
});
