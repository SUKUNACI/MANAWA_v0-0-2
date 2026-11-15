'use strict';

const logger = require('../utils/logger');

/**
 * Analytics Advanced Module — Retention, Distribution, Funnels, Revenue
 * Handles complex analytics computations (DAU/MAU, churn, revenue, funnels)
 */

class AnalyticsAdvancedModule {
  constructor(prisma) {
    this.prisma = prisma;
    this.TIER_PRICES = { ESSENTIEL: 25, PRO: 50, ELITE: 100, GRATUIT: 0 };
    this.COMMISSION_RATE = 0.15;
  }

  // ─── RETENTION METRICS ───────────────────────────────────────────────────

  async getRetentionMetrics() {
    const now = new Date();
    const d1  = new Date(now - 1  * 24 * 60 * 60 * 1000);
    const d7  = new Date(now - 7  * 24 * 60 * 60 * 1000);
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [dau, wau, mau, totalUsers, newToday, newThisWeek, newThisMonth] =
      await Promise.all([
        this.prisma.userEvent
          .findMany({ where: { createdAt: { gte: d1 }  }, select: { userId: true }, distinct: ['userId'] })
          .then(r => r.filter(e => e.userId).length),
        this.prisma.userEvent
          .findMany({ where: { createdAt: { gte: d7 }  }, select: { userId: true }, distinct: ['userId'] })
          .then(r => r.filter(e => e.userId).length),
        this.prisma.userEvent
          .findMany({ where: { createdAt: { gte: d30 } }, select: { userId: true }, distinct: ['userId'] })
          .then(r => r.filter(e => e.userId).length),
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.user.count({ where: { createdAt: { gte: d1  } } }),
        this.prisma.user.count({ where: { createdAt: { gte: d7  } } }),
        this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      ]);

    // D7 & D30 cohort retention
    const d14 = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const registeredBeforeD7 = await this.prisma.user.findMany({
      where: { createdAt: { gte: d14, lt: d7 } },
      select: { id: true },
    });
    const d7CohortIds = registeredBeforeD7.map(u => u.id);
    const d7Retained = d7CohortIds.length > 0
      ? await this.prisma.userEvent
          .findMany({ where: { userId: { in: d7CohortIds }, createdAt: { gte: d7 } }, select: { userId: true }, distinct: ['userId'] })
          .then(r => r.length)
      : 0;

    const d60 = new Date(now - 60 * 24 * 60 * 60 * 1000);
    const registeredBeforeD30 = await this.prisma.user.findMany({
      where: { createdAt: { gte: d60, lt: d30 } },
      select: { id: true },
    });
    const d30CohortIds = registeredBeforeD30.map(u => u.id);
    const d30Retained = d30CohortIds.length > 0
      ? await this.prisma.userEvent
          .findMany({ where: { userId: { in: d30CohortIds }, createdAt: { gte: d30 } }, select: { userId: true }, distinct: ['userId'] })
          .then(r => r.length)
      : 0;

    return {
      activeUsers: { dau, wau, mau },
      newUsers: { today: newToday, thisWeek: newThisWeek, thisMonth: newThisMonth },
      totalUsers,
      retention: {
        d7: {
          cohortSize: d7CohortIds.length,
          retained: d7Retained,
          rate: d7CohortIds.length > 0
            ? parseFloat(((d7Retained / d7CohortIds.length) * 100).toFixed(2))
            : null,
        },
        d30: {
          cohortSize: d30CohortIds.length,
          retained: d30Retained,
          rate: d30CohortIds.length > 0
            ? parseFloat(((d30Retained / d30CohortIds.length) * 100).toFixed(2))
            : null,
        },
      },
      ratios: {
        dauMau: mau > 0 ? parseFloat((dau / mau * 100).toFixed(2)) : null,
        dauWau: wau > 0 ? parseFloat((dau / wau * 100).toFixed(2)) : null,
      },
    };
  }

  async getRetentionHistory(days = 30) {
    const snapshots = await this.prisma.retentionSnapshot.findMany({
      orderBy: { date: 'desc' },
      take: days,
    });
    return { snapshots: snapshots.reverse() };
  }

  // ─── CHURN PREDICTION ────────────────────────────────────────────────────

