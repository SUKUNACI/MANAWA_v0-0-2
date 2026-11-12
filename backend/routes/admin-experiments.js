/**
 * Admin A/B Testing Routes
 * CRUD endpoints for managing experiments and variants
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { calculateExperimentStats, testSignificance } = require('../utils/experiment-engine');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(['ADMIN']));

/**
 * GET /admin/experiments
 * List all experiments
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const [experiments, total] = await Promise.all([
      prisma.experiment.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          variants: { select: { id: true, name: true, weight: true } },
          _count: { select: { assignments: true } },
        },
      }),
      prisma.experiment.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        experiments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    logger.error('[Experiments] Failed to list', { error: err.message });
    res.status(500).json({ error: 'Failed to list experiments' });
  }
});

/**
 * GET /admin/experiments/:id
 * Get single experiment with variants and stats
 */
router.get('/:id', async (req, res) => {
  try {
    const experiment = await prisma.experiment.findUnique({
      where: { id: req.params.id },
      include: {
        variants: true,
        _count: { select: { assignments: true } },
      },
    });

    if (!experiment) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    const stats = await calculateExperimentStats(prisma, experiment.id);

    res.json({
      success: true,
      data: { experiment, stats },
    });
  } catch (err) {
    logger.error('[Experiments] Failed to get', { error: err.message });
    res.status(500).json({ error: 'Failed to get experiment' });
  }
});

/**
 * POST /admin/experiments
 * Create new experiment with variants
 */
router.post(
  '/',
  [
    body('name').isString().trim().notEmpty().withMessage('Name is required'),
    body('description').optional().isString().trim(),
    body('trafficPercentage').isInt({ min: 1, max: 100 }).withMessage('Traffic must be 1-100'),
    body('variants').isArray({ min: 2 }).withMessage('At least 2 variants required'),
    body('variants.*.name').isString().trim().notEmpty(),
    body('variants.*.weight').isInt({ min: 1 }).withMessage('Weight must be positive'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description, trafficPercentage, variants } = req.body;

      const existing = await prisma.experiment.findUnique({ where: { name } });
      if (existing) {
        return res.status(409).json({ error: 'Experiment name already exists' });
      }

      const experiment = await prisma.experiment.create({
        data: {
          name,
          description: description || null,
          trafficPercentage,
          status: 'DRAFT',
          variants: {
            create: variants.map(v => ({
              name: v.name,
              weight: v.weight,
            })),
          },
        },
        include: { variants: true },
      });

      logger.info('[Experiments] Created', { adminId: req.user.id, name });

      res.status(201).json({
        success: true,
        data: { experiment },
      });
    } catch (err) {
      logger.error('[Experiments] Failed to create', { error: err.message });
      res.status(500).json({ error: 'Failed to create experiment' });
    }
  }
);

/**
 * PATCH /admin/experiments/:id/status
 * Start, pause, or stop experiment
 */
router.patch(
  '/:id/status',
  [
    body('status')
      .isIn(['ACTIVE', 'PAUSED', 'COMPLETED'])
      .withMessage('Status must be ACTIVE, PAUSED, or COMPLETED'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { status } = req.body;

      const experiment = await prisma.experiment.findUnique({ where: { id } });
      if (!experiment) {
        return res.status(404).json({ error: 'Experiment not found' });
      }

      const updateData = { status };
      if (status === 'ACTIVE' && !experiment.startedAt) {
        updateData.startedAt = new Date();
      }
      if (status === 'COMPLETED') {
        updateData.endedAt = new Date();
      }

      const updated = await prisma.experiment.update({
        where: { id },
        data: updateData,
        include: { variants: true },
      });

      logger.info('[Experiments] Status updated', { adminId: req.user.id, id, status });

      res.json({
        success: true,
        data: { experiment: updated },
      });
    } catch (err) {
      logger.error('[Experiments] Failed to update status', { error: err.message });
      res.status(500).json({ error: 'Failed to update experiment status' });
    }
  }
);

/**
 * GET /admin/experiments/:id/results
 * Get experiment results with significance test
 */
router.get('/:id/results', async (req, res) => {
  try {
    const { id } = req.params;
    const { variant1, variant2 } = req.query;

    const experiment = await prisma.experiment.findUnique({
      where: { id },
      include: {
        variants: { select: { id: true, name: true, weight: true } },
        _count: { select: { assignments: true } },
      },
    });

    if (!experiment) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    const stats = await calculateExperimentStats(prisma, id);

    let significance = null;
    if (variant1 && variant2) {
      significance = await testSignificance(prisma, id, variant1, variant2);
    }

    res.json({
      success: true,
      data: {
        experiment,
        stats,
        significance,
        totalAssignments: experiment._count.assignments,
      },
    });
  } catch (err) {
    logger.error('[Experiments] Failed to get results', { error: err.message });
    res.status(500).json({ error: 'Failed to get experiment results' });
  }
});

/**
 * DELETE /admin/experiments/:id
 * Delete experiment (only if DRAFT or COMPLETED)
 */
router.delete('/:id', async (req, res) => {
  try {
    const experiment = await prisma.experiment.findUnique({ where: { id: req.params.id } });

    if (!experiment) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    if (experiment.status === 'ACTIVE') {
      return res.status(400).json({
        error: 'Cannot delete an active experiment. Pause or complete it first.',
      });
    }

    await prisma.experiment.delete({ where: { id: req.params.id } });

    logger.info('[Experiments] Deleted', { adminId: req.user.id, id: req.params.id });

    res.json({ success: true, message: 'Experiment deleted' });
  } catch (err) {
    logger.error('[Experiments] Failed to delete', { error: err.message });
    res.status(500).json({ error: 'Failed to delete experiment' });
  }
});

module.exports = router;
