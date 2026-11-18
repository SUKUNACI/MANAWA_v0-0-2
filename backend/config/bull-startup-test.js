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

/**
 * Test Bull job processing: create a temporary diagnostic queue,
 * add a no-op job, and verify it completes end-to-end
 */
async function testBullJobProcessing() {
  try {
    const Queue = require('bull');

    // Parse REDIS_URL to build config (same as queue.js)
    const redisUrl = (process.env.REDIS_URL || '').trim();
    if (!redisUrl) {
      logger.warn('[Bull Job Test] REDIS_URL not set, skipping job processing test');
      return;
    }

    const urlObj = new URL(redisUrl);
    const isTls = urlObj.protocol === 'rediss:';
    const host = urlObj.hostname;
    const port = urlObj.port || (isTls ? 6380 : 6379);
    const password = urlObj.password || undefined;

    const redisConfig = {
      host,
      port: parseInt(port, 10),
      password,
      ...(isTls && { tls: {} }),
      maxRetriesPerRequest: null,
    };

    // Create temporary diagnostic queue (unique name)
    const diagQueue = new Queue(`diagnostic-${Date.now()}`, { redis: redisConfig });

    logger.info('[Bull Job Test] Created temporary diagnostic queue');

    // Register a simple no-op worker
    await diagQueue.process(async (job) => {
      logger.info('[Bull Job Test] Worker processing job', { jobId: job.id });
      return { result: 'diagnostic job completed', jobId: job.id, timestamp: new Date().toISOString() };
    });

    logger.info('[Bull Job Test] Registered diagnostic worker');

    // Add a job
    const job = await diagQueue.add(
      { type: 'diagnostic', timestamp: new Date().toISOString() },
      { attempts: 1, removeOnComplete: true, removeOnFail: false }
    );

    logger.info('[Bull Job Test] Diagnostic job added', { jobId: job.id });

    // Wait for completion or timeout (5s)
    let completed = false;
    let jobError = null;

    const completeHandler = (result) => {
      completed = true;
      logger.info('[Bull Job Test] Job completed ✅', { jobId: job.id, result });
    };

    const failHandler = (err) => {
      jobError = err.message;
      logger.error('[Bull Job Test] Job failed ❌', { jobId: job.id, error: err.message });
    };

    job.on('completed', completeHandler);
    job.on('failed', failHandler);

    await new Promise((resolve) => {
      setTimeout(() => {
        job.removeListener('completed', completeHandler);
        job.removeListener('failed', failHandler);
        resolve();
      }, 5000);
    });

    if (completed) {
      logger.info('[Bull Job Test] Job processing verified: PENDING → COMPLETED ✅');
    } else if (jobError) {
      logger.error('[Bull Job Test] Job processing failed', { error: jobError });
    } else {
      logger.warn('[Bull Job Test] Job did not complete within 5s timeout (worker may not have picked it up)');
    }

    // Cleanup: close temporary queue and remove from Redis
    await diagQueue.close();
    await diagQueue.clean(0, 0, 'completed');
    await diagQueue.clean(0, 0, 'failed');
    logger.info('[Bull Job Test] Cleaned up temporary diagnostic queue');

  } catch (err) {
    logger.error('[Bull Job Test] Failed to run job processing test', {
      error: err.message,
      stack: err.stack,
    });
  }
}

module.exports = { testBullQueues, testBullJobProcessing };
