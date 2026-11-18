/**
 * GET /api/bull-status - Internal diagnostic endpoint
 * Tests Bull queue connection to Redis and reports status
 */

const express = require('express');
const router = express.Router();
const Queue = require('bull');

router.get('/bull-status', async (req, res) => {
  // Only allow local access
  if (req.ip !== '127.0.0.1' && req.ip !== '::1' && !req.ip.startsWith('127.')) {
    return res.status(403).json({ error: 'Only local access allowed' });
  }

  const redisUrl = (process.env.REDIS_URL || '').trim();
  if (!redisUrl) {
    return res.json({
      status: 'unknown',
      reason: 'REDIS_URL not configured'
    });
  }

  try {
    const urlObj = new URL(redisUrl);
    const isTls = urlObj.protocol === 'rediss:';
    const host = urlObj.hostname;
    const port = urlObj.port || (isTls ? 6380 : 6379);

    // Create a temporary test queue
    const testQueue = new Queue('bull-status-test', {
      redis: {
        host,
        port: parseInt(port, 10),
        password: urlObj.password || undefined,
        ...(isTls && { tls: {} }),
        connectTimeout: 3000,
        maxRetriesPerRequest: null,
      },
    });

    let status = 'unknown';
    let error = null;

    await new Promise((resolve) => {
      testQueue.on('ready', () => {
        status = 'connected';
        resolve();
      });

      testQueue.on('error', (err) => {
        error = err.message;
        status = 'error';
        resolve();
      });

      setTimeout(() => {
        status = 'timeout';
        resolve();
      }, 4000);
    });

    // Clean up
    await testQueue.close();

    res.json({
      status,
      redis: {
        host,
        port,
        tls: isTls,
      },
      error,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: err.message,
    });
  }
});

module.exports = router;
