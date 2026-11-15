const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { prisma } = require('../config/db');
const rollbackManager = require('../utils/rollback-manager');
const ConfigVersionsModule = require('../modules/ConfigVersionsModule');

const router = express.Router();
const cvModule = new ConfigVersionsModule(prisma, rollbackManager);

const requireAdmin = (req, res, next) => { req.user && req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'ADMIN role required' }); };

router.get('/', requireAdmin, [body('limit').optional().isInt({ min: 1, max: 100 }).toInt(), body('offset').optional().isInt({ min: 0 }).toInt()], async (req, res) => {
  try { const limit = req.query.limit ? parseInt(req.query.limit) : 20; const offset = req.query.offset ? parseInt(req.query.offset) : 0; const r = await cvModule.listVersions({ limit, offset }); res.json({ data: r.versions, pagination: { limit, offset, total: r.total }, timestamp: new Date().toISOString() }); } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:version', requireAdmin, [param('version').isString().trim()], async (req, res) => {
  try { const cv = await cvModule.getVersion(req.params.version); res.json({ data: cv, timestamp: new Date().toISOString() }); } catch (err) { err.message.includes('not found') ? res.status(404).json({ error: err.message }) : res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/', requireAdmin, [body('version').matches(/^\d+\.\d+\.\d+$/), body('changelog').isString().trim().isLength({ min: 10, max: 1000 })], async (req, res) => {
  try { const e = validationResult(req); if (!e.isEmpty()) return res.status(400).json({ errors: e.array() }); const cv = await cvModule.createVersion(req.body, req.user.id); res.status(201).json({ data: cv, message: `Version ${req.body.version} created`, timestamp: new Date().toISOString() }); } catch (err) { err.message.includes('exists') ? res.status(409).json({ error: err.message }) : res.status(500).json({ error: 'Failed to save' }); }
});

router.post('/:version/restore', requireAdmin, [param('version').isString().trim(), body('reason').isString().trim().isLength({ min: 5, max: 500 })], async (req, res) => {
  try { const e = validationResult(req); if (!e.isEmpty()) return res.status(400).json({ errors: e.array() }); const result = await cvModule.restoreVersion(req.params.version, req.user.id, req.body.reason); res.json({ data: result, message: `Version ${req.params.version} restored`, timestamp: new Date().toISOString() }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:version/mark-stable', requireAdmin, [param('version').isString().trim()], async (req, res) => {
  try { const e = validationResult(req); if (!e.isEmpty()) return res.status(400).json({ errors: e.array() }); const result = await cvModule.markStable(req.params.version); res.json({ data: result, message: `Version ${req.params.version} marked stable`, timestamp: new Date().toISOString() }); } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
