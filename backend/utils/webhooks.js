const crypto = require('crypto');
const axios = require('axios');
const prisma = require('../config/db');
const logger = require('./logger');

// Extracted so tests can override: webhooks._delay = () => Promise.resolve()
let _delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Event types that can trigger webhooks
const WEBHOOK_EVENTS = {
  BOOKING_CREATED: 'booking.created',
  BOOKING_UPDATED: 'booking.updated',
  BOOKING_CANCELLED: 'booking.cancelled',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  QUOTE_CREATED: 'quote.created',
  QUOTE_ACCEPTED: 'quote.accepted',
  QUOTE_REFUSED: 'quote.refused',
  USER_REGISTERED: 'user.registered',
  USER_VERIFIED: 'user.verified',
  PROJECT_CREATED: 'project.created',
  PROJECT_COMPLETED: 'project.completed',
};

// Configuration for retry logic
const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 5000,     // 5 seconds
  backoffMultiplier: 2,      // exponential backoff: 5s, 10s, 20s
  timeoutMs: 30000,          // 30 second timeout per request
};

/**
 * Generate HMAC-SHA256 signature for webhook payload
 * @param {string} payload - JSON stringified payload
 * @param {string} secret - Webhook secret
 * @returns {string} HMAC-SHA256 hex digest
 */
function generateSignature(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Register a new webhook
 * @param {string} url - Endpoint URL to receive webhooks
 * @param {string} secret - Secret for HMAC signing
 * @param {string[]} events - Array of event types to subscribe to
 * @returns {Object} Created webhook
 */
async function registerWebhook(url, secret, events = []) {
  try {
    // Validate URL
    try {
      new URL(url);
    } catch (err) {
      throw new Error(`Invalid webhook URL: ${err.message}`);
    }

    // Validate secret length (minimum 16 characters for security)
    if (!secret || secret.length < 16) {
      throw new Error('Webhook secret must be at least 16 characters long');
    }

    // Validate events
    const validEvents = Object.values(WEBHOOK_EVENTS);
    const invalidEvents = events.filter(e => !validEvents.includes(e));
    if (invalidEvents.length > 0) {
      throw new Error(`Invalid events: ${invalidEvents.join(', ')}`);
    }

    const webhook = await prisma.webhook.create({
      data: {
        url,
        secret,
        events: events.length > 0 ? events : Object.values(WEBHOOK_EVENTS),
        isActive: true,
      },
    });

    logger.info('Webhook registered', {
      webhookId: webhook.id,
      url,
      eventCount: webhook.events.length,
    });

    return webhook;
  } catch (err) {
    logger.error('Failed to register webhook', { error: err.message, url });
    throw err;
  }
}

/**
 * Unregister a webhook
 * @param {string} webhookId - Webhook ID
 * @returns {boolean} Success
 */
async function unregisterWebhook(webhookId) {
  try {
    await prisma.webhook.delete({
      where: { id: webhookId },
    });

    logger.info('Webhook unregistered', { webhookId });
    return true;
  } catch (err) {
    logger.error('Failed to unregister webhook', { error: err.message, webhookId });
    throw err;
  }
}

/**
 * Deactivate/activate a webhook
 * @param {string} webhookId - Webhook ID
 * @param {boolean} isActive - Active status
 * @returns {Object} Updated webhook
 */
async function setWebhookActive(webhookId, isActive) {
  try {
    const webhook = await prisma.webhook.update({
      where: { id: webhookId },
      data: { isActive },
    });

    logger.info('Webhook status updated', {
      webhookId,
      isActive,
    });

    return webhook;
  } catch (err) {
    logger.error('Failed to update webhook status', { error: err.message, webhookId });
    throw err;
  }
}

/**
 * Trigger a webhook event with automatic retry logic
 * @param {string} event - Event type (must be in WEBHOOK_EVENTS)
 * @param {Object} payload - Event data to send
 * @returns {Promise<void>}
 */
async function triggerWebhook(event, payload) {
  try {
    // Validate event
    if (!Object.values(WEBHOOK_EVENTS).includes(event)) {
      logger.warn('Unknown webhook event', { event });
      return;
    }

    // Find all active webhooks subscribed to this event
    const webhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        events: {
          has: event,
        },
      },
    });

    if (webhooks.length === 0) {
      logger.debug('No active webhooks for event', { event });
      return;
    }

    // Send webhook to each subscriber
    const payloadString = JSON.stringify(payload);
    const results = [];

    for (const webhook of webhooks) {
      try {
        // Create initial log entry
        const log = await prisma.webhookLog.create({
          data: {
            webhookId: webhook.id,
            event,
            payload: payloadString,
            status: 'pending',
            attempt: 1,
          },
        });

        // Attempt to deliver webhook
        await deliverWebhook(webhook, event, payloadString, log.id);
        results.push({ webhookId: webhook.id, status: 'sent' });
      } catch (err) {
        logger.error('Failed to queue webhook delivery', {
          webhookId: webhook.id,
          event,
          error: err.message,
        });
        results.push({ webhookId: webhook.id, status: 'error', error: err.message });
      }
    }

    logger.info('Webhook event triggered', {
      event,
      targetCount: webhooks.length,
      results,
    });
  } catch (err) {
    logger.error('Failed to trigger webhook', { event, error: err.message });
  }
}

