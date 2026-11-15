const express = require('express');
const rateLimit = require('express-rate-limit');
const { checkDatabaseHealth } = require('../utils/health-check');
const redis = require('../config/redis');
const HealthModule = require('../modules/HealthModule');

const router = express.Router();
const healthModule = new HealthModule({ checkDatabaseHealth }, redis);
const healthLimiter = rateLimit({ windowMs: 60000, max: 200, standardHeaders: true, legacyHeaders: false });

router.get('/health', healthLimiter, async (req, res) => {
  try { const h = await healthModule.checkSystemHealth(); res.status(healthModule.getStatusCode(h)).json(h); } catch (err) { res.status(503).json({ status: 'unhealthy', error: 'Health check failed', timestamp: new Date().toISOString() }); }
});

module.exports = router;
