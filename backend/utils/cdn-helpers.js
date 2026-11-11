const { cloudinary, TRANSFORMATIONS, FOLDERS, OPTIMIZATION, CACHE_HEADERS, SIGNED_URL_CONFIG } = require('../config/cdn');
const { uploadBuffer } = require('../config/cloudinary');

/**
 * CDN Helpers - Production-ready utilities for image/video optimization
 * Handles URL generation, responsive sets, optimized uploads, and cleanup
 */

class CDNHelper {
  /**
   * Generate optimized image URL with transformation
   * @param {string} publicId - Cloudinary public ID
   * @param {string} transformation - Transformation preset name
   * @param {object} options - Override transformation options
   * @returns {string} Optimized secure URL
   */
  static generateImageUrl(publicId, transformation = 'medium', options = {}) {
    if (!publicId) throw new Error('Public ID is required');

    let transformConfig = TRANSFORMATIONS[transformation] || TRANSFORMATIONS.medium;
    transformConfig = { ...transformConfig, ...options };

    return cloudinary.url(publicId, {
      secure: true,
      ...transformConfig,
    });
  }

  /**
   * Generate thumbnail with auto-crop
   * @param {string} publicId - Cloudinary public ID
   * @param {object} options - Custom transformation options
   * @returns {string} Thumbnail URL
   */
  static generateThumbnail(publicId, options = {}) {
    if (!publicId) throw new Error('Public ID is required');

    const thumbConfig = {
      ...TRANSFORMATIONS.thumbnail,
      ...options,
    };

    return cloudinary.url(publicId, {
      secure: true,
      ...thumbConfig,
    });
  }

  /**
   * Generate responsive image set (srcset format)
   * @param {string} publicId - Cloudinary public ID
   * @param {string} preset - Responsive preset (avatar_responsive, gallery_responsive)
   * @returns {object} Responsive set with srcset and sizes
   */
  static generateResponsiveSet(publicId, preset = 'gallery_responsive') {
    if (!publicId) throw new Error('Public ID is required');

    const responsivePreset = TRANSFORMATIONS[preset];
    if (!responsivePreset) throw new Error(`Unknown responsive preset: ${preset}`);

    const srcset = responsivePreset
      .map(transform => {
        const url = cloudinary.url(publicId, {
          secure: true,
          ...transform,
        });
        return `${url} ${transform.width}w`;
      })
      .join(', ');

    // Determine sizes attribute based on preset
    let sizes = '100vw';
    if (preset === 'avatar_responsive') {
      sizes = '(max-width: 600px) 100px, (max-width: 1200px) 200px, 300px';
    } else if (preset === 'gallery_responsive') {
      sizes = '(max-width: 600px) 300px, (max-width: 1200px) 600px, 900px';
    }

    return {
      srcset,
      sizes,
      src: cloudinary.url(publicId, {
        secure: true,
        ...responsivePreset[Math.floor(responsivePreset.length / 2)], // Default to middle size
      }),
    };
  }

  /**
   * Upload file with smart optimization
   * @param {Buffer} buffer - File buffer
   * @param {string} folder - Cloudinary folder
   * @param {object} options - Upload options (transformation, tags, etc.)
   * @returns {Promise<object>} Upload result with URLs
   */
  static async uploadWithOptimization(buffer, folder, options = {}) {
    if (!buffer) throw new Error('Buffer is required');
    if (!folder) throw new Error('Folder is required');

    try {
      const uploadOptions = {
        folder,
        resource_type: 'auto',
        quality: OPTIMIZATION.quality.auto,
        fetch_format: OPTIMIZATION.autoFormat ? 'auto' : undefined,
        strip_metadata: OPTIMIZATION.stripMetadata,
        use_filename: true,
        unique_filename: true,
        tags: ['manawa', ...((options.tags || []))],
        ...options,
      };

      // Remove undefined values
      Object.keys(uploadOptions).forEach(key => uploadOptions[key] === undefined && delete uploadOptions[key]);

      const result = await uploadBuffer(buffer, folder, uploadOptions);

      // Generate optimized variants
      const publicId = result.split('/').slice(-1)[0].split('.')[0]; // Extract public ID

      return {
        url: result,
        publicId,
        optimized: {
          thumbnail: this.generateThumbnail(publicId),
          medium: this.generateImageUrl(publicId, 'medium'),
          large: this.generateImageUrl(publicId, 'gallery'),
        },
        responsive: this.generateResponsiveSet(publicId),
        metadata: {
          uploadedAt: new Date().toISOString(),
          folder,
          cacheHeaders: CACHE_HEADERS.content,
        },
      };
    } catch (error) {
      throw new Error(`Upload optimization failed: ${error.message}`);
    }
  }

  /**
   * Generate signed URL for authenticated/private content
   * @param {string} publicId - Cloudinary public ID
   * @param {string} type - Signed URL type (default, extended, temporary)
   * @returns {string} Signed secure URL
   */
  static generateSignedUrl(publicId, type = 'default') {
    if (!publicId) throw new Error('Public ID is required');

    const config = SIGNED_URL_CONFIG[type] || SIGNED_URL_CONFIG.default;

    return cloudinary.url(publicId, {
      secure: true,
      type: config.type,
      sign_url: config.sign_url,
      expires_at: Math.floor(Date.now() / 1000) + config.expire,
    });
  }

