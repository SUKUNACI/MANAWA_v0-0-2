/**
 * CDNAdminModule
 * Business logic for CDN administration
 */

const logger = require('../utils/logger');

class CDNAdminModule {
  constructor(cdnHelper, cloudinary) {
    this.cdnHelper = cdnHelper;
    this.cloudinary = cloudinary;
  }

  // Get stats
  async getStats() {
    const stats = await this.cdnHelper.getUsageStats();
    const costs = this.calculateCosts(stats);
    const recommendations = this.generateRecommendations(stats);
    return { usage: stats, costs, recommendations, lastUpdated: new Date().toISOString() };
  }

  // List resources
  async listResources(folder, limit = 50) {
    if (!folder) throw new Error('folder parameter is required');
    return this.cdnHelper.listResources(folder, parseInt(limit));
  }

  // Get resource metadata
  async getResourceMetadata(publicId) {
    if (!publicId) throw new Error('publicId parameter is required');
    return this.cdnHelper.getImageMetadata(publicId);
  }

  // Purge by method
  async purge(data) {
    const { method, url, folder, tag } = data;
    if (!method) throw new Error('method parameter is required (url, folder, tag, or all)');

    let result;
    switch (method) {
      case 'url':
        if (!url) throw new Error('url parameter is required for method: url');
        result = await this.cloudinary.api.delete_resources_by_prefix(url);
        break;
      case 'folder':
        if (!folder) throw new Error('folder parameter is required for method: folder');
        result = await this.cloudinary.api.delete_resources_by_prefix(folder);
        break;
      case 'tag':
        if (!tag) throw new Error('tag parameter is required for method: tag');
        result = await this.cdnHelper.deleteByTag(tag, 1000);
        break;
      case 'all':
        if (process.env.NODE_ENV !== 'development') throw new Error('Full CDN purge only allowed in development');
        result = await this.cloudinary.api.delete_all_resources();
        break;
      default:
        throw new Error('Invalid purge method');
    }
    return { method, result, timestamp: new Date().toISOString() };
  }

  // Delete resources
  async deleteResources(publicIds) {
    if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
      throw new Error('publicIds array is required and must not be empty');
    }
    if (publicIds.length > 500) throw new Error('Maximum 500 resources can be deleted at once');
    return this.cdnHelper.deleteOldImages(publicIds);
  }

  // Get transformations
  getTransformations() {
    return {
      transformations: [
        { name: 'avatar', width: 200, height: 200, gravity: 'face' },
        { name: 'thumbnail', width: 100, height: 100 },
        { name: 'card', width: 400, height: 250 },
      ],
    };
  }

  // Get cache config
  getCacheConfig() {
    return {
      browser: { maxAge: 86400 },
      cdn: { maxAge: 31536000 },
    };
  }

  // Cleanup old resources
  async cleanup() {
    const resources = await this.cloudinary.api.resources();
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const oldResources = resources.resources.filter(r => new Date(r.created_at) < oldDate);

    let cleaned = 0;
    if (oldResources.length > 0) {
      cleaned = (await this.cdnHelper.deleteOldImages(oldResources.map(r => r.public_id))).deleted;
    }
    return { cleaned, timestamp: new Date().toISOString() };
  }

  // Health check
  async health() {
    const [ping, account] = await Promise.all([
      this.cloudinary.api.ping(),
      this.cloudinary.api.account(),
    ]);
    return {
      cloudinary: {
        connected: ping.status === 'ok',
        plan: account.plan,
        cloud_name: account.cloud_name,
      },
      timestamp: new Date().toISOString(),
    };
  }

  calculateCosts(stats) {
    return { bandwidth: stats.bandwidth.used_gb * 0.12, storage: stats.storage.used_gb * 0.50 };
  }

  generateRecommendations(stats) {
    return stats.bandwidth.used_gb > 100 ? ['Consider upgrading CDN plan'] : [];
  }
}

module.exports = CDNAdminModule;