/**
 * Deliver webhook to endpoint with retry logic
 * @private
 * @param {Object} webhook - Webhook configuration
 * @param {string} event - Event type
 * @param {string} payload - JSON payload
 * @param {string} logId - WebhookLog ID for tracking
 */
async function deliverWebhook(webhook, event, payload, logId, attempt = 1) {
  const signature = generateSignature(payload, webhook.secret);

  try {
    // Send webhook
    const response = await axios.post(webhook.url, JSON.parse(payload), {
      headers: {
        'X-Webhook-Event': event,
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Attempt': attempt.toString(),
        'Content-Type': 'application/json',
      },
      timeout: RETRY_CONFIG.timeoutMs,
      validateStatus: () => true,
    });

    // Success on 2xx
    if (response.status >= 200 && response.status < 300) {
      await prisma.webhookLog.update({
        where: { id: logId },
        data: {
          status: 'success',
          response: JSON.stringify({ statusCode: response.status, body: response.data }),
          attempt,
          nextRetryAt: null,
        },
      });

      logger.info('Webhook delivered successfully', { logId, event, webhookId: webhook.id, attempt, statusCode: response.status });
      return;
    }

    // Non-2xx — schedule retry if attempts remain
    const lastError = { statusCode: response.status, body: response.data, message: `HTTP ${response.status}` };
    logger.warn('Webhook delivery failed', { logId, event, webhookId: webhook.id, attempt, statusCode: response.status });
    await _scheduleRetryOrFail(logId, attempt, lastError);
  } catch (err) {
    const lastError = { message: err.message, code: err.code };
    logger.warn('Webhook delivery error', { logId, event, webhookId: webhook.id, attempt, error: err.message });
    await _scheduleRetryOrFail(logId, attempt, lastError);
  }
}

async function _scheduleRetryOrFail(logId, attempt, lastError) {
  if (attempt < RETRY_CONFIG.maxAttempts) {
    const delayMs = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1);
    const nextRetryAt = new Date(Date.now() + delayMs);

    await prisma.webhookLog.update({
      where: { id: logId },
      data: {
        status: 'pending',
        response: JSON.stringify(lastError),
        attempt,
        nextRetryAt,
      },
    });
  } else {
    await prisma.webhookLog.update({
      where: { id: logId },
      data: {
        status: 'failed',
        response: JSON.stringify({ message: 'Max retries exceeded', lastError, attempts: RETRY_CONFIG.maxAttempts }),
        attempt: RETRY_CONFIG.maxAttempts,
        nextRetryAt: null,
      },
    });
  }
}

/**
 * Retry failed webhook deliveries
 * Used by a scheduled job to retry pending/failed webhooks
 * @returns {Promise<number>} Number of webhooks retried
 */
