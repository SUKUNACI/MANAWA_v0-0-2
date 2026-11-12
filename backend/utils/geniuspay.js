const axios = require('axios');
const crypto = require('crypto');
const { CircuitBreaker } = require('./circuit-breaker');
const { AdaptiveRateLimiter } = require('./rate-limiter-adaptive');
const { getConfig } = require('../config/third-party-api-config');
const logger = require('./logger');
const timeoutConfig = require('../config/timeout-config');

const GENIUSPAY_BASE_URL = 'https://geniuspay.ci/api/v1/merchant';
const API_KEY = process.env.GENIUSPAY_API_KEY;
const API_SECRET = process.env.GENIUSPAY_API_SECRET;
const WEBHOOK_SECRET = process.env.GENIUSPAY_WEBHOOK_SECRET;

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

// ERROR #4: Use crypto.timingSafeEqual for consistency - prevent timing attacks
// Vérifier la signature d'un webhook
function verifyWebhookSignature(signature, timestamp, payload) {
  if (!WEBHOOK_SECRET) {
    console.warn('GENIUSPAY_WEBHOOK_SECRET not configured');
    return false;
  }

  // Format: signature = HMAC-SHA256(timestamp + "." + json_payload, secret)
  const data = `${timestamp}.${JSON.stringify(payload)}`;
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
};
