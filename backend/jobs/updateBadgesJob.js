const prisma = require('../config/db');
const logger = require('../utils/logger');

/**
 * Update badges job processor
 * Recalculates and updates user badges based on criteria
 *
 * Job data shape:
 * {
 *   type?: 'all' | 'user',
 *   userId?: string,
 *   badgeType?: string,
 *   metadata?: object
 * }
 */
async function updateBadgesJob(job) {
  const { type = 'all', userId, badgeType, metadata } = job.data;

  try {
    await job.progress(10);

    logger.debug('[updateBadgesJob] Starting badge update', {
      jobId: job.id,
      type,
      userId,
      badgeType,
      metadata,
    });

    let result;

    if (type === 'user' && userId) {
      result = await updateUserBadges(job, userId, badgeType);
    } else if (type === 'all') {
      result = await updateAllBadges(job);
    } else {
      throw new Error(`Unsupported badge update type: ${type}`);
    }

    await job.progress(100);

    return result;
  } catch (err) {
    logger.error('[updateBadgesJob] Error updating badges', {
      jobId: job.id,
      type,
      userId,
      badgeType,
      error: err.message,
      stack: err.stack,
      metadata,
    });

    throw err;
  }
}

/**
 * Update badges for a single user
 */
async function updateUserBadges(job, userId, badgeType) {
  await job.progress(20);

  try {
    // Fetch user and related data
    const professional = await prisma.professional.findUnique({
      where: { userId },
      include: {
        user: true,
        badges: true,
        reviews: true,
        bookings: true,
        quotes: true,
      },
    });

    if (!professional) {
      logger.warn('[updateUserBadges] Professional not found', { userId });
      return { success: false, reason: 'professional_not_found', userId };
    }

    await job.progress(30);

    const badgesToUpdate = [];

    // Check each badge criteria
    if (!badgeType || badgeType === 'verified') {
      if (professional.verifiedByAdmin && !professional.badges.some(b => b.type === 'verified')) {
        badgesToUpdate.push('verified');
      }
    }

    if (!badgeType || badgeType === 'top_rated') {
      const avgRating = await calculateAverageRating(professional.reviews);
      if (avgRating >= 4.8 && !professional.badges.some(b => b.type === 'top_rated')) {
        badgesToUpdate.push('top_rated');
      }
    }

    if (!badgeType || badgeType === 'experienced') {
      if (professional.bookings.length >= 50 && !professional.badges.some(b => b.type === 'experienced')) {
        badgesToUpdate.push('experienced');
      }
    }

    if (!badgeType || badgeType === 'responsive') {
      const responseRate = await calculateResponseRate(professional);
      if (responseRate >= 0.95 && !professional.badges.some(b => b.type === 'responsive')) {
        badgesToUpdate.push('responsive');
      }
    }

    if (!badgeType || badgeType === 'quick_quote') {
      const avgQuoteTime = await calculateAverageQuoteTime(professional);
      if (avgQuoteTime <= 2 && !professional.badges.some(b => b.type === 'quick_quote')) {
        // avg time in hours
        badgesToUpdate.push('quick_quote');
      }
    }

    await job.progress(60);

    // Add new badges
    for (const badge of badgesToUpdate) {
      await prisma.badge.create({
        data: {
          type: badge,
          professionalId: professional.id,
          earnedAt: new Date(),
          criteria: getBadgeCriteria(badge),
        },
      });
    }

    await job.progress(80);

    // Check for badge revocation
    const badgesToRemove = [];

    // Revoke top_rated if rating drops below 4.5
    if (professional.badges.some(b => b.type === 'top_rated')) {
      const avgRating = await calculateAverageRating(professional.reviews);
      if (avgRating < 4.5) {
        badgesToRemove.push('top_rated');
      }
    }

    // Remove revoked badges
    for (const badge of badgesToRemove) {
      await prisma.badge.deleteMany({
        where: {
          professionalId: professional.id,
          type: badge,
        },
      });
    }

    logger.info('[updateUserBadges] Badges updated successfully', {
      jobId: job.id,
      userId,
      badgesAdded: badgesToUpdate,
      badgesRemoved: badgesToRemove,
    });

    return {
      success: true,
      jobId: job.id,
      userId,
      badgesAdded: badgesToUpdate,
      badgesRemoved: badgesToRemove,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('[updateUserBadges] Error:', err.message);
    throw err;
  }
}

/**
 * Update badges for all professionals
 */
async function updateAllBadges(job) {
  await job.progress(20);

  try {
    // Fetch all professionals
    const professionals = await prisma.professional.findMany({
      include: {
        user: true,
        badges: true,
      },
    });

    logger.info('[updateAllBadges] Updating badges for all professionals', {
      jobId: job.id,
      count: professionals.length,
    });

    const progressPerPro = 60 / professionals.length;
    let currentProgress = 20;

    const results = [];

    for (const professional of professionals) {
      const jobCopy = {
        progress: async (p) => {
          // Simulate progress
        },
      };

      try {
        const result = await updateUserBadges(jobCopy, professional.userId);
        results.push(result);
      } catch (err) {
        logger.error('[updateAllBadges] Error updating professional', {
          professionalId: professional.id,
          error: err.message,
        });
      }

      currentProgress += progressPerPro;
      await job.progress(Math.min(currentProgress, 80));
    }

    logger.info('[updateAllBadges] All badges updated successfully', {
      jobId: job.id,
      processedCount: professionals.length,
      successCount: results.filter(r => r.success).length,
    });

    return {
      success: true,
      jobId: job.id,
      processedCount: professionals.length,
      results,
      completedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('[updateAllBadges] Error:', err.message);
    throw err;
  }
}

/**
 * Helper: Calculate average rating from reviews
 */
async function calculateAverageRating(reviews) {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return sum / reviews.length;
}

/**
 * Helper: Calculate response rate
 */
async function calculateResponseRate(professional) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const messagesReceived = await prisma.message.count({
    where: {
      recipientId: professional.userId,
      createdAt: { gte: thirtyDaysAgo },
    },
  });

  const messagesReplied = await prisma.message.count({
    where: {
      recipientId: professional.userId,
      repliedAt: { not: null },
      createdAt: { gte: thirtyDaysAgo },
    },
  });

  if (messagesReceived === 0) return 1;
  return messagesReplied / messagesReceived;
}

/**
 * Helper: Calculate average quote response time
 */
async function calculateAverageQuoteTime(professional) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const quotes = await prisma.quote.findMany({
    where: {
      professionalId: professional.id,
      createdAt: { gte: thirtyDaysAgo },
    },
  });

  if (quotes.length === 0) return 0;

  let totalHours = 0;
  for (const quote of quotes) {
    // Assuming project has createdAt timestamp
    const projectReq = await prisma.project.findUnique({
      where: { id: quote.projectId },
    });

    if (projectReq && projectReq.createdAt) {
      const hours = (quote.createdAt - projectReq.createdAt) / (1000 * 60 * 60);
      totalHours += hours;
    }
  }

  return totalHours / quotes.length;
}

