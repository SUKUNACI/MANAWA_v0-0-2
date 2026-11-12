const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, validationResult } = require('express-validator');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const {
  getDistributionStats,
  getPriceDistributionStats,
  getReviewDistributionStats,
  getQuoteBookingStats,
} = require('../utils/aggregation-helper');

const router = express.Router();

// Rate limiters
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez dans une minute' },
});

// ============================================================================
// GET /api/v1/analytics/distribution
// Distribution stats: count by trade, location, verification status
// Accessible to authenticated users (especially admins)
// ============================================================================
router.get(
  '/distribution',
  analyticsLimiter,
  optionalAuth, // Allow both authenticated and unauthenticated access
  [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('startDate must be ISO8601 format'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('endDate must be ISO8601 format'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { startDate, endDate } = req.query;

      // Validate date range if both provided
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (start >= end) {
          return res.status(400).json({
            error: 'startDate must be before endDate',
          });
        }
      }

      const filters = {
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      };

      const stats = await getDistributionStats(filters);

      res.status(200).json({
        success: true,
        data: {
          distribution: {
            byTrade: stats.byTrade,
            byLocation: stats.byLocation,
            byVerification: stats.byVerification,
            bySubscription: stats.bySubscription,
          },
          appliedFilters: {
            startDate: filters.startDate?.toISOString() || null,
            endDate: filters.endDate?.toISOString() || null,
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[AnalyticsDistribution] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/analytics/distribution/by-trade
// Distribution by trade only
// ============================================================================
router.get(
  '/distribution/by-trade',
  analyticsLimiter,
  optionalAuth,
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const stats = await getDistributionStats({});

      // Format for easy consumption
      const tradeCounts = stats.byTrade.map(item => ({
        trade: item.trade,
        count: Number(item.count),
      }));

      res.status(200).json({
        success: true,
        data: {
          byTrade: tradeCounts,
          total: tradeCounts.reduce((sum, item) => sum + item.count, 0),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[AnalyticsDistribution ByTrade] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/analytics/distribution/by-location
// Distribution by location only
// ============================================================================
router.get(
  '/distribution/by-location',
  analyticsLimiter,
  optionalAuth,
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const stats = await getDistributionStats({});

      // Format for easy consumption
      const locationCounts = stats.byLocation.map(item => ({
        location: item.location,
        count: Number(item.count),
      }));

      res.status(200).json({
        success: true,
        data: {
          byLocation: locationCounts,
          total: locationCounts.reduce((sum, item) => sum + item.count, 0),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[AnalyticsDistribution ByLocation] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/analytics/distribution/by-status
// Distribution by verification status
// ============================================================================
router.get(
  '/distribution/by-status',
  analyticsLimiter,
  optionalAuth,
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const stats = await getDistributionStats({});

      // Format for easy consumption
      const statusCounts = stats.byVerification.map(item => ({
        status: item.status,
        count: Number(item.count),
      }));

      res.status(200).json({
        success: true,
        data: {
          byStatus: statusCounts,
          total: statusCounts.reduce((sum, item) => sum + item.count, 0),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[AnalyticsDistribution ByStatus] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/analytics/price-distribution
// Price distribution stats: min, max, median, percentiles, histogram
// ============================================================================
router.get(
  '/price-distribution',
  analyticsLimiter,
  optionalAuth,
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const priceStats = await getPriceDistributionStats();

      res.status(200).json({
        success: true,
        data: {
          summary: {
            totalProfessionals: Number(priceStats.summary.total_professionals),
            professionalsWithRate: Number(
              priceStats.summary.professionals_with_rate
            ),
            minPrice: priceStats.summary.min_price
              ? parseFloat(priceStats.summary.min_price)
              : null,
            maxPrice: priceStats.summary.max_price
              ? parseFloat(priceStats.summary.max_price)
              : null,
            meanPrice: priceStats.summary.mean_price
              ? parseFloat(priceStats.summary.mean_price)
              : null,
            medianPrice: priceStats.summary.median_price
              ? parseFloat(priceStats.summary.median_price)
              : null,
            percentile25: priceStats.summary.percentile_25
              ? parseFloat(priceStats.summary.percentile_25)
              : null,
            percentile75: priceStats.summary.percentile_75
              ? parseFloat(priceStats.summary.percentile_75)
              : null,
            percentile90: priceStats.summary.percentile_90
              ? parseFloat(priceStats.summary.percentile_90)
              : null,
            percentile95: priceStats.summary.percentile_95
              ? parseFloat(priceStats.summary.percentile_95)
              : null,
            standardDeviation: priceStats.summary.std_dev
              ? parseFloat(priceStats.summary.std_dev)
              : null,
          },
          distribution: priceStats.distribution.map(bucket => ({
            priceRange: bucket.price_range,
            count: Number(bucket.count),
            averageInRange: bucket.avg_in_range
              ? parseFloat(bucket.avg_in_range)
              : null,
            percentage: (
              (Number(bucket.count) /
                Number(priceStats.summary.total_professionals)) *
              100
            ).toFixed(2),
          })),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[AnalyticsPriceDistribution] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/analytics/review-distribution
// Review and rating statistics
// ============================================================================
router.get(
  '/review-distribution',
  analyticsLimiter,
  optionalAuth,
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const reviewStats = await getReviewDistributionStats();

      res.status(200).json({
        success: true,
        data: {
          ratingDistribution: reviewStats.ratingDistribution.map(item => ({
            rating: Number(item.rating),
            count: Number(item.count),
            percentage: parseFloat(item.percentage),
          })),
          ratingByTrade: reviewStats.ratingByTrade.map(item => ({
            trade: item.trade,
            totalReviews: Number(item.total_reviews),
            avgRating: item.avg_rating ? parseFloat(item.avg_rating) : null,
            minRating: Number(item.min_rating),
            maxRating: Number(item.max_rating),
            medianRating: item.median_rating
              ? parseFloat(item.median_rating)
              : null,
          })),
          topRated: reviewStats.topRated.map(item => ({
            professionalId: item.id,
            userId: item.user_id,
            trade: item.trade,
            rating: parseFloat(item.rating),
            reviewCount: Number(item.review_count),
            name: `${item.first_name} ${item.last_name}`,
            city: item.city,
          })),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[AnalyticsReviewDistribution] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/analytics/quotes-bookings
// Quote and booking statistics
// ============================================================================
router.get(
  '/quotes-bookings',
  analyticsLimiter,
  optionalAuth,
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const stats = await getQuoteBookingStats();

      res.status(200).json({
        success: true,
        data: {
          quotes: stats.quotes.map(item => ({
            status: item.status,
            count: Number(item.count),
            avgAmount: item.avg_amount
              ? parseFloat(item.avg_amount)
              : null,
            minAmount: item.min_amount
              ? parseFloat(item.min_amount)
              : null,
            maxAmount: item.max_amount
              ? parseFloat(item.max_amount)
              : null,
          })),
          bookings: stats.bookings.map(item => ({
            status: item.status,
            count: Number(item.count),
          })),
          conversion: {
            totalQuotes: Number(stats.conversion.total_quotes),
            totalBookings: Number(stats.conversion.total_bookings),
            conversionRate: parseFloat(stats.conversion.conversion_rate) || 0,
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[AnalyticsQuotesBookings] Error:', err.message);
      next(err);
    }
  }
);

// ============================================================================
// GET /api/v1/analytics/health-check
// Admin only - verify database aggregation queries are working
// ============================================================================
router.get(
  '/health-check',
  analyticsLimiter,
  requireAuth,
  requireRole('ADMIN'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const startTime = Date.now();

      // Run all aggregation queries to verify they work
      const [distribution, prices, reviews, quotesBookings] = await Promise.all(
        [
          getDistributionStats({}),
          getPriceDistributionStats(),
          getReviewDistributionStats(),
          getQuoteBookingStats(),
        ]
      );

      const duration = Date.now() - startTime;

      res.status(200).json({
        success: true,
        data: {
          status: 'healthy',
          aggregationQueries: {
            distribution: {
              status: 'ok',
              trades: distribution.byTrade.length,
              locations: distribution.byLocation.length,
            },
            priceDistribution: {
              status: 'ok',
              bucketsCount: prices.distribution.length,
            },
            reviewDistribution: {
              status: 'ok',
              topRatedCount: reviews.topRated.length,
            },
            quotesBookings: {
              status: 'ok',
              quoteStatuses: quotesBookings.quotes.length,
              bookingStatuses: quotesBookings.bookings.length,
            },
          },
          duration: `${duration}ms`,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[AnalyticsHealthCheck] Error:', err.message);
      res.status(500).json({
        success: false,
        error: err.message,
        status: 'unhealthy',
      });
    }
  }
);

module.exports = router;
