'use strict';

const logger = require('../utils/logger');

/**
 * Analytics Events Module — Events, Metrics, User Journey
 * Handles event tracking, custom metrics, and user journey reconstruction
 */

class AnalyticsEventsModule {
  constructor(prisma) {
    this.prisma = prisma;
    this.SESSION_GAP_MS = 30 * 60 * 1000; // 30 min inactivity = new session
  }

  // ─── EVENT TRACKING ──────────────────────────────────────────────────────

  async trackEvent(type, page = null, metadata = null, sessionId = null, userId = null, ipAddress = null, userAgent = null) {
    return this.prisma.userEvent.create({
      data: {
        userId: userId || null,
        sessionId: sessionId || null,
        type,
        page: page || null,
        metadata: metadata || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });
  }

  async trackBatchEvents(events, userId, ipAddress = null, userAgent = null) {
    return this.prisma.userEvent.createMany({
      data: events.map(e => ({
        userId,
        sessionId: e.sessionId || null,
        type: e.type,
        page: e.page || null,
        metadata: e.metadata || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      })),
    });
  }

  // ─── EVENT SUMMARY ───────────────────────────────────────────────────────

  async getEventsSummary(from = null, to = null) {
    const where = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const events = await this.prisma.userEvent.groupBy({
      by: ['type'],
      where,
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
    });

    const total = events.reduce((s, e) => s + e._count.type, 0);

    return {
      total,
      byType: events.map(e => ({
        type: e.type,
        count: e._count.type,
        percentage: parseFloat(((e._count.type / total) * 100).toFixed(2)),
      })),
    };
  }

  // ─── CUSTOM METRICS ──────────────────────────────────────────────────────

  async recordMetric(name, category, value, unit = null, dimensions = null) {
    return this.prisma.customMetric.create({
      data: { name, category, value, unit: unit || null, dimensions: dimensions || null },
    });
  }

  async queryMetrics(name = null, category = null, from = null, to = null, page = 1, limit = 100) {
    const skip = (page - 1) * limit;
    const where = {};
    if (name) where.name = name;
    if (category) where.category = category;
    if (from || to) {
      where.recordedAt = {};
      if (from) where.recordedAt.gte = new Date(from);
      if (to) where.recordedAt.lte = new Date(to);
    }

    const [metrics, total] = await Promise.all([
      this.prisma.customMetric.findMany({
        where,
        skip,
        take: limit,
        orderBy: { recordedAt: 'desc' },
      }),
      this.prisma.customMetric.count({ where }),
    ]);

    // Build summary: mean, min, max per metric name
    const aggregated = {};
    metrics.forEach(m => {
      if (!aggregated[m.name]) {
        aggregated[m.name] = { name: m.name, unit: m.unit, values: [] };
      }
      aggregated[m.name].values.push(m.value);
    });

    const summary = Object.values(aggregated).map(a => ({
      name: a.name,
      unit: a.unit,
      count: a.values.length,
      mean: parseFloat((a.values.reduce((s, v) => s + v, 0) / a.values.length).toFixed(4)),
      min: Math.min(...a.values),
      max: Math.max(...a.values),
    }));

    return {
      metrics,
      summary,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ─── USER JOURNEY ────────────────────────────────────────────────────────

  async getUserJourney(userId, from = null, to = null) {
    const where = { userId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [user, events] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, createdAt: true, lastLoginAt: true,
        },
      }),
      this.prisma.userEvent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
    ]);

    if (!user) {
      throw new Error('User not found');
    }

    // Group events into sessions
    const sessions = [];
    let currentSession = null;

    for (const event of events) {
      const ts = new Date(event.createdAt).getTime();

      if (!currentSession || ts - currentSession.lastTs > this.SESSION_GAP_MS) {
        currentSession = {
          sessionId: event.sessionId || `auto-${sessions.length + 1}`,
          startedAt: event.createdAt,
          lastTs: ts,
          events: [],
        };
        sessions.push(currentSession);
      }

      currentSession.lastTs = ts;
      currentSession.events.push({
        type: event.type,
        page: event.page,
        metadata: event.metadata,
        createdAt: event.createdAt,
      });
    }

    // Milestone detection
    const eventTypes = new Set(events.map(e => e.type));
    const milestones = {
      registered: true,
      searched: eventTypes.has('search'),
      viewedProfile: eventTypes.has('profile_view'),
      sentQuote: eventTypes.has('quote_sent'),
      acceptedQuote: eventTypes.has('quote_accepted'),
      createdBooking: eventTypes.has('booking_created'),
      madePayment: eventTypes.has('payment_success'),
      leftReview: eventTypes.has('review_submitted'),
      upgradedSubscription: eventTypes.has('subscription_upgraded'),
    };

    return {
      user,
      totalEvents: events.length,
      totalSessions: sessions.length,
      milestones,
      completedMilestones: Object.values(milestones).filter(Boolean).length,
      sessions,
    };
  }
}

module.exports = AnalyticsEventsModule;
