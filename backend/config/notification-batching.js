const logger = require('../utils/logger');
const pushNotifications = require('./pushNotifications');

/**
 * Notification Batching Configuration
 *
 * Instead of sending notifications sequentially, batch them in groups
 * and use Promise.all() for parallelization.
 *
 * Benefits:
 * - Faster delivery (parallel instead of sequential)
 * - Reduced latency
 * - Better resource utilization
 * - Built-in rate limiting
 */

const BATCH_CONFIG = {
  BATCH_SIZE: 100, // Process 100 notifications at a time
  MAX_CONCURRENT_BATCHES: 5, // Process up to 5 batches in parallel
  RETRY_FAILED: true,
  FAILED_BATCH_RETRY_DELAY: 5000, // 5 seconds before retrying failed batch
};

/**
 * Send notifications in batches with Promise.all()
 * @param {Array<{userId: string, title: string, body: string, data?: object}>} notifications - Array of notifications
 * @returns {Promise<{sent: number, failed: number, total: number, details: Array}>}
 */
async function sendNotificationsBatch(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    logger.warn('[Batch] No notifications to send');
    return { sent: 0, failed: 0, total: 0, details: [] };
  }

  logger.info(`[Batch] Starting batch send for ${notifications.length} notifications`);

  try {
    const batches = createBatches(notifications, BATCH_CONFIG.BATCH_SIZE);
    logger.info(`[Batch] Created ${batches.length} batches (size: ${BATCH_CONFIG.BATCH_SIZE})`);

    const allResults = [];
    let batchIndex = 0;

    // Process batches in parallel (limited by MAX_CONCURRENT_BATCHES)
    while (batchIndex < batches.length) {
      const concurrentBatches = batches.slice(
        batchIndex,
        Math.min(batchIndex + BATCH_CONFIG.MAX_CONCURRENT_BATCHES, batches.length)
      );

      logger.info(`[Batch] Processing ${concurrentBatches.length} concurrent batches (${batchIndex}/${batches.length})`);

      const batchPromises = concurrentBatches.map((batch, idx) =>
        processBatch(batch, batchIndex + idx + 1, batches.length)
      );

      const batchResults = await Promise.all(batchPromises);
      allResults.push(...batchResults);

      batchIndex += BATCH_CONFIG.MAX_CONCURRENT_BATCHES;
    }

    // Aggregate results
    const summary = aggregateResults(allResults);
    logger.info(
      `[Batch] ✅ Batch complete - Sent: ${summary.sent}, Failed: ${summary.failed}, Total: ${summary.total}`
    );

    return summary;
  } catch (err) {
    logger.error('[Batch] Error during batch sending:', err.message);
    return { sent: 0, failed: notifications.length, total: notifications.length, details: [], error: err.message };
  }
}

/**
 * Split notifications into smaller batches
 * @param {Array} notifications - Array of notifications
 * @param {number} batchSize - Size of each batch
 * @returns {Array<Array>} Array of batches
 */
function createBatches(notifications, batchSize) {
  const batches = [];
  for (let i = 0; i < notifications.length; i += batchSize) {
    batches.push(notifications.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Process a single batch with Promise.all()
 * @param {Array} batch - Batch of notifications
 * @param {number} batchNum - Current batch number
 * @param {number} totalBatches - Total number of batches
 * @returns {Promise<{sent: number, failed: number, total: number, details: Array}>}
 */
async function processBatch(batch, batchNum, totalBatches) {
  logger.info(`[Batch #${batchNum}/${totalBatches}] Processing ${batch.length} notifications`);

  const startTime = Date.now();

  try {
    // Create promises for all notifications in the batch
    const promises = batch.map(notif =>
      sendSingleNotification(notif)
        .catch(err => ({
          userId: notif.userId,
          success: false,
          error: err.message,
        }))
    );

    // Execute all promises in parallel
    const results = await Promise.all(promises);

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const duration = Date.now() - startTime;

    logger.info(
      `[Batch #${batchNum}/${totalBatches}] ✅ Complete - Sent: ${sent}/${batch.length} (${duration}ms)`
    );

    return {
      batchNum,
      sent,
      failed,
      total: batch.length,
      duration,
      details: results,
    };
  } catch (err) {
    logger.error(`[Batch #${batchNum}/${totalBatches}] Error:`, err.message);
    return {
      batchNum,
      sent: 0,
      failed: batch.length,
      total: batch.length,
      error: err.message,
      details: [],
    };
  }
}

/**
 * Send a single notification
 * @param {object} notif - Notification object
 * @returns {Promise<object>}
 */
async function sendSingleNotification(notif) {
  const { userId, title, body, data = {} } = notif;

  try {
    const result = await pushNotifications.sendPushNotification(userId, title, body, data);
    return {
      userId,
      success: result?.sent || false,
      ...result,
    };
  } catch (err) {
    logger.error(`[Batch] Error sending to user ${userId}:`, err.message);
    return {
      userId,
      success: false,
      error: err.message,
    };
  }
}

/**
 * Aggregate batch results
 * @param {Array} batchResults - Array of batch results
 * @returns {object} Aggregated summary
 */
function aggregateResults(batchResults) {
  const summary = {
    sent: 0,
    failed: 0,
    total: 0,
    details: [],
    batchCount: batchResults.length,
  };

  batchResults.forEach(batch => {
    summary.sent += batch.sent;
    summary.failed += batch.failed;
    summary.total += batch.total;
    summary.details.push({
      batchNum: batch.batchNum,
      sent: batch.sent,
      failed: batch.failed,
      duration: batch.duration,
    });
  });

  return summary;
}

/**
 * Send to multiple users with batching
 * Optimized version of sendPushToMultiple with batching
 * @param {Array<string>} userIds - Array of user IDs
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data
 * @returns {Promise<object>}
 */
async function sendToMultipleWithBatching(userIds, title, body, data = {}) {
  const notifications = userIds.map(userId => ({
    userId,
    title,
    body,
    data,
  }));

  return sendNotificationsBatch(notifications);
}

module.exports = {
  sendNotificationsBatch,
  sendToMultipleWithBatching,
  createBatches,
  processBatch,
  sendSingleNotification,
  aggregateResults,
  BATCH_CONFIG,
};
