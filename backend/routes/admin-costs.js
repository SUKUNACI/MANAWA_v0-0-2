const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const AdminCostsModule = require('../modules/AdminCostsModule');

const router = express.Router();
const module_ = new AdminCostsModule(prisma);

router.use(requireAuth);
router.use(requireRole(['ADMIN']));

router.get('/', [query('month').optional().matches(/^\d{4}-\d{2}$/), query('service').optional().isIn(AdminCostsModule.getValidServices())], async (req, res) => {
  try { const e = validationResult(req); if (!e.isEmpty()) return res.status(400).json({ errors: e.array() }); const r = await module_.listCosts(req.query); res.json({ success: true, data: r }); } catch (err) { res.status(500).json({ error: 'Failed to list costs' }); }
});

router.post('/', [body('service').isIn(AdminCostsModule.getValidServices()), body('month').matches(/^\d{4}-\d{2}$/), body('amountEur').isFloat({ min: 0 }), body('budgetEur').optional().isFloat({ min: 0 }), body('unit').optional().isString().trim(), body('quantity').optional().isFloat({ min: 0 }), body('notes').optional().isString().trim()], async (req, res) => {
  try { const e = validationResult(req); if (!e.isEmpty()) return res.status(400).json({ errors: e.array() }); const c = await module_.recordCost(req.body); res.status(201).json({ success: true, data: { cost: c } }); } catch (err) { res.status(500).json({ error: 'Failed to record cost' }); }
});

router.get('/report', [query('year').optional().isInt({ min: 2024, max: 2030 })], async (req, res) => {
  try { const r = await module_.generateReport(req.query.year); res.json({ success: true, data: r }); } catch (err) { res.status(500).json({ error: 'Failed to generate cost report' }); }
});

router.delete('/:id', async (req, res) => {
  try { await module_.deleteCost(req.params.id); res.json({ success: true, message: 'Cost entry deleted' }); } catch (err) { err.message.includes('not found') ? res.status(404).json({ error: 'Cost entry not found' }) : res.status(500).json({ error: 'Failed to delete cost entry' }); }
});

module.exports = router;
