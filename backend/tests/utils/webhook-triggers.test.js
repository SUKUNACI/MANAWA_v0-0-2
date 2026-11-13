/**
 * Tests for webhook-triggers.js
 * Tests all trigger functions: booking, payment, quote, user, project events
 */

jest.mock('../../utils/webhooks', () => ({
  triggerWebhook: jest.fn().mockResolvedValue(undefined),
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

describe('WebhookTriggers', () => {
  let triggers;
  let triggerWebhook;

  // Reusable fixtures
  const booking = {
    id: 'book-1',
    professionalId: 'pro-1',
    clientId: 'client-1',
    date: '2026-01-15',
    startTime: '09:00',
    endTime: '11:00',
    status: 'CONFIRMED',
    projectId: 'proj-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const client = {
    id: 'client-1',
    email: 'client@test.com',
    firstName: 'Jane',
    lastName: 'Doe',
  };
  const professional = {
    id: 'pro-1',
    email: 'pro@test.com',
    firstName: 'John',
    lastName: 'Smith',
    trade: 'plumber',
  };
  const project = {
    id: 'proj-1',
    title: 'Fix pipes',
    description: 'Need plumbing work',
    budgetMin: 100,
    budgetMax: 500,
    tradeNeeded: 'plumber',
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    city: 'Paris',
    latitude: 48.85,
    longitude: 2.35,
    clientId: 'client-1',
    clientConfirmedCompletion: false,
    proConfirmedCompletion: false,
  };
  const quote = {
    id: 'quote-1',
    projectId: 'proj-1',
    professionalId: 'pro-1',
    amount: 300,
    description: 'Install new pipes',
    status: 'PENDING',
    expiresAt: new Date().toISOString(),
    mode: 'FIXED',
    createdAt: new Date().toISOString(),
  };
  const payment = {
    id: 'pay-1',
    quoteId: 'quote-1',
    amount: 300,
    netAmount: 285,
    fees: 15,
    status: 'succeeded',
    paymentMethod: 'card',
    completedAt: new Date().toISOString(),
    isDeposit: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    triggers = require('../../utils/webhook-triggers');
    const webhooks = require('../../utils/webhooks');
    triggerWebhook = webhooks.triggerWebhook;
  });

  // ─────────────────────────────────────────────
  // Exports
  // ─────────────────────────────────────────────
  describe('Exports', () => {
    const expectedExports = [
      'triggerBookingCreated',
      'triggerBookingUpdated',
      'triggerBookingCancelled',
      'triggerPaymentCompleted',
      'triggerPaymentFailed',
      'triggerQuoteCreated',
      'triggerQuoteAccepted',
      'triggerQuoteRefused',
      'triggerUserRegistered',
      'triggerUserVerified',
      'triggerProjectCreated',
      'triggerProjectCompleted',
    ];

    expectedExports.forEach(fn => {
      it(`should export ${fn}`, () => {
        expect(typeof triggers[fn]).toBe('function');
      });
    });
  });

  // ─────────────────────────────────────────────
  // Booking triggers
  // ─────────────────────────────────────────────
  describe('triggerBookingCreated', () => {
    it('should call triggerWebhook with booking.created event', async () => {
      // Act
      await triggers.triggerBookingCreated(booking, client, professional);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'booking.created',
        expect.objectContaining({
          event: 'booking.created',
        })
      );
    });

    it('should include bookingId in payload data', async () => {
      // Act
      await triggers.triggerBookingCreated(booking, client, professional);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.bookingId).toBe('book-1');
    });

    it('should include client and professional info in payload', async () => {
      // Act
      await triggers.triggerBookingCreated(booking, client, professional);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.client.email).toBe('client@test.com');
      expect(payload.data.professional.email).toBe('pro@test.com');
    });

    it('should include timestamp in payload', async () => {
      // Act
      await triggers.triggerBookingCreated(booking, client, professional);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.timestamp).toBeDefined();
      expect(typeof payload.timestamp).toBe('string');
    });
  });

  describe('triggerBookingUpdated', () => {
    it('should call triggerWebhook with booking.updated event', async () => {
      // Act
      await triggers.triggerBookingUpdated(booking, client, professional, 'PENDING');

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'booking.updated',
        expect.objectContaining({ event: 'booking.updated' })
      );
    });

    it('should include oldStatus and newStatus in payload', async () => {
      // Act
      await triggers.triggerBookingUpdated(booking, client, professional, 'PENDING');

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.oldStatus).toBe('PENDING');
      expect(payload.data.newStatus).toBe('CONFIRMED');
    });
  });

  describe('triggerBookingCancelled', () => {
    it('should call triggerWebhook with booking.cancelled event', async () => {
      // Act
      await triggers.triggerBookingCancelled(booking, client, professional, 'User request');

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'booking.cancelled',
        expect.objectContaining({ event: 'booking.cancelled' })
      );
    });

    it('should include cancelReason in payload', async () => {
      // Act
      await triggers.triggerBookingCancelled(booking, client, professional, 'User request');

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.cancelReason).toBe('User request');
    });

    it('should include cancelledAt timestamp', async () => {
      // Act
      await triggers.triggerBookingCancelled(booking, client, professional, '');

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.cancelledAt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // Payment triggers
  // ─────────────────────────────────────────────
  describe('triggerPaymentCompleted', () => {
    it('should call triggerWebhook with payment.completed event', async () => {
      // Act
      await triggers.triggerPaymentCompleted(payment, quote, professional, client);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'payment.completed',
        expect.objectContaining({ event: 'payment.completed' })
      );
    });

    it('should include payment amount, fees, and net amount', async () => {
      // Act
      await triggers.triggerPaymentCompleted(payment, quote, professional, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.amount).toBe(300);
      expect(payload.data.netAmount).toBe(285);
      expect(payload.data.fees).toBe(15);
    });
  });

  describe('triggerPaymentFailed', () => {
    it('should call triggerWebhook with payment.failed event', async () => {
      // Act
      await triggers.triggerPaymentFailed(
        payment,
        quote,
        professional,
        client,
        'Insufficient funds'
      );

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'payment.failed',
        expect.objectContaining({ event: 'payment.failed' })
      );
    });

    it('should include failureReason in payload', async () => {
      // Act
      await triggers.triggerPaymentFailed(
        payment,
        quote,
        professional,
        client,
        'Card declined'
      );

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.failureReason).toBe('Card declined');
    });

    it('should include failedAt timestamp', async () => {
      // Act
      await triggers.triggerPaymentFailed(payment, quote, professional, client, '');

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.failedAt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // Quote triggers
  // ─────────────────────────────────────────────
  describe('triggerQuoteCreated', () => {
    it('should call triggerWebhook with quote.created event', async () => {
      // Act
      await triggers.triggerQuoteCreated(quote, professional, project, client);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'quote.created',
        expect.objectContaining({ event: 'quote.created' })
      );
    });

    it('should include professional trade in payload', async () => {
      // Act
      await triggers.triggerQuoteCreated(quote, professional, project, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.professional.trade).toBe('plumber');
    });

    it('should include project budget range', async () => {
      // Act
      await triggers.triggerQuoteCreated(quote, professional, project, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.project.budget.min).toBe(100);
      expect(payload.data.project.budget.max).toBe(500);
    });
  });

  describe('triggerQuoteAccepted', () => {
    it('should call triggerWebhook with quote.accepted event', async () => {
      // Act
      await triggers.triggerQuoteAccepted(quote, professional, project, client);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'quote.accepted',
        expect.objectContaining({ event: 'quote.accepted' })
      );
    });

    it('should include acceptedAt timestamp', async () => {
      // Act
      await triggers.triggerQuoteAccepted(quote, professional, project, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.acceptedAt).toBeDefined();
    });
  });

  describe('triggerQuoteRefused', () => {
    it('should call triggerWebhook with quote.refused event', async () => {
      // Act
      await triggers.triggerQuoteRefused(quote, professional, project, client);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'quote.refused',
        expect.objectContaining({ event: 'quote.refused' })
      );
    });

    it('should include refusedAt timestamp', async () => {
      // Act
      await triggers.triggerQuoteRefused(quote, professional, project, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.refusedAt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // User triggers
  // ─────────────────────────────────────────────
  describe('triggerUserRegistered', () => {
    const user = {
      id: 'user-1',
      email: 'user@test.com',
      firstName: 'Alice',
      lastName: 'Martin',
      role: 'CLIENT',
      phone: '+33612345678',
      emailVerified: false,
      createdAt: new Date().toISOString(),
    };

    it('should call triggerWebhook with user.registered event', async () => {
      // Act
      await triggers.triggerUserRegistered(user);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'user.registered',
        expect.objectContaining({ event: 'user.registered' })
      );
    });

    it('should include user fields in payload', async () => {
      // Act
      await triggers.triggerUserRegistered(user);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.userId).toBe('user-1');
      expect(payload.data.email).toBe('user@test.com');
      expect(payload.data.role).toBe('CLIENT');
    });
  });

  describe('triggerUserVerified', () => {
    const user = {
      id: 'user-2',
      email: 'verified@test.com',
      firstName: 'Bob',
      lastName: 'Brown',
      role: 'PROFESSIONAL',
    };

    it('should call triggerWebhook with user.verified event', async () => {
      // Act
      await triggers.triggerUserVerified(user);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'user.verified',
        expect.objectContaining({ event: 'user.verified' })
      );
    });

    it('should include verifiedAt timestamp', async () => {
      // Act
      await triggers.triggerUserVerified(user);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.verifiedAt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // Project triggers
  // ─────────────────────────────────────────────
  describe('triggerProjectCreated', () => {
    it('should call triggerWebhook with project.created event', async () => {
      // Act
      await triggers.triggerProjectCreated(project, client);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'project.created',
        expect.objectContaining({ event: 'project.created' })
      );
    });

    it('should include project location in payload', async () => {
      // Act
      await triggers.triggerProjectCreated(project, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.location.city).toBe('Paris');
      expect(payload.data.location.latitude).toBe(48.85);
    });

    it('should include client details in payload', async () => {
      // Act
      await triggers.triggerProjectCreated(project, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.client.email).toBe('client@test.com');
    });
  });

  describe('triggerProjectCompleted', () => {
    it('should call triggerWebhook with project.completed event', async () => {
      // Act
      await triggers.triggerProjectCompleted(project, client);

      // Assert
      expect(triggerWebhook).toHaveBeenCalledWith(
        'project.completed',
        expect.objectContaining({ event: 'project.completed' })
      );
    });

    it('should include completedAt timestamp', async () => {
      // Act
      await triggers.triggerProjectCompleted(project, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data.completedAt).toBeDefined();
    });

    it('should include client confirmation status', async () => {
      // Act
      await triggers.triggerProjectCompleted(project, client);

      // Assert
      const payload = triggerWebhook.mock.calls[0][1];
      expect(payload.data).toHaveProperty('clientConfirmedCompletion');
      expect(payload.data).toHaveProperty('proConfirmedCompletion');
    });
  });

  // ─────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────
  describe('Error propagation', () => {
    it('should propagate error when triggerWebhook throws', async () => {
      // Arrange
      triggerWebhook.mockRejectedValueOnce(new Error('Network error'));

      // Act & Assert
      await expect(
        triggers.triggerBookingCreated(booking, client, professional)
      ).rejects.toThrow('Network error');
    });
  });
});
