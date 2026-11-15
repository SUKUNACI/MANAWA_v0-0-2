const PaymentRetryModule = require('../modules/paymentRetry');
const prisma = require('../config/db');

jest.mock('../config/db');
jest.mock('../utils/geniuspay');
const geniuspay = require('../utils/geniuspay');

describe('PaymentRetryModule — Edge Cases', () => {
  let paymentRetry;

  beforeEach(() => {
    paymentRetry = new PaymentRetryModule(prisma);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });;

  it('throws 403 when user not authorized for payment', async () => {
    const payment = {
      quoteId: 'quote-1',
      quote: {
        project: { clientId: 'client-1' },
        professional: { userId: 'pro-1' },
      },
    };

    try {
      await paymentRetry.validatePaymentOwnership(payment, 'hacker-user');
      expect(true).toBe(false); // Should throw
    } catch (err) {
      expect(err.status).toBe(403);
    }
  });

  it('throws 400 when payment status not failed', async () => {
    const payment = { status: 'completed' };

    try {
      await paymentRetry.canRetryPayment(payment);
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  it('returns 0 when payment has no audit logs', async () => {
    const payment = { auditLogs: null };
    const count = await paymentRetry.countRetryAttempts(payment);
    expect(count).toBe(0);
  });

  it('returns null when promo code expired', async () => {
    const expiredDate = new Date(Date.now() - 1000 * 60 * 60);
    const payment = { metadata: { promoCodeId: 'promo-1' } };

    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      active: true,
      validUntil: expiredDate,
    });

    const promo = await paymentRetry.reapplyPromoCode(payment, {});
    expect(promo).toBeNull();
  });

  it('throws 400 when max retry attempts exceeded', async () => {
    const payment = {
      id: 'pay-1',
      status: 'failed',
      amount: 5000,
      quoteId: 'quote-1',
      auditLogs: [{ reason: 'retry' }, { reason: 'retry' }, { reason: 'retry' }],
      quote: {
        professional: {
          userId: 'pro-1',
          user: { email: 'pro@test.com', firstName: 'Pro', lastName: 'User' },
        },
        project: { clientId: 'client-1' },
      },
    };

    prisma.payment.findUnique.mockResolvedValue(payment);

    try {
      await paymentRetry.retryPayment('pay-1', 'client-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  it('throws 500 when GeniusPay API fails', async () => {
    const payment = {
      id: 'pay-1',
      status: 'failed',
      amount: 5000,
      quoteId: 'quote-1',
      auditLogs: [],
      metadata: null,
      quote: {
        professional: {
          userId: 'pro-1',
          user: { email: 'pro@test.com', firstName: 'Pro', lastName: 'User' },
        },
        project: { clientId: 'client-1' },
      },
    };

    prisma.payment.findUnique.mockResolvedValue(payment);
    geniuspay.createPayment.mockRejectedValue(new Error('API Error'));

    try {
      await paymentRetry.retryPayment('pay-1', 'client-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(500);
    }
  });

  it('throws 500 when GeniusPay returns invalid response', async () => {
    const payment = {
      id: 'pay-1',
      status: 'failed',
      amount: 5000,
      quoteId: 'quote-1',
      auditLogs: [],
      metadata: null,
      quote: {
        professional: {
          userId: 'pro-1',
          user: { email: 'pro@test.com', firstName: 'Pro', lastName: 'User' },
        },
        project: { clientId: 'client-1' },
      },
    };

    prisma.payment.findUnique.mockResolvedValue(payment);
    geniuspay.createPayment.mockResolvedValue({ checkout_url: 'https://test.com' });

    try {
      await paymentRetry.retryPayment('pay-1', 'client-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(500);
    }
  });

  it('applies PERCENT discount correctly on retry', async () => {
    const payment = {
      id: 'pay-1',
      status: 'failed',
      amount: 5000,
      quoteId: 'quote-1',
      auditLogs: [],
      metadata: { promoCodeId: 'promo-1' },
      quote: {
        professional: {
          userId: 'pro-1',
          user: { email: 'pro@test.com', firstName: 'Pro', lastName: 'User' },
        },
        project: { clientId: 'client-1' },
      },
    };

    const updatedPayment = { ...payment, status: 'pending', geniuspayRef: 'ref-123', amount: 4500 };

    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'SAVE10',
      active: true,
      validUntil: new Date(Date.now() + 1000 * 60 * 60),
      discountType: 'PERCENT',
      discountValue: 10,
    });
    geniuspay.createPayment.mockResolvedValue({
      reference: 'ref-123',
      checkout_url: 'https://test.com',
    });
    prisma.payment.update.mockResolvedValue(updatedPayment);
    prisma.paymentAuditLog.create.mockResolvedValue({});

    const result = await paymentRetry.retryPayment('pay-1', 'client-1');
    expect(result.data.amount).toBe(4500);
    expect(result.data.discountAmount).toBe(500);
  });
});
