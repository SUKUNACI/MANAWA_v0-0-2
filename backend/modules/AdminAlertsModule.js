/**
 * AdminAlertsModule
 * Business logic for alert event management
 */

const logger = require('../utils/logger');

const VALID_TYPES = ['error_rate', 'latency', 'memory', 'cpu', 'payment_failure', 'queue_depth'];
const VALID_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'];
const VALID_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SILENCED'];

class AdminAlertsModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // Get all events with filters
  async getEvents(filters = {}, pagination = {}) {
    const { status, severity, type, from, to } = filters;
    const { page = 1, limit = 50 } = pagination;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (type) where.type = type;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [events, total, openCritical, openWarn] = await Promise.all([
      this.prisma.alertEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.alertEvent.count({ where }),
      this.prisma.alertEvent.count({ where: { status: 'OPEN', severity: 'CRITICAL' } }),
      this.prisma.alertEvent.count({ where: { status: 'OPEN', severity: 'WARN' } }),
    ]);

    return {
      events,
      openSummary: { critical: openCritical, warn: openWarn },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // Create new event
  async createEvent(data) {
    const { type, severity, message, value, threshold, channel } = data;
    return this.prisma.alertEvent.create({
      data: {
        type,
        severity,
        message,
        value: value !== undefined ? value : null,
        threshold: threshold !== undefined ? threshold : null,
        channel: channel || null,
        status: 'OPEN',
      },
    });
  }

  // Acknowledge event
  async acknowledgeEvent(eventId, adminId) {
    const event = await this.prisma.alertEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new Error('Alert event not found');
    if (event.status !== 'OPEN') throw new Error(`Cannot acknowledge alert with status ${event.status}`);

    return this.prisma.alertEvent.update({
      where: { id: eventId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedBy: adminId,
        acknowledgedAt: new Date(),
      },
    });
  }

  // Resolve event
  async resolveEvent(eventId) {
    const event = await this.prisma.alertEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new Error('Alert event not found');
    if (event.status === 'RESOLVED') throw new Error('Alert already resolved');

    return this.prisma.alertEvent.update({
      where: { id: eventId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  // Silence event
  async silenceEvent(eventId, minutes) {
    const event = await this.prisma.alertEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new Error('Alert event not found');

    const silencedUntil = new Date(Date.now() + minutes * 60 * 1000);
    return this.prisma.alertEvent.update({
      where: { id: eventId },
      data: { status: 'SILENCED', silencedUntil },
    });
  }

  // Get statistics
  async getStats(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const events = await this.prisma.alertEvent.findMany({
      where: { createdAt: { gte: since } },
    });

    const byType = {};
    const bySeverity = {};
    let totalMTTA = 0;
    let countMTTA = 0;
    let totalMTTR = 0;
    let countMTTR = 0;

    events.forEach(e => {
      byType[e.type] = (byType[e.type] || 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;

      if (e.acknowledgedAt && e.createdAt) {
        totalMTTA += e.acknowledgedAt - e.createdAt;
        countMTTA++;
      }
      if (e.resolvedAt && e.createdAt) {
        totalMTTR += e.resolvedAt - e.createdAt;
        countMTTR++;
      }
    });

    return {
      total: events.length,
      byType,
      bySeverity,
      meanTimeToAcknowledgeMs: countMTTA > 0 ? Math.round(totalMTTA / countMTTA) : null,
      meanTimeToResolveMs: countMTTR > 0 ? Math.round(totalMTTR / countMTTR) : null,
      period: `${days} days`,
    };
  }

  static getValidTypes() { return VALID_TYPES; }
  static getValidSeverities() { return VALID_SEVERITIES; }
  static getValidStatuses() { return VALID_STATUSES; }
}

module.exports = AdminAlertsModule;
