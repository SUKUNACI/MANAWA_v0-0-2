'use strict';

const logger = require('./logger');

/**
 * Send a typed notification to a user.
 * @param {string} type - Notification type key (e.g. 'PAYMENT_RETRY_INITIATED')
 * @param {object} opts
 * @param {string} opts.userId
 * @param {object} [opts.data]
 */
async function sendNotification(type, { userId, data = {} } = {}) {
  try {
    const prisma = require('../config/db');
    await prisma.notification.create({
      data: {
        userId,
        type,
        title: type,
        data: data,
        read: false,
      },
    });
  } catch (err) {
    logger.warn('[Notification] Failed to persist notification', {
      type,
      userId,
      error: err.message,
    });
  }
}

module.exports = { sendNotification };
