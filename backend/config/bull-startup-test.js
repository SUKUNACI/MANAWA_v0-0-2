/**
 * Test: Verify Bull queues are connected to Redis at startup
 * Logs connection status for each queue to prove real-world connectivity
 */

const logger = require('../utils/logger');

async function testBullQueues() {
  try {
    const {
      emailQueue,
      pdfQueue,
      analyticsQueue,
      paymentQueue,
      badgesQueue,
    } = require('./queue');

    const queues = [
      { name: 'emails', queue: emailQueue },
      { name: 'pdfs', queue: pdfQueue },
      { name: 'analytics', queue: analyticsQueue },
      { name: 'payments', queue: paymentQueue },
      { name: 'badges', queue: badgesQueue },
    ];

    logger.info('[Bull Startup Test] Testing queue connections...');

    const results = [];
    for (const { name, queue } of queues) {
      try {
        // Test PING via queue's internal client
        if (queue.client && typeof queue.client.ping === 'function') {
          const pingResult = await Promise.race([
            queue.client.ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('PING timeout')), 3000)),
          ]);
          results.push({
            queue: name,
            status: 'connected',
            ping: pingResult,
            timestamp: new Date().toISOString(),
          });
          logger.info(`[Bull] Queue "${name}" connected ✅ PING=${pingResult}`);
        } else {
          logger.warn(`[Bull] Queue "${name}" client.ping not available`);
          results.push({
            queue: name,
            status: 'unknown',
            reason: 'ping method unavailable',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        logger.error(`[Bull] Queue "${name}" test failed ❌`, {
          error: err.message,
          code: err.code,
        });
        results.push({
          queue: name,
          status: 'error',
          error: err.message,
          code: err.code,
          timestamp: new Date().toISOString(),
        });
      }
    }

    logger.info('[Bull Startup Test] Results:', { results });
    return results;
  } catch (err) {
    logger.error('[Bull Startup Test] Failed to load or test queues', {
      error: err.message,
      stack: err.stack,
    });
    return [];
  }
}

module.exports = { testBullQueues };
