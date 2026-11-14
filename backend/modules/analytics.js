'use strict';

const logger = require('../utils/logger');

/**
 * Analytics Module — Centralized event tracking and metrics aggregation
 * Tracks user actions (profile views, quote clicks, bookings, conversions)
 */

const EVENT_TYPES = {
  PROFILE_VIEW: 'PROFILE_VIEW',
  QUOTE_VIEW: 'QUOTE_VIEW',
  QUOTE_SUBMITTED: 'QUOTE_SUBMITTED',
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  PAYMENT_PROCESSED: 'PAYMENT_PROCESSED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  SEARCH_PERFORMED: 'SEARCH_PERFORMED',
};

class AnalyticsModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Get all valid event types
   * @returns {object}
   */
  getEventTypes() {
    return EVENT_TYPES;
  }

  /**
   * Track a user event
   * @param {string} type - Event type
   * @param {object} opts - { userId, entityId, entityType, metadata }
   * @returns {Promise<object>}
   */
  async trackEvent(type, { userId, entityId, entityType, metadata = {} } = {}) {
    if (!(type in EVENT_TYPES)) {
      logger.warn('[AnalyticsModule] Invalid event type', { type });
      throw new Error(`Invalid event type: ${type}`);
    }

    try {
      const event = await this.prisma.analyticsEvent.create({
        data: {
          type,
          userId,
          entityId,
          entityType,
          metadata,
        },
      });

      logger.debug('[AnalyticsModule] Event tracked', { type, userId });
      return event;
    } catch (err) {
      logger.warn('[AnalyticsModule] Failed to track event', { type, error: err.message });
      // Don't throw — analytics failures should not block user actions
      return null;
    }
  }

  /**
   * Track profile view event
   * @param {string} professionalId - Professional ID
   * @param {string} viewerId - User viewing the profile
   * @returns {Promise<object>}
   */
  async trackProfileView(professionalId, viewerId) {
    return this.trackEvent('PROFILE_VIEW', {
      userId: viewerId,
      entityId: professionalId,
      entityType: 'Professional',
    });
  }

  /**
   * Track quote interaction
   * @param {string} quoteId - Quote ID
   * @param {string} userId - User
   * @param {string} action - 'VIEW' or 'SUBMIT'
   * @returns {Promise<object>}
   */
  async trackQuoteInteraction(quoteId, userId, action = 'VIEW') {
    const type = action === 'SUBMIT' ? 'QUOTE_SUBMITTED' : 'QUOTE_VIEW';
    return this.trackEvent(type, {
      userId,
      entityId: quoteId,
      entityType: 'Quote',
      metadata: { action },
    });
  }

  /**
   * Get conversion funnel metrics
   * @param {object} opts - { dateFrom, dateTo }
   * @returns {Promise<{views, quotes, bookings, payments, conversionRate}>}
   */
  async getConversionFunnel({ dateFrom, dateTo } = {}) {
    try {
      let where = {};
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) where.createdAt.lte = new Date(dateTo);
      }

      const [views, quotes, bookings, payments] = await Promise.all([
        this.prisma.analyticsEvent.count({ where: { ...where, type: 'PROFILE_VIEW' } }),
        this.prisma.analyticsEvent.count({ where: { ...where, type: 'QUOTE_SUBMITTED' } }),
        this.prisma.analyticsEvent.count({ where: { ...where, type: 'BOOKING_CREATED' } }),
        this.prisma.analyticsEvent.count({ where: { ...where, type: 'PAYMENT_PROCESSED' } }),
      ]);

      const conversionRate = views > 0 ? (bookings / views) * 100 : 0;

      return {
        views,
        quotes,
        bookings,
        payments,
        conversionRate: conversionRate.toFixed(2),
      };
    } catch (err) {
      logger.warn('[AnalyticsModule] getConversionFunnel failed', { error: err.message });
      return { views: 0, quotes: 0, bookings: 0, payments: 0, conversionRate: '0.00' };
    }
  }

  /**
   * Get top professionals by profile views
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   */
  async getTopProfessionals(limit = 10) {
    try {
      const topPros = await this.prisma.analyticsEvent.groupBy({
        by: ['entityId'],
        where: { type: 'PROFILE_VIEW', entityType: 'Professional' },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: limit,
      });

      return topPros.map(p => ({
        professionalId: p.entityId,
        viewCount: p._count.id,
      }));
    } catch (err) {
      logger.warn('[AnalyticsModule] getTopProfessionals failed', { error: err.message });
      return [];
    }
  }

  /**
   * Get user activity metrics
   * @param {string} userId - User ID
   * @returns {Promise<{profileViews, quotesSubmitted, bookingsCreated, lastActivity}>}
   */
  async getUserMetrics(userId) {
    try {
      const [profileViews, quotesSubmitted, bookingsCreated, lastEvent] = await Promise.all([
        this.prisma.analyticsEvent.count({ where: { userId, type: 'PROFILE_VIEW' } }),
        this.prisma.analyticsEvent.count({ where: { userId, type: 'QUOTE_SUBMITTED' } }),
        this.prisma.analyticsEvent.count({ where: { userId, type: 'BOOKING_CREATED' } }),
        this.prisma.analyticsEvent.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      return {
        profileViews,
        quotesSubmitted,
        bookingsCreated,
        lastActivity: lastEvent?.createdAt || null,
      };
    } catch (err) {
      logger.warn('[AnalyticsModule] getUserMetrics failed', { userId, error: err.message });
      return { profileViews: 0, quotesSubmitted: 0, bookingsCreated: 0, lastActivity: null };
    }
  }

  /**
   * Get search trends
   * @param {number} limit - Top N searches
   * @returns {Promise<Array>}
   */
  async getSearchTrends(limit = 10) {
    try {
      const trends = await this.prisma.analyticsEvent.groupBy({
        by: ['metadata'],
        where: { type: 'SEARCH_PERFORMED' },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: limit,
      });

      return trends.map(t => ({
        query: t.metadata?.query || 'unknown',
        count: t._count.id,
      }));
    } catch (err) {
      logger.warn('[AnalyticsModule] getSearchTrends failed', { error: err.message });
      return [];
    }
  }
}

module.exports = AnalyticsModule;
