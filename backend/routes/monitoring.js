const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { checkDatabaseHealth } = require('../utils/health-check');
const monitoring = require('../utils/monitoring');
const prisma = require('../config/db');
const MonitoringModule = require('../modules/MonitoringModule');

const router = express.Router();
const monModule = new MonitoringModule({ checkDatabaseHealth }, monitoring, prisma);

const metricsLimiter = rateLimit({ windowMs: 60000, max: 100 });
const dashboardLimiter = rateLimit({ windowMs: 60000, max: 60 });

const verifyAdmin = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.adminToken;
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') return res.status(403).json({ error: 'Insufficient permissions' });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.get('/health', rateLimit({ windowMs: 60000, max: 200 }), async (req, res) => {
  try { const h = await monModule.getHealth(); res.status(h.status === 'healthy' ? 200 : 503).json(h); } catch (error) { res.status(503).json({ status: 'unhealthy', error: 'Health check failed', timestamp: new Date().toISOString() }); }
});

router.get('/metrics', metricsLimiter, (req, res) => {
  try { res.set('Content-Type', 'text/plain; charset=utf-8'); res.send(monitoring.getPrometheusMetrics()); } catch (error) { res.status(500).json({ error: 'Failed to generate metrics' }); }
});

router.get('/admin/monitoring', verifyAdmin, dashboardLimiter, async (req, res) => {
  try { const d = await monModule.getDashboard(); res.json(d); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/alerts', verifyAdmin, async (req, res) => {
  try { const a = monModule.getAlerts(); res.json(a); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/alerts/config', verifyAdmin, [body('errorRate').optional().isFloat({ min: 0 }), body('apiResponseTime').optional().isInt({ min: 0 }), body('cpuUsage').optional().isFloat({ min: 0, max: 100 }), body('memoryUsage').optional().isFloat({ min: 0, max: 100 }), body('databaseLatency').optional().isInt({ min: 0 })], async (req, res) => {
  try { const e = validationResult(req); if (!e.isEmpty()) return res.status(400).json({ errors: e.array() }); const r = await monModule.updateAlertThresholds(req.body); res.json(r); } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/admin/alerts/config', verifyAdmin, async (req, res) => {
  try { const r = monModule.getAlertThresholds(); res.json(r); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/performance/top-routes', verifyAdmin, async (req, res) => {
  try { const r = await monModule.getPerformanceMetrics(); res.json(r); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/performance/database', verifyAdmin, async (req, res) => {
  try { const r = await monModule.getDatabasePerformance(); res.json(r); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/business/metrics', verifyAdmin, async (req, res) => {
  try { const r = monModule.getBusinessMetrics(); res.json(r); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/monitoring/reset', verifyAdmin, async (req, res) => {
  try { const r = monModule.resetMetrics(); res.json(r); } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
