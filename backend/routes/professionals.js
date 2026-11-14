/**
 * Professional Routes
 * HTTP layer only — business logic delegated to ProfessionalModule.
 */

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const ProfessionalModule = require('../modules/professional');

const router = express.Router();
const profModule = new ProfessionalModule(prisma);

// GET /api/professionals — liste publique
router.get('/', async (req, res, next) => {
  try {
    const { city, trade, page, limit } = req.query;
    const professionals = await profModule.list({ city, trade, page, limit });
    res.json(professionals);
  } catch (err) {
    next(err);
  }
});

// GET /api/professionals/me/status — statut identité (PROFESSIONAL uniquement)
router.get('/me/status', requireAuth, requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    const pro = await profModule.getMyStatus(req.user.id);
    res.json(pro);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// GET /api/professionals/:id — profil public d'un pro
router.get('/:id', async (req, res, next) => {
  try {
    const pro = await profModule.getById(req.params.id);
    res.json(pro);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// POST /api/professionals/:id/follow — toggle follow (auth requis)
router.post('/:id/follow', requireAuth, async (req, res, next) => {
  try {
    const result = await profModule.toggleFollow(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
