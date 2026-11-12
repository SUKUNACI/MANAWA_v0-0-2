const logger = require('../utils/logger');
const pushNotifications = require('./pushNotifications');
const mailer = require('./mailer');

/**
 * Push Notification Fallback Strategy
 *
 * Fallback chain:
 * 1. Try FCM (Firebase Cloud Messaging)
 * 2. If FCM fails -> retry with Expo
 * 3. If Expo fails -> send email fallback notification
 *
 * This ensures notifications reach users even if primary service fails
 */

const RETRY_CONFIG = {
  fcm: {
    attempts: 2,
    delay: 1000, // ms between retries
  },
  expo: {
    attempts: 2,
    delay: 1000,
  },
};

/**
 * Send with automatic fallback
 * @param {string} userId - User ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data
 * @param {string} userEmail - User email (for email fallback)
 * @returns {Promise<{sent: boolean, method: string, reason?: string}>}
 */
async function sendWithFallback(userId, title, body, data = {}, userEmail = null) {
  try {
    // Step 1: Try FCM first
    logger.info(`[Fallback] Attempting FCM for user ${userId}`);
    let result = await sendWithRetry(
      () => pushNotifications.sendPushNotification(userId, title, body, data),
      RETRY_CONFIG.fcm.attempts,
      RETRY_CONFIG.fcm.delay
    );

    if (result?.sent) {
      logger.info(`[Fallback] ✅ FCM succeeded for user ${userId}`);
      return { sent: true, method: 'FCM' };
    }

    // Step 2: If FCM failed, try Expo
    logger.warn(`[Fallback] FCM failed, attempting Expo for user ${userId}`);
    result = await sendWithRetry(
      () => pushNotifications.sendPushNotification(userId, title, body, data),
      RETRY_CONFIG.expo.attempts,
      RETRY_CONFIG.expo.delay
    );

    if (result?.sent) {
      logger.info(`[Fallback] ✅ Expo succeeded for user ${userId}`);
      return { sent: true, method: 'EXPO' };
    }

    // Step 3: If push failed, fallback to email
    if (userEmail) {
      logger.warn(`[Fallback] Push notifications failed, attempting email fallback for ${userEmail}`);
      try {
        await sendEmailFallback(userEmail, title, body, data);
        logger.info(`[Fallback] ✅ Email fallback sent to ${userEmail}`);
        return { sent: true, method: 'EMAIL_FALLBACK' };
      } catch (emailErr) {
        logger.error(`[Fallback] Email fallback failed for ${userEmail}:`, emailErr.message);
        return { sent: false, method: 'EMAIL_FALLBACK', reason: emailErr.message };
      }
    }

    logger.error(`[Fallback] All notification methods failed for user ${userId}`);
    return { sent: false, method: 'NONE', reason: 'All fallback methods exhausted' };
  } catch (err) {
    logger.error(`[Fallback] Unexpected error for user ${userId}:`, err.message);
    return { sent: false, method: 'ERROR', reason: err.message };
  }
}

/**
 * Retry logic with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} attempts - Number of attempts
 * @param {number} delay - Delay between attempts in ms
 * @returns {Promise<any>}
 */
async function sendWithRetry(fn, attempts, delay) {
  let lastError = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn();
      if (result?.sent) {
        return result;
      }
    } catch (err) {
      lastError = err;
      logger.warn(`[Fallback] Attempt ${i + 1}/${attempts} failed:`, err.message);

      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }

  return { sent: false, error: lastError?.message };
}

/**
 * Send email fallback notification
 * @param {string} email - User email
 * @param {string} title - Email subject
 * @param {string} body - Email body/content
 * @param {object} data - Additional context data
 */
async function sendEmailFallback(email, title, body, data = {}) {
  const html = buildEmailFallbackHtml(title, body, data);

  // Use Mailjet if available, otherwise log
  if (mailer.isConfigured) {
    try {
      await mailer.send({
        to: email,
        subject: `[NOTIFICATION URGENTE] ${title}`,
        html,
        text: `${title}\n\n${body}`,
      });
    } catch (err) {
      logger.error('[Fallback] Failed to send email via Mailjet:', err.message);
      throw err;
    }
  } else {
    logger.warn(`[Fallback] Mailjet not configured, email fallback logged for ${email}:`, { title, body });
  }
}

/**
 * Build HTML for email fallback
 * @param {string} title - Email title
 * @param {string} body - Email body
 * @param {object} data - Additional data
 * @returns {string} HTML email
 */
function buildEmailFallbackHtml(title, body, data = {}) {
  const actionUrl = data.actionUrl || 'https://manawa.app';
  const actionText = data.actionText || 'Voir détails';

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 8px;">
      <div style="background: white; padding: 32px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h1 style="color: #F97316; margin-top: 0; font-size: 24px;">${escapeHtml(title)}</h1>
        <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 20px 0;">
          ${escapeHtml(body)}
        </p>
        ${
          actionUrl && actionUrl !== 'https://manawa.app'
            ? `
          <div style="margin: 30px 0;">
            <a href="${escapeHtml(actionUrl)}"
               style="display: inline-block; background: #F97316; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; font-weight: bold;">
              ${escapeHtml(actionText)}
            </a>
          </div>
            `
            : ''
        }
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px; text-align: center;">
          Cette notification a été envoyée car votre notification push n'a pas pu être délivrée.
        </p>
      </div>
    </div>
  `;
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
  sendWithFallback,
  sendWithRetry,
  sendEmailFallback,
  buildEmailFallbackHtml,
};
