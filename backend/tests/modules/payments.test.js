const PaymentsModule = require('../../modules/payments');

describe('PaymentsModule', () => {
  let prisma;
  let stripe;
  let paymentsModule;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
      },
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      },
    };

    stripe = {
      paymentIntents: { create: jest.fn() },
      refunds: { create: jest.fn() },
    };

    paymentsModule = new PaymentsModule(prisma, stripe);
  });

  describe('getStatuses', () => {
    test('returns all payment statuses', () => {
      const statuses = paymentsModule.getStatuses();

      expect(statuses.PENDING).toBe('PENDING');
      expect(statuses.PROCESSING).toBe('PROCESSING');
      expect(statuses.COMPLETED).toBe('COMPLETED');
      expect(statuses.FAILED).toBe('FAILED');
      expect(statuses.REFUNDED).toBe('REFUNDED');
    });
  });

  describe('createPaymentIntent', () => {
    test('creates payment in PENDING status', async () => {
      prisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        clientId: 'client-1',
      });

      const mockPayment = {
        id: 'payment-1',
        bookingId: 'booking-1',
        status: 'PENDING',
        amount: 100,
      };
      prisma.payment.create.mockResolvedValue(mockPayment);

      const result = await paymentsModule.createPaymentIntent({
        bookingId: 'booking-1',
        amount: 100,
        currency: 'EUR',
        description: 'Booking payment',
      });

      expect(result.status).toBe('PENDING');
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING',
            amount: 100,
          }),
        })
      );
    });

    test('throws error if booking not found', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);

      await expect(
        paymentsModule.createPaymentIntent({
          bookingId: 'invalid',
          amount: 100,
        })
      ).rejects.toThrow('Booking not found');
    });
  });

  describe('processPayment', () => {
    test('processes payment successfully (mock mode)', async () => {
      const mockPayment = {
        id: 'payment-1',
        amount: 100,
        currency: 'EUR',
        status: 'PENDING',
      };

      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.payment.update.mockResolvedValueOnce({ status: 'PROCESSING' });

      const completedPayment = { ...mockPayment, status: 'COMPLETED', completedAt: new Date() };
      prisma.payment.update.mockResolvedValueOnce(completedPayment);

      const result = await paymentsModule.processPayment('payment-1', {});

      expect(result.status).toBe('COMPLETED');
      expect(prisma.payment.update).toHaveBeenCalledTimes(2);
    });

    test('processes payment with Stripe', async () => {
      const mockPayment = {
        id: 'payment-1',
        amount: 100,
        currency: 'EUR',
        status: 'PENDING',
      };

      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.payment.update.mockResolvedValueOnce({ status: 'PROCESSING' });

      stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_12345',
        status: 'succeeded',
      });

      const completedPayment = {
        ...mockPayment,
        status: 'COMPLETED',
        stripePaymentIntentId: 'pi_12345',
      };
      prisma.payment.update.mockResolvedValueOnce(completedPayment);

      const result = await paymentsModule.processPayment('payment-1', {
        stripeToken: 'tok_test',
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.stripePaymentIntentId).toBe('pi_12345');
      expect(stripe.paymentIntents.create).toHaveBeenCalled();
    });

    test('marks payment as FAILED on Stripe error', async () => {
      const mockPayment = {
        id: 'payment-1',
        amount: 100,
        currency: 'EUR',
        status: 'PENDING',
      };

      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.payment.update.mockResolvedValueOnce({ status: 'PROCESSING' });

      stripe.paymentIntents.create.mockRejectedValue(new Error('Stripe error'));

      const failedPayment = {
        ...mockPayment,
        status: 'FAILED',
        errorMessage: 'Stripe error',
      };
      prisma.payment.update.mockResolvedValueOnce(failedPayment);

      await expect(
        paymentsModule.processPayment('payment-1', { stripeToken: 'tok_test' })
      ).rejects.toThrow('Stripe error');

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        })
      );
    });
  });

  describe('refundPayment', () => {
    test('refunds completed payment', async () => {
      const mockPayment = {
        id: 'payment-1',
        status: 'COMPLETED',
        stripePaymentIntentId: 'pi_12345',
      };

      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      stripe.refunds.create.mockResolvedValue({ id: 're_12345' });

      const refundedPayment = {
        ...mockPayment,
        status: 'REFUNDED',
        refundReason: 'Customer request',
        refundedAt: new Date(),
      };
      prisma.payment.update.mockResolvedValue(refundedPayment);

      const result = await paymentsModule.refundPayment('payment-1', {
        reason: 'Customer request',
      });

      expect(result.status).toBe('REFUNDED');
      expect(stripe.refunds.create).toHaveBeenCalled();
    });

    test('throws error if payment not completed', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        status: 'PENDING',
      });

      await expect(
        paymentsModule.refundPayment('payment-1', { reason: 'Test' })
      ).rejects.toThrow('Only completed payments can be refunded');
    });

    test('handles Stripe refund error', async () => {
      const mockPayment = {
        id: 'payment-1',
        status: 'COMPLETED',
        stripePaymentIntentId: 'pi_12345',
      };

      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      stripe.refunds.create.mockRejectedValue(new Error('Stripe refund failed'));

      await expect(
        paymentsModule.refundPayment('payment-1', { reason: 'Test' })
      ).rejects.toThrow('Stripe refund failed');
    });
  });

  describe('handleStripeWebhook', () => {
    test('handles payment_intent.succeeded event', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await paymentsModule.handleStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_12345' } },
      });

      expect(result.success).toBe(true);
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        })
      );
    });

    test('handles payment_intent.payment_failed event', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await paymentsModule.handleStripeWebhook({
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_12345',
            last_payment_error: { message: 'Card declined' },
          },
        },
      });

      expect(result.success).toBe(true);
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        })
      );
    });

    test('handles charge.refunded event', async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await paymentsModule.handleStripeWebhook({
        type: 'charge.refunded',
        data: { object: { payment_intent: 'pi_12345' } },
      });

      expect(result.success).toBe(true);
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REFUNDED' }),
        })
      );
    });

    test('ignores unhandled webhook events', async () => {
      const result = await paymentsModule.handleStripeWebhook({
        type: 'charge.created',
        data: { object: {} },
      });

      expect(result.success).toBe(true);
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getDetails', () => {
    test('returns payment with booking details', async () => {
      const mockPayment = {
        id: 'payment-1',
        amount: 100,
        booking: { id: 'booking-1' },
      };

      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await paymentsModule.getDetails('payment-1');

      expect(result).toEqual(mockPayment);
    });
  });

  describe('getMetrics', () => {
    test('returns payment metrics', async () => {
      prisma.payment.aggregate
        .mockResolvedValueOnce({
          _sum: { amount: 5000 },
          _count: { id: 50 },
        })
        .mockResolvedValueOnce({
          _sum: { amount: 300 },
        });

      prisma.payment.count.mockResolvedValue(5);

      const result = await paymentsModule.getMetrics({});

      expect(result.totalAmount).toBe(5000);
      expect(result.completedCount).toBe(50);
      expect(result.failedCount).toBe(5);
      expect(result.refundedAmount).toBe(300);
    });
  });
});
