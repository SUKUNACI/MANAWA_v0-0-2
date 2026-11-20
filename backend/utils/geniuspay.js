const axios = require('axios');
const crypto = require('crypto');
const { CircuitBreaker } = require('./circuit-breaker');
const { AdaptiveRateLimiter } = require('./rate-limiter-adaptive');
const { getConfig } = require('../config/third-party-api-config');
const logger = require('./logger');
const timeoutConfig = require('../config/timeout-config');

const GENIUSPAY_BASE_URL = 'https://geniuspay.ci/api/v1/merchant';
// Sélection stricte des credentials selon NODE_ENV — sans fallback entre sandbox et production.
// Exportée pour tests unitaires directs (sans rechargement du module).
function _selectCredentials(nodeEnv, env) {
  if (nodeEnv === 'production') {
    const apiKey = env.GENIUSPAY_API_KEY || null;
    const apiSecret = env.GENIUSPAY_API_SECRET || null;
    const webhookSecret = env.GENIUSPAY_WEBHOOK_SECRET || null;
    if (apiKey && apiKey.startsWith('pk_sandbox_')) {
      throw new Error('[GeniusPay] FATAL: Clé sandbox (pk_sandbox_...) détectée dans NODE_ENV=production. Configurez GENIUSPAY_API_KEY avec une clé live (pk_live_...).');
    }
    if (apiSecret && apiSecret.startsWith('sk_sandbox_')) {
      throw new Error('[GeniusPay] FATAL: Secret sandbox (sk_sandbox_...) détecté dans NODE_ENV=production. Configurez GENIUSPAY_API_SECRET avec un secret live (sk_live_...).');
    }
    return { apiKey, apiSecret, webhookSecret };
  }
  if (nodeEnv === 'development') {
    const apiKey = env.GENIUSPAY_SANDBOX_API_KEY || null;
    const apiSecret = env.GENIUSPAY_SANDBOX_API_SECRET || null;
    const webhookSecret = env.GENIUSPAY_SANDBOX_WEBHOOK_SECRET || null;
    if (apiKey && apiKey.startsWith('pk_live_')) {
      throw new Error('[GeniusPay] FATAL: Clé live (pk_live_...) détectée dans NODE_ENV=development. Configurez GENIUSPAY_SANDBOX_API_KEY avec une clé sandbox (pk_sandbox_...).');
    }
    if (apiSecret && apiSecret.startsWith('sk_live_')) {
      throw new Error('[GeniusPay] FATAL: Secret live (sk_live_...) détecté dans NODE_ENV=development. Configurez GENIUSPAY_SANDBOX_API_SECRET avec un secret sandbox (sk_sandbox_...).');
    }
    return { apiKey, apiSecret, webhookSecret };
  }
  // test / autre — pas de garde (les mocks définissent des valeurs arbitraires)
  return {
    apiKey: env.GENIUSPAY_API_KEY || null,
    apiSecret: env.GENIUSPAY_API_SECRET || null,
    webhookSecret: env.GENIUSPAY_WEBHOOK_SECRET || null,
  };
}

const _resolved = _selectCredentials(process.env.NODE_ENV, process.env);
const API_KEY = _resolved.apiKey;
const API_SECRET = _resolved.apiSecret;
const WEBHOOK_SECRET = _resolved.webhookSecret;

if (!API_KEY) logger.warn('[GeniusPay] Clé API absente — paiements désactivés');
if (!API_SECRET) logger.warn('[GeniusPay] Secret API absent — paiements désactivés');
if (!WEBHOOK_SECRET) logger.warn('[GeniusPay] Secret webhook absent — vérification des webhooks désactivée');

// Get configuration
const config = getConfig('geniuspay');
const cbConfig = config?.circuitBreaker || {};
const rlConfig = config?.rateLimiter || {};

// Initialize Circuit Breaker and Rate Limiter
const circuitBreaker = new CircuitBreaker({
  serviceName: 'GeniusPay',
  ...cbConfig,
});

const rateLimiter = new AdaptiveRateLimiter({
  serviceName: 'GeniusPay',
  ...rlConfig,
});

// Q59: Set 5s timeout for GeniusPay API calls
const client = axios.create({
  baseURL: GENIUSPAY_BASE_URL,
  timeout: timeoutConfig.GENIUSPAY_TIMEOUT, // 5 seconds
  headers: {
    'X-API-Key': API_KEY,
    'X-API-Secret': API_SECRET,
    'Content-Type': 'application/json',
  },
});