/**
 * Helper: Get badge description/criteria
 */
function getBadgeCriteria(badgeType) {
  const criteria = {
    verified: 'Identity verified by MANAWA team',
    top_rated: 'Average rating of 4.8+ stars',
    experienced: '50+ completed bookings',
    responsive: '95%+ message response rate',
    quick_quote: 'Average quote time ≤ 2 hours',
  };
  return criteria[badgeType] || 'Custom badge';
}

/**
 * Helper to schedule badge update for a user
 */
async function queueUserBadgeUpdate(badgesQueue, userId, badgeType = null) {
  return await badgesQueue.add(
    {
      type: 'user',
      userId,
      badgeType,
      metadata: {
        queuedAt: new Date().toISOString(),
      },
    },
    {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 3000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

/**
 * Helper to schedule global badge update (all users)
 */
async function queueGlobalBadgeUpdate(badgesQueue) {
  return await badgesQueue.add(
    {
      type: 'all',
      metadata: {
        queuedAt: new Date().toISOString(),
      },
    },
    {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

module.exports = {
  updateBadgesJob,
  updateUserBadges,
  updateAllBadges,
  calculateAverageRating,
  calculateResponseRate,
  calculateAverageQuoteTime,
  getBadgeCriteria,
  queueUserBadgeUpdate,
  queueGlobalBadgeUpdate,
};
