/**
 * A/B Testing Experiment Engine
 * Functions to manage experiments, variant assignment, and metrics tracking
 * Uses deterministic hashing for consistent user assignment
 */

const crypto = require('crypto');
const logger = require('./logger');

/**
 * Hash function for deterministic variant assignment
 * Same userId + experimentName = same variant (consistent across requests)
 */
function hashUserExperiment(userId, experimentName) {
  const hash = crypto
    .createHash('sha256')
    .update(`${experimentName}:${userId}`)
    .digest('hex');

  // Convert first 8 chars to number
  const hashValue = parseInt(hash.substring(0, 8), 16);
  return hashValue;
}

/**
 * Assign a user to a variant deterministically
 * @param {string} userId - User ID
 * @param {string} experimentName - Experiment name
 * @param {object} variants - Array of variant objects with weights
 *   [{ name: 'control', weight: 50 }, { name: 'variant_a', weight: 50 }]
 * @returns {string} - Assigned variant name
 */
function getVariant(userId, experimentName, variants) {
  if (!variants || variants.length === 0) {
    logger.warn('[ExperimentEngine] No variants provided', { experimentName });
    return null;
  }

  // Total weight
  const totalWeight = variants.reduce((sum, v) => sum + (v.weight || 0), 0);
  if (totalWeight <= 0) {
    logger.warn('[ExperimentEngine] Invalid variant weights', { experimentName });
    return variants[0]?.name;
  }

  // Hash user to number between 0 and totalWeight
  const hash = hashUserExperiment(userId, experimentName);
  let position = hash % totalWeight;

  // Find variant
  for (const variant of variants) {
    position -= (variant.weight || 0);
    if (position < 0) {
      logger.debug('[ExperimentEngine] Variant assigned', {
        experimentName,
        userId,
        variant: variant.name,
      });
      return variant.name;
    }
  }

  // Fallback
  return variants[0].name;
}

/**
 * Check if a user is in an active experiment
 * @param {string} userId - User ID
 * @param {object} experiment - Experiment object from DB
 * @param {string} experiment.status - Experiment status
 * @param {number} experiment.trafficPercentage - 0-100
 * @returns {boolean}
 */
function isUserInExperiment(userId, experiment) {
  if (experiment.status !== 'ACTIVE') {
    return false;
  }

  if (experiment.trafficPercentage >= 100) {
    return true;
  }

  // Use hash to determine if user is in traffic allocation
  const hash = hashUserExperiment(userId, experiment.name);
  const userPosition = hash % 100;

  const isIncluded = userPosition < experiment.trafficPercentage;

  logger.debug('[ExperimentEngine] Traffic check', {
    experimentName: experiment.name,
    userId,
    trafficPercentage: experiment.trafficPercentage,
    userPosition,
    isIncluded,
  });

  return isIncluded;
}

/**
 * Record metric for an experiment
 * @param {object} prisma - Prisma client
 * @param {string} variantId - Variant ID (from DB)
 * @param {string} metricName - Metric name (e.g., 'click', 'conversion')
 * @param {number} value - Metric value (e.g., 1 for binary, or actual value)
 * @param {object} metadata - Optional extra data
 */
async function recordMetric(prisma, variantId, metricName, value, metadata = {}) {
  try {
    await prisma.experimentMetric.create({
      data: {
        variantId,
        metricName,
        value,
        metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      },
    });

    logger.debug('[ExperimentEngine] Metric recorded', {
      variantId,
      metricName,
      value,
    });
  } catch (err) {
    logger.error('[ExperimentEngine] Failed to record metric', {
      variantId,
      metricName,
      error: err.message,
    });
  }
}

/**
 * Calculate statistics for experiment results
 * Returns: count, mean, stdDev, min, max for each variant
 */
async function calculateExperimentStats(prisma, experimentId) {
  try {
    const variants = await prisma.experimentVariant.findMany({
      where: { experimentId },
      include: {
        metrics: {
          select: { value: true },
        },
      },
    });

    const stats = {};

    for (const variant of variants) {
      if (variant.metrics.length === 0) {
        stats[variant.name] = {
          count: 0,
          mean: 0,
          stdDev: 0,
          min: 0,
          max: 0,
        };
        continue;
      }

      const values = variant.metrics.map(m => m.value);
      const count = values.length;
      const mean = values.reduce((a, b) => a + b, 0) / count;

      // Calculate standard deviation
      const variance =
        values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count;
      const stdDev = Math.sqrt(variance);

      stats[variant.name] = {
        count,
        mean: parseFloat(mean.toFixed(4)),
        stdDev: parseFloat(stdDev.toFixed(4)),
        min: Math.min(...values),
        max: Math.max(...values),
      };
    }

    return stats;
  } catch (err) {
    logger.error('[ExperimentEngine] Failed to calculate stats', {
      experimentId,
      error: err.message,
    });
    return {};
  }
}

/**
 * Perform simple statistical significance test (t-test approximation)
 * Compares two variant groups
 * Returns: { significant: boolean, pValue: number }
 */
async function testSignificance(prisma, experimentId, variant1Name, variant2Name) {
  try {
    const variants = await prisma.experimentVariant.findMany({
      where: {
        experimentId,
        name: { in: [variant1Name, variant2Name] },
      },
      include: {
        metrics: {
          select: { value: true },
        },
      },
    });

    if (variants.length !== 2) {
      logger.warn('[ExperimentEngine] Significance test requires exactly 2 variants');
      return { significant: false, pValue: 1 };
    }

    const v1 = variants[0].metrics.map(m => m.value);
    const v2 = variants[1].metrics.map(m => m.value);

    if (v1.length < 2 || v2.length < 2) {
      return { significant: false, pValue: 1, message: 'Insufficient samples' };
    }

    // Simple two-sample t-test (simplified, not full student's t)
    const mean1 = v1.reduce((a, b) => a + b, 0) / v1.length;
    const mean2 = v2.reduce((a, b) => a + b, 0) / v2.length;

    const var1 =
      v1.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (v1.length - 1);
    const var2 =
      v2.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (v2.length - 1);

    const pooledSE = Math.sqrt(var1 / v1.length + var2 / v2.length);
    const tStatistic = Math.abs(mean1 - mean2) / pooledSE;

    // Approximate p-value (very simplified)
    // For t-test with high df, use normal approximation
    // p = 2 * (1 - Φ(|t|))
    // Using rough approximation: p ≈ 2 * e^(-0.5 * t^2)
    const pValue = 2 * Math.exp(-0.5 * tStatistic * tStatistic);

    // Significant at p < 0.05
    const significant = pValue < 0.05;

    logger.info('[ExperimentEngine] Significance test results', {
      experimentId,
      variant1: variant1Name,
      variant2: variant2Name,
      mean1: parseFloat(mean1.toFixed(4)),
      mean2: parseFloat(mean2.toFixed(4)),
      tStatistic: parseFloat(tStatistic.toFixed(4)),
      pValue: parseFloat(pValue.toFixed(4)),
      significant,
    });

    return {
      significant,
      pValue: parseFloat(pValue.toFixed(4)),
      stats: {
        [variant1Name]: { mean: mean1, n: v1.length },
        [variant2Name]: { mean: mean2, n: v2.length },
      },
    };
  } catch (err) {
    logger.error('[ExperimentEngine] Failed to test significance', {
      experimentId,
      error: err.message,
    });
    return { significant: false, pValue: 1, error: err.message };
  }
}

module.exports = {
  getVariant,
  isUserInExperiment,
  recordMetric,
  calculateExperimentStats,
  testSignificance,
  hashUserExperiment,
};