  /**
   * Delete old/unused images from CDN
   * @param {Array<string>} publicIds - List of public IDs to delete
   * @returns {Promise<object>} Deletion results
   */
  static async deleteOldImages(publicIds) {
    if (!Array.isArray(publicIds) || publicIds.length === 0) {
      throw new Error('Array of public IDs is required');
    }

    try {
      const results = [];

      // Delete in batches to respect rate limits
      for (let i = 0; i < publicIds.length; i += 100) {
        const batch = publicIds.slice(i, i + 100);
        const deleteResults = await cloudinary.api.delete_resources(batch);
        results.push(deleteResults);
      }

      return {
        success: true,
        deleted: publicIds.length,
        results,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Image deletion failed: ${error.message}`);
    }
  }

  /**
   * Delete images by tag (e.g., cleanup by date or category)
   * @param {string} tag - Tag to delete by
   * @param {number} limit - Max number to delete per call
   * @returns {Promise<object>} Deletion results
   */
  static async deleteByTag(tag, limit = 100) {
    if (!tag) throw new Error('Tag is required');

    try {
      const result = await cloudinary.api.delete_resources_by_tag(tag, { max_results: limit });
      return {
        success: true,
        deleted: result.deleted_resources.length,
        resources: result.deleted_resources,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Tag-based deletion failed: ${error.message}`);
    }
  }

  /**
   * Get CDN usage statistics
   * @returns {Promise<object>} Usage data
   */
  static async getUsageStats() {
    try {
      const usage = await cloudinary.api.usage();
      return {
        transformations: usage.transformations,
        credits: {
          used: usage.credits_used,
          limit: usage.credits_limit,
        },
        requests: usage.requests,
        bandwidth: {
          used_bytes: usage.bandwidth,
          used_gb: (usage.bandwidth / (1024 ** 3)).toFixed(2),
        },
        storage: {
          used_bytes: usage.storage,
          used_gb: (usage.storage / (1024 ** 3)).toFixed(2),
        },
        resources: usage.resources_count,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to fetch usage stats: ${error.message}`);
    }
  }

  /**
   * List resources in a folder
   * @param {string} folder - Folder path
   * @param {number} maxResults - Max results to return
   * @returns {Promise<Array>} List of resources
   */
  static async listResources(folder, maxResults = 50) {
    if (!folder) throw new Error('Folder is required');

    try {
      const result = await cloudinary.api.resources({
        type: 'upload',
        prefix: folder,
        max_results: maxResults,
      });

      return {
        resources: result.resources.map(r => ({
          publicId: r.public_id,
          url: r.secure_url,
          type: r.type,
          createdAt: r.created_at,
          bytes: r.bytes,
          tags: r.tags,
        })),
        total: result.total_count,
        nextCursor: result.next_cursor,
      };
    } catch (error) {
      throw new Error(`Failed to list resources: ${error.message}`);
    }
  }

  /**
   * Get image metadata (dimensions, format, etc.)
   * @param {string} publicId - Cloudinary public ID
   * @returns {Promise<object>} Image metadata
   */
  static async getImageMetadata(publicId) {
    if (!publicId) throw new Error('Public ID is required');

    try {
      const resource = await cloudinary.api.resource(publicId);
      return {
        publicId: resource.public_id,
        format: resource.format,
        width: resource.width,
        height: resource.height,
        bytes: resource.bytes,
        createdAt: resource.created_at,
        tags: resource.tags,
        url: resource.secure_url,
        aspectRatio: (resource.width / resource.height).toFixed(2),
      };
    } catch (error) {
      throw new Error(`Failed to fetch metadata: ${error.message}`);
    }
  }

  /**
   * Generate transformation URL with chaining
   * @param {string} publicId - Cloudinary public ID
   * @param {Array} transformations - Array of transformation objects to chain
   * @returns {string} Chained transformation URL
   */
  static generateChainedTransformation(publicId, transformations = []) {
    if (!publicId) throw new Error('Public ID is required');
    if (!Array.isArray(transformations) || transformations.length === 0) {
      throw new Error('Transformations array is required and must not be empty');
    }

    return cloudinary.url(publicId, {
      secure: true,
      transformation: transformations,
    });
  }

  /**
   * Get optimal format and quality based on device/network
   * @param {object} deviceInfo - Device capabilities (userAgent, etc.)
   * @returns {object} Recommended format and quality settings
   */
  static getOptimalSettings(deviceInfo = {}) {
    const isMobile = deviceInfo.isMobile || false;
    const supportsWebP = deviceInfo.supportsWebP || false;
    const supportedFormats = deviceInfo.supportedFormats || ['auto'];

    return {
      format: supportsWebP ? 'auto' : 'jpg',
      quality: isMobile ? 'auto:good' : 'auto:best',
      dpr: 'auto',
      fetch_format: 'auto',
      responsive: true,
      sizes: isMobile ? '100vw' : '(max-width: 1200px) 100vw, 1200px',
    };
  }
}

module.exports = CDNHelper;
