const prisma = require('../config/db');

/**
 * Aggregation helper utilities for search facets and analytics
 * Supports both Prisma aggregations and raw SQL for complex queries
 */

// ============================================================================
// FACETED SEARCH - Aggregate counts by dimensions
// ============================================================================

/**
 * Get faceted counts for professionals search
 * Returns counts grouped by location, trade, rating, price range
 * Supports combined filters
 */
async function getFacetedCounts(filters = {}) {
  const {
    q = '', // search query
    minRating = 0,
    maxRating = 5,
    minPrice = 0,
    maxPrice = 100000,
  } = filters;

  try {
    // Build where clause for active professionals
    const baseWhere = {
      user: { deletedAt: null },
    };

    // Apply search filter if provided
    if (q) {
      baseWhere.OR = [
        { user: { firstName: { contains: q, mode: 'insensitive' } } },
        { user: { lastName: { contains: q, mode: 'insensitive' } } },
        { trade: { contains: q, mode: 'insensitive' } },
        { trades: { has: q } },
        { description: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { user: { city: { contains: q, mode: 'insensitive' } } },
      ];
    }

    // Get all professionals matching filters
    const professionals = await prisma.professional.findMany({
      where: baseWhere,
      select: {
        id: true,
        trade: true,
        trades: true,
        hourlyRate: true,
        averageRating: true,
        user: {
          select: {
            city: true,
          },
        },
      },
    });

    // Compute facet counts
    const facets = {
      locations: {},
      trades: {},
      ratings: {
        '0': 0,
        '1': 0,
        '2': 0,
        '3': 0,
        '4': 0,
        '5': 0,
      },
      priceRanges: {
        'under-50': 0,
        '50-100': 0,
        '100-200': 0,
        '200-500': 0,
        'over-500': 0,
      },
      total: professionals.length,
    };

    professionals.forEach(pro => {
      // Location facet
      if (pro.user?.city) {
        facets.locations[pro.user.city] = (facets.locations[pro.user.city] || 0) + 1;
      }

      // Trade facet (primary and secondary trades)
      if (pro.trade) {
        facets.trades[pro.trade] = (facets.trades[pro.trade] || 0) + 1;
      }
      if (pro.trades && Array.isArray(pro.trades)) {
        pro.trades.forEach(trade => {
          facets.trades[trade] = (facets.trades[trade] || 0) + 1;
        });
      }

      // Rating facet (round to nearest integer)
      const ratingInt = Math.round(pro.averageRating || 0);
      if (ratingInt >= 0 && ratingInt <= 5) {
        facets.ratings[ratingInt.toString()] =
          (facets.ratings[ratingInt.toString()] || 0) + 1;
      }

      // Price range facet
      const rate = pro.hourlyRate || 0;
      if (rate < 50) {
        facets.priceRanges['under-50']++;
      } else if (rate < 100) {
        facets.priceRanges['50-100']++;
      } else if (rate < 200) {
        facets.priceRanges['100-200']++;
      } else if (rate < 500) {
        facets.priceRanges['200-500']++;
      } else {
        facets.priceRanges['over-500']++;
      }
    });

    // Sort locations and trades by count (descending)
    facets.locations = Object.entries(facets.locations)
      .sort((a, b) => b[1] - a[1])
      .reduce((acc, [key, val]) => {
        acc[key] = val;
        return acc;
      }, {});

    facets.trades = Object.entries(facets.trades)
      .sort((a, b) => b[1] - a[1])
      .reduce((acc, [key, val]) => {
        acc[key] = val;
        return acc;
      }, {});

    return facets;
  } catch (err) {
    console.error('[Aggregation] Error computing facets:', err.message);
    throw err;
  }
}

// ============================================================================
// DISTRIBUTION ANALYTICS - Count by dimensions
// ============================================================================

/**
 * Get distribution counts for professionals by trade, location, status
 * Returns aggregated counts with optional filters
 */
async function getDistributionStats(filters = {}) {
  const { startDate, endDate } = filters;

  try {
    // Build query parameters for raw SQL
    const dateFilter =
      startDate && endDate
        ? `WHERE p.created_at >= $1 AND p.created_at <= $2`
        : '';
    const dateParams = startDate && endDate ? [startDate, endDate] : [];

    // Get counts by trade
    const tradeDistribution = await prisma.$queryRaw`
      SELECT
        COALESCE(p.trade, 'Unknown') as trade,
        COUNT(*) as count
      FROM professional p
      WHERE p.user_id IN (SELECT id FROM "user" WHERE deleted_at IS NULL)
      GROUP BY p.trade
      ORDER BY count DESC
    `;

    // Get counts by location (city)
    const locationDistribution = await prisma.$queryRaw`
      SELECT
        COALESCE(u.city, 'Unknown') as location,
        COUNT(DISTINCT p.id) as count
      FROM professional p
      JOIN "user" u ON p.user_id = u.id
      WHERE u.deleted_at IS NULL
      GROUP BY u.city
      ORDER BY count DESC
    `;

    // Get counts by verification status
    const verificationDistribution = await prisma.$queryRaw`
      SELECT
        CASE
          WHEN p.verified_by_admin = true THEN 'Verified'
          WHEN p.identity_status = 'VERIFIED' THEN 'Identity Verified'
          WHEN p.identity_status = 'PENDING' THEN 'Identity Pending'
          WHEN p.identity_status = 'REJECTED' THEN 'Identity Rejected'
          ELSE 'Not Verified'
        END as status,
        COUNT(*) as count
      FROM professional p
      JOIN "user" u ON p.user_id = u.id
      WHERE u.deleted_at IS NULL
      GROUP BY status
      ORDER BY count DESC
    `;

    // Get counts by subscription tier
    const subscriptionDistribution = await prisma.$queryRaw`
      SELECT
        COALESCE(s.tier, 'No Subscription') as tier,
        COUNT(DISTINCT p.id) as count
      FROM professional p
      LEFT JOIN subscription s ON p.id = s.professional_id
      WHERE p.user_id IN (SELECT id FROM "user" WHERE deleted_at IS NULL)
      GROUP BY s.tier
      ORDER BY count DESC
    `;

    return {
      byTrade: tradeDistribution,
      byLocation: locationDistribution,
      byVerification: verificationDistribution,
      bySubscription: subscriptionDistribution,
    };
  } catch (err) {
    console.error('[Aggregation] Error computing distribution:', err.message);
    throw err;
  }
}

// ============================================================================
// PRICE DISTRIBUTION - Statistical analysis
// ============================================================================

/**
 * Get price distribution statistics
 * Returns min, max, mean, median, percentiles
 */
async function getPriceDistributionStats() {
  try {
    // Raw SQL for statistical aggregations
    const stats = await prisma.$queryRaw`
      SELECT
        COUNT(*) as total_professionals,
        COUNT(CASE WHEN hourly_rate IS NOT NULL THEN 1 END) as professionals_with_rate,
        MIN(CASE WHEN hourly_rate > 0 THEN hourly_rate END)::FLOAT as min_price,
        MAX(hourly_rate)::FLOAT as max_price,
        AVG(CASE WHEN hourly_rate > 0 THEN hourly_rate END)::FLOAT as mean_price,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hourly_rate)::FLOAT as median_price,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY hourly_rate)::FLOAT as percentile_25,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY hourly_rate)::FLOAT as percentile_75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY hourly_rate)::FLOAT as percentile_90,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY hourly_rate)::FLOAT as percentile_95,
        STDDEV_POP(CASE WHEN hourly_rate > 0 THEN hourly_rate END)::FLOAT as std_dev
      FROM professional p
      WHERE p.user_id IN (SELECT id FROM "user" WHERE deleted_at IS NULL)
    `;

    // Price distribution buckets (for histogram)
    const buckets = await prisma.$queryRaw`
      SELECT
        CASE
          WHEN hourly_rate IS NULL THEN 'Not Set'
          WHEN hourly_rate < 30 THEN '0-30'
          WHEN hourly_rate < 50 THEN '30-50'
          WHEN hourly_rate < 75 THEN '50-75'
          WHEN hourly_rate < 100 THEN '75-100'
          WHEN hourly_rate < 150 THEN '100-150'
          WHEN hourly_rate < 200 THEN '150-200'
          WHEN hourly_rate < 300 THEN '200-300'
          ELSE '300+'
        END as price_range,
        COUNT(*) as count,
        AVG(hourly_rate)::FLOAT as avg_in_range
      FROM professional p
      WHERE p.user_id IN (SELECT id FROM "user" WHERE deleted_at IS NULL)
      GROUP BY price_range
      ORDER BY
        CASE price_range
          WHEN 'Not Set' THEN 0
          WHEN '0-30' THEN 1
          WHEN '30-50' THEN 2
          WHEN '50-75' THEN 3
          WHEN '75-100' THEN 4
          WHEN '100-150' THEN 5
          WHEN '150-200' THEN 6
          WHEN '200-300' THEN 7
          WHEN '300+' THEN 8
        END
    `;

    return {
      summary: stats[0],
      distribution: buckets,
    };
  } catch (err) {
    console.error('[Aggregation] Error computing price distribution:', err.message);
    throw err;
  }
}

// ============================================================================
// REVIEW DISTRIBUTION - Statistics on ratings
// ============================================================================

/**
 * Get review and rating statistics
 * Returns distribution of ratings, average scores, etc.
 */
async function getReviewDistributionStats() {
  try {
    // Rating distribution across all reviews
    const ratingDistribution = await prisma.$queryRaw`
      SELECT
        rating,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM review), 2) as percentage
      FROM review
      GROUP BY rating
      ORDER BY rating DESC
    `;

    // Ratings by trade (top trades)
    const ratingByTrade = await prisma.$queryRaw`
      SELECT
        p.trade,
        COUNT(r.id) as total_reviews,
        AVG(r.rating)::FLOAT as avg_rating,
        MIN(r.rating) as min_rating,
        MAX(r.rating) as max_rating,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.rating)::FLOAT as median_rating
      FROM professional p
      LEFT JOIN review r ON p.id = r.professional_id
      WHERE p.user_id IN (SELECT id FROM "user" WHERE deleted_at IS NULL)
      GROUP BY p.trade
      HAVING COUNT(r.id) > 0
      ORDER BY total_reviews DESC
      LIMIT 20
    `;

    // Top rated professionals (by average rating and review count)
    const topRated = await prisma.$queryRaw`
      SELECT
        p.id,
        p.user_id,
        p.trade,
        p.average_rating as rating,
        p.review_count,
        u.first_name,
        u.last_name,
        u.city
      FROM professional p
      JOIN "user" u ON p.user_id = u.id
      WHERE p.review_count >= 5 AND u.deleted_at IS NULL
      ORDER BY p.average_rating DESC
      LIMIT 20
    `;

    return {
      ratingDistribution,
      ratingByTrade,
      topRated,
    };
  } catch (err) {
    console.error('[Aggregation] Error computing review distribution:', err.message);
    throw err;
  }
}

// ============================================================================
// QUOTE & BOOKING ANALYTICS
// ============================================================================

/**
 * Get quote and booking statistics
 * Returns counts, conversion rates, avg amounts
 */
async function getQuoteBookingStats() {
  try {
    // Quote statistics
    const quoteStats = await prisma.$queryRaw`
      SELECT
        status,
        COUNT(*) as count,
        AVG(amount)::FLOAT as avg_amount,
        MIN(amount)::FLOAT as min_amount,
        MAX(amount)::FLOAT as max_amount
      FROM quote
      GROUP BY status
      ORDER BY count DESC
    `;

    // Booking statistics
    const bookingStats = await prisma.$queryRaw`
      SELECT
        status,
        COUNT(*) as count
      FROM booking
      GROUP BY status
      ORDER BY count DESC
    `;

    // Quote to booking conversion (if available)
    const conversionStats = await prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT q.id) as total_quotes,
        COUNT(DISTINCT b.id) as total_bookings,
        ROUND(COUNT(DISTINCT b.id) * 100.0 / NULLIF(COUNT(DISTINCT q.id), 0), 2) as conversion_rate
      FROM quote q
      LEFT JOIN booking b ON q.id = b.quote_id
    `;

    return {
      quotes: quoteStats,
      bookings: bookingStats,
      conversion: conversionStats[0],
    };
  } catch (err) {
    console.error('[Aggregation] Error computing quote/booking stats:', err.message);
    throw err;
  }
}

module.exports = {
  getFacetedCounts,
  getDistributionStats,
  getPriceDistributionStats,
  getReviewDistributionStats,
  getQuoteBookingStats,
};
