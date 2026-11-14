const AnalyticsModule = require('../../modules/analytics');

describe('AnalyticsModule', () => {
  let prisma;
  let analyticsModule;

  beforeEach(() => {
    prisma = {
      analyticsEvent: {
        create: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    analyticsModule = new AnalyticsModule(prisma);
  });

  describe('getEventTypes', () => {
    test('returns all event types', () => {
      const types = analyticsModule.getEventTypes();

      expect(types.PROFILE_VIEW).toBe('PROFILE_VIEW');
      expect(types.QUOTE_SUBMITTED).toBe('QUOTE_SUBMITTED');
      expect(types.BOOKING_CREATED).toBe('BOOKING_CREATED');
      expect(types.PAYMENT_PROCESSED).toBe('PAYMENT_PROCESSED');
    });
  });

  describe('trackEvent', () => {
    test('creates analytics event', async () => {
      const mockEvent = {
        id: 'event-1',
        type: 'PROFILE_VIEW',
        userId: 'user-1',
      };
      prisma.analyticsEvent.create.mockResolvedValue(mockEvent);

      const result = await analyticsModule.trackEvent('PROFILE_VIEW', {
        userId: 'user-1',
        entityId: 'pro-1',
        entityType: 'Professional',
      });

      expect(result).toEqual(mockEvent);
      expect(prisma.analyticsEvent.create).toHaveBeenCalled();
    });

    test('returns null on error (does not throw)', async () => {
      prisma.analyticsEvent.create.mockRejectedValue(new Error('DB error'));

      const result = await analyticsModule.trackEvent('PROFILE_VIEW', {
        userId: 'user-1',
      });

      expect(result).toBeNull();
    });

    test('throws error for invalid event type', async () => {
      await expect(
        analyticsModule.trackEvent('INVALID_TYPE', { userId: 'user-1' })
      ).rejects.toThrow('Invalid event type');
    });
  });

  describe('trackProfileView', () => {
    test('tracks profile view event', async () => {
      const mockEvent = { id: 'event-1', type: 'PROFILE_VIEW' };
      prisma.analyticsEvent.create.mockResolvedValue(mockEvent);

      const result = await analyticsModule.trackProfileView('pro-1', 'user-1');

      expect(result).toEqual(mockEvent);
      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PROFILE_VIEW',
            entityType: 'Professional',
          }),
        })
      );
    });
  });

  describe('trackQuoteInteraction', () => {
    test('tracks quote view', async () => {
      const mockEvent = { id: 'event-1', type: 'QUOTE_VIEW' };
      prisma.analyticsEvent.create.mockResolvedValue(mockEvent);

      const result = await analyticsModule.trackQuoteInteraction('quote-1', 'user-1', 'VIEW');

      expect(result).toEqual(mockEvent);
    });

    test('tracks quote submission', async () => {
      const mockEvent = { id: 'event-1', type: 'QUOTE_SUBMITTED' };
      prisma.analyticsEvent.create.mockResolvedValue(mockEvent);

      const result = await analyticsModule.trackQuoteInteraction('quote-1', 'user-1', 'SUBMIT');

      expect(result).toEqual(mockEvent);
      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'QUOTE_SUBMITTED' }),
        })
      );
    });
  });

  describe('getConversionFunnel', () => {
    test('returns conversion funnel metrics', async () => {
      prisma.analyticsEvent.count
        .mockResolvedValueOnce(1000) // views
        .mockResolvedValueOnce(150) // quotes
        .mockResolvedValueOnce(50) // bookings
        .mockResolvedValueOnce(40); // payments

      const result = await analyticsModule.getConversionFunnel({});

      expect(result.views).toBe(1000);
      expect(result.quotes).toBe(150);
      expect(result.bookings).toBe(50);
      expect(result.payments).toBe(40);
      expect(result.conversionRate).toBe('5.00');
    });

    test('returns 0.00 conversion rate when no views', async () => {
      prisma.analyticsEvent.count
        .mockResolvedValueOnce(0) // views
        .mockResolvedValueOnce(0) // quotes
        .mockResolvedValueOnce(0) // bookings
        .mockResolvedValueOnce(0); // payments

      const result = await analyticsModule.getConversionFunnel({});

      expect(result.conversionRate).toBe('0.00');
    });
  });

  describe('getTopProfessionals', () => {
    test('returns top professionals by views', async () => {
      const mockStats = [
        { entityId: 'pro-1', _count: { id: 100 } },
        { entityId: 'pro-2', _count: { id: 80 } },
      ];
      prisma.analyticsEvent.groupBy.mockResolvedValue(mockStats);

      const result = await analyticsModule.getTopProfessionals(10);

      expect(result[0]).toEqual({ professionalId: 'pro-1', viewCount: 100 });
      expect(result[1]).toEqual({ professionalId: 'pro-2', viewCount: 80 });
    });

    test('returns empty array on error', async () => {
      prisma.analyticsEvent.groupBy.mockRejectedValue(new Error('DB error'));

      const result = await analyticsModule.getTopProfessionals();

      expect(result).toEqual([]);
    });
  });

  describe('getUserMetrics', () => {
    test('returns user activity metrics', async () => {
      prisma.analyticsEvent.count
        .mockResolvedValueOnce(5) // profileViews
        .mockResolvedValueOnce(2) // quotesSubmitted
        .mockResolvedValueOnce(1); // bookingsCreated

      prisma.analyticsEvent.findFirst.mockResolvedValue({
        createdAt: new Date('2026-01-15'),
      });

      const result = await analyticsModule.getUserMetrics('user-1');

      expect(result.profileViews).toBe(5);
      expect(result.quotesSubmitted).toBe(2);
      expect(result.bookingsCreated).toBe(1);
      expect(result.lastActivity).not.toBeNull();
    });

    test('returns null lastActivity if no events', async () => {
      prisma.analyticsEvent.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      prisma.analyticsEvent.findFirst.mockResolvedValue(null);

      const result = await analyticsModule.getUserMetrics('user-1');

      expect(result.lastActivity).toBeNull();
    });
  });

  describe('getSearchTrends', () => {
    test('returns top search queries', async () => {
      const mockTrends = [
        { metadata: { query: 'plumber' }, _count: { id: 50 } },
        { metadata: { query: 'electrician' }, _count: { id: 30 } },
      ];
      prisma.analyticsEvent.groupBy.mockResolvedValue(mockTrends);

      const result = await analyticsModule.getSearchTrends(10);

      expect(result[0]).toEqual({ query: 'plumber', count: 50 });
      expect(result[1]).toEqual({ query: 'electrician', count: 30 });
    });

    test('returns empty array on error', async () => {
      prisma.analyticsEvent.groupBy.mockRejectedValue(new Error('DB error'));

      const result = await analyticsModule.getSearchTrends();

      expect(result).toEqual([]);
    });
  });
});
