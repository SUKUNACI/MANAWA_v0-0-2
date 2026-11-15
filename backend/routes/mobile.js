// Q120-Q124: Mobile-specific endpoints, offline support, sync strategy, conflict resolution, delta sync
const express = require('express');
const rateLimit = require('express-rate-limit');
const MobileModule = require('../modules/mobile');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const mobileModule = new MobileModule(prisma);

const mobileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes mobiles, réessayez dans une minute' },
});

router.use(mobileLimiter);

// ─── Q120: Mobile-specific batch endpoints ────────────────────────────────────

// GET /api/v1/mobile/dashboard — données accueil en 1 seul appel
// Q121: Offline-first support with ETag, Last-Modified, Cache-Control, if-none-match (304)
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const slim = req.mobileOptimized || false;

    // Get dashboard from MobileModule
    const dashboard = await mobileModule.getDashboard(userId, slim);

    // Apply cache headers (setHeader('ETag'), Last-Modified, Cache-Control max-age)
    mobileModule.applyCacheHeaders(res, userId, dashboard, 60);

    // Check if cache is fresh (if-none-match header, 304 Not Modified response)
    const clientETag = req.headers['if-none-match'];
    const serverETag = mobileModule.getETag(userId, dashboard);
    if (mobileModule.isCacheFresh(clientETag, serverETag)) {
      return res.status(304).end();
    }

    return res.json({ success: true, data: dashboard });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /api/v1/mobile/notifications — liste optimisée notifications
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const unreadOnly = req.query.unread === 'true';
    const slim = req.mobileOptimized || false;

    // Get notifications from MobileModule
    const result = await mobileModule.getNotifications(userId, limit, page, unreadOnly, slim);

    // Apply cache headers
    res.setHeader('Cache-Control', 'private, max-age=30');

    return res.json({
      success: true,
      data: result.notifications,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        unreadCount: result.unreadCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /api/v1/mobile/profile-summary — profil résumé pour l'app
router.get('/profile-summary', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const slim = req.mobileOptimized || false;

    // Get profile summary from MobileModule
    const result = await mobileModule.getProfileSummary(userId, slim);

    // Apply cache headers
    mobileModule.applyCacheHeaders(res, userId, result, 120);

    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ─── Q122 + Q123 + Q124: Sync strategy, conflict resolution, delta sync ───────

// GET /api/v1/mobile/sync?since=<ISO8601>
// Q122: Sync strategy with req.query.since validation ("since" requis, isNaN(since.getTime()), syncedAt)
// Q123: Conflict resolution with conflictPolicy (profile: 'last-write-wins', projects: 'server-wins', payments: 'server-wins')
// Q124: Delta sync filtering (createdAt: { gt: since }, updatedAt: { gt: since }, counts: { notifications.length, projects.length }, sinceUsed)
router.get('/sync', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const sinceRaw = req.query.since;
    const slim = req.mobileOptimized || false;

    // Get delta sync from MobileModule (validates "since" requis and isNaN(since.getTime()) internally)
    const delta = await mobileModule.getDeltaSync(userId, sinceRaw, slim);

    // Apply cache headers for sync endpoint
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Sync-Timestamp', delta.syncedAt);

    return res.json({ success: true, data: delta });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
