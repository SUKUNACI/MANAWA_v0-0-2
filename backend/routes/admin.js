/**
 * Admin Routes
 * Main router for admin endpoints including bulk operations
 */

const express = require('express');
const bulkOperationsRoutes = require('./bulk-operations');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');

const router = express.Router();

// ============ ADMIN AUTHENTICATION ============

// All admin routes require admin role
router.use(requireAuth, requireRole('ADMIN'));

// ============ BULK OPERATIONS ============

// Mount bulk operations routes under /projects/bulk
router.use('/projects/bulk', bulkOperationsRoutes);

// ============ DASHBOARD KPIs ============

router.get('/dashboard', async (req, res) => {
  try {
    const [
      usersTotal,
      usersProfessionals,
      usersClients,
      projectsOpen,
      projectsInProgress,
      projectsDone,
      projectsCancelled,
      quotesTotal,
      paymentsTotal,
      paymentsAggregate,
      subscriptionsTotal,
      professionalsPending,
      promosActive,
      portfolioTotal,
      recentMessages,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'PROFESSIONAL' } }),
      prisma.user.count({ where: { role: 'CLIENT' } }),
      prisma.project.count({ where: { status: 'OPEN' } }),
      prisma.project.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.project.count({ where: { status: 'DONE' } }),
      prisma.project.count({ where: { status: 'CANCELLED' } }),
      prisma.quote.count(),
      prisma.payment.count(),
      prisma.payment.aggregate({ _sum: { amount: true } }),
      prisma.subscription.count(),
      prisma.professional.count({ where: { identityStatus: 'PENDING' } }),
      prisma.promoCode.count({ where: { isActive: true } }),
      prisma.portfolioProject.count(),
      prisma.message.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    const projectsTotal = projectsOpen + projectsInProgress + projectsDone + projectsCancelled;

    res.json({
      users: { total: usersTotal, professionals: usersProfessionals, clients: usersClients },
      projects: {
        total: projectsTotal,
        open: projectsOpen,
        inProgress: projectsInProgress,
        done: projectsDone,
        cancelled: projectsCancelled,
      },
      quotes: { total: quotesTotal },
      payments: {
        total: paymentsTotal,
        revenue: paymentsAggregate._sum?.amount ?? 0,
      },
      subscriptions: { total: subscriptionsTotal },
      promos: { active: promosActive },
      portfolio: { total: portfolioTotal },
      pendingVerifications: professionalsPending,
      recentMessages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PLACEHOLDER FOR OTHER ADMIN ROUTES ============

router.get('/', (req, res) => {
  res.json({
    message: 'Admin API',
    version: 'v1',
    endpoints: {
      bulk_create: 'POST /admin/projects/bulk',
      bulk_update: 'PATCH /admin/projects/bulk',
      bulk_delete: 'DELETE /admin/projects/bulk',
      dashboard: 'GET /admin/dashboard',
    },
  });
});

module.exports = router;
