const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Middleware pour vérifier la signature HMAC-SHA256 des webhooks reçus (Q55)
 *
 * Vérifie:
 * - Header X-Webhook-Signature présent
 * - Format valide (sha256=<hex>)
 * - Signature valide avec timing-safe comparison
 * - Reject si signature invalide → 401 Unauthorized
 * - Logger les tentatives invalides
 *
 * Configuration:
 * - Ignorer les webhooks avec secret manquant (test mode)
 * - Ignorer les endpoints TEST (X-Webhook-Test header)
 */

/**
 * Timing-safe comparison pour HMAC
 * Prévient les timing attacks
 */
function timingSafeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(a),
      Buffer.from(b)
    );
  } catch (err) {
    return false;
  }
}

/**
 * Extraire la signature du header
 * Format: sha256=<hex_digest>
 */
function extractSignatureFromHeader(header) {
  if (!header) return null;
  const match = header.match(/^sha256=([a-f0-9]{64})$/i);
  return match ? match[1] : null;
}

/**
 * Middleware de vérification de signature webhook
 *
 * @param {Object} options - Configuration
 * @param {Array<string>} options.ignorePaths - Chemins à ignorer (ex: ['/api/v1/payments/webhooks/test'])
 * @param {Boolean} options.allowTestWebhooks - Autoriser les webhooks test (X-Webhook-Test=true)
 */
function webhookSignatureVerification(options = {}) {
  const {
    ignorePaths = [],
    allowTestWebhooks = false,
  } = options;

  return (req, res, next) => {
    // Ignorer les chemins configurés
    if (ignorePaths.some(path => req.path === path)) {
      return next();
    }

    // Ignorer les webhooks de test si autorisé
    if (allowTestWebhooks && req.headers['x-webhook-test'] === 'true') {
      return next();
    }

    // Vérifier que c'est un webhook (doit avoir un header X-Webhook-Signature)
    const signatureHeader = req.headers['x-webhook-signature'];
    if (!signatureHeader) {
      // Pas de header signature = pas un webhook valide
      logger.warn('[Q55] Webhook sans signature détecté', {
        path: req.path,
        ip: req.ip,
        method: req.method,
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing X-Webhook-Signature header',
      });
    }

    // Extraire et valider le format de la signature
    const providedSignature = extractSignatureFromHeader(signatureHeader);
    if (!providedSignature) {
      logger.warn('[Q55] Format de signature invalide', {
        path: req.path,
        ip: req.ip,
        signatureHeader,
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid X-Webhook-Signature format (expected: sha256=<hex>)',
      });
    }

    // Récupérer le secret du webhook depuis la BD
    // NOTE: Le secret doit être passé au middleware ou chargé depuis la BD
    // Pour l'instant, on suppose qu'il est stocké dans req.webhookSecret
    const webhookSecret = req.webhookSecret || process.env.WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error('[Q55] Secret webhook manquant - configuration incomplète', {
        path: req.path,
        ip: req.ip,
      });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Webhook secret not configured',
      });
    }

    // Calculer la signature attendue depuis le body brut
    // IMPORTANT: Utiliser req.rawBody (doit être défini par un middleware antérieur)
    // ou req.body en JSON
    let bodyToSign;

    if (req.rawBody) {
      // Si on a le body brut, l'utiliser (plus fiable)
      bodyToSign = req.rawBody;
    } else if (req.body) {
      // Sinon, stringify le body parsé (attention: l'ordre des clés peut differ)
      bodyToSign = JSON.stringify(req.body);
    } else {
      logger.warn('[Q55] Pas de body à signer', {
        path: req.path,
        ip: req.ip,
      });
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Empty request body',
      });
    }

    // Calculer la signature attendue
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(bodyToSign)
      .digest('hex');

    // Comparaison timing-safe (Q55: Timing-safe comparison)
    const isValid = timingSafeEqual(expectedSignature, providedSignature);

    if (!isValid) {
      logger.warn('[Q55] Signature webhook invalide - tentative rejetée', {
        path: req.path,
        ip: req.ip,
        event: req.headers['x-webhook-event'],
        attempt: req.headers['x-webhook-attempt'],
        provided: providedSignature.substring(0, 16) + '...',
        expected: expectedSignature.substring(0, 16) + '...',
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid webhook signature',
      });
    }

    // Signature valide - ajouter des informations au request
    req.webhookVerified = true;
    req.webhookEvent = req.headers['x-webhook-event'];
    req.webhookAttempt = parseInt(req.headers['x-webhook-attempt'] || '1', 10);
    req.webhookSequence = parseInt(req.headers['x-webhook-sequence'] || '0', 10); // Q56
    req.webhookIdempotencyKey = req.headers['x-idempotency-key']; // Q56

    logger.debug('[Q55] Signature webhook valide', {
      path: req.path,
      ip: req.ip,
      event: req.webhookEvent,
      attempt: req.webhookAttempt,
      sequence: req.webhookSequence,
    });

    next();
  };
}

/**
 * Middleware pour capturer le body brut (doit être appliqué avant JSON parser)
 *
 * IMPORTANT: Appliquer AVANT express.json()
 *
 * Usage:
 * app.use(captureRawBody);
 * app.use(express.json());
 */
function captureRawBody(req, res, next) {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      req.rawBody = data;
      next();
    });
  } else {
    next();
  }
}

module.exports = {
  webhookSignatureVerification,
  captureRawBody,
  timingSafeEqual,
  extractSignatureFromHeader,
};