// Initier un paiement GeniusPay
async function createPayment(payload) {
  return circuitBreaker.execute(async () => {
    return rateLimiter.execute(async () => {
      try {
        const response = await client.post('/payments', {
          amount: payload.amount,
          currency: 'XOF',
          description: payload.description,
          customer: {
            name: payload.customerName,
            email: payload.customerEmail,
            phone: payload.customerPhone,
          },
          metadata: {
            quoteId: payload.quoteId,
            projectId: payload.projectId,
            isDeposit: payload.isDeposit,
            userId: payload.userId,
          },
          success_url: payload.successUrl,
          error_url: payload.errorUrl,
        }, {
          headers: {
            // Clé d'idempotence : même clé = même réponse GeniusPay, pas de double paiement
            'X-Idempotency-Key': payload.idempotencyKey,
          },
        });

        logger.info('[GeniusPay] ✅ Payment created', {
          amount: payload.amount,
          quoteId: payload.quoteId,
          reference: response.data?.reference,
        });

        return response.data;
      } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;
        logger.error('[GeniusPay] createPayment error — status:', status, 'code:', err.code, 'data:', JSON.stringify(data), 'msg:', err.message);
        throw err;
      }
    });
  });
}

// Récupérer les détails d'un paiement par référence
async function getPayment(reference) {
  return circuitBreaker.execute(async () => {
    return rateLimiter.execute(async () => {
      try {
        const response = await client.get(`/payments/${reference}`);
        return response.data;
      } catch (err) {
        logger.error('GeniusPay getPayment error:', err.response?.data || err.message, { reference });
        throw err;
      }
    });
  });
}

// Lister les paiements avec filtres
async function listPayments(filters = {}) {
  return circuitBreaker.execute(async () => {
    return rateLimiter.execute(async () => {
      try {
        const response = await client.get('/payments', { params: filters });
        return response.data;
      } catch (err) {
        logger.error('GeniusPay listPayments error:', err.response?.data || err.message);
        throw err;
      }
    });
  });
}

// Récupérer les infos du compte
async function getAccountInfo() {
  return circuitBreaker.execute(async () => {
    return rateLimiter.execute(async () => {
      try {
        const response = await client.get('/account');
        return response.data;
      } catch (err) {
        logger.error('GeniusPay getAccountInfo error:', err.response?.data || err.message);
        throw err;
      }
    });
  });
}

// Récupérer le solde du compte
async function getAccountBalance() {
  return circuitBreaker.execute(async () => {
    return rateLimiter.execute(async () => {
      try {
        const response = await client.get('/account/balance');
        return response.data;
      } catch (err) {
        logger.error('GeniusPay getAccountBalance error:', err.response?.data || err.message);
        throw err;
      }
    });
  });
}

// Récupérer les fournisseurs MMO disponibles
async function getPawapayProviders(country = null) {
  return circuitBreaker.execute(async () => {
    return rateLimiter.execute(async () => {
      try {
        const url = country ? `/pawapay/providers?country=${country}` : '/pawapay/providers';
        const response = await client.get(url);
        return response.data;
      } catch (err) {
        logger.error('GeniusPay getPawapayProviders error:', err.response?.data || err.message);
        throw err;
      }
    });
  });
}

// Initier un remboursement GeniusPay
async function refundPayment(reference, amount, reason) {
  return circuitBreaker.execute(async () => {
    return rateLimiter.execute(async () => {
      try {
        const response = await client.post(`/payments/${reference}/refund`, {
          amount,
          currency: 'XOF',
          reason: reason || 'Remboursement client MANAWA',
        });

        logger.info('[GeniusPay] ✅ Refund initiated', {
          reference,
          amount,
          reason,
        });

        return response.data;
      } catch (err) {
        const status = err.response?.status;
        const data   = err.response?.data;
        logger.error('[GeniusPay] refundPayment error — status:', status, 'data:', JSON.stringify(data), 'msg:', err.message);
        throw err;
      }
    });
  });
}

// Vérifier la signature d'un webhook
// rawBody doit être le corps brut de la requête (string) — jamais un objet re-sérialisé,
// car JSON.stringify(JSON.parse(raw)) peut altérer l'ordre des clés ou le format des nombres.
function verifyWebhookSignature(signature, timestamp, rawBody) {
  if (!WEBHOOK_SECRET) {
    console.warn('GENIUSPAY_WEBHOOK_SECRET not configured');
    return false;
  }

  // Format: signature = HMAC-SHA256(timestamp + "." + raw_body_string, secret)
  const bodyStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
  const data = `${timestamp}.${bodyStr}`;
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(data)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}

// Vérifier le timestamp (protection contre les replay attacks - 5 min)
function verifyWebhookTimestamp(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 5 * 60; // 5 minutes
  return Math.abs(now - parseInt(timestamp)) <= maxAge;
}

module.exports = {
  createPayment,
  getPayment,
  listPayments,
  getAccountInfo,
  getAccountBalance,
  getPawapayProviders,
  refundPayment,
  verifyWebhookSignature,
  verifyWebhookTimestamp,
  // Expose instances for monitoring/testing
  circuitBreaker,
  rateLimiter,
  client,
  // Exposed for unit testing of credential selection
  _selectCredentials,
};
