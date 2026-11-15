'use strict';

const logger = require('../utils/logger');

/**
 * NotificationTemplateModule — Centralized notification template management
 * Handles CRUD operations for notification templates with versioning support
 */

class NotificationTemplateModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * List notification templates with pagination and filtering
   * @param {object} filters - { language?, type?, isActive? }
   * @param {object} pagination - { limit, skip, offset }
   * @returns {Promise<object>} { templates, total, limit, offset }
   */
  async list(filters = {}, pagination = {}) {
    try {
      const { limit = 20, skip = 0, offset = 0 } = pagination;
      const where = {};

      // Apply filters
      if (filters.language) where.language = filters.language;
      if (filters.type) where.type = filters.type;
      if (filters.isActive !== undefined) where.isActive = filters.isActive;

      // Execute count and findMany in parallel
      const [templates, total] = await Promise.all([
        this.prisma.notificationTemplate.findMany({
          where,
          orderBy: [{ name: 'asc' }, { version: 'desc' }],
          skip,
          take: limit,
        }),
        this.prisma.notificationTemplate.count({ where }),
      ]);

      logger.info('[NotificationTemplateModule] Listed templates', { count: templates.length, total, filters });

      return {
        templates,
        total,
        limit,
        offset,
      };
    } catch (err) {
      logger.error('[NotificationTemplateModule] list failed', { error: err.message, filters });
      throw err;
    }
  }

  /**
   * Get all versions of a template by name
   * @param {string} id - Template name (identifier)
   * @returns {Promise<object>} { templates, current, totalVersions }
   */
  async getById(id) {
    try {
      const templates = await this.prisma.notificationTemplate.findMany({
        where: { name: id },
        orderBy: { version: 'desc' },
      });

      if (templates.length === 0) {
        throw Object.assign(new Error('Template not found'), { status: 404 });
      }

      logger.info('[NotificationTemplateModule] Retrieved template', { id, versions: templates.length });

      return {
        templates,
        current: templates.find(t => t.isActive) || templates[0],
        totalVersions: templates.length,
      };
    } catch (err) {
      logger.error('[NotificationTemplateModule] getById failed', { id, error: err.message });
      throw err;
    }
  }

  /**
   * Create new notification template (auto-versions)
   * @param {object} data - { name, type, language, title, body, variables? }
   * @returns {Promise<object>} Created template
   */
  async create(data) {
    try {
      const { name, type, language, title, body, variables = [] } = data;

      // Validate required fields
      if (!name || !type || !language || !title || !body) {
        throw new Error('Missing required fields: name, type, language, title, body');
      }

      // Get current version
      const latest = await this.prisma.notificationTemplate.findFirst({
        where: { name },
        orderBy: { version: 'desc' },
      });

      const newVersion = (latest?.version || 0) + 1;

      // Deactivate previous versions if this is v1
      if (newVersion === 1) {
        await this.prisma.notificationTemplate.updateMany({
          where: { name },
          data: { isActive: false },
        });
      }

      // Create new template
      const template = await this.prisma.notificationTemplate.create({
        data: {
          name,
          type,
          language,
          title,
          body,
          variables,
          version: newVersion,
          isActive: true,
          createdAt: new Date(),
        },
      });

      logger.info('[NotificationTemplateModule] Created template', { name, version: newVersion });

      return template;
    } catch (err) {
      if (err.code === 'P2002') {
        logger.error('[NotificationTemplateModule] Duplicate template', { name: data.name });
        throw Object.assign(new Error('Template with this name already exists'), { status: 409 });
      }
      logger.error('[NotificationTemplateModule] create failed', { error: err.message, data });
      throw err;
    }
  }

  /**
   * Update template by name (creates new version, soft-deactivates old)
   * @param {string} id - Template name (identifier)
   * @param {object} data - { title?, body?, variables? }
   * @returns {Promise<object>} { template, previousVersion }
   */
  async update(id, data) {
    try {
      // Get current version
      const current = await this.prisma.notificationTemplate.findFirst({
        where: { name: id },
        orderBy: { version: 'desc' },
      });

      if (!current) {
        throw Object.assign(new Error('Template not found'), { status: 404 });
      }

      // Deactivate old version
      await this.prisma.notificationTemplate.update({
        where: { id: current.id },
        data: { isActive: false },
      });

      // Create new version
      const newVersion = current.version + 1;
      const updated = await this.prisma.notificationTemplate.create({
        data: {
          name: current.name,
          type: current.type,
          language: current.language,
          title: data.title || current.title,
          body: data.body || current.body,
          variables: data.variables || current.variables,
          version: newVersion,
          isActive: true,
          createdAt: new Date(),
        },
      });

      logger.info('[NotificationTemplateModule] Updated template', { id, newVersion, previousVersion: current.version });

      return {
        template: updated,
        previousVersion: current.version,
      };
    } catch (err) {
      logger.error('[NotificationTemplateModule] update failed', { id, error: err.message, data });
      throw err;
    }
  }

  /**
   * Delete template (soft-delete: disable all versions)
   * @param {string} id - Template name (identifier)
   * @returns {Promise<object>} { message, versionsAffected }
   */
  async delete(id) {
    try {
      const result = await this.prisma.notificationTemplate.updateMany({
        where: { name: id },
        data: { isActive: false },
      });

      if (result.count === 0) {
        throw Object.assign(new Error('Template not found'), { status: 404 });
      }

      logger.info('[NotificationTemplateModule] Deleted template', { id, versionsAffected: result.count });

      return {
        message: `Template ${id} and all versions disabled`,
        versionsAffected: result.count,
      };
    } catch (err) {
      logger.error('[NotificationTemplateModule] delete failed', { id, error: err.message });
      throw err;
    }
  }

  /**
   * Get all versions of a template (paginated)
   * @param {string} id - Template name (identifier)
   * @param {number} limit - Max results (default 20)
   * @returns {Promise<object>} { name, versions, total }
   */
  async getVersions(id, limit = 20) {
    try {
      const maxLimit = Math.min(50, parseInt(limit) || 20);

      const versions = await this.prisma.notificationTemplate.findMany({
        where: { name: id },
        orderBy: { version: 'desc' },
        take: maxLimit,
      });

      if (versions.length === 0) {
        throw Object.assign(new Error('Template not found'), { status: 404 });
      }

      logger.info('[NotificationTemplateModule] Retrieved versions', { id, total: versions.length });

      return {
        name: id,
        versions,
        total: versions.length,
      };
    } catch (err) {
      logger.error('[NotificationTemplateModule] getVersions failed', { id, error: err.message });
      throw err;
    }
  }

  /**
   * Revert to specific version (creates new version as copy)
   * @param {string} id - Template name (identifier)
   * @param {number} version - Version to revert to
   * @returns {Promise<object>} { template, message }
   */
  async revert(id, version) {
    try {
      const revertVersion = parseInt(version);

      if (isNaN(revertVersion) || revertVersion < 1) {
        throw new Error('Invalid version number');
      }

      // Find the version to revert to
      const versionToRevert = await this.prisma.notificationTemplate.findFirst({
        where: {
          name: id,
          version: revertVersion,
        },
      });

      if (!versionToRevert) {
        throw Object.assign(new Error('Version not found'), { status: 404 });
      }

      // Deactivate all versions
      await this.prisma.notificationTemplate.updateMany({
        where: { name: id },
        data: { isActive: false },
      });

      // Get highest version to determine new version number
      const highest = await this.prisma.notificationTemplate.findFirst({
        where: { name: id },
        orderBy: { version: 'desc' },
      });

      const newVersion = (highest?.version || 0) + 1;

      // Create copy as new version
      const reverted = await this.prisma.notificationTemplate.create({
        data: {
          name: id,
          type: versionToRevert.type,
          language: versionToRevert.language,
          title: versionToRevert.title,
          body: versionToRevert.body,
          variables: versionToRevert.variables,
          version: newVersion,
          isActive: true,
          createdAt: new Date(),
        },
      });

      logger.info('[NotificationTemplateModule] Reverted template', { id, revertVersion, newVersion });

      return {
        template: reverted,
        message: `Template reverted from v${revertVersion} to v${newVersion}`,
      };
    } catch (err) {
      logger.error('[NotificationTemplateModule] revert failed', { id, version, error: err.message });
      throw err;
    }
  }
}

module.exports = NotificationTemplateModule;
