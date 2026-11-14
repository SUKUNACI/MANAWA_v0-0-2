const BookingModule = require('../../modules/booking');

describe('BookingModule', () => {
  let prisma;
  let bookingModule;

  beforeEach(() => {
    prisma = {
      booking: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      professional: {
        findUnique: jest.fn(),
      },
    };

    bookingModule = new BookingModule(prisma);
  });

  describe('getStatuses', () => {
    test('returns all booking statuses', () => {
      const statuses = bookingModule.getStatuses();

      expect(statuses.PENDING).toBe('PENDING');
      expect(statuses.CONFIRMED).toBe('CONFIRMED');
      expect(statuses.COMPLETED).toBe('COMPLETED');
      expect(statuses.CANCELLED).toBe('CANCELLED');
    });
  });

  describe('listBookings', () => {
    test('returns bookings with pagination', async () => {
      const mockBookings = [
        { id: 'booking-1', status: 'CONFIRMED', date: new Date() },
      ];

      prisma.booking.findMany.mockResolvedValue(mockBookings);
      prisma.booking.count.mockResolvedValue(10);

      const result = await bookingModule.listBookings({ skip: 0, take: 20 });

      expect(result.bookings).toEqual(mockBookings);
      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.pageCount).toBe(1);
    });

    test('filters by status', async () => {
      prisma.booking.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValue(0);

      await bookingModule.listBookings({ status: 'CONFIRMED' });

      const callArgs = prisma.booking.findMany.mock.calls[0][0];
      expect(callArgs.where.status).toBe('CONFIRMED');
    });

    test('filters by date range', async () => {
      prisma.booking.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValue(0);

      const dateFrom = new Date('2026-01-01');
      const dateTo = new Date('2026-01-31');

      await bookingModule.listBookings({ dateFrom, dateTo });

      const callArgs = prisma.booking.findMany.mock.calls[0][0];
      expect(callArgs.where.date.gte).toEqual(dateFrom);
      expect(callArgs.where.date.lte).toEqual(dateTo);
    });
  });

  describe('getDetail', () => {
    test('returns full booking detail', async () => {
      const mockBooking = {
        id: 'booking-1',
        status: 'CONFIRMED',
        client: { id: 'client-1' },
        professional: { id: 'pro-1' },
      };

      prisma.booking.findUnique.mockResolvedValue(mockBooking);

      const result = await bookingModule.getDetail('booking-1');

      expect(result).toEqual(mockBooking);
      const callArgs = prisma.booking.findUnique.mock.calls[0][0];
      expect(callArgs.where).toEqual({ id: 'booking-1' });
      expect(callArgs.include.client).toBe(true);
      expect(callArgs.include.professional).toBeTruthy();
    });

    test('throws error if booking not found', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);

      await expect(bookingModule.getDetail('invalid')).rejects.toThrow('Booking not found');
    });
  });

  describe('createFromQuote', () => {
    test('creates booking in PENDING status', async () => {
      prisma.professional.findUnique.mockResolvedValue({
        id: 'pro-1',
        verifiedByAdmin: true,
      });

      const mockBooking = {
        id: 'booking-1',
        status: 'PENDING',
        clientId: 'client-1',
        professionalId: 'pro-1',
      };

      prisma.booking.create.mockResolvedValue(mockBooking);

      const result = await bookingModule.createFromQuote({
        quoteId: 'quote-1',
        clientId: 'client-1',
        professionalId: 'pro-1',
        projectId: 'proj-1',
        date: '2026-01-15',
      });

      expect(result.status).toBe('PENDING');
      expect(prisma.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING',
            clientId: 'client-1',
          }),
        })
      );
    });

    test('throws error if professional not verified', async () => {
      prisma.professional.findUnique.mockResolvedValue({
        id: 'pro-1',
        verifiedByAdmin: false,
      });

      await expect(
        bookingModule.createFromQuote({
          quoteId: 'quote-1',
          clientId: 'client-1',
          professionalId: 'pro-1',
          projectId: 'proj-1',
          date: '2026-01-15',
        })
      ).rejects.toThrow('Professional not verified');
    });
  });

  describe('confirm', () => {
    test('transitions booking to CONFIRMED', async () => {
      const mockBooking = { id: 'booking-1', status: 'CONFIRMED', confirmedAt: new Date() };
      prisma.booking.update.mockResolvedValue(mockBooking);

      const result = await bookingModule.confirm('booking-1');

      expect(result.status).toBe('CONFIRMED');
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({ status: 'CONFIRMED' }),
        })
      );
    });
  });

  describe('cancel', () => {
    test('transitions booking to CANCELLED with reason', async () => {
      const mockBooking = {
        id: 'booking-1',
        status: 'CANCELLED',
        cancellationReason: 'Client request',
      };
      prisma.booking.update.mockResolvedValue(mockBooking);

      const result = await bookingModule.cancel('booking-1', {
        reason: 'Client request',
      });

      expect(result.status).toBe('CANCELLED');
      expect(result.cancellationReason).toBe('Client request');
    });
  });

  describe('complete', () => {
    test('transitions booking to COMPLETED', async () => {
      const mockBooking = { id: 'booking-1', status: 'COMPLETED' };
      prisma.booking.update.mockResolvedValue(mockBooking);

      const result = await bookingModule.complete('booking-1');

      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('getMetrics', () => {
    test('returns booking metrics', async () => {
      prisma.booking.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(10);

      const result = await bookingModule.getMetrics({});

      expect(result.totalBookings).toBe(100);
      expect(result.confirmedCount).toBe(80);
      expect(result.cancelledCount).toBe(10);
      expect(result.avgValue).toBeCloseTo(0.8, 2);
    });
  });
});
