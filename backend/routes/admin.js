/**
 * Admin Routes
 * Main router for admin endpoints including bulk operations
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const bulkOperationsRoutes = require('./bulk-operations');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const { getConfig } = require('../utils/appConfig');

const router = express.Router();

// All admin routes require admin role
router.use(requireAuth, requireRole('ADMIN'));

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

// ============ PROFESSIONALS ============

router.get('/professionals', async (req, res) => {
  try {
    const professionals = await prisma.professional.findMany();
    res.json({ data: professionals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/professionals/:id', async (req, res) => {
  try {
    const professional = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!professional) return res.status(404).json({ error: 'Professionnel introuvable' });
    res.json({ professional });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/verify', async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    const data = {
      identityStatus: 'APPROVED',
      verifiedByAdmin: true,
    };
    // Set trial period only if not already set
    if (!pro.trialEndsAt) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 30);
      data.trialEndsAt = trialEnd;
    }

    const professional = await prisma.professional.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ professional });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/reject', async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    const professional = await prisma.professional.update({
      where: { id: req.params.id },
      data: {
        identityStatus: 'REJECTED',
        identityRejectionReason: req.body.reason || 'Document non conforme',
      },
    });
    res.json({ professional });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/verify-decennale', async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    const professional = await prisma.professional.update({
      where: { id: req.params.id },
      data: { decennaleVerified: true },
    });
    res.json({ professional });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/revoke-decennale', async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    const professional = await prisma.professional.update({
      where: { id: req.params.id },
      data: { decennaleVerified: false },
    });
    res.json({ professional });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/suspend', async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    await Promise.all([
      prisma.professional.update({ where: { id: req.params.id }, data: { suspendedAt: new Date() } }),
      prisma.user.update({ where: { id: pro.userId }, data: { suspended: true } }),
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/reactivate', async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    await Promise.all([
      prisma.professional.update({ where: { id: req.params.id }, data: { suspendedAt: null } }),
      prisma.user.update({ where: { id: pro.userId }, data: { suspended: false } }),
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/professionals/:id/complaint', async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    await prisma.professional.update({
      where: { id: req.params.id },
      data: { complaintsCount: { increment: 1 } },
    });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/professionals/:id/complaint', async (req, res) => {
  try {
    const pro = await prisma.professional.findUnique({ where: { id: req.params.id } });
    if (!pro) return res.status(404).json({ error: 'Professionnel introuvable' });

    await prisma.professional.update({
      where: { id: req.params.id },
      data: { complaintsCount: { decrement: 1 } },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ USERS ============

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const temporaryPassword = crypto.randomBytes(12).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash },
    });

    res.json({ temporaryPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ FINANCES ============

const DEFAULT_COMMISSION_RATE = 0.08;

router.get('/finances/summary', async (req, res) => {
  try {
    const commissionRate = (await getConfig('commission_rate')) ?? DEFAULT_COMMISSION_RATE;

    const payments = await prisma.payment.findMany({
      where: { status: 'succeeded', isDeposit: false },
    });

    const totalTransactions = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalCommissions = totalTransactions * commissionRate;
    const commissionsDuesAmount = payments
      .filter(p => !p.commissionPaid)
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    const commissionsPercuesAmount = payments
      .filter(p => p.commissionPaid)
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const commissionsDues = commissionsDuesAmount * commissionRate;
    const commissionsPercues = commissionsPercuesAmount * commissionRate;

    // Revenue by month — last 12 months keyed YYYY-MM
    const revenueByMonth = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      revenueByMonth[key] = 0;
    }
    payments.forEach(p => {
      const d = new Date(p.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in revenueByMonth) revenueByMonth[key] += p.amount || 0;
    });

    res.json({
      commissionRate,
      totalTransactions,
      totalCommissions,
      commissionsDues,
      commissionsPercues,
      revenueByMonth,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/finances/commissions', async (req, res) => {
  try {
    const commissionRate = (await getConfig('commission_rate')) ?? DEFAULT_COMMISSION_RATE;
    const { status, page = 1, limit = 20 } = req.query;

    const payments = await prisma.payment.findMany({
      where: { status: 'succeeded', isDeposit: false },
      include: {
        quote: {
          include: {
            professional: {
              include: { user: true },
            },
            project: true,
          },
        },
      },
    });

    // Group by professional
    const proMap = new Map();
    payments.forEach(p => {
      const pro = p.quote?.professional;
      if (!pro) return;
      const proId = pro.id;
      if (!proMap.has(proId)) {
        proMap.set(proId, {
          professionalId: proId,
          professional: pro,
          totalTransactions: 0,
          commissionDue: 0,
          commissionPaid: 0,
        });
      }
      const entry = proMap.get(proId);
      entry.totalTransactions += p.amount || 0;
      if (!p.commissionPaid) {
        entry.commissionDue += (p.amount || 0) * commissionRate;
      } else {
        entry.commissionPaid += (p.amount || 0) * commissionRate;
      }
    });

    let professionals = Array.from(proMap.values());

    // Filter
    if (status === 'due') professionals = professionals.filter(p => p.commissionDue > 0);
    if (status === 'paid') professionals = professionals.filter(p => p.commissionDue === 0);

    // Sort by commissionDue descending
    professionals.sort((a, b) => b.commissionDue - a.commissionDue);

    const total = professionals.length;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const totalPages = Math.ceil(total / limitNum);
    const paginated = professionals.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({ professionals: paginated, total, page: pageNum, limit: limitNum, totalPages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/finances/commissions/:professionalId/mark-paid', async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { commissionPaid: false },
    });
    await Promise.all(payments.map(p =>
      prisma.payment.update({ where: { id: p.id }, data: { commissionPaid: true } })
    ));
    res.json({ success: true, updated: payments.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/finances/payments', async (req, res) => {
  try {
    const payments = await prisma.payment.findMany();
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/finances/payments/stats', async (req, res) => {
  try {
    const agg = await prisma.payment.aggregate({ _sum: { amount: true }, _count: { id: true } });
    res.json({
      totalAmount: agg._sum?.amount ?? 0,
      totalCount: agg._count?.id ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ SUPPORT ============

router.get('/support/stats', async (req, res) => {
  try {
    const [total, open, inProgress, resolved, closed, byCategory, resolvedTickets] = await Promise.all([
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.supportTicket.count({ where: { status: 'RESOLVED' } }),
      prisma.supportTicket.count({ where: { status: 'CLOSED' } }),
      prisma.supportTicket.groupBy({ by: ['category'], _count: { _all: true } }),
      prisma.supportTicket.findMany({
        where: { status: { in: ['RESOLVED', 'CLOSED'] } },
        select: { createdAt: true, updatedAt: true },
      }),
    ]);

    const byCategoryMap = {};
    byCategory.forEach(item => { byCategoryMap[item.category] = item._count._all; });

    let avgResolutionHours = null;
    if (resolvedTickets.length > 0) {
      const totalHours = resolvedTickets.reduce((sum, t) => {
        const diff = new Date(t.updatedAt) - new Date(t.createdAt);
        return sum + diff / (1000 * 3600);
      }, 0);
      avgResolutionHours = Math.round(totalHours / resolvedTickets.length);
    }

    res.json({ total, open, inProgress, resolved, closed, byCategory: byCategoryMap, avgResolutionHours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/support/tickets', async (req, res) => {
  try {
    const { category, status, search } = req.query;
    const where = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const tickets = await prisma.supportTicket.findMany({ where });
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/support/tickets/:id/priority', async (req, res) => {
  try {
    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { priority: req.body.priority },
    });
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/support/tickets/:id/assign', async (req, res) => {
  try {
    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { assignedToAdminId: req.body.assignedToAdminId },
    });
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ MESSAGING ============

router.get('/messaging/stats', async (req, res) => {
  try {
    const [total, unread, topSendersRaw] = await Promise.all([
      prisma.message.count(),
      prisma.message.count({ where: { read: false } }).catch(() => 0),
      prisma.message.groupBy({ by: ['senderId'], _count: { _all: true } }),
    ]);

    const totalConversations = total;
    const activeConversations = unread;
    const topSenders = topSendersRaw.slice(0, 5).map(s => ({ id: s.senderId }));

    res.json({ total, unread, totalConversations, activeConversations, topSenders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/messaging/messages/:id', async (req, res) => {
  try {
    const message = await prisma.message.findUnique({ where: { id: req.params.id } });
    if (!message) return res.status(404).json({ error: 'Message introuvable' });

    await prisma.message.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PLACEHOLDER ============

router.get('/', (req, res) => {
  res.json({ message: 'Admin API', version: 'v1' });
});

module.exports = router;
