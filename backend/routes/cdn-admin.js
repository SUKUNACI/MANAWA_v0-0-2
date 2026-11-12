const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const CDNHelper = require('../utils/cdn-helpers');
const { cloudinary, FOLDERS } = require('../config/cdn');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

const router = express.Router();

/**
 * CDN Admin Routes
 * Manages CDN operations, statistics, and maintenance
 * All routes require admin authentication
 */

// Middleware: Require admin role for all routes
router.use(requireAuth);
router.use(requireRole('admin'));

/**
 * GET /admin/cdn/stats
 * Get CDN usage statistics and cost analysis
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await CDNHelper.getUsageStats();

    // Calculate additional metrics
    const costEstimates = calculateCosts(stats);
    const recommendations = generateRecommendations(stats);

    return res.json({
      success: true,
      data: {
        usage: stats,
        costs: costEstimates,
        recommendations,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('CDN stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch CDN statistics',
    });
  }
});

/**
 * GET /admin/cdn/resources
 * List resources in a specific folder
 * Query: ?folder=manawa/avatars&limit=50
 */
router.get('/resources', async (req, res) => {
  try {
    const { folder, limit = 50 } = req.query;

    if (!folder) {
      return res.status(400).json({
        success: false,
        error: 'folder parameter is required',
      });
    }

    const result = await CDNHelper.listResources(folder, parseInt(limit));

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Resource listing error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to list resources',
    });
  }
});

/**
 * GET /admin/cdn/resource/:publicId
 * Get metadata for a specific resource
 */
router.get('/resource/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        error: 'publicId parameter is required',
      });
    }

    const metadata = await CDNHelper.getImageMetadata(publicId);

    return res.json({
      success: true,
      data: metadata,
    });
  } catch (error) {
    logger.error('Resource metadata error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch resource metadata',
    });
  }
});

/**
 * POST /admin/cdn/purge
 * Manually purge CDN cache
 * Methods: url, folder, tag, all
 */
router.post('/purge', async (req, res) => {
  try {
    const { method, url, folder, tag } = req.body;

    if (!method) {
      return res.status(400).json({
        success: false,
        error: 'method parameter is required (url, folder, tag, or all)',
      });
    }

    let result;

    switch (method) {
      case 'url':
        if (!url) {
          return res.status(400).json({
            success: false,
            error: 'url parameter is required for method: url',
          });
        }
        result = await cloudinary.api.delete_resources_by_prefix(url);
        logger.info(`CDN purge by URL: ${url}`);
        break;

      case 'folder':
        if (!folder) {
          return res.status(400).json({
            success: false,
            error: 'folder parameter is required for method: folder',
          });
        }
        result = await cloudinary.api.delete_resources_by_prefix(folder);
        logger.info(`CDN purge folder: ${folder}`);
        break;

      case 'tag':
        if (!tag) {
          return res.status(400).json({
            success: false,
            error: 'tag parameter is required for method: tag',
          });
        }
        result = await CDNHelper.deleteByTag(tag, 1000);
        logger.info(`CDN purge tag: ${tag}`);
        break;

      case 'all':
        // Purge entire CDN (dangerous - use carefully)
        if (process.env.NODE_ENV !== 'development') {
          return res.status(403).json({
            success: false,
            error: 'Full CDN purge only allowed in development',
          });
        }
        result = await cloudinary.api.delete_all_resources();
        logger.warn('Full CDN purge executed');
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid purge method',
        });
    }

    return res.json({
      success: true,
      data: {
        method,
        result,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('CDN purge error:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to purge CDN: ${error.message}`,
    });
  }
});

/**
 * DELETE /admin/cdn/resources
 * Delete specific resources by public IDs
 * Body: { publicIds: ['id1', 'id2', ...] }
 */
