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
    // CRITICAL: queue.process() returns a Promise that never settles (it listens indefinitely)
    // Don't await it — launch in background and capture errors asynchronously
    const workerPromise = diagQueue.process(async (job) => {
      logger.info('[Bull Job Test] Worker processing job', { jobId: job.id });
      return { result: 'diagnostic job completed', jobId: job.id, timestamp: new Date().toISOString() };
    });

    // Attach error handler but don't block on the worker promise
    workerPromise.catch(err => {
      logger.error('[Bull Job Test] Worker promise rejected:', { error: err.message });
    });

    logger.info('[Bull Job Test] Registered diagnostic worker (background)');

    // Add a job (keep it for verification — don't auto-remove)
    const jobData = await diagQueue.add(
      { type: 'diagnostic', timestamp: new Date().toISOString() },
      { attempts: 1, removeOnComplete: false, removeOnFail: false }
    );

    const jobId = jobData.id;
    logger.info('[Bull Job Test] Diagnostic job added', { jobId, initialState: jobData._state });

    // Wait for completion or timeout (5s)
    let completed = false;
    let jobError = null;
    let completionResult = null;

    // Wait using job.finished() API (proper Bull v4 method)
    const startWait = Date.now();
    let finalJobState = null;

    try {
      // Use job.finished() which resolves when job completes or fails
      const result = await Promise.race([
        jobData.finished(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Job wait timeout')), 10000)
        )
      ]);

      completed = true;
      completionResult = result;
      finalJobState = 'completed';
      logger.info('[Bull Job Test] Job completed ✅', {
        jobId,
        result: completionResult,
        totalElapsed: Date.now() - startWait
      });
    } catch (err) {
      // Job didn't complete or failed
      if (err.message === 'Job wait timeout') {
        logger.warn('[Bull Job Test] Job wait timeout (10s)', { jobId });
      } else {
        jobError = err.message;
        logger.error('[Bull Job Test] Job failed ❌', { jobId, error: jobError });
      }

      // Check final state via getState()
      try {
        finalJobState = await jobData.getState();
        logger.info('[Bull Job Test] Final job state via getState()', {
          jobId,
          state: finalJobState,
          totalElapsed: Date.now() - startWait
        });
      } catch (stateErr) {
        logger.warn('[Bull Job Test] Could not get final state:', { error: stateErr.message });
      }
    }

    // Cleanup: explicitly remove the job, then close queue
    try {
      // Remove the job explicitly before closing
      await jobData.remove();
      logger.info('[Bull Job Test] Job removed from queue', { jobId });

      // Close the queue
      await diagQueue.close();
      logger.info('[Bull Job Test] Queue closed and cleaned');
    } catch (err) {
      logger.warn('[Bull Job Test] Error during cleanup:', { error: err.message });
    }

  } catch (err) {
    logger.error('[Bull Job Test] Failed to run job processing test', {
      error: err.message,
      stack: err.stack,
    });
  }
}

module.exports = { testBullQueues, testBullJobProcessing };
