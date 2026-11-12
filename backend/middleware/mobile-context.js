// Q127 + Q128: Mobile context middleware
// Détecte battery-saver et network-quality depuis les headers
// X-Battery-Saver: true  → req.batterySaver = true
// X-Network-Quality: slow|fast → req.networkQuality = 'slow'|'fast'

function mobileContextMiddleware(req, res, next) {
  req.batterySaver = req.headers['x-battery-saver'] === 'true';

  const nq = (req.headers['x-network-quality'] || '').toLowerCase();
  req.networkQuality = ['slow-2g', '2g', '3g', 'slow'].includes(nq) ? 'slow' : 'fast';

  req.mobileOptimized = req.batterySaver || req.networkQuality === 'slow';

  next();
}

module.exports = { mobileContextMiddleware };
