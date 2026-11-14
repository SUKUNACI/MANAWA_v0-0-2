/**
 * Admin Routes
 * HTTP layer only — business logic delegated to AdminModule.
 */

const express = require('express');
const bulkOperationsRoutes = require('./bulk-operations');
const { requireAuth, requireRole } = require('../middleware/auth');
const prisma = require('../config/db');
const AdminModule = require('../modules/admin');

const router = express.Router();
const admin = new AdminModule(prisma);

// All admin routes require admin role
router.use(requireAuth, requireRole('ADMIN'));

// Mount bulk operations routes under /projects/bulk
router.use('/projects/bulk', bulkOperationsRoutes);

// ============ DASHBOARD KPIs ============

router.get('/dashboard', async (req, res) => {
  try {
    const data = await admin.getDashboard();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PROFESSIONALS ============

router.get('/professionals', async (req, res) => {
  try {
    const professionals = await admin.listProfessionals();
    res.json({ data: professionals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/professionals/:id', async (req, res) => {
  try {
    const professional = await admin.getProfessional(req.params.id);
    res.json({ professional });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/verify', async (req, res) => {
  try {
    const professional = await admin.verifyProfessional(req.params.id);
    res.json({ professional });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/reject', async (req, res) => {
  try {
    const professional = await admin.rejectProfessional(req.params.id, req.body.reason);
    res.json({ professional });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/verify-decennale', async (req, res) => {
  try {
    const professional = await admin.verifyDecennale(req.params.id);
    res.json({ professional });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/revoke-decennale', async (req, res) => {
  try {
    const professional = await admin.revokeDecennale(req.params.id);
    res.json({ professional });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/suspend', async (req, res) => {
  try {
    await admin.suspendProfessional(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/professionals/:id/reactivate', async (req, res) => {
  try {
    await admin.reactivateProfessional(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/professionals/:id/complaint', async (req, res) => {
  try {
    await admin.addComplaint(req.params.id);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/professionals/:id/complaint', async (req, res) => {
  try {
    await admin.removeComplaint(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ============ USERS ============

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const result = await admin.resetUserPassword(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ============ FINANCES ============

router.get('/finances/summary', async (req, res) => {
  try {
    const data = await admin.getFinanceSummary();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/finances/commissions', async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const data = await admin.listCommissions({ status, page, limit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/finances/commissions/:professionalId/mark-paid', async (req, res) => {
  try {
    const { updated } = await admin.markCommissionsPaid();
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Not yet covered by AdminModule — delegated directly to Prisma
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
    const data = await admin.getSupportStats();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/support/tickets', async (req, res) => {
  try {
    const { category, status, search } = req.query;
    const tickets = await admin.listSupportTickets({ category, status, search });
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/support/tickets/:id/priority', async (req, res) => {
  try {
    const ticket = await admin.updateTicketPriority(req.params.id, req.body.priority);
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/support/tickets/:id/assign', async (req, res) => {
  try {
    const ticket = await admin.assignTicket(req.params.id, req.body.assignedToAdminId);
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ MESSAGING ============

router.get('/messaging/stats', async (req, res) => {
  try {
    const data = await admin.getMessagingStats();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/messaging/messages/:id', async (req, res) => {
  try {
    await admin.deleteMessage(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ============ PLACEHOLDER ============

router.get('/', (req, res) => {
  res.json({ message: 'Admin API', version: 'v1' });
});

module.exports = router;