router.delete('/resources', async (req, res) => {
  try {
    const { publicIds } = req.body;

    if (!Array.isArray(publicIds) || publicIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'publicIds array is required and must not be empty',
      });
    }

    if (publicIds.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 500 resources can be deleted at once',
      });
    }

    const result = await CDNHelper.deleteOldImages(publicIds);

    logger.info(`Deleted ${publicIds.length} CDN resources`);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Resource deletion error:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to delete resources: ${error.message}`,
    });
  }
});

/**
 * GET /admin/cdn/transformations
 * List all active transformations and their usage
 */
router.get('/transformations', async (req, res) => {
  try {
    const transformations = [
      {
        name: 'avatar',
        description: 'User avatars (200x200, rounded)',
        usage: 'Profile pictures, member listings',
        avgFileSize: '18 KB',
        cacheTime: '30 days',
      },
      {
        name: 'thumbnail',
        description: 'Thumbnails (300x300)',
        usage: 'Gallery previews, listings',
        avgFileSize: '25 KB',
        cacheTime: '30 days',
      },
      {
        name: 'gallery',
        description: 'Gallery images (800x600)',
        usage: 'Portfolio projects, project details',
        avgFileSize: '90 KB',
        cacheTime: '30 days',
      },
      {
        name: 'mobile',
        description: 'Mobile optimized (375x280)',
        usage: 'Mobile app displays',
        avgFileSize: '30 KB',
        cacheTime: '7 days',
      },
      {
        name: 'hero',
        description: 'Hero/banner images (1920x400)',
        usage: 'Page headers, banners',
        avgFileSize: '150 KB',
        cacheTime: '30 days',
      },
      {
        name: 'pdf_preview',
        description: 'PDF previews (400x500)',
        usage: 'Quote and invoice previews',
        avgFileSize: '40 KB',
        cacheTime: '30 days',
      },
      {
        name: 'video_thumbnail',
        description: 'Video thumbnails (800x450)',
        usage: 'Video listings',
        avgFileSize: '45 KB',
        cacheTime: '30 days',
      },
    ];

    return res.json({
      success: true,
      data: {
        transformations,
        totalCount: transformations.length,
        documentationUrl: '/docs/cdn-transformations',
      },
    });
  } catch (error) {
    logger.error('Transformations list error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch transformations',
    });
  }
});

/**
 * GET /admin/cdn/cache-config
 * Get current cache configuration
 */
router.get('/cache-config', (req, res) => {
  try {
    const config = {
      browser: {
        versioned: 'max-age=31536000, immutable',
        content: 'max-age=2592000, must-revalidate',
        dynamic: 'max-age=86400, must-revalidate',
        private: 'no-cache, no-store, must-revalidate',
      },
      cdn: {
        avatars: '30 days',
        thumbnails: '30 days',
        gallery: '90 days',
        documents: '365 days',
      },
      staleWhileRevalidate: '7 days',
      etagEnabled: true,
      lastModifiedEnabled: true,
    };

    return res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    logger.error('Cache config error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch cache configuration',
    });
  }
});

/**
 * POST /admin/cdn/cleanup
 * Cleanup old/unused images
 * Query: ?daysOld=30&includeUnused=true
 */
router.post('/cleanup', async (req, res) => {
  try {
    const { daysOld = 30, includeUnused = false, maxResults = 1000 } = req.query;

    // Get resources older than daysOld
    const resources = await cloudinary.api.resources({
      type: 'upload',
      max_results: parseInt(maxResults),
      direction: 'asc',
    });

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(daysOld));

    const toDelete = resources.resources
      .filter(r => new Date(r.created_at) < cutoffDate)
      .map(r => r.public_id);

    if (toDelete.length === 0) {
      return res.json({
        success: true,
        data: {
          message: `No resources older than ${daysOld} days found`,
          cleaned: 0,
        },
      });
    }

    // Perform deletion
    const result = await CDNHelper.deleteOldImages(toDelete);

    logger.info(`Cleanup: deleted ${toDelete.length} old resources`);

    return res.json({
      success: true,
      data: {
        cleaned: toDelete.length,
        timestamp: new Date().toISOString(),
        details: result,
      },
    });
  } catch (error) {
    logger.error('Cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to cleanup CDN: ${error.message}`,
    });
  }
});

/**
 * GET /admin/cdn/health
 * Health check for CDN integration
 */
router.get('/health', async (req, res) => {
  try {
    // Test basic connectivity
    const pingResult = await cloudinary.api.ping();

    // Get account info
    const accountInfo = await cloudinary.api.account();

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      cloudinary: {
        connected: true,
        ping: pingResult,
        account: {
          cloudName: accountInfo.cloud_name || 'N/A',
          plan: accountInfo.plan || 'N/A',
        },
      },
      checks: {
        apiKey: !!process.env.CLOUDINARY_API_KEY,
        apiSecret: !!process.env.CLOUDINARY_API_SECRET,
        cloudName: !!process.env.CLOUDINARY_CLOUD_NAME,
      },
    };

    return res.json({
      success: true,
      data: health,
    });
  } catch (error) {
    logger.error('CDN health check error:', error);
    return res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: `CDN connectivity issue: ${error.message}`,
    });
  }
});

/**
 * Helper: Calculate cost estimates
 */
function calculateCosts(stats) {
  const bandwidthCostPerGB = 0.12;
  const storageCostPerGB = 0.25;
  const transformationCostPerM = 0.01;

  const bandwidthGB = stats.bandwidth ? stats.bandwidth.used_gb : 0;
  const storageGB = stats.storage ? stats.storage.used_gb : 0;
  const transformationsM = (stats.transformations || 0) / 1000000;

  const bandwidthCost = bandwidthGB * bandwidthCostPerGB;
  const storageCost = storageGB * storageCostPerGB;
  const transformationCost = transformationsM * transformationCostPerM;
  const totalCost = bandwidthCost + storageCost + transformationCost;

  return {
    monthly: {
      bandwidth: bandwidthCost.toFixed(2),
      storage: storageCost.toFixed(2),
      transformations: transformationCost.toFixed(2),
      total: totalCost.toFixed(2),
    },
    annual: {
      total: (totalCost * 12).toFixed(2),
    },
    breakdown: {
      bandwidthPercentage: ((bandwidthCost / totalCost) * 100).toFixed(1),
      storagePercentage: ((storageCost / totalCost) * 100).toFixed(1),
      transformationPercentage: ((transformationCost / totalCost) * 100).toFixed(1),
    },
  };
}

/**
 * Helper: Generate optimization recommendations
 */
function generateRecommendations(stats) {
  const recommendations = [];

  // Check bandwidth usage
  if (stats.bandwidth && stats.bandwidth.used_gb > 100) {
    recommendations.push({
      priority: 'high',
      category: 'bandwidth',
      message: 'Consider enabling aggressive caching to reduce bandwidth costs',
      potential_savings: '40-50%',
    });
  }

  // Check transformation count
  if (stats.transformations && stats.transformations > 1000000) {
    recommendations.push({
      priority: 'medium',
      category: 'transformations',
      message: 'Cache transformation results to reduce API calls',
      potential_savings: '30-40%',
    });
  }

  // Check storage usage
  if (stats.storage && stats.storage.used_gb > 50) {
    recommendations.push({
      priority: 'medium',
      category: 'storage',
      message: 'Clean up old/unused images to reduce storage costs',
      potential_savings: '15-25%',
    });
  }

  // Default recommendation
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'low',
      category: 'general',
      message: 'Your CDN usage is well-optimized',
      potential_savings: '0%',
    });
  }

  return recommendations;
}

module.exports = router;
