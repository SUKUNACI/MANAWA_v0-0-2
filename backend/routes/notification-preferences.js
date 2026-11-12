const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validateInput');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const { applyPageBasedPagination, validatePageBasedPaginationQuery, buildPaginatedResponse } = require('../utils/pagination-helper');

const router = express.Router();

// Rate limiters
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

/**
 * GET /api/users/notification-preferences
 * Get notification preferences for current user
 */
router.get('/me', readLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    let preferences = await prisma.notificationPreference.findUnique({
      where: { userId: req.user.id },
    });

    // Create default preferences if none exist
    if (!preferences) {
      preferences = await prisma.notificationPreference.create({
        data: {
          userId: req.user.id,
          preferences: {
            // Default: all notifications enabled on all channels
            ORDER_CONFIRMED: { email: true, push: true, sms: false },
            ORDER_SHIPPED: { email: true, push: true, sms: false },
            ORDER_DELIVERED: { email: true, push: true, sms: false },
            ORDER_CANCELLED: { email: true, push: true, sms: false },
            PAYMENT_RECEIVED: { email: true, push: true, sms: false },
            PAYMENT_FAILED: { email: true, push: true, sms: true },
            MESSAGE_RECEIVED: { email: true, push: true, sms: false },
            REVIEW_RECEIVED: { email: true, push: true, sms: false },
            BOOKING_CONFIRMED: { email: true, push: true, sms: false },
            BOOKING_CANCELLED: { email: true, push: true, sms: false },
            DISPUTE_CREATED: { email: true, push: true, sms: true },
            DISPUTE_RESOLVED: { email: true, push: true, sms: false },
            PROMOTIONAL: { email: true, push: false, sms: false },
            SYSTEM_ALERT: { email: true, push: true, sms: true },
          },
        },
      });

      logger.info(`[Preferences] Created default preferences for user ${req.user.id}`);
    }

    res.json({
      preferences: preferences.preferences,
      updatedAt: preferences.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/users/notification-preferences/me
 * Update notification preferences for current user
 */
router.patch(
  '/me',
  writeLimiter,
  requireAuth,
  [
    body('preferences').optional().isObject().withMessage('Preferences must be object'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { preferences: newPrefs } = req.body;

      if (!newPrefs || Object.keys(newPrefs).length === 0) {
        return res.status(400).json({ error: 'At least one preference to update required' });
      }

      // Validate preference structure
      const validNotificationTypes = [
        'ORDER_CONFIRMED',
        'ORDER_SHIPPED',
        'ORDER_DELIVERED',
        'ORDER_CANCELLED',
        'PAYMENT_RECEIVED',
        'PAYMENT_FAILED',
        'MESSAGE_RECEIVED',
        'REVIEW_RECEIVED',
        'BOOKING_CONFIRMED',
        'BOOKING_CANCELLED',
        'DISPUTE_CREATED',
        'DISPUTE_RESOLVED',
        'PROMOTIONAL',
        'SYSTEM_ALERT',
      ];

      const validChannels = ['email', 'push', 'sms'];

      for (const [type, channels] of Object.entries(newPrefs)) {
        if (!validNotificationTypes.includes(type)) {
          return res.status(400).json({ error: `Invalid notification type: ${type}` });
        }

        if (!channels || typeof channels !== 'object') {
          return res.status(400).json({ error: `${type} must be object with channels` });
        }

        for (const [channel, enabled] of Object.entries(channels)) {
          if (!validChannels.includes(channel)) {
            return res.status(400).json({ error: `Invalid channel: ${channel}` });
          }

          if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: `${type}.${channel} must be boolean` });
          }
        }
      }

      // Get current preferences
      let preferences = await prisma.notificationPreference.findUnique({
        where: { userId: req.user.id },
      });

      if (!preferences) {
        // Create with defaults merged with updates
        const defaultPrefs = getDefaultPreferences();
        const merged = {
          ...defaultPrefs,
          ...newPrefs,
        };

        preferences = await prisma.notificationPreference.create({
          data: {
            userId: req.user.id,
            preferences: merged,
          },
        });
      } else {
        // Merge with existing
        const merged = {
          ...preferences.preferences,
          ...newPrefs,
        };

        preferences = await prisma.notificationPreference.update({
          where: { userId: req.user.id },
          data: {
            preferences: merged,
            updatedAt: new Date(),
          },
        });
      }

      logger.info(`[Preferences] Updated preferences for user ${req.user.id}`);

      res.json({
        preferences: preferences.preferences,
        updatedAt: preferences.updatedAt,
        message: 'Notification preferences updated',
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/users/notification-preferences/me/:type
 * Toggle specific notification type
 */
router.patch(
  '/me/:type',
  writeLimiter,
  requireAuth,
  [
    body('enabled').optional().isBoolean().withMessage('Enabled must be boolean'),
    body('channels').optional().isArray().withMessage('Channels must be array'),
  ],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { type } = req.params;
      const { enabled, channels } = req.body;

      const validNotificationTypes = [
        'ORDER_CONFIRMED',
        'ORDER_SHIPPED',
        'ORDER_DELIVERED',
        'ORDER_CANCELLED',
        'PAYMENT_RECEIVED',
        'PAYMENT_FAILED',
        'MESSAGE_RECEIVED',
        'REVIEW_RECEIVED',
        'BOOKING_CONFIRMED',
        'BOOKING_CANCELLED',
        'DISPUTE_CREATED',
        'DISPUTE_RESOLVED',
        'PROMOTIONAL',
        'SYSTEM_ALERT',
      ];

      if (!validNotificationTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid notification type: ${type}` });
      }

      let preferences = await prisma.notificationPreference.findUnique({
        where: { userId: req.user.id },
      });

      if (!preferences) {
        preferences = await prisma.notificationPreference.create({
          data: {
            userId: req.user.id,
            preferences: getDefaultPreferences(),
          },
        });
      }

      const updated = { ...preferences.preferences };

      // If channels array provided, set each channel
      if (channels && Array.isArray(channels)) {
        updated[type] = {
          email: channels.includes('email'),
          push: channels.includes('push'),
          sms: channels.includes('sms'),
        };
      } else if (enabled !== undefined) {
        // If enabled flag provided, enable/disable on all channels
        updated[type] = {
          email: enabled,
          push: enabled,
          sms: enabled,
        };
      }

      preferences = await prisma.notificationPreference.update({
        where: { userId: req.user.id },
        data: {
          preferences: updated,
          updatedAt: new Date(),
        },
      });

      logger.info(`[Preferences] Updated ${type} for user ${req.user.id}`);

      res.json({
        preferences: preferences.preferences,
        updatedAt: preferences.updatedAt,
        message: `Preferences for ${type} updated`,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/users/notification-preferences/reset
 * Reset all preferences to defaults
 */
router.post('/reset', writeLimiter, requireAuth, handleValidationErrors, async (req, res, next) => {
  try {
    const defaultPrefs = getDefaultPreferences();

    let preferences = await prisma.notificationPreference.findUnique({
      where: { userId: req.user.id },
    });

    if (preferences) {
      preferences = await prisma.notificationPreference.update({
        where: { userId: req.user.id },
        data: {
          preferences: defaultPrefs,
          updatedAt: new Date(),
        },
      });
    } else {
      preferences = await prisma.notificationPreference.create({
        data: {
          userId: req.user.id,
          preferences: defaultPrefs,
        },
      });
    }

    logger.info(`[Preferences] Reset to defaults for user ${req.user.id}`);

    res.json({
      preferences: preferences.preferences,
      message: 'Notification preferences reset to defaults',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Check if user has notifications enabled for a specific type/channel
 * Used internally by notification sending logic
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {string} channel - Channel (email, push, sms)
 * @returns {Promise<boolean>}
 */
async function isNotificationEnabled(userId, type, channel = 'push') {
  try {
    const preferences = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (!preferences) {
      // Default: enable notifications
      return true;
    }

    const typePref = preferences.preferences[type];
    if (!typePref) {
      return true; // Default enable if type not configured
    }

    return typePref[channel] === true;
  } catch (err) {
    logger.warn(`[Preferences] Error checking preferences for ${userId}:`, err.message);
    return true; // Fail open
  }
}

/**
 * Get default notification preferences
 * @returns {object} Default preferences object
 */
function getDefaultPreferences() {
  return {
    ORDER_CONFIRMED: { email: true, push: true, sms: false },
    ORDER_SHIPPED: { email: true, push: true, sms: false },
    ORDER_DELIVERED: { email: true, push: true, sms: false },
    ORDER_CANCELLED: { email: true, push: true, sms: false },
    PAYMENT_RECEIVED: { email: true, push: true, sms: false },
    PAYMENT_FAILED: { email: true, push: true, sms: true },
    MESSAGE_RECEIVED: { email: true, push: true, sms: false },
    REVIEW_RECEIVED: { email: true, push: true, sms: false },
    BOOKING_CONFIRMED: { email: true, push: true, sms: false },
    BOOKING_CANCELLED: { email: true, push: true, sms: false },
    DISPUTE_CREATED: { email: true, push: true, sms: true },
    DISPUTE_RESOLVED: { email: true, push: true, sms: false },
    PROMOTIONAL: { email: true, push: false, sms: false },
    SYSTEM_ALERT: { email: true, push: true, sms: true },
  };
}

module.exports = router;
module.exports.isNotificationEnabled = isNotificationEnabled;
module.exports.getDefaultPreferences = getDefaultPreferences;
