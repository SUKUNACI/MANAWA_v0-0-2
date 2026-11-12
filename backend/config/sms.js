const timeoutConfig = require('./timeout-config');
const { CircuitBreaker } = require('../utils/circuit-breaker');
const { AdaptiveRateLimiter } = require('../utils/rate-limiter-adaptive');
const { getConfig } = require('./third-party-api-config');
const logger = require('../utils/logger');

const isConfigured = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER;

// Get configuration
const config = getConfig('twilio');
const cbConfig = config?.circuitBreaker || {};
const rlConfig = config?.rateLimiter || {};

// Initialize Circuit Breaker and Rate Limiter
const circuitBreaker = new CircuitBreaker({
  serviceName: 'Twilio',
  ...cbConfig,
});

const rateLimiter = new AdaptiveRateLimiter({
  serviceName: 'Twilio',
  ...rlConfig,
});

let twilioClient = null;
if (isConfigured) {
  const twilio = require('twilio');
  // Q59: Add 5s timeout for Twilio API calls
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    timeout: timeoutConfig.TWILIO_TIMEOUT, // 5 seconds
  });
}

/**
 * Envoie un SMS avec un code de vérification.
 * Si les identifiants Twilio ne sont pas configurés dans .env,
 * le SMS n'est PAS envoyé : le code est simplement retourné (mode test).
 * ⚠️ Ce mode test ne doit JAMAIS être actif en production.
 */
async function sendVerificationSms(toPhone, code) {
  if (!isConfigured) {
    logger.info(`[MODE TEST - pas de SMS envoyé] Code pour ${toPhone} : ${code}`);
    return { sent: false, devCode: code };
  }

  return circuitBreaker.execute(async () => {
    return rateLimiter.execute(async () => {
      try {
        const message = await twilioClient.messages.create({
          body: `Votre code de vérification MANAWA est : ${code}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: toPhone,
        });

        logger.info(`[Twilio] ✅ SMS verification sent to ${toPhone}`, {
          messageSid: message.sid,
        });

        return { sent: true };
      } catch (err) {
        logger.error(`[Twilio] SMS send error:`, err.message, { toPhone });
        throw err;
      }
    });
  });
}

module.exports = { sendVerificationSms, isConfigured, circuitBreaker, rateLimiter };
