// Q120-Q124: Mobile-specific endpoints, offline support, sync strategy, conflict resolution, delta sync
const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { optimizeImagesForMobile } = require('../config/mobile-images');

const router = express.Router();

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
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const slim = req.mobileOptimized;

    const [user, notifications, activeProjects, unreadMessages] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          role: true,
          emailVerified: true,
          city: true,
          professional: slim ? false : {
            select: { id: true, verified: true, rating: true, reviewCount: true },
          },
        },
      }),
      prisma.notification.findMany({
        where: { userId, read: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, type: true, title: true, body: true, createdAt: true },
      }),
      prisma.project.findMany({
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
      prisma.message.count({
        where: { receiverId: userId, read: false },
      }),
    ]);

    const dashboard = {
      user: optimizeImagesForMobile(user, 'avatar'),
      unreadNotifications: notifications.length,
      recentNotifications: notifications,
      activeProjects,
      unreadMessages,
      fetchedAt: new Date().toISOString(),
    };

    // Q121: ETag + Cache-Control pour offline support
    const etag = `"mobile-dashboard-${userId}-${dashboard.fetchedAt}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    res.setHeader('Last-Modified', new Date().toUTCString());

    if (req.headers['if-none-match'] === etag) {
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
    const skip = (page - 1) * limit;
    const unreadOnly = req.query.unread === 'true';

    const where = { userId, ...(unreadOnly && { read: false }) };

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          read: true,
          createdAt: true,
          ...(req.mobileOptimized ? {} : { data: true }),
        },
      }),
      prisma.notification.count({ where }),
    ]);

    res.setHeader('Cache-Control', 'private, max-age=30');

    return res.json({
      success: true,
      data: notifications,
      meta: { total, page, limit, unreadCount: unreadOnly ? total : undefined },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /api/v1/mobile/profile-summary — profil résumé pour l'app
router.get('/profile-summary', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const slim = req.mobileOptimized;

    const user = await prisma.user.findUnique({
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

    if (!user) return res.status(404).json({ success: false, error: 'Utilisateur introuvable' });

    const result = optimizeImagesForMobile(user, 'avatar');

    res.setHeader('ETag', `"profile-${userId}-${user.id}"`);
    res.setHeader('Cache-Control', 'private, max-age=120, stale-while-revalidate=600');

    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ─── Q122 + Q123 + Q124: Sync strategy, conflict resolution, delta sync ───────

// GET /api/v1/mobile/sync?since=<ISO8601>
// Retourne uniquement les entités modifiées depuis le timestamp donné (delta sync Q124)
// Résolution de conflits (Q123) : server-wins pour status/paiements, last-write-wins pour profil
router.get('/sync', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const sinceRaw = req.query.since;

    if (!sinceRaw) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre "since" requis (ex: ?since=2026-11-01T00:00:00Z)',
      });
    }

    const since = new Date(sinceRaw);
    if (isNaN(since.getTime())) {
      return res.status(400).json({ success: false, error: 'Format "since" invalide — utilisez ISO 8601' });
    }

    const slim = req.mobileOptimized;
    const now = new Date();

    // Récupération parallèle de toutes les entités modifiées depuis `since`
    const [notifications, projects, messages, profile] = await Promise.all([
      // Notifications non lues ou modifiées
      prisma.notification.findMany({
        where: { userId, createdAt: { gt: since } },
        orderBy: { createdAt: 'desc' },
        take: slim ? 20 : 50,
        select: {
          id: true, type: true, title: true, body: true,
          read: true, createdAt: true,
        },
      }),
      // Projets modifiés
      prisma.project.findMany({
        where: { clientId: userId, updatedAt: { gt: since } },
        orderBy: { updatedAt: 'desc' },
        take: slim ? 5 : 20,
        select: {
          id: true, title: true, status: true, city: true,
          updatedAt: true,
          ...(!slim && { budgetMin: true, budgetMax: true, description: true }),
        },
      }),
      // Messages non lus reçus après `since`
      prisma.message.findMany({
        where: { receiverId: userId, createdAt: { gt: since }, read: false },
        orderBy: { createdAt: 'desc' },
        take: slim ? 10 : 30,
        select: {
          id: true, senderId: true, content: slim ? false : true,
          read: true, createdAt: true,
        },
      }),
      // Profil modifié depuis `since` (Q123: server-wins — on retourne l'état serveur)
      prisma.user.findFirst({
        where: { id: userId, updatedAt: { gt: since } },
        select: {
          id: true, firstName: true, lastName: true,
          avatarUrl: true, updatedAt: true,
        },
      }),
    ]);

    const syncedAt = now.toISOString();

    // Q123: conflict resolution metadata
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

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Sync-Timestamp', syncedAt);

    return res.json({ success: true, data: delta });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
