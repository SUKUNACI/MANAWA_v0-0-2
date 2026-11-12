const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');
const {
  WEBHOOK_EVENTS,
  registerWebhook,
  unregisterWebhook,
  setWebhookActive,
  getWebhooks,
  getWebhookLogs,
  sendTestWebhook,
} = require('../utils/webhooks');

const router = express.Router();

// Middleware to require admin access
router.use(requireAuth);
router.use(requireRole(['ADMIN']));

// Helper to log admin actions
async function writeAdminLog(req, action, targetType, targetId, metadata) {
  try {
    await prisma.adminLog.create({
      data: {
        adminId: req.user?.id || 'system',
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        ipAddress: req.ip || null,
      },
    });
  } catch (err) {
    logger.error('Failed to write admin log', { action, error: err.message });
  }
}

/**
 * GET /admin/webhooks
 * List all webhooks with recent logs
 */
router.get('/', async (req, res, next) => {
  try {
    const isActive = req.query.isActive !== undefined
      ? req.query.isActive === 'true'
      : undefined;

    const webhooks = await getWebhooks({ isActive });

    logger.info('Webhooks listed', {
      adminId: req.user.id,
      count: webhooks.length,
    });

    res.json({
      success: true,
      data: {
        webhooks: webhooks.map(w => ({
          id: w.id,
          url: w.url,
          events: w.events,
          isActive: w.isActive,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
          recentLogs: w.logs.map(log => ({
            id: log.id,
            event: log.event,
            status: log.status,
            attempt: log.attempt,
            createdAt: log.createdAt,
          })),
        })),
        total: webhooks.length,
      },
    });
  } catch (err) {
    logger.error('Failed to list webhooks', { error: err.message });
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

/**
 * GET /admin/webhooks/events
 * Get available webhook events
 */
router.get('/events', async (req, res) => {
  try {
    const events = Object.values(WEBHOOK_EVENTS);

    res.json({
      success: true,
      data: {
        availableEvents: events,
        description: {
          'booking.created': 'Triggered when a booking is created',
          'booking.updated': 'Triggered when a booking status changes',
          'booking.cancelled': 'Triggered when a booking is cancelled',
          'payment.completed': 'Triggered when a payment succeeds',
          'payment.failed': 'Triggered when a payment fails',
          'quote.created': 'Triggered when a new quote is created',
          'quote.accepted': 'Triggered when a quote is accepted',
          'quote.refused': 'Triggered when a quote is refused',
          'user.registered': 'Triggered when a new user registers',
          'user.verified': 'Triggered when a user email is verified',
          'project.created': 'Triggered when a project is created',
          'project.completed': 'Triggered when a project is marked completed',
        },
      },
    });
  } catch (err) {
    logger.error('Failed to get events', { error: err.message });
    res.status(500).json({ error: 'Failed to get events' });
  }
});

/**
 * POST /admin/webhooks
 * Register a new webhook
 */
router.post(
  '/',
  [
    body('url')
      .isURL({ require_protocol: true })
      .withMessage('Invalid URL. Must start with http:// or https://'),
    body('secret')
      .isLength({ min: 16 })
      .withMessage('Secret must be at least 16 characters long'),
    body('events')
      .optional()
      .isArray()
      .withMessage('Events must be an array'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { url, secret, events = [] } = req.body;

      // Validate events if provided
      if (events.length > 0) {
        const validEvents = Object.values(WEBHOOK_EVENTS);
        const invalidEvents = events.filter(e => !validEvents.includes(e));
        if (invalidEvents.length > 0) {
          return res.status(400).json({
            error: 'Invalid events',
            invalidEvents,
          });
        }
      }

      const webhook = await registerWebhook(url, secret, events);

      await writeAdminLog(req, 'WEBHOOK_CREATE', 'WEBHOOK', webhook.id, {
        url,
        eventCount: webhook.events.length,
      });

      res.status(201).json({
        success: true,
        data: webhook,
      });
    } catch (err) {
      if (err.message.includes('Invalid')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error('Failed to register webhook', { error: err.message });
      res.status(500).json({ error: 'Failed to register webhook' });
    }
  }
);

/**
 * GET /admin/webhooks/:id
 * Get webhook details with logs
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.logLimit) || 50, 500);
    const offset = parseInt(req.query.logOffset) || 0;

    const webhook = await prisma.webhook.findUnique({
      where: { id },
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const { logs, total } = await getWebhookLogs(id, {
      limit,
      offset,
      status: req.query.status,
    });

    res.json({
      success: true,
      data: {
        webhook: {
          id: webhook.id,
          url: webhook.url,
          events: webhook.events,
          isActive: webhook.isActive,
          createdAt: webhook.createdAt,
          updatedAt: webhook.updatedAt,
        },
        logs: logs.map(log => ({
          id: log.id,
          event: log.event,
          status: log.status,
          attempt: log.attempt,
          nextRetryAt: log.nextRetryAt,
          createdAt: log.createdAt,
          response: log.response ? JSON.parse(log.response) : null,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
    });
  } catch (err) {
    logger.error('Failed to get webhook', { error: err.message });
    res.status(500).json({ error: 'Failed to get webhook' });
  }
});

/**
 * PUT /admin/webhooks/:id
 * Update webhook configuration
 */
router.put(
  '/:id',
  [
    body('url')
      .optional()
      .isURL({ require_protocol: true })
      .withMessage('Invalid URL'),
    body('secret')
      .optional()
      .isLength({ min: 16 })
      .withMessage('Secret must be at least 16 characters long'),
    body('events')
      .optional()
      .isArray()
      .withMessage('Events must be an array'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { id } = req.params;
      const { url, secret, events } = req.body;

      const webhook = await prisma.webhook.findUnique({
        where: { id },
      });

      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }

      // Validate events if provided
      if (events && events.length > 0) {
        const validEvents = Object.values(WEBHOOK_EVENTS);
        const invalidEvents = events.filter(e => !validEvents.includes(e));
        if (invalidEvents.length > 0) {
          return res.status(400).json({
            error: 'Invalid events',
            invalidEvents,
          });
        }
      }

      const updateData = {};
      if (url) updateData.url = url;
      if (secret) updateData.secret = secret;
      if (events) updateData.events = events;
      updateData.updatedAt = new Date();

      const updated = await prisma.webhook.update({
        where: { id },
        data: updateData,
      });

      await writeAdminLog(req, 'WEBHOOK_UPDATE', 'WEBHOOK', id, {
        changes: Object.keys(updateData),
      });

      res.json({
        success: true,
        data: updated,
      });
    } catch (err) {
      logger.error('Failed to update webhook', { error: err.message });
      res.status(500).json({ error: 'Failed to update webhook' });
    }
  }
);

/**
 * DELETE /admin/webhooks/:id
 * Remove a webhook
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const webhook = await prisma.webhook.findUnique({
      where: { id },
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    await unregisterWebhook(id);

    await writeAdminLog(req, 'WEBHOOK_DELETE', 'WEBHOOK', id, {
      url: webhook.url,
    });

    res.json({
      success: true,
      message: 'Webhook deleted',
    });
  } catch (err) {
    logger.error('Failed to delete webhook', { error: err.message });
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

/**
 * PATCH /admin/webhooks/:id/activate
 * Activate/deactivate a webhook
 */
router.patch('/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const webhook = await setWebhookActive(id, isActive);

    await writeAdminLog(req, 'WEBHOOK_STATUS_CHANGE', 'WEBHOOK', id, {
      isActive,
    });

    res.json({
      success: true,
      data: webhook,
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    logger.error('Failed to update webhook status', { error: err.message });
    res.status(500).json({ error: 'Failed to update webhook status' });
  }
});

/**
 * POST /admin/webhooks/:id/test
 * Send a test webhook to verify configuration
 */
router.post('/:id/test', async (req, res) => {
  try {
    const { id } = req.params;

    const webhook = await prisma.webhook.findUnique({
      where: { id },
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const result = await sendTestWebhook(id);

    await writeAdminLog(req, 'WEBHOOK_TEST', 'WEBHOOK', id, {
      statusCode: result.statusCode,
      success: result.success,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    logger.error('Failed to send test webhook', { error: err.message });
    res.status(500).json({ error: 'Failed to send test webhook' });
  }
});

/**
 * GET /admin/webhooks/:id/logs
 * Get webhook delivery logs (paginated)
 */
router.get('/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status;

    const webhook = await prisma.webhook.findUnique({
      where: { id },
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const { logs, total } = await getWebhookLogs(id, {
      limit,
      offset,
      status,
    });

    res.json({
      success: true,
      data: {
        logs: logs.map(log => ({
          id: log.id,
          event: log.event,
          status: log.status,
          attempt: log.attempt,
          nextRetryAt: log.nextRetryAt,
          createdAt: log.createdAt,
          response: log.response ? JSON.parse(log.response) : null,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
    });
  } catch (err) {
    logger.error('Failed to get webhook logs', { error: err.message });
    res.status(500).json({ error: 'Failed to get webhook logs' });
  }
});

module.exports = router;
