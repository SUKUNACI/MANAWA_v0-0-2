'use strict';

const logger = require('../utils/logger');

/**
 * Notification Preferences Module
 * Centralized management of user notification preferences
 * Handles validation, defaults, merging, and persistence
 */

const VALID_NOTIFICATION_TYPES = [
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

const VALID_CHANNELS = ['email', 'push', 'sms'];

const DEFAULT_PREFERENCES = {
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

/**
 * Custom error class with status code and error code
 */
class PreferencesError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'PreferencesError';
  }
}

class NotificationPreferencesModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Get default preferences
   * @returns {object} Default preferences object
   */
  getDefaults() {
    return { ...DEFAULT_PREFERENCES };
  }

  /**
   * Get user preferences (or create defaults if none exist)
   * @param {string} userId - User ID
   * @returns {Promise<object>} User preferences record
   */
  async getOrCreate(userId) {
    try {
      let preferences = await this.prisma.notificationPreference.findUnique({
        where: { userId },
      });

      if (!preferences) {
        preferences = await this.prisma.notificationPreference.create({
          data: {
            userId,
            preferences: this.getDefaults(),
          },
        });
        logger.info('[PreferencesModule] Created default preferences', { userId });
      }

      return preferences;
    } catch (err) {
      logger.error('[PreferencesModule] Failed to get/create preferences', {
        userId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Update preferences with validation
   * @param {string} userId - User ID
   * @param {object} newPrefs - New preference overrides
   * @returns {Promise<object>} Updated preferences record
   * @throws {PreferencesError} If validation fails or update fails
   */
  async update(userId, newPrefs) {
    try {
      if (!newPrefs || Object.keys(newPrefs).length === 0) {
        throw new PreferencesError(
          'At least one preference to update required',
          400,
          'EMPTY_PREFERENCES'
        );
      }

      // Validate structure
      this.validate(newPrefs);

      // Get current or create defaults
      let preferences = await this.prisma.notificationPreference.findUnique({
        where: { userId },
      });

      let merged;
      if (preferences) {
        merged = { ...preferences.preferences, ...newPrefs };
        const updated = await this.prisma.notificationPreference.update({
          where: { userId },
          data: {
            preferences: merged,
            updatedAt: new Date(),
          },
        });
        logger.info('[PreferencesModule] Updated preferences', { userId });
        return updated;
      } else {
        merged = { ...this.getDefaults(), ...newPrefs };
        const created = await this.prisma.notificationPreference.create({
          data: {
            userId,
            preferences: merged,
          },
        });
        logger.info('[PreferencesModule] Created preferences', { userId });
        return created;
      }
    } catch (err) {
      // Re-throw PreferencesError as-is
      if (err instanceof PreferencesError) {
        throw err;
      }
      logger.error('[PreferencesModule] Failed to update preferences', {
        userId,
        error: err.message,
      });
      throw new PreferencesError(
        'Failed to update preferences',
        500,
        'UPDATE_FAILED'
      );
    }
  }

  /**
   * Update specific notification type
   * @param {string} userId - User ID
   * @param {string} type - Notification type
   * @param {object} opts - { enabled?: boolean, channels?: Array<string> }
   * @returns {Promise<object>} Updated preferences record
   * @throws {PreferencesError} If type is invalid or update fails
   */
  async updateType(userId, type, { enabled, channels } = {}) {
    try {
      if (!VALID_NOTIFICATION_TYPES.includes(type)) {
        throw new PreferencesError(
          `Invalid notification type: ${type}`,
          400,
          'INVALID_TYPE'
        );
      }

      // Get current or create defaults
      let preferences = await this.prisma.notificationPreference.findUnique({
        where: { userId },
      });

      if (!preferences) {
        preferences = await this.prisma.notificationPreference.create({
          data: {
            userId,
            preferences: this.getDefaults(),
          },
        });
      }

      const updated = { ...preferences.preferences };

      // Set channels if provided
      if (channels && Array.isArray(channels)) {
        updated[type] = {
          email: channels.includes('email'),
          push: channels.includes('push'),
          sms: channels.includes('sms'),
        };
      } else if (enabled !== undefined) {
        // Set all channels to enabled/disabled if flag provided
        updated[type] = {
          email: enabled,
          push: enabled,
          sms: enabled,
        };
      }

      // Persist
      const result = await this.prisma.notificationPreference.update({
        where: { userId },
        data: {
          preferences: updated,
          updatedAt: new Date(),
        },
      });

      logger.info('[PreferencesModule] Updated type', { userId, type });
      return result;
    } catch (err) {
      // Re-throw PreferencesError as-is
      if (err instanceof PreferencesError) {
        throw err;
      }
      logger.error('[PreferencesModule] Failed to update type', {
        userId,
        type,
        error: err.message,
      });
      throw new PreferencesError(
        'Failed to update type',
        500,
        'UPDATE_TYPE_FAILED'
      );
    }
  }

  /**
   * Reset preferences to defaults
   * @param {string} userId - User ID
   * @returns {Promise<object>} Reset preferences record
   */
  async reset(userId) {
    try {
      const defaults = this.getDefaults();
      let preferences = await this.prisma.notificationPreference.findUnique({
        where: { userId },
      });

      let result;
      if (preferences) {
        result = await this.prisma.notificationPreference.update({
          where: { userId },
          data: {
            preferences: defaults,
            updatedAt: new Date(),
          },
        });
      } else {
        result = await this.prisma.notificationPreference.create({
          data: {
            userId,
            preferences: defaults,
          },
        });
      }

      logger.info('[PreferencesModule] Reset to defaults', { userId });
      return result;
    } catch (err) {
      logger.error('[PreferencesModule] Failed to reset', {
        userId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Validate preference structure
   * @param {object} prefs - Preferences to validate
   * @throws {PreferencesError} If validation fails
   */
  validate(prefs) {
    if (!prefs || typeof prefs !== 'object') {
      throw new PreferencesError(
        'Preferences must be object',
        400,
        'INVALID_STRUCTURE'
      );
    }

    for (const [type, channels] of Object.entries(prefs)) {
      if (!VALID_NOTIFICATION_TYPES.includes(type)) {
        throw new PreferencesError(
          `Invalid notification type: ${type}`,
          400,
          'INVALID_TYPE'
        );
      }

      if (!channels || typeof channels !== 'object') {
        throw new PreferencesError(
          `${type} must be object with channels`,
          400,
          'INVALID_CHANNELS_STRUCTURE'
        );
      }

      for (const [channel, enabled] of Object.entries(channels)) {
        if (!VALID_CHANNELS.includes(channel)) {
          throw new PreferencesError(
            `Invalid channel: ${channel}`,
            400,
            'INVALID_CHANNEL'
          );
        }

        if (typeof enabled !== 'boolean') {
          throw new PreferencesError(
            `${type}.${channel} must be boolean`,
            400,
            'INVALID_BOOLEAN_VALUE'
          );
        }
      }
    }
  }

  /**
   * Check if notification is enabled for user/type/channel
   * @param {string} userId - User ID
   * @param {string} type - Notification type
   * @param {string} channel - Channel (email, push, sms)
   * @returns {Promise<boolean>} Whether notification is enabled
   */
  async isEnabled(userId, type, channel = 'push') {
    try {
      const preferences = await this.prisma.notificationPreference.findUnique({
        where: { userId },
      });

      if (!preferences) {
        return true; // Default: enable
      }

      const typePref = preferences.preferences[type];
      if (!typePref) {
        return true; // Default: enable if type not configured
      }

      return typePref[channel] === true;
    } catch (err) {
      logger.warn('[PreferencesModule] Error checking enabled status', {
        userId,
        error: err.message,
      });
      return true; // Fail open
    }
  }
}

module.exports = NotificationPreferencesModule;
module.exports.PreferencesError = PreferencesError;
