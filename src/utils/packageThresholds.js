const prisma = require('../config/db');

const DEFAULT_THRESHOLDS = {
  maxDisputeRatePercent: 20,
  maxPrice: 5000000,
  minPrice: 1000,
  inactiveDaysThreshold: 180
};

let thresholdsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getThresholds() {
  const now = Date.now();
  if (thresholdsCache && (now - cacheTimestamp) < CACHE_TTL) {
    return thresholdsCache;
  }

  try {
    const thresholds = await prisma.packageSuspensionThreshold.findMany();
    thresholdsCache = thresholds;
    cacheTimestamp = now;
    return thresholds;
  } catch (err) {
    console.error('[Thresholds] Erreur cache:', err.message);
    return [];
  }
}

function getThresholdForCategory(category, allThresholds) {
  if (!allThresholds) return DEFAULT_THRESHOLDS;

  const specific = allThresholds.find(t => t.category === category);
  const global = allThresholds.find(t => t.category === '*');

  return specific || global || DEFAULT_THRESHOLDS;
}

function clearCache() {
  thresholdsCache = null;
  cacheTimestamp = 0;
}

async function detectAbuseFlags(pkg, suspendedProIds, allThresholds) {
  const threshold = getThresholdForCategory(pkg.category || '*', allThresholds);
  const flags = [];
  let isFlagged = false;

  if (suspendedProIds.has(pkg.professional.userId)) {
    flags.push('Professionnel suspendu');
    isFlagged = true;
  }

  const ordersTotal = pkg.orders.length;
  const disputeCount = pkg.orders.filter(o => o.status === 'DISPUTED').length;
  const disputeRate = ordersTotal > 0 ? (disputeCount / ordersTotal) * 100 : 0;

  if (disputeRate > threshold.maxDisputeRatePercent) {
    flags.push(`Taux de litiges élevé (${disputeRate.toFixed(1)}%)`);
    isFlagged = true;
  }

  if (pkg.price > threshold.maxPrice) {
    flags.push(`Prix excessif (> ${threshold.maxPrice.toLocaleString('fr-FR')} FCFA)`);
  }

  if (pkg.price < threshold.minPrice) {
    flags.push(`Prix anormalement bas (< ${threshold.minPrice.toLocaleString('fr-FR')} FCFA)`);
  }

  const inactiveMs = threshold.inactiveDaysThreshold * 24 * 60 * 60 * 1000;
  if (ordersTotal === 0 && new Date() - new Date(pkg.createdAt) > inactiveMs) {
    flags.push(`Inactif depuis ${threshold.inactiveDaysThreshold} jours (0 vente)`);
  }

  return { flags, isFlagged, disputeRate };
}

module.exports = { getThresholds, getThresholdForCategory, clearCache, DEFAULT_THRESHOLDS, detectAbuseFlags };
