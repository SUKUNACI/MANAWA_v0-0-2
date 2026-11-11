# Redis Caching - Route Integration Examples

Complete examples showing how to add caching to different route types in MANAWA.

---

## 1. Professional Search/Browse (High-Traffic Read)

**File**: `routes/professionals.js` (create if doesn't exist)

```javascript
const express = require('express');
const { cacheGet, cacheInvalidate } = require('../middleware/cacheMiddleware');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();

// ============ CACHED ENDPOINTS ============

// GET /api/professionals
// Browse all professionals (paginated, cacheable)
router.get('/',
  optionalAuth(),
  cacheGet(), // Cache this response for 1h
  async (req, res) => {
    try {
      const { page = 1, limit = 20, search, city, specialty } = req.query;
      const skip = (page - 1) * limit;

      const where = {};
      if (search) where.user = { OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } }
      ]};
      if (city) where.user = { ...where.user, city };
      if (specialty) where.specialties = { has: specialty };

      const [professionals, total] = await Promise.all([
        prisma.professional.findMany({
          where,
          skip,
          take: limit,
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, city: true } },
            reviews: { select: { rating: true } }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.professional.count({ where })
      ]);

      const averageRatings = professionals.map(p => ({
        ...p,
        averageRating: p.reviews.length > 0
          ? (p.reviews.reduce((sum, r) => sum + r.rating, 0) / p.reviews.length).toFixed(1)
          : null,
        reviews: undefined
      }));

      res.json({
        data: averageRatings,
        pagination: { page: parseInt(page), limit: parseInt(limit), total }
      });
      // ✅ Response cached for 1h as: professionals:*:list:{query}
    } catch (err) {
      logger.error('Error fetching professionals', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/professionals/:id
// Get specific professional profile (cacheable)
router.get('/:id',
  optionalAuth(),
  cacheGet(), // Cache for 1h
  async (req, res) => {
    try {
      const professional = await prisma.professional.findUnique({
        where: { id: req.params.id },
        include: {
          user: {
            select: {
              id: true, firstName: true, lastName: true, email: true,
              phone: true, city: true, avatarUrl: true, verified: true
            }
          },
          reviews: {
            select: { id: true, rating: true, comment: true, createdAt: true, client: { select: { firstName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          portfolio: {
            select: { id: true, title: true, description: true, photos: true }
          }
        }
      });

      if (!professional) {
        return res.status(404).json({ error: 'Professionnel non trouvé' });
      }

      const averageRating = professional.reviews.length > 0
        ? (professional.reviews.reduce((sum, r) => sum + r.rating, 0) / professional.reviews.length).toFixed(1)
        : null;

      res.json({
        ...professional,
        averageRating,
        reviewCount: professional.reviews.length
      });
      // ✅ Response cached for 1h as: professional:{id}
    } catch (err) {
      logger.error('Error fetching professional', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ============ MUTATION ENDPOINTS (Invalidate Cache) ============

// PATCH /api/professionals/:id
// Update professional profile (invalidates caches)
router.patch('/:id',
  requireAuth(),
  cacheInvalidate(['professional:*']), // Clear all professional caches on success
  async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Non authentifié' });

      const { specialties, bio, hourlyRate, responseTime } = req.body;

      const professional = await prisma.professional.update({
        where: { id: req.params.id },
        data: {
          specialties: specialties || undefined,
          bio: bio || undefined,
          hourlyRate: hourlyRate || undefined,
          responseTime: responseTime || undefined
        },
        include: { user: true }
      });

      res.json({
        success: true,
        message: 'Profil mis à jour',
        data: professional
      });
      // ✅ Cache cleared on 2xx response
    } catch (err) {
      logger.error('Error updating professional', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

module.exports = router;
```

---

## 2. Project Search (Medium-Traffic Read with Complex Query)

**File**: `routes/projects.js` (update existing)

```javascript
// Inside routes/projects.js

const { cacheGet, cacheInvalidate } = require('../middleware/cacheMiddleware');

// GET /api/projects/search
// Search projects by location, type, etc. (30min cache)
router.get('/search',
  cacheGet(), // Cache search results for 30min
  async (req, res) => {
    try {
      const { city, type, budget_min, budget_max, search } = req.query;

      const where = {};
      if (city) where.city = city;
      if (type) where.category = type;
      if (budget_min || budget_max) {
        where.budget = {};
        if (budget_min) where.budget.gte = parseFloat(budget_min);
        if (budget_max) where.budget.lte = parseFloat(budget_max);
      }
      if (search) where.description = { contains: search, mode: 'insensitive' };

      const projects = await prisma.project.findMany({
        where,
        include: {
          client: { select: { firstName: true, city: true } },
          quotes: { select: { id: true, professional: { select: { user: { select: { firstName: true, avatarUrl: true } } } } } }
        },
        orderBy: { createdAt: 'desc' },
        take: 50
      });

      res.json({ data: projects });
      // ✅ Cached for 30min as: projects:search:{city}:{type}:{search}
    } catch (err) {
      logger.error('Error searching projects', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/projects/:id
// Get project details (30min cache)
router.get('/:id',
  cacheGet(),
  async (req, res) => {
    try {
      const project = await prisma.project.findUnique({
        where: { id: req.params.id },
        include: {
          photos: true,
          client: { select: { id: true, firstName: true, lastName: true, phone: true } },
          quotes: {
            include: {
              professional: {
                include: {
                  user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
                }
              }
            }
          }
        }
      });

      if (!project) {
        return res.status(404).json({ error: 'Projet non trouvé' });
      }

      res.json(project);
      // ✅ Cached for 30min as: projects:{id}
    } catch (err) {
      logger.error('Error fetching project', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// POST /api/projects
// Create new project (invalidates search cache)
router.post('/',
  requireAuth(),
  requireEmailVerified(),
  cacheInvalidate(['projects:search:*', 'projects:city:*']),
  async (req, res) => {
    try {
      const project = await prisma.project.create({
        data: {
          title: req.body.title,
          description: req.body.description,
          category: req.body.category,
          budget: req.body.budget,
          city: req.body.city,
          clientId: req.user.id
        }
      });

      res.json({ success: true, data: project });
      // ✅ Cache invalidated on success
    } catch (err) {
      logger.error('Error creating project', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// PATCH /api/projects/:id
// Update project (invalidates related caches)
router.patch('/:id',
  requireAuth(),
  cacheInvalidate(['projects:*', 'projects:search:*', 'quotes:*']),
  async (req, res) => {
    try {
      const project = await prisma.project.update({
        where: { id: req.params.id },
        data: {
          title: req.body.title,
          description: req.body.description,
          budget: req.body.budget
        }
      });

      res.json({ success: true, data: project });
      // ✅ Cache invalidated on success
    } catch (err) {
      logger.error('Error updating project', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// DELETE /api/projects/:id
// Delete project (invalidates search cache)
router.delete('/:id',
  requireAuth(),
  cacheInvalidate(['projects:*', 'projects:search:*', 'quotes:*']),
  async (req, res) => {
    try {
      await prisma.project.delete({ where: { id: req.params.id } });
      res.json({ success: true });
      // ✅ Cache invalidated on success
    } catch (err) {
      logger.error('Error deleting project', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);
```

---

## 3. Admin Analytics Dashboard (Heavy Computation → Needs Cache)

**File**: `routes/analytics.js` (update existing)

```javascript
const express = require('express');
const { cacheGet, cacheInvalidate } = require('../middleware/cacheMiddleware');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();

// Helper: Expensive analytics computation
async function computeDashboardStats() {
  // These queries are expensive, so they MUST be cached
  const [projectCount, professionalCount, activeUsers, revenue] = await Promise.all([
    prisma.project.count({ where: { status: 'ACTIVE' } }),
    prisma.professional.count(),
    prisma.user.count({ where: { lastLogin: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true }
    })
  ]);

  return {
    projects: { active: projectCount },
    professionals: { total: professionalCount },
    users: { activeLastWeek: activeUsers },
    revenue: { total: revenue._sum.amount || 0 }
  };
}

// GET /api/analytics/dashboard
// Main analytics dashboard (5min cache - heavy computation)
router.get('/dashboard',
  requireAuth(),
  requireSuperAdmin(),
  cacheGet(), // Cache for 5min (TTL: 300)
  async (req, res) => {
    try {
      const stats = await computeDashboardStats();
      res.json(stats);
      // ✅ Cached for 5min as: analytics:dashboard
    } catch (err) {
      logger.error('Error computing dashboard', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/analytics/professionals
// Professional statistics (5min cache)
router.get('/professionals',
  requireAuth(),
  requireSuperAdmin(),
  cacheGet(), // Cache for 5min
  async (req, res) => {
    try {
      const stats = {
        totalProfessionals: await prisma.professional.count(),
        activeThisMonth: await prisma.professional.count({
          where: {
            quotes: {
              some: {
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
              }
            }
          }
        }),
        topRated: await prisma.professional.findMany({
          take: 5,
          orderBy: { reviews: { _count: 'desc' } },
          include: { reviews: { select: { rating: true } } }
        })
      };

      res.json(stats);
      // ✅ Cached for 5min as: analytics:professionals
    } catch (err) {
      logger.error('Error computing professionals stats', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/analytics/projects
// Project statistics (5min cache)
router.get('/projects',
  requireAuth(),
  requireSuperAdmin(),
  cacheGet(), // Cache for 5min
  async (req, res) => {
    try {
      const stats = {
        totalProjects: await prisma.project.count(),
        completed: await prisma.project.count({ where: { status: 'COMPLETED' } }),
        pending: await prisma.project.count({ where: { status: 'PENDING' } }),
        byCity: await prisma.project.groupBy({
          by: ['city'],
          _count: true,
          orderBy: { _count: { city: 'desc' } }
        })
      };

      res.json(stats);
      // ✅ Cached for 5min as: analytics:projects
    } catch (err) {
      logger.error('Error computing projects stats', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// POST /api/analytics/refresh
// Force refresh analytics (admin only)
// No cache, triggers invalidation
router.post('/refresh',
  requireAuth(),
  requireSuperAdmin(),
  cacheInvalidate(['analytics:*', 'kpis:*', 'admin:dashboard:*']),
  async (req, res) => {
    try {
      logger.info('Analytics cache manually refreshed by admin');
      res.json({ success: true, message: 'Cache rafraîchi' });
      // ✅ Cache cleared on success
    } catch (err) {
      logger.error('Error refreshing analytics', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

module.exports = router;
```

---

## 4. KPIs Dashboard (Very Heavy Computation)

**File**: `routes/kpis-admin.js` (update existing)

```javascript
const express = require('express');
const { cacheGet, cacheInvalidate } = require('../middleware/cacheMiddleware');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const prisma = require('../config/db');
const logger = require('../utils/logger');

const router = express.Router();

// Very expensive computation - MUST cache for 5min
async function computeKPIs() {
  return {
    conversionRate: 0.034, // Complex calculation
    avgProjectValue: 2500, // Aggregation over months
    customerRetention: 0.72, // Churn analysis
    professionalResponseTime: 4.2, // Hours average
    completionRate: 0.89, // Percentage
    nps: 72, // Net Promoter Score
    topCategories: ['Plomberie', 'Électricité', 'Menuiserie']
  };
}

// GET /api/admin/kpis/overview
// KPIs overview (5min cache - very heavy)
router.get('/overview',
  requireAuth(),
  requireSuperAdmin(),
  cacheGet(), // Cache for 5min (TTL: 300)
  async (req, res) => {
    try {
      const kpis = await computeKPIs();
      res.json(kpis);
      // ✅ Cached for 5min as: kpis:overview
    } catch (err) {
      logger.error('Error computing KPIs', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// GET /api/admin/kpis/performance
// Performance metrics (5min cache)
router.get('/performance',
  requireAuth(),
  requireSuperAdmin(),
  cacheGet(), // Cache for 5min
  async (req, res) => {
    try {
      const performance = {
        uptime: 99.98,
        avgResponseTime: 145, // ms
        errorRate: 0.001,
        cacheHitRate: 0.72
      };

      res.json(performance);
      // ✅ Cached for 5min as: kpis:performance
    } catch (err) {
      logger.error('Error computing performance KPIs', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

module.exports = router;
```

---

## 5. User Profile (Sensitive - Minimal Cache)

**File**: `routes/users.js` (update existing)

```javascript
const { cacheGet, cacheInvalidate } = require('../middleware/cacheMiddleware');

// GET /api/users/me
// Current user profile (NOT cached - always fresh, sensitive)
router.get('/me',
  requireAuth(),
  async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true }
    });
    res.json(user);
    // ❌ NOT cached - always fresh for sensitive user data
  }
);

// GET /api/users/:id/public
// Public user profile (cacheable)
router.get('/:id/public',
  cacheGet(), // Cache for 1h
  async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, city: true }
    });
    res.json(user);
    // ✅ Cached for 1h as: user:{id}:public
  }
);

// PATCH /api/users/:id
// Update user profile (invalidates cache)
router.patch('/:id',
  requireAuth(),
  cacheInvalidate(['user:*']),
  async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { ...req.body }
    });
    res.json(user);
    // ✅ Cache cleared on success
  }
);
```

---

## Integration Checklist

After using these examples:

- [ ] `cacheGet()` added to all cacheable GET endpoints
- [ ] `cacheInvalidate([...patterns])` added to all mutation endpoints
- [ ] Appropriate cache TTLs confirmed for each resource type
- [ ] Cache patterns match the resource being modified
- [ ] Tests verify cache behavior (HIT/MISS headers)
- [ ] Production Redis configured and tested
- [ ] Cache health monitoring added to health endpoint
- [ ] Team trained on cache invalidation requirements

---

**Note**: Always test cache invalidation patterns carefully. A too-broad pattern will invalidate more than needed (performance). A too-narrow pattern will leave stale data (correctness).

**Example**: When updating a professional's specialty, clear `professional:*` not just `professional:{id}:specialty` to ensure search results are fresh.