  async getChurnPrediction(riskLevel, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const now = new Date();
    const thresholds = {
      high:   new Date(now - 14 * 24 * 60 * 60 * 1000),
      medium: new Date(now -  7 * 24 * 60 * 60 * 1000),
      low:    new Date(now -  3 * 24 * 60 * 60 * 1000),
    };

    let lastLoginFilter;
    if (riskLevel === 'high') {
      lastLoginFilter = { lt: thresholds.high };
    } else if (riskLevel === 'medium') {
      lastLoginFilter = { gte: thresholds.high, lt: thresholds.medium };
    } else if (riskLevel === 'low') {
      lastLoginFilter = { gte: thresholds.medium, lt: thresholds.low };
    } else {
      lastLoginFilter = { lt: thresholds.low };
    }

    const where = {
      lastLoginAt: lastLoginFilter,
      deletedAt: null,
      suspended: false,
    };

    const [users, total, highCount, mediumCount, lowCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { lastLoginAt: 'asc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { lastLoginAt: { lt: thresholds.high }, deletedAt: null } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: thresholds.high, lt: thresholds.medium }, deletedAt: null } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: thresholds.medium, lt: thresholds.low }, deletedAt: null } }),
    ]);

    const usersWithRisk = users.map(u => {
      const daysSinceLogin = u.lastLoginAt
        ? Math.floor((now - new Date(u.lastLoginAt)) / (24 * 60 * 60 * 1000))
        : null;
      let risk = 'low', score = 0;
      if (!u.lastLoginAt || daysSinceLogin > 14) {
        risk = 'high'; score = 90;
      } else if (daysSinceLogin > 7) {
        risk = 'medium'; score = 60;
      } else if (daysSinceLogin > 3) {
        risk = 'low'; score = 30;
      }
      return { ...u, daysSinceLogin, churnRisk: risk, churnScore: score };
    });

    return {
      users: usersWithRisk,
      summary: { high: highCount, medium: mediumCount, low: lowCount, total: highCount + mediumCount + lowCount },
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getSubscriptionChurn(days = 30) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [expired, activeSubscriptions, totalPros] = await Promise.all([
      this.prisma.subscription.count({
        where: {
          status: 'ACTIVE',
          expiresAt: { gte: cutoff, lt: new Date() },
        },
      }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.professional.count(),
    ]);

    const churnRate = activeSubscriptions > 0
      ? parseFloat(((expired / activeSubscriptions) * 100).toFixed(2))
      : 0;

    return {
      period: `${days} days`,
      expiredSubscriptions: expired,
      activeSubscriptions,
      totalProfessionals: totalPros,
      subscriptionChurnRate: churnRate,
    };
  }

  // ─── REVENUE METRICS ─────────────────────────────────────────────────────

  async getRevenueMetrics() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart  = new Date(now.getFullYear(), 0, 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeSubscriptions = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      select: { tier: true },
    });

    const mrr = activeSubscriptions.reduce((sum, s) => sum + (this.TIER_PRICES[s.tier] || 0), 0);
    const arr = mrr * 12;
    const payingCount = activeSubscriptions.filter(s => s.tier !== 'GRATUIT').length;
    const arpu = payingCount > 0 ? parseFloat((mrr / payingCount).toFixed(2)) : 0;

    const [commissionThisMonth, commissionThisYear, commissionPrevMonth] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'succeeded', createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'succeeded', createdAt: { gte: yearStart } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'succeeded', createdAt: { gte: prevMonthStart, lt: prevMonthEnd } },
        _sum: { amount: true },
      }),
    ]);

    const commissionMonthly = parseFloat(((commissionThisMonth._sum.amount || 0) * this.COMMISSION_RATE).toFixed(2));
    const commissionYearly  = parseFloat(((commissionThisYear._sum.amount  || 0) * this.COMMISSION_RATE).toFixed(2));
    const commissionPrev    = parseFloat(((commissionPrevMonth._sum.amount || 0) * this.COMMISSION_RATE).toFixed(2));

    const prevMrr = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', createdAt: { lt: prevMonthEnd } },
      select: { tier: true },
    }).then(subs => subs.reduce((sum, s) => sum + (this.TIER_PRICES[s.tier] || 0), 0));

    const mrrGrowth = prevMrr > 0
      ? parseFloat((((mrr - prevMrr) / prevMrr) * 100).toFixed(2))
      : null;

    const avgSubscriptionMonths = 6;
    const ltv = parseFloat((arpu * avgSubscriptionMonths).toFixed(2));

    const tierBreakdown = {};
    activeSubscriptions.forEach(s => {
      tierBreakdown[s.tier] = (tierBreakdown[s.tier] || 0) + 1;
    });

    return {
      subscriptionRevenue: {
        mrr,
        arr,
        arpu,
        ltv,
        mrrGrowth,
        activeSubscribers: activeSubscriptions.length,
        payingSubscribers: payingCount,
        tierBreakdown,
      },
      commissionRevenue: {
        thisMonth: commissionMonthly,
        thisYear: commissionYearly,
        prevMonth: commissionPrev,
        momGrowth: commissionPrev > 0
          ? parseFloat((((commissionMonthly - commissionPrev) / commissionPrev) * 100).toFixed(2))
          : null,
      },
      totalRevenue: {
        thisMonth: parseFloat((mrr + commissionMonthly).toFixed(2)),
        thisYear:  parseFloat(((mrr * 12) + commissionYearly).toFixed(2)),
      },
    };
  }

  async getRevenueTransactions(from, to, groupBy = 'day') {
    const now = new Date();
    const dateFrom = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const dateTo   = to   ? new Date(to)   : now;

    const payments = await this.prisma.payment.findMany({
      where: {
        status: 'succeeded',
        createdAt: { gte: dateFrom, lte: dateTo },
      },
      select: { amount: true, fees: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const grouped = {};
    payments.forEach(p => {
      const d = new Date(p.createdAt);
      let key;
      if (groupBy === 'month') {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      } else if (groupBy === 'week') {
        const weekNum = Math.ceil(d.getDate() / 7);
        key = `${d.getFullYear()}-W${String(d.getMonth() * 4 + weekNum).padStart(2, '0')}`;
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      if (!grouped[key]) grouped[key] = { period: key, volume: 0, commission: 0, count: 0 };
      grouped[key].volume     += p.amount;
      grouped[key].commission += p.amount * this.COMMISSION_RATE;
      grouped[key].count      += 1;
    });

    const series = Object.values(grouped).map(g => ({
      period: g.period,
      volume: parseFloat(g.volume.toFixed(2)),
      commission: parseFloat(g.commission.toFixed(2)),
      count: g.count,
    }));

    const totals = {
      volume:     parseFloat(payments.reduce((s, p) => s + p.amount, 0).toFixed(2)),
      commission: parseFloat(payments.reduce((s, p) => s + p.amount * this.COMMISSION_RATE, 0).toFixed(2)),
      count:      payments.length,
    };

    return { series, totals, period: { from: dateFrom, to: dateTo, groupBy } };
  }
}

module.exports = AnalyticsAdvancedModule;
