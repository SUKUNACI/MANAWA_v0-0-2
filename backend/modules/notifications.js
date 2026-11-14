'use strict';

const logger = require('../utils/logger');

/**
 * Notifications Module — Centralized notification delivery and type registry
 * Handles single sends, batch sends, and notification type definitions
 */

const NOTIFICATION_TYPES = {
  NEW_BOOKING: { label: 'Nouvelle réservation', priority: 'high' },
  BOOKING_CONFIRMED: { label: 'Réservation confirmée', priority: 'high' },
  BOOKING_CANCELLED: { label: 'Réservation annulée', priority: 'medium' },
  PAYMENT_RECEIVED: { label: 'Paiement reçu', priority: 'high' },
  PAYMENT_FAILED: { label: 'Échec du paiement', priority: 'high' },
  QUOTE_ACCEPTED: { label: 'Devis accepté', priority: 'high' },
  QUOTE_REJECTED: { label: 'Devis rejeté', priority: 'medium' },
  NEW_FOLLOWER: { label: 'Nouvel abonné', priority: 'low' },
  MESSAGE_RECEIVED: { label: 'Nouveau message', priority: 'medium' },
  REVIEW_POSTED: { label: 'Nouvel avis', priority: 'medium' },
  PROFILE_VIEWED: { label: 'Profil consulté', priority: 'low' },
  PROMOTION_AVAILABLE: { label: 'Promotion disponible', priority: 'low' },
};

class NotificationsModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Get all notification types
   * @returns {object} Notification type registry
   */
  getTypes() {
    return NOTIFICATION_TYPES;
  }

  /**
   * Validate notification type
   * @param {string} type - Notification type
   * @returns {boolean}
   */
  isValidType(type) {
    return type in NOTIFICATION_TYPES;
  }

  /**
   * Send a single notification
   * @param {string} type - Notification type (must be in NOTIFICATION_TYPES)
   * @param {object} opts - { userId, data }
   * @returns {Promise<object>} Created notification or error log
   */
  async sendNotification(type, { userId, data = {} } = {}) {
    if (!this.isValidType(type)) {
      logger.warn('[NotificationsModule] Invalid notification type', { type });
      throw new Error(`Invalid notification type: ${type}`);
    }

    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type,
          title: NOTIFICATION_TYPES[type].label,
          data,
          read: false,
        },
      });
      logger.info('[NotificationsModule] Notification sent', { userId, type });
      return notification;
    } catch (err) {
      logger.warn('[NotificationsModule] Failed to persist notification', {
        type,
        userId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Send batch notifications efficiently (createMany = 1 query instead of N)
   * @param {Array} notifications - Array of { type, userId, data }
   * @returns {Promise<number>} Count of created notifications
   */
  async sendBatchNotifications(notifications) {
    if (!Array.isArray(notifications) || notifications.length === 0) {
      return 0;
    }

    // Validate all types
    for (const n of notifications) {
      if (!this.isValidType(n.type)) {
        throw new Error(`Invalid notification type: ${n.type}`);
      }
    }

    try {
      const data = notifications.map(n => ({
        userId: n.userId,
        type: n.type,
        title: NOTIFICATION_TYPES[n.type].label,
        data: n.data || {},
        read: false,
      }));

      const result = await this.prisma.notification.createMany({ data });
      logger.info('[NotificationsModule] Batch created', { count: notifications.length });
      return result.count;
    } catch (err) {
      logger.warn('[NotificationsModule] Failed to persist batch notifications', {
        count: notifications.length,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @returns {Promise<object>} Updated notification
   */
  async markAsRead(notificationId) {
    try {
      return await this.prisma.notification.update({
        where: { id: notificationId },
        data: { read: true, readAt: new Date() },
      });
    } catch (err) {
      logger.warn('[NotificationsModule] Failed to mark as read', {
        notificationId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Mark all notifications as read for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Count of updated notifications
   */
  async markAllAsRead(userId) {
    try {
      const result = await this.prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true, readAt: new Date() },
      });
      return result.count;
    } catch (err) {
      logger.warn('[NotificationsModule] Failed to mark all as read', {
        userId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Get unread count for user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Unread notification count
   */
  async getUnreadCount(userId) {
    try {
      return await this.prisma.notification.count({
        where: { userId, read: false },
      });
    } catch (err) {
      logger.warn('[NotificationsModule] Failed to get unread count', {
        userId,
        error: err.message,
      });
      return 0;
    }
  }

  /**
   * Get recent notifications for user
   * @param {string} userId - User ID
   * @param {number} limit - Max results
   * @param {number} skip - Number of records to skip (for pagination)
   * @param {object|null} where - Prisma where clause override (defaults to { userId })
   * @returns {Promise<Array>} Notifications
   */
  async getRecent(userId, limit = 20, skip = 0, where = null) {
    try {
      return await this.prisma.notification.findMany({
        where: where || { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      });
    } catch (err) {
      logger.warn('[NotificationsModule] Failed to get recent notifications', {
        userId,
        error: err.message,
      });
      return [];
    }
  }
}

module.exports = NotificationsModule;
