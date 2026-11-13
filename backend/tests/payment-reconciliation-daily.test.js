const prisma = require('../config/db');
const { reconcilePaymentsDaily } = require('../jobs/payment-reconciliation-daily');
const geniuspay = require('../utils/geniuspay');

jest.mock('../utils/geniuspay');

describe('Payment Reconciliation Daily - Q52', () => {
  let testClient;
  let testProfessional;
  let testProject;
  let testQuote;

  beforeAll(async () => {
    // Setup test data
    testClient = await prisma.user.create({
      data: {
        email: `client-${Date.now()}@example.com`,
        firstName: 'Test',
        lastName: 'Client',
        passwordHash: 'hashed',
        role: 'CLIENT',
      },
    });

    testProfessional = await prisma.user.create({
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

    testProject = await prisma.project.create({
      data: {
        title: 'Test Project',
        description: 'Test',
        clientId: testClient.id,
        tradeNeeded: 'Electrician',
        city: 'Paris',
      },
    });

    testQuote = await prisma.quote.create({
      data: {
        projectId: testProject.id,
        professionalId: testProfessional.id,
        description: 'Test',
        amount: 500,
        status: 'ACCEPTED',
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.notification.deleteMany({});
    await prisma.paymentAuditLog.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.quote.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.professional.deleteMany({});
    await prisma.user.deleteMany({});
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Remove any payments from prior test to avoid @@unique([quoteId, isDeposit]) violations
    await prisma.paymentAuditLog.deleteMany({ where: { payment: { quoteId: testQuote.id } } });
    await prisma.payment.deleteMany({ where: { quoteId: testQuote.id } });
  });

  describe('reconcilePaymentsDaily()', () => {
    it('should sync pending payment to succeeded', async () => {
      // Create a pending payment
      const payment = await prisma.payment.create({
        data: {
          quoteId: testQuote.id,
          amount: 500,
          status: 'pending',
          geniuspayRef: 'gp-ref-001',
          isDeposit: true,
        },
      });

      // Mock GeniusPay API response
      geniuspay.getPayment.mockResolvedValue({
        data: {
          reference: 'gp-ref-001',
          status: 'completed',
          amount: 500,
        },
      });

      const result = await reconcilePaymentsDaily();

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);

      // Verify payment status updated
      const updatedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });

      expect(updatedPayment.status).toBe('succeeded');
      expect(updatedPayment.reconciledAt).toBeTruthy();
      expect(updatedPayment.reconciledBy).toBe('reconciliation_job');
    });

    it('should detect amount mismatch with tolerance ±1 XOF', async () => {
      const payment = await prisma.payment.create({
        data: {
          quoteId: testQuote.id,
          amount: 500,
          status: 'pending',
          geniuspayRef: 'gp-ref-002',
          isDeposit: true,
        },
      });

      // Mock amount mismatch (> 1 XOF tolerance)
      geniuspay.getPayment.mockResolvedValue({
        data: {
          reference: 'gp-ref-002',
          status: 'completed',
          amount: 502, // Exceeds ±1 tolerance
        },
      });

      const result = await reconcilePaymentsDaily();

      expect(result.failed).toBe(1);

      const updatedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });

      expect(updatedPayment.status).toBe('failed');
      const metadata = JSON.parse(updatedPayment.metadata);
      expect(metadata.reason).toBe('amount_mismatch');
    });

    it('should handle amount mismatch within ±1 XOF tolerance', async () => {
      const payment = await prisma.payment.create({
        data: {
          quoteId: testQuote.id,
          amount: 500,
          status: 'pending',
          geniuspayRef: 'gp-ref-003',
          isDeposit: true,
        },
      });

      // Mock amount within tolerance (±1 XOF)
      geniuspay.getPayment.mockResolvedValue({
        data: {
          reference: 'gp-ref-003',
          status: 'completed',
          amount: 501, // Within ±1 tolerance
        },
      });

      const result = await reconcilePaymentsDaily();

      expect(result.synced).toBe(1);

      const updatedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });

      expect(updatedPayment.status).toBe('succeeded');
    });

    it('should sync failed payments', async () => {
      const payment = await prisma.payment.create({
        data: {
          quoteId: testQuote.id,
          amount: 500,
          status: 'pending',
          geniuspayRef: 'gp-ref-004',
          isDeposit: true,
        },
      });

      geniuspay.getPayment.mockResolvedValue({
        data: {
          reference: 'gp-ref-004',
          status: 'failed',
          failure_reason: 'Card declined',
        },
      });

      const result = await reconcilePaymentsDaily();

      expect(result.failed).toBe(1);

      const updatedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });

      expect(updatedPayment.status).toBe('failed');
    });

    it('should detect stuck payments > 7 days', async () => {
      // Create multiple stuck payments
      const sevenDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

      const stuckPayments = [];
      for (let i = 0; i < 12; i++) {
        const quote = await prisma.quote.create({
          data: {
            projectId: testProject.id,
            professionalId: testProfessional.id,
            description: `Quote ${i}`,
            amount: 500,
            status: 'ACCEPTED',
          },
        });

        const payment = await prisma.payment.create({
          data: {
            quoteId: quote.id,
            amount: 500,
            status: 'pending',
            geniuspayRef: `gp-stuck-${i}`,
            isDeposit: true,
            createdAt: sevenDaysAgo,
          },
        });

        stuckPayments.push(payment);

        // Mock still pending on GeniusPay
        geniuspay.getPayment.mockResolvedValueOnce({
          data: {
            reference: `gp-stuck-${i}`,
            status: 'pending',
          },
        });
      }

      const result = await reconcilePaymentsDaily();

      expect(result.stuckPayments.length).toBeGreaterThan(10);

      // Verify admin notification was created
      const adminNotifications = await prisma.notification.findMany({
        where: {
          type: 'SYSTEM_ALERT',
          title: { contains: 'bloqués' },
        },
      });

      expect(adminNotifications.length).toBeGreaterThan(0);

      // Cleanup stuck payments and quotes
      for (const p of stuckPayments) {
        const quote = await prisma.quote.findUnique({ where: { id: p.quoteId } });
        if (quote) await prisma.quote.delete({ where: { id: quote.id } });
      }
    });

    it('should skip payments without geniuspayRef', async () => {
      const payment = await prisma.payment.create({
        data: {
          quoteId: testQuote.id,
          amount: 500,
          status: 'pending',
          geniuspayRef: null,
          isDeposit: true,
        },
      });

      const result = await reconcilePaymentsDaily();

      // Should not attempt to reconcile
      expect(geniuspay.getPayment).not.toHaveBeenCalled();

      const unchangedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });

      expect(unchangedPayment.status).toBe('pending');
    });

    it('should log audit trail for each change', async () => {
      const payment = await prisma.payment.create({
        data: {
          quoteId: testQuote.id,
          amount: 500,
          status: 'pending',
          geniuspayRef: 'gp-ref-005',
          isDeposit: true,
        },
      });

      geniuspay.getPayment.mockResolvedValue({
        data: {
          reference: 'gp-ref-005',
          status: 'completed',
          amount: 500,
        },
      });

      await reconcilePaymentsDaily();

      const auditLogs = await prisma.paymentAuditLog.findMany({
        where: { paymentId: payment.id },
      });

      expect(auditLogs.length).toBeGreaterThan(0);

      const lastLog = auditLogs[auditLogs.length - 1];
      expect(lastLog.fromStatus).toBe('pending');
      expect(lastLog.toStatus).toBe('succeeded');
      expect(lastLog.reason).toBe('reconciliation');
    });

    it('should handle GeniusPay API errors gracefully', async () => {
      const payment = await prisma.payment.create({
        data: {
          quoteId: testQuote.id,
          amount: 500,
          status: 'pending',
          geniuspayRef: 'gp-ref-006',
          isDeposit: true,
        },
      });

      // Mock API error
      geniuspay.getPayment.mockRejectedValue(new Error('API timeout'));

      const result = await reconcilePaymentsDaily();

      expect(result.errors.length).toBe(1);

      // Payment should remain unchanged
      const unchangedPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });

      expect(unchangedPayment.status).toBe('pending');
    });

    it('should return 0 result when no pending payments', async () => {
      const result = await reconcilePaymentsDaily();

      expect(result.reconciled).toBe(0);
      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);
    });
  });
});
