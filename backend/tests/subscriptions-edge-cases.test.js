const SubscriptionModule = require('../modules/subscription');
const prisma = require('../config/db');

jest.mock('../config/db');
jest.mock('../utils/geniuspay');
const geniuspay = require('../utils/geniuspay');

describe('SubscriptionModule — Edge Cases', () => {
  let subscription;

  beforeEach(() => {
    subscription = new SubscriptionModule(prisma);
    jest.clearAllMocks();
  });

  it('throws 400 when promo code does not exist', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(null);

    try {
      await subscription.validatePromoForCheckout('INVALID20', 'PRO', 'pro-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toContain('Code invalide');
    }
  });

  it('throws 400 when promo code is inactive', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      code: 'INACTIVE20',
      active: false,
      validUntil: new Date(Date.now() + 1000 * 60 * 60),
    });

    try {
      await subscription.validatePromoForCheckout('INACTIVE20', 'PRO', 'pro-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toContain('Code désactivé');
    }
  });

  it('throws 400 when promo code usage limit reached', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      code: 'LIMITED20',
      active: true,
      validUntil: new Date(Date.now() + 1000 * 60 * 60),
      maxUses: 100,
      usedCount: 100,
    });

    try {
      await subscription.validatePromoForCheckout('LIMITED20', 'PRO', 'pro-1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toContain('Code limite atteinte');
    }
  });

  it('activates subscription immediately when amount becomes zero after promo', async () => {
    const professional = {
      id: 'pro-1',
      user: { email: 'pro@test.com', firstName: 'Pro', lastName: 'User', phone: '+33612345678' },
    };

    prisma.subscription.upsert.mockResolvedValue({
      id: 'sub-1',
      professionalId: 'pro-1',
      tier: 'PRO',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'FREE100',
      active: true,
      validUntil: new Date(Date.now() + 1000 * 60 * 60),
      discountType: 'FIXED',
      discountValue: 5000,
      applicableTiers: ['PRO'],
    });

    const result = await subscription.createCheckout('PRO', 'FREE100', professional);

    expect(result.activated).toBe(true);
    expect(result.finalAmount).toBe(0);
    expect(result.message).toContain('Abonnement activé sans frais');
  });

  it('throws 500 when GeniusPay returns invalid checkout URL', async () => {
    const professional = {
      id: 'pro-1',
      user: { email: 'pro@test.com', firstName: 'Pro', lastName: 'User', phone: '+33612345678' },
    };

    prisma.subscription.upsert.mockResolvedValue({
      id: 'sub-1',
      professionalId: 'pro-1',
      tier: 'PRO',
      status: 'PENDING_PAYMENT',
    });

    geniuspay.createPayment.mockResolvedValue({
      reference: 'ref-123',
      // Missing checkout_url
    });

    try {
      await subscription.createCheckout('PRO', null, professional);
      expect(true).toBe(false);
    } catch (err) {
      expect(err.status).toBe(500);
      expect(err.message).toContain('Impossible de créer le paiement');
    }
  });
});
