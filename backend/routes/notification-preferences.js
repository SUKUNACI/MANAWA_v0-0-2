const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const NotificationPreferencesModule = require('../modules/notification-preferences');
const prisma = require('../config/db');

const router = express.Router();
const preferencesModule = new NotificationPreferencesModule(prisma);

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /me
router.get('/me', readLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const preferences = await preferencesModule.getOrCreate(req.user.id);
    res.json({ preferences: preferences.preferences, updatedAt: preferences.updatedAt });
  } catch (err) {
    next(err);
  }
});

// PATCH /me
router.patch('/me', writeLimiter, requireAuth,
  [body('preferences').optional().isObject().withMessage('Preferences must be object')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { preferences: newPrefs } = req.body;

      const updated = await preferencesModule.update(req.user.id, newPrefs);
      res.json({ preferences: updated.preferences, updatedAt: updated.updatedAt, message: 'Notification preferences updated' });
    } catch (err) {
      if (err.message.includes('At least one') || err.message.includes('Invalid') || err.message.includes('must be')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  }
);

// PATCH /me/:type
router.patch('/me/:type', writeLimiter, requireAuth,
  [
    body('enabled').optional().isBoolean().withMessage('Enabled must be boolean'),
    body('channels').optional().isArray().withMessage('Channels must be array'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { type } = req.params;
      const { enabled, channels } = req.body;

      const updated = await preferencesModule.updateType(req.user.id, type, { enabled, channels });
      res.json({ preferences: updated.preferences, updatedAt: updated.updatedAt, message: `Preferences for ${type} updated` });
    } catch (err) {
      if (err.message.includes('Invalid')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  }
);

// POST /reset
router.post('/reset', writeLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const preferences = await preferencesModule.reset(req.user.id);
    res.json({ preferences: preferences.preferences, message: 'Notification preferences reset to defaults' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.isNotificationEnabled = (userId, type, channel = 'push') => preferencesModule.isEnabled(userId, type, channel);
module.exports.getDefaultPreferences = () => preferencesModule.getDefaults();
