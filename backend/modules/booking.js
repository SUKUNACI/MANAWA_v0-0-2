'use strict';

const logger = require('../utils/logger');

/**
 * Booking Module — Centralized booking workflow and state management
 * Handles booking creation, status transitions, and listing with filters
 */

const BOOKING_STATUSES = {
  PENDING: 'PENDING',         // Initial state, awaiting confirmation
  CONFIRMED: 'CONFIRMED',     // Professional confirmed, payment pending
  COMPLETED: 'COMPLETED',     // Service completed
  CANCELLED: 'CANCELLED',     // Cancelled by client or professional
};

class BookingModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Get all valid booking statuses
   * @returns {object}
   */
  getStatuses() {
    return BOOKING_STATUSES;
  }

  /**
   * List bookings with filters and pagination
   * @param {object} opts - { userId, status, dateFrom, dateTo, search, skip, take }
   * @returns {Promise<{bookings, total, page, pageCount}>}
   */
  async listBookings({ userId, status, dateFrom, dateTo, search, skip = 0, take = 20 } = {}) {
    try {
      let where = {};

      if (status) where.status = status;
      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) where.date.gte = new Date(dateFrom);
        if (dateTo) where.date.lte = new Date(dateTo);
      }
      if (search) {
        where.OR = [
          { client: { firstName: { contains: search, mode: 'insensitive' } } },
          { client: { lastName: { contains: search, mode: 'insensitive' } } },
          { professional: { user: { firstName: { contains: search, mode: 'insensitive' } } } },
          { professional: { user: { lastName: { contains: search, mode: 'insensitive' } } } },
        ];
      }

      const [bookings, total] = await Promise.all([
        this.prisma.booking.findMany({
          where,
          include: {
            client: { select: { id: true, firstName: true, lastName: true, email: true } },
            professional: {
              include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
            },
            project: true,
          },
          skip,
          take,
          orderBy: { date: 'desc' },
        }),
        this.prisma.booking.count({ where }),
      ]);

      const page = Math.floor(skip / take) + 1;
      const pageCount = Math.ceil(total / take);

      return { bookings, total, page, pageCount };
    } catch (err) {
      logger.error('[BookingModule] listBookings failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Get booking detail with all relations
   * @param {string} bookingId - Booking ID
   * @returns {Promise<object>}
   */
  async getDetail(bookingId) {
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          client: true,
          professional: { include: { user: true } },
          project: true,
          auditLog: true,
        },
      });

      if (!booking) {
        throw new Error('Booking not found');
      }

      return booking;
    } catch (err) {
      logger.error('[BookingModule] getDetail failed', { bookingId, error: err.message });
      throw err;
    }
  }

  /**
   * Create a new booking from a quote
   * @param {object} opts - { quoteId, clientId, professionalId, projectId, date }
   * @returns {Promise<object>} Created booking
   */
  async createFromQuote({ quoteId, clientId, professionalId, projectId, date }) {
    try {
      // Verify professional exists and is verified
      const professional = await this.prisma.professional.findUnique({
        where: { id: professionalId },
        select: { id: true, verifiedByAdmin: true },
      });

      if (!professional) {
        throw new Error('Professional not found');
      }

      if (!professional.verifiedByAdmin) {
        throw new Error('Professional not verified');
      }

      // Create booking in PENDING state
      const booking = await this.prisma.booking.create({
        data: {
          status: BOOKING_STATUSES.PENDING,
          clientId,
          professionalId,
          projectId,
          quoteId,
          date: new Date(date),
        },
        include: {
          client: true,
          professional: { include: { user: true } },
          project: true,
        },
      });

      logger.info('[BookingModule] Booking created', { bookingId: booking.id, clientId, professionalId });
      return booking;
    } catch (err) {
      logger.error('[BookingModule] createFromQuote failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Confirm booking (state: PENDING → CONFIRMED)
   * @param {string} bookingId - Booking ID
   * @returns {Promise<object>}
   */
  async confirm(bookingId) {
    try {
      const booking = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: BOOKING_STATUSES.CONFIRMED,
          confirmedAt: new Date(),
        },
        include: { client: true, professional: { include: { user: true } } },
      });

      logger.info('[BookingModule] Booking confirmed', { bookingId });
      return booking;
    } catch (err) {
      logger.error('[BookingModule] confirm failed', { bookingId, error: err.message });
      throw err;
    }
  }

  /**
   * Cancel booking (→ CANCELLED state)
   * @param {string} bookingId - Booking ID
   * @param {object} opts - { reason, notifyByEmail }
   * @returns {Promise<object>}
   */
  async cancel(bookingId, { reason, notifyByEmail = false } = {}) {
    try {
      const booking = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: BOOKING_STATUSES.CANCELLED,
          cancellationReason: reason || null,
          cancelledAt: new Date(),
        },
        include: {
          client: true,
          professional: { include: { user: true } },
        },
      });

      logger.info('[BookingModule] Booking cancelled', { bookingId, reason });

      if (notifyByEmail) {
        // TODO: Delegate to email service
        logger.info('[BookingModule] Cancellation notification queued', { bookingId });
      }

      return booking;
    } catch (err) {
      logger.error('[BookingModule] cancel failed', { bookingId, error: err.message });
      throw err;
    }
  }

  /**
   * Complete booking (→ COMPLETED state)
   * @param {string} bookingId - Booking ID
   * @returns {Promise<object>}
   */
  async complete(bookingId) {
    try {
      const booking = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: BOOKING_STATUSES.COMPLETED,
          completedAt: new Date(),
        },
        include: { client: true, professional: { include: { user: true } } },
      });

      logger.info('[BookingModule] Booking completed', { bookingId });
      return booking;
    } catch (err) {
      logger.error('[BookingModule] complete failed', { bookingId, error: err.message });
      throw err;
    }
  }

  /**
   * Get booking metrics for dashboard
   * @param {object} opts - { dateFrom, dateTo }
   * @returns {Promise<{totalBookings, confirmedCount, cancelledCount, avgValue}>}
   */
  async getMetrics({ dateFrom, dateTo } = {}) {
    try {
      let where = {};
      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) where.date.gte = new Date(dateFrom);
        if (dateTo) where.date.lte = new Date(dateTo);
      }

      const [totalBookings, confirmedCount, cancelledCount] = await Promise.all([
        this.prisma.booking.count({ where }),
        this.prisma.booking.count({ where: { ...where, status: BOOKING_STATUSES.CONFIRMED } }),
        this.prisma.booking.count({ where: { ...where, status: BOOKING_STATUSES.CANCELLED } }),
      ]);

      return {
        totalBookings,
        confirmedCount,
        cancelledCount,
        avgValue: totalBookings > 0 ? confirmedCount / totalBookings : 0,
      };
    } catch (err) {
      logger.warn('[BookingModule] getMetrics failed', { error: err.message });
      return { totalBookings: 0, confirmedCount: 0, cancelledCount: 0, avgValue: 0 };
    }
  }
}

module.exports = BookingModule;
