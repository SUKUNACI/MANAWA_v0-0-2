'use strict';

const logger = require('../utils/logger');
const { optimizeImagesForMobile } = require('../config/mobile-images');

/**
 * Mobile Module — Batch queries, caching, offline support, delta sync
 * Consolidates dashboard, notifications, profile-summary, and sync endpoints
 * Features: ETag caching, Cache-Control, conditional fields (slim mode), conflict resolution
 */

class MobileModule {
  constructor(prisma, mobileImagesConfig = {}) {
    this.prisma = prisma;
    this.mobileImagesConfig = mobileImagesConfig;
  }

  // ─── Dashboard: 4 parallel queries (user, notifications, projects, messages) ───

  /**
   * Get mobile dashboard with batch queries
   * Fetches user, notifications, active projects, and unread message count in parallel
   * @param {string} userId - User ID
   * @param {boolean} slim - If true, omit heavy fields (professional.bio, project details, etc)
   * @returns {Promise<object>} Dashboard data with metadata
   */
  async getDashboard(userId, slim = false) {
    try {
      const [user, notifications, activeProjects, unreadMessages] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            role: true,
            emailVerified: true,
            city: true,
            professional: slim
              ? false
              : {
                  select: {
                    id: true,
                    verified: true,
                    rating: true,
                    reviewCount: true,
                  },
                },
          },
        }),
        this.prisma.notification.findMany({
          where: { userId, read: false },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            createdAt: true,
          },
        }),
        this.prisma.project.findMany({
          where: {
            clientId: userId,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
          },
          orderBy: { updatedAt: 'desc' },
          take: slim ? 3 : 5,
          select: {
            id: true,
            title: true,
            status: true,
            city: true,
            updatedAt: true,
            ...(!slim && { budgetMin: true, budgetMax: true }),
          },
        }),
        this.prisma.message.count({
          where: { receiverId: userId, read: false },
        }),
      ]);

      const fetchedAt = new Date().toISOString();

      const dashboard = {
        user: optimizeImagesForMobile(user, 'avatar'),
        unreadNotifications: notifications.length,
        recentNotifications: notifications,
        activeProjects,
        unreadMessages,
        fetchedAt,
      };

      logger.info('[MobileModule] Dashboard fetched', { userId, slim });
      return dashboard;
    } catch (err) {
      logger.error('[MobileModule] Failed to fetch dashboard', {
        userId,
        error: err.message,
      });
      throw err;
    }
  }

  // ─── Notifications: optimized list with pagination ───

  /**
   * Get optimized notifications list for mobile
   * Includes pagination and filtering (unread-only mode)
   * @param {string} userId - User ID
   * @param {number} limit - Max results per page (default 20, max 50)
   * @param {number} page - Page number (default 1)
   * @param {boolean} unreadOnly - If true, return only unread notifications
   * @param {boolean} slim - If true, omit heavy fields like data
   * @returns {Promise<object>} { notifications, total, page, limit, unreadCount }
   */
  async getNotifications(
    userId,
    limit = 20,
    page = 1,
    unreadOnly = false,
    slim = false
  ) {
    try {
      const boundLimit = Math.min(50, Math.max(1, limit));
      const boundPage = Math.max(1, page);
      const skip = (boundPage - 1) * boundLimit;

      const where = {
        userId,
        ...(unreadOnly && { read: false }),
      };

      const [notifications, total] = await Promise.all([
        this.prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: boundLimit,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            read: true,
            createdAt: true,
            // Include data field only if not in slim mode
            ...(!slim && { data: true }),
          },
        }),
        this.prisma.notification.count({ where }),
      ]);

      logger.info('[MobileModule] Notifications fetched', {
        userId,
        count: notifications.length,
        total,
        unreadOnly,
      });

      return {
        notifications,
        total,
        page: boundPage,
        limit: boundLimit,
        unreadCount: unreadOnly ? total : undefined,
      };
    } catch (err) {
      logger.error('[MobileModule] Failed to fetch notifications', {
        userId,
        error: err.message,
      });
      throw err;
    }
  }

  // ─── ETag generation for caching ───

  /**
   * Generate ETag hash for dashboard or notifications data
   * Used for HTTP 304 Not Modified responses
   * @param {string} userId - User ID
   * @param {object} data - Dashboard or notification data
   * @returns {string} ETag value (including quotes for HTTP header)
   */
  getETag(userId, data) {
    // Create a simple but effective hash from userId + data timestamp
    const timestamp = data.fetchedAt || data[0]?.createdAt || new Date().toISOString();
    const hash = `mobile-${userId}-${timestamp}`;
    return `"${hash}"`;
  }

  // ─── Cache headers management ───

  /**
   * Apply cache headers to response (ETag, Cache-Control, Last-Modified)
   * @param {object} res - Express response object
   * @param {string} userId - User ID
   * @param {object} data - Response data for ETag generation
   * @param {number} maxAge - Cache duration in seconds (default 60)
   * @returns {void}
   */
  applyCacheHeaders(res, userId, data, maxAge = 60) {
    const etag = this.getETag(userId, data);
    res.setHeader('ETag', etag);
    res.setHeader(
      'Cache-Control',
      `private, max-age=${maxAge}, stale-while-revalidate=${maxAge * 5}`
    );
    res.setHeader('Last-Modified', new Date().toUTCString());
  }

  /**
   * Check if client has fresh cache (ETag comparison)
   * @param {string} clientETag - ETag from If-None-Match header
   * @param {string} serverETag - Server-generated ETag
   * @returns {boolean} True if cache is fresh (304 response should be sent)
   */
  isCacheFresh(clientETag, serverETag) {
    return clientETag === serverETag;
  }

  // ─── Profile summary ───

  /**
   * Get profile summary with professional details
   * @param {string} userId - User ID
   * @param {boolean} slim - If true, omit heavy fields (professional.bio, trades)
   * @returns {Promise<object>} Profile data
   */
  async getProfileSummary(userId, slim = false) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatarUrl: true,
          role: true,
          city: true,
          emailVerified: true,
          phoneVerified: true,
          twoFAEnabled: true,
          locale: true,
          createdAt: true,
          professional: {
            select: {
              id: true,
              bio: slim ? false : true,
              verified: true,
              rating: true,
              reviewCount: true,
              trades: slim ? false : true,
              city: true,
              photoUrl: true,
            },
          },
        },
      });

      if (!user) {
        throw Object.assign(
          new Error('Utilisateur introuvable'),
          { status: 404 }
        );
      }

      const result = optimizeImagesForMobile(user, 'avatar');
      logger.info('[MobileModule] Profile summary fetched', { userId, slim });
      return result;
    } catch (err) {
      logger.error('[MobileModule] Failed to fetch profile summary', {
        userId,
        error: err.message,
      });
      throw err;
    }
  }

  // ─── Delta sync (Q124: only modified entities since timestamp) ───

  /**
   * Get delta sync: only entities modified since given timestamp
   * Supports conflict resolution strategies: last-write-wins (profile), server-wins (status/payments)
   * @param {string} userId - User ID
   * @param {Date} sinceTimestamp - Fetch changes since this ISO8601 timestamp
   * @param {boolean} slim - If true, omit heavy fields
   * @returns {Promise<object>} Delta with notifications, projects, messages, profile
   */
  async getDeltaSync(userId, sinceTimestamp, slim = false) {
    try {
      if (!sinceTimestamp || isNaN(new Date(sinceTimestamp).getTime())) {
        throw Object.assign(
          new Error(
            'Invalid "since" parameter — use ISO 8601 format (e.g., 2026-11-01T00:00:00Z)'
          ),
          { status: 400 }
        );
      }

      const since = new Date(sinceTimestamp);
      const now = new Date();

      // Fetch all modified entities in parallel
      const [notifications, projects, messages, profile] = await Promise.all([
        // Notifications created/modified since `since`
        this.prisma.notification.findMany({
          where: { userId, createdAt: { gt: since } },
          orderBy: { createdAt: 'desc' },
          take: slim ? 20 : 50,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            read: true,
            createdAt: true,
          },
        }),
        // Projects modified since `since`
        this.prisma.project.findMany({
          where: { clientId: userId, updatedAt: { gt: since } },
          orderBy: { updatedAt: 'desc' },
          take: slim ? 5 : 20,
          select: {
            id: true,
            title: true,
            status: true,
            city: true,
            updatedAt: true,
            ...(!slim && { budgetMin: true, budgetMax: true, description: true }),
          },
        }),
        // Unread messages received since `since`
        this.prisma.message.findMany({
          where: {
            receiverId: userId,
            createdAt: { gt: since },
            read: false,
          },
          orderBy: { createdAt: 'desc' },
          take: slim ? 10 : 30,
          select: {
            id: true,
            senderId: true,
            content: slim ? false : true,
            read: true,
            createdAt: true,
          },
        }),
        // Profile modified since `since` (server-wins: return server state)
        this.prisma.user.findFirst({
          where: { id: userId, updatedAt: { gt: since } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            updatedAt: true,
          },
        }),
      ]);

      const syncedAt = now.toISOString();

      // Conflict resolution policy (Q123)
      const conflictPolicy = {
        profile: 'last-write-wins',
        projects: 'server-wins',
        payments: 'server-wins',
        notifications: 'server-wins',
      };

      const delta = {
        notifications,
        projects,
        messages,
        profile: profile ? optimizeImagesForMobile(profile, 'avatar') : null,
        syncedAt,
        sinceUsed: since.toISOString(),
        conflictPolicy,
        counts: {
          notifications: notifications.length,
          projects: projects.length,
          messages: messages.length,
          profileUpdated: profile !== null,
        },
      };

      logger.info('[MobileModule] Delta sync performed', {
        userId,
        slim,
        sinceUsed: since.toISOString(),
        counts: delta.counts,
      });

      return delta;
    } catch (err) {
      logger.error('[MobileModule] Failed to perform delta sync', {
        userId,
        error: err.message,
      });
      throw err;
    }
  }
}

module.exports = MobileModule;
