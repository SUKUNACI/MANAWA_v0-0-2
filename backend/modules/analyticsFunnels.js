'use strict';

const logger = require('../utils/logger');

/**
 * Analytics Funnels & Cohorts Module — Funnel Analysis, Cohort Analysis
 * Handles conversion funnel tracking and cohort retention analysis
 */

class AnalyticsFunnelsModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // ─── FUNNEL ANALYSIS ─────────────────────────────────────────────────────

  async getFunnelAnalysis(from = null, to = null, role = null) {
    const dateFilter = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) dateFilter.createdAt.gte = new Date(from);
      if (to) dateFilter.createdAt.lte = new Date(to);
    }

    const userFilter = { ...dateFilter };
    if (role) userFilter.role = role;

    // Step 1: Total registered users
    const registered = await this.prisma.user.count({ where: userFilter });

    // Event window for events
    const eventWhere = {};
    if (from || to) {
      eventWhere.createdAt = {};
      if (from) eventWhere.createdAt.gte = new Date(from);
      if (to) eventWhere.createdAt.lte = new Date(to);
    }

    // Steps 2-6: Count distinct users for each event type
    const [searchedUsers, viewedProfileUsers, sentQuoteUsers, bookedUsers, paidUsers] =
      await Promise.all([
        this.prisma.userEvent
          .findMany({
            where: { ...eventWhere, type: 'search' },
            select: { userId: true },
            distinct: ['userId'],
          })
          .then(r => r.filter(e => e.userId).length),

        this.prisma.userEvent
          .findMany({
            where: { ...eventWhere, type: 'profile_view' },
            select: { userId: true },
            distinct: ['userId'],
          })
          .then(r => r.filter(e => e.userId).length),

        this.prisma.userEvent
          .findMany({
            where: { ...eventWhere, type: 'quote_sent' },
            select: { userId: true },
            distinct: ['userId'],
          })
          .then(r => r.filter(e => e.userId).length),

        this.prisma.booking.count({
          where: {
            createdAt: eventWhere.createdAt,
          },
        }),

        this.prisma.payment.count({
          where: {
            status: 'succeeded',
            createdAt: eventWhere.createdAt,
          },
        }),
      ]);

    const steps = [
      { step: 'registered', label: 'Inscription', count: registered },
      { step: 'searched', label: 'Première recherche', count: searchedUsers },
      { step: 'viewed_profile', label: 'Profil consulté', count: viewedProfileUsers },
      { step: 'quote_sent', label: 'Devis envoyé', count: sentQuoteUsers },
      { step: 'booking_created', label: 'Réservation créée', count: bookedUsers },
      { step: 'payment_success', label: 'Paiement effectué', count: paidUsers },
    ];

    // Calculate conversion rates
    const funnel = steps.map((step, i) => {
      const prev = i === 0 ? step.count : steps[i - 1].count;
      const fromFirst = registered > 0 ? (step.count / registered) * 100 : 0;
      const fromPrev = prev > 0 ? (step.count / prev) * 100 : 0;
      const dropOff = i === 0 ? 0 : steps[i - 1].count - step.count;

      return {
        ...step,
        conversionFromFirst: parseFloat(fromFirst.toFixed(2)),
        conversionFromPrev: parseFloat(fromPrev.toFixed(2)),
        dropOff,
      };
    });

    return {
      funnel,
      overallConversion: registered > 0
        ? parseFloat(((paidUsers / registered) * 100).toFixed(2))
        : 0,
      period: { from, to },
    };
  }

  // ─── COHORT ANALYSIS ─────────────────────────────────────────────────────

  async getCohortAnalysis(monthsBack = 6) {
    // Try to get from snapshots first
    const snapshots = await this.prisma.cohortSnapshot.findMany({
      orderBy: [{ cohortMonth: 'asc' }, { periodOffset: 'asc' }],
      take: monthsBack * 12,
    });

    if (snapshots.length > 0) {
      const cohortMap = {};
      snapshots.forEach(s => {
        if (!cohortMap[s.cohortMonth]) cohortMap[s.cohortMonth] = [];
        cohortMap[s.cohortMonth].push({
          periodMonth: s.periodMonth,
          offset: s.periodOffset,
          userCount: s.userCount,
          activeCount: s.activeCount,
          retainedRate: parseFloat((s.retainedRate * 100).toFixed(2)),
          revenue: s.revenue,
        });
      });

      return { cohorts: cohortMap, source: 'snapshots' };
    }

    // Compute live from raw data
    const now = new Date();
    const cohorts = {};

    for (let m = monthsBack - 1; m >= 0; m--) {
      const cohortDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const cohortKey = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`;
      const cohortEnd = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + 1, 1);

      const cohortUsers = await this.prisma.user.findMany({
        where: {
          createdAt: { gte: cohortDate, lt: cohortEnd },
          role: 'CLIENT',
        },
        select: { id: true },
      });

      const userIds = cohortUsers.map(u => u.id);
      if (userIds.length === 0) continue;

      cohorts[cohortKey] = { userCount: userIds.length, periods: [] };

      const periodsToCheck = now.getMonth() - cohortDate.getMonth() +
        (now.getFullYear() - cohortDate.getFullYear()) * 12;

      for (let p = 0; p <= Math.min(periodsToCheck, 11); p++) {
        const periodStart = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + p, 1);
        const periodEnd = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + p + 1, 1);
        const periodKey = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;

        const activeInPeriod = await this.prisma.userEvent.findMany({
          where: {
            userId: { in: userIds },
            createdAt: { gte: periodStart, lt: periodEnd },
          },
          select: { userId: true },
          distinct: ['userId'],
        });

        const activeCount = activeInPeriod.length;
        cohorts[cohortKey].periods.push({
          periodMonth: periodKey,
          offset: p,
          activeCount,
          retainedRate: parseFloat(((activeCount / userIds.length) * 100).toFixed(2)),
        });
      }
    }

    return { cohorts, source: 'live', monthsAnalyzed: monthsBack };
  }

  // ─── COHORT SNAPSHOT ─────────────────────────────────────────────────────

  async createCohortSnapshot() {
    const now = new Date();
    const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const created = [];
    for (let m = 5; m >= 0; m--) {
      const cohortDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const cohortKey = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`;
      const cohortEnd = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + 1, 1);

      const cohortUsers = await this.prisma.user.findMany({
        where: { createdAt: { gte: cohortDate, lt: cohortEnd }, role: 'CLIENT' },
        select: { id: true },
      });

      if (cohortUsers.length === 0) continue;

      const userIds = cohortUsers.map(u => u.id);
      const periodOffset = now.getMonth() - cohortDate.getMonth() +
        (now.getFullYear() - cohortDate.getFullYear()) * 12;

      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const activeUsers = await this.prisma.userEvent.findMany({
        where: { userId: { in: userIds }, createdAt: { gte: periodStart } },
        select: { userId: true },
        distinct: ['userId'],
      });

      await this.prisma.cohortSnapshot.upsert({
        where: { cohortMonth_periodMonth: { cohortMonth: cohortKey, periodMonth } },
        create: {
          cohortMonth: cohortKey,
          periodMonth,
          periodOffset,
          userCount: userIds.length,
          activeCount: activeUsers.length,
          retainedRate: activeUsers.length / userIds.length,
        },
        update: {
          activeCount: activeUsers.length,
          retainedRate: activeUsers.length / userIds.length,
        },
      });

      created.push(cohortKey);
    }

    return { snapshotsCreated: created.length, cohorts: created };
  }
}

module.exports = AnalyticsFunnelsModule;