async function retryFailedWebhooks() {
  try {
    const pendingLogs = await prisma.webhookLog.findMany({
      where: {
        status: 'pending',
        nextRetryAt: {
          lte: new Date(), // Time to retry
        },
      },
      include: {
        webhook: true,
      },
      take: 100, // Process max 100 at a time
    });

    let retryCount = 0;

    for (const log of pendingLogs) {
      try {
        // Verify webhook still exists and is active
        if (!log.webhook.isActive) {
          await prisma.webhookLog.update({
            where: { id: log.id },
            data: {
              status: 'failed',
              response: JSON.stringify({ message: 'Webhook deactivated' }),
              nextRetryAt: null,
            },
          });
          continue;
        }

        // Attempt delivery again (next attempt number)
        await deliverWebhook(log.webhook, log.event, log.payload, log.id, log.attempt + 1);
        retryCount++;
      } catch (err) {
        logger.error('Failed to retry webhook', {
          logId: log.id,
          webhookId: log.webhook.id,
          error: err.message,
        });
      }
    }

    if (pendingLogs.length > 0) {
      logger.info('Webhook retry job completed', {
        pendingCount: pendingLogs.length,
        retryCount,
      });
    }

    return retryCount;
  } catch (err) {
    logger.error('Webhook retry job failed', { error: err.message });
    throw err;
  }
}

/**
 * Get all webhooks with optional filtering
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Array of webhooks
 */
async function getWebhooks(options = {}) {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        isActive: options.isActive !== undefined ? options.isActive : undefined,
      },
      include: {
        logs: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return webhooks;
  } catch (err) {
    logger.error('Failed to get webhooks', { error: err.message });
    throw err;
  }
}

/**
 * Get webhook logs for debugging
 * @param {string} webhookId - Webhook ID
 * @param {Object} options - Filter options (limit, offset, status)
 * @returns {Promise<Array>} Array of logs
 */
async function getWebhookLogs(webhookId, options = {}) {
  try {
    const { limit = 50, offset = 0, status } = options;

    const logs = await prisma.webhookLog.findMany({
      where: {
        webhookId,
        status: status || undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await prisma.webhookLog.count({
      where: {
        webhookId,
        status: status || undefined,
      },
    });

    return { logs, total };
  } catch (err) {
    logger.error('Failed to get webhook logs', { error: err.message, webhookId });
    throw err;
  }
}

/**
 * Send test webhook to verify configuration
 * @param {string} webhookId - Webhook ID
 * @returns {Promise<Object>} Test result
 */
async function sendTestWebhook(webhookId) {
  try {
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook payload',
        webhookId,
      },
    };

    const payloadString = JSON.stringify(testPayload);
    const signature = generateSignature(payloadString, webhook.secret);

    // Send test request
    const response = await axios.post(webhook.url, testPayload, {
      headers: {
        'X-Webhook-Event': 'test',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Test': 'true',
        'Content-Type': 'application/json',
      },
      timeout: RETRY_CONFIG.timeoutMs,
      validateStatus: () => true,
    });

    const success = response.status >= 200 && response.status < 300;

    // Log test result
    const log = await prisma.webhookLog.create({
      data: {
        webhookId,
        event: 'test',
        payload: payloadString,
        status: success ? 'success' : 'failed',
        response: JSON.stringify({
          statusCode: response.status,
          body: response.data,
        }),
        attempt: 1,
      },
    });

    logger.info('Test webhook sent', {
      webhookId,
      statusCode: response.status,
      success,
    });

    return {
      success,
      statusCode: response.status,
      responseBody: response.data,
      logId: log.id,
    };
  } catch (err) {
    logger.error('Test webhook failed', { error: err.message, webhookId });
    throw err;
  }
}

module.exports = {
  WEBHOOK_EVENTS,
  RETRY_CONFIG,
  registerWebhook,
  unregisterWebhook,
  setWebhookActive,
  triggerWebhook,
  retryFailedWebhooks,
  getWebhooks,
  getWebhookLogs,
  sendTestWebhook,
  generateSignature,
  get _delay() { return _delay; },
  set _delay(fn) { _delay = fn; },
};
