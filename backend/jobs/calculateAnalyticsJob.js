const prisma = require('../config/db');
const logger = require('../utils/logger');

/**
 * Calculate analytics job processor
 * Processes daily analytics calculations
 *
 * Job data shape:
 * {
 *   date?: string (ISO date, defaults to yesterday),
 *   scope?: 'daily' | 'weekly' | 'monthly',
 *   metadata?: object
 * }
 */
async function calculateAnalyticsJob(job) {
  const { date, scope = 'daily', metadata } = job.data;

  try {
    await job.progress(10);

    const targetDate = date ? new Date(date) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    targetDate.setHours(0, 0, 0, 0);

    logger.debug('[calculateAnalyticsJob] Starting analytics calculation', {
      jobId: job.id,
      date: targetDate.toISOString(),
      scope,
      metadata,
    });

    // Calculate metrics based on scope
    let metrics = {};

    if (scope === 'daily' || scope === 'weekly' || scope === 'monthly') {
      metrics = await calculateDailyMetrics(targetDate);
    }

    if (scope === 'weekly' || scope === 'monthly') {
      metrics = { ...metrics, ...(await calculateWeeklyMetrics(targetDate)) };
    }

    if (scope === 'monthly') {
      metrics = { ...metrics, ...(await calculateMonthlyMetrics(targetDate)) };
    }

    await job.progress(50);

    // Store metrics in database (if needed)
    // This could be extended to save to an Analytics table

    logger.info('[calculateAnalyticsJob] Analytics calculated successfully', {
      jobId: job.id,
      date: targetDate.toISOString(),
      scope,
      metrics: {
        newBookings: metrics.newBookings,
        newQuotes: metrics.newQuotes,
        newUsers: metrics.newUsers,
        totalRevenue: metrics.totalRevenue,
        averageRating: metrics.averageRating,
      },
    });

    await job.progress(100);

    return {
      success: true,
      jobId: job.id,
      date: targetDate.toISOString(),
      scope,
      metrics,
      calculatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('[calculateAnalyticsJob] Error calculating analytics', {
      jobId: job.id,
      date,
      scope,
      error: err.message,
      stack: err.stack,
      metadata,
    });

    throw err;
  }
}

/**
 * Calculate daily metrics
 */
async function calculateDailyMetrics(date) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);

  try {
    // Count new bookings
    const newBookings = await prisma.booking.count({
      where: {
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
    });

    // Count new quotes
    const newQuotes = await prisma.quote.count({
      where: {
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
    });

    // Count new users
    const newUsers = await prisma.user.count({
      where: {
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
    });

    // Calculate total revenue (from completed bookings)
    const revenueData = await prisma.booking.aggregate({
      where: {
        status: 'COMPLETED',
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
      _sum: {
        amount: true,
      },
    });

    const totalRevenue = revenueData._sum?.amount || 0;

    // Calculate average rating (from reviews)
    const ratingData = await prisma.review.aggregate({
      where: {
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
      _avg: {
        rating: true,
      },
      _count: true,
    });

    const averageRating = ratingData._avg?.rating || 0;
    const reviewCount = ratingData._count || 0;

    return {
      newBookings,
      newQuotes,
      newUsers,
      totalRevenue,
      averageRating,
      reviewCount,
    };
  } catch (err) {
    logger.error('[calculateDailyMetrics] Error:', err.message);
    throw err;
  }
}

/**
 * Calculate weekly metrics
 */
async function calculateWeeklyMetrics(date) {
  const weekStart = new Date(date);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Get Monday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  try {
    const activeUsers = await prisma.user.count({
      where: {
        lastActivityAt: {
          gte: weekStart,
          lt: weekEnd,
        },
      },
    });

    const completedBookings = await prisma.booking.count({
      where: {
        status: 'COMPLETED',
        updatedAt: {
          gte: weekStart,
          lt: weekEnd,
        },
      },
    });

    return {
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      activeUsersThisWeek: activeUsers,
      completedBookingsThisWeek: completedBookings,
    };
  } catch (err) {
    logger.error('[calculateWeeklyMetrics] Error:', err.message);
    throw err;
  }
}

/**
 * Calculate monthly metrics
 */
async function calculateMonthlyMetrics(date) {
  const monthStart = new Date(date);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  try {
    const monthlyRevenue = await prisma.booking.aggregate({
      where: {
        status: 'COMPLETED',
        createdAt: {
          gte: monthStart,
          lt: monthEnd,
        },
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const topProfessionals = await prisma.professional.findMany({
      where: {
        bookings: {
          some: {
            status: 'COMPLETED',
            createdAt: {
              gte: monthStart,
              lt: monthEnd,
            },
          },
        },
      },
      include: {
        _count: {
          select: {
            bookings: {
              where: {
                status: 'COMPLETED',
                createdAt: {
                  gte: monthStart,
                  lt: monthEnd,
                },
              },
            },
          },
        },
      },
      take: 10,
      orderBy: {
        bookings: {
          _count: 'desc',
        },
      },
    });

    return {
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
      monthlyRevenue: monthlyRevenue._sum?.amount || 0,
      completedBookingsThisMonth: monthlyRevenue._count || 0,
      topProfessionalsCount: topProfessionals.length,
    };
  } catch (err) {
    logger.error('[calculateMonthlyMetrics] Error:', err.message);
    throw err;
  }
}

/**
 * Helper to schedule daily analytics calculation
 * Should be called once daily, typically at 2 AM UTC
 */
async function scheduleDailyAnalytics(analyticsQueue) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return await analyticsQueue.add(
    {
      date: yesterday.toISOString(),
      scope: 'daily',
      metadata: {
        scheduledAt: new Date().toISOString(),
      },
    },
    {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

module.exports = {
  calculateAnalyticsJob,
  calculateDailyMetrics,
  calculateWeeklyMetrics,
  calculateMonthlyMetrics,
  scheduleDailyAnalytics,
};
