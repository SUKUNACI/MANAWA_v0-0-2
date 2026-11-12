/**
 * Q87: Cost Tracking Routes
 * Track infrastructure costs per service per month
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN']));

const VALID_SERVICES = ['render', 'supabase', 'redis', 'cloudinary', 'mailjet', 'twilio', 'meilisearch', 'other'];

/**
 * GET /admin/costs
 * List infra costs with optional month/service filters
 */
router.get('/', [
  query('month').optional().matches(/^\d{4}-\d{2}$/),
  query('service').optional().isIn(VALID_SERVICES),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { month, service } = req.query;
    const where = {};
    if (month) where.month = month;
    if (service) where.service = service;

    const costs = await prisma.infraCost.findMany({
      where,
      orderBy: [{ month: 'desc' }, { service: 'asc' }],
    });

    // Aggregate by month with MoM trend
    const byMonth = {};
    costs.forEach(c => {
      if (!byMonth[c.month]) byMonth[c.month] = { month: c.month, total: 0, budget: 0, services: [] };
      byMonth[c.month].total  += c.amountEur;
      byMonth[c.month].budget += c.budgetEur || 0;
      byMonth[c.month].services.push({ service: c.service, amount: c.amountEur, budget: c.budgetEur });
    });

    const months = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
    const trend = months.map((m, i) => ({
      ...m,
      momChange: i === 0 || months[i - 1].total === 0
        ? null
        : parseFloat((((m.total - months[i - 1].total) / months[i - 1].total) * 100).toFixed(2)),
    }));

    res.json({ success: true, data: { costs, summary: trend } });
  } catch (err) {
    logger.error('[Costs] Failed to list', { error: err.message });
    res.status(500).json({ error: 'Failed to list costs' });
  }
});

/**
 * POST /admin/costs
 * Record or update a cost entry for a service/month (upsert)
 */
router.post('/', [
  body('service').isIn(VALID_SERVICES),
  body('month').matches(/^\d{4}-\d{2}$/).withMessage('Format YYYY-MM required'),
  body('amountEur').isFloat({ min: 0 }),
  body('budgetEur').optional().isFloat({ min: 0 }),
  body('unit').optional().isString().trim(),
  body('quantity').optional().isFloat({ min: 0 }),
  body('notes').optional().isString().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { service, month, amountEur, budgetEur, unit, quantity, notes } = req.body;

    const cost = await prisma.infraCost.upsert({
      where: { service_month: { service, month } },
      create: {
        service, month, amountEur,
        budgetEur: budgetEur || null,
        unit: unit || null,
        quantity: quantity || null,
        notes: notes || null,
      },
      update: {
        amountEur,
        budgetEur: budgetEur || null,
        unit: unit || null,
        quantity: quantity || null,
        notes: notes || null,
      },
    });

    logger.info('[Costs] Recorded', { adminId: req.user.id, service, month, amountEur });
    res.status(201).json({ success: true, data: { cost } });
  } catch (err) {
    logger.error('[Costs] Failed to record', { error: err.message });
    res.status(500).json({ error: 'Failed to record cost' });
  }
});

/**
 * GET /admin/costs/report
 * Annual cost report: YTD total, per-service breakdown, budget vs actual, unit costs
 */
router.get('/report', [
  query('year').optional().isInt({ min: 2024, max: 2030 }),
], async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const costs = await prisma.infraCost.findMany({
      where: { month: { startsWith: `${year}-` } },
      orderBy: [{ month: 'asc' }, { service: 'asc' }],
    });

    const byService = {};
    costs.forEach(c => {
      if (!byService[c.service]) byService[c.service] = { service: c.service, total: 0, budget: 0, months: [] };
      byService[c.service].total  += c.amountEur;
      byService[c.service].budget += c.budgetEur || 0;
      byService[c.service].months.push({ month: c.month, amount: c.amountEur });
    });

    const ytdTotal  = costs.reduce((s, c) => s + c.amountEur, 0);
    const ytdBudget = costs.reduce((s, c) => s + (c.budgetEur || 0), 0);

    const unitCosts = costs
      .filter(c => c.quantity && c.quantity > 0)
      .map(c => ({
        service: c.service,
        month:   c.month,
        unit:    c.unit,
        quantity: c.quantity,
        costPerUnit: parseFloat((c.amountEur / c.quantity).toFixed(6)),
      }));

    res.json({
      success: true,
      data: {
        year,
        ytd: {
          total:      parseFloat(ytdTotal.toFixed(2)),
          budget:     parseFloat(ytdBudget.toFixed(2)),
          variance:   parseFloat((ytdTotal - ytdBudget).toFixed(2)),
          overBudget: ytdTotal > ytdBudget,
        },
        byService: Object.values(byService),
        unitCosts,
      },
    });
  } catch (err) {
    logger.error('[Costs] Report failed', { error: err.message });
    res.status(500).json({ error: 'Failed to generate cost report' });
  }
});

/**
 * DELETE /admin/costs/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const cost = await prisma.infraCost.findUnique({ where: { id: req.params.id } });
    if (!cost) return res.status(404).json({ error: 'Cost entry not found' });

    await prisma.infraCost.delete({ where: { id: req.params.id } });
    logger.info('[Costs] Deleted', { adminId: req.user.id, id: req.params.id });
    res.json({ success: true, message: 'Cost entry deleted' });
  } catch (err) {
    logger.error('[Costs] Delete failed', { error: err.message });
    res.status(500).json({ error: 'Failed to delete cost entry' });
  }
});

module.exports = router;
