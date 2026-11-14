'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Admin Module — Dashboard KPIs, professional management, finance, support, messaging
 */

const DEFAULT_COMMISSION_RATE = 0.08;

class AdminModule {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // ---- Dashboard ----

  async getDashboard() {
    try {
      const [
        usersTotal, usersProfessionals, usersClients,
        projectsOpen, projectsInProgress, projectsDone, projectsCancelled,
        quotesTotal, paymentsTotal, paymentsAggregate,
        subscriptionsTotal, professionalsPending,
        promosActive, portfolioTotal, recentMessages,
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { role: 'PROFESSIONAL' } }),
        this.prisma.user.count({ where: { role: 'CLIENT' } }),
        this.prisma.project.count({ where: { status: 'OPEN' } }),
        this.prisma.project.count({ where: { status: 'IN_PROGRESS' } }),
        this.prisma.project.count({ where: { status: 'DONE' } }),
        this.prisma.project.count({ where: { status: 'CANCELLED' } }),
        this.prisma.quote.count(),
        this.prisma.payment.count(),
        this.prisma.payment.aggregate({ _sum: { amount: true } }),
        this.prisma.subscription.count(),
        this.prisma.professional.count({ where: { identityStatus: 'PENDING' } }),
        this.prisma.promoCode.count({ where: { isActive: true } }),
        this.prisma.portfolioProject.count(),
        this.prisma.message.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      ]);

      const projectsTotal = projectsOpen + projectsInProgress + projectsDone + projectsCancelled;

      return {
        users: { total: usersTotal, professionals: usersProfessionals, clients: usersClients },
        projects: { total: projectsTotal, open: projectsOpen, inProgress: projectsInProgress, done: projectsDone, cancelled: projectsCancelled },
        quotes: { total: quotesTotal },
        payments: { total: paymentsTotal, revenue: paymentsAggregate._sum?.amount ?? 0 },
        subscriptions: { total: subscriptionsTotal },
        promos: { active: promosActive },
        portfolio: { total: portfolioTotal },
        pendingVerifications: professionalsPending,
        recentMessages,
      };
    } catch (err) {
      logger.error('[AdminModule] getDashboard failed', { error: err.message });
      throw err;
    }
  }

  // ---- Professionals ----

  async listProfessionals() {
    return this.prisma.professional.findMany();
  }

  async getProfessional(id) {
    const professional = await this.prisma.professional.findUnique({ where: { id } });
    if (!professional) throw Object.assign(new Error('Professionnel introuvable'), { status: 404 });
    return professional;
  }

  async verifyProfessional(id) {
    try {
      const pro = await this.getProfessional(id);
      const data = { identityStatus: 'APPROVED', verifiedByAdmin: true };

      if (!pro.trialEndsAt) {
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 30);
        data.trialEndsAt = trialEnd;
      }

      return this.prisma.professional.update({ where: { id }, data });
    } catch (err) {
      logger.error('[AdminModule] verifyProfessional failed', { id, error: err.message });
      throw err;
    }
  }

  async rejectProfessional(id, reason = 'Document non conforme') {
    try {
      await this.getProfessional(id);
      return this.prisma.professional.update({
        where: { id },
        data: { identityStatus: 'REJECTED', identityRejectionReason: reason },
      });
    } catch (err) {
      logger.error('[AdminModule] rejectProfessional failed', { id, error: err.message });
      throw err;
    }
  }

  async verifyDecennale(id) {
    await this.getProfessional(id);
    return this.prisma.professional.update({ where: { id }, data: { decennaleVerified: true } });
  }

  async revokeDecennale(id) {
    await this.getProfessional(id);
    return this.prisma.professional.update({ where: { id }, data: { decennaleVerified: false } });
  }

  async suspendProfessional(id) {
    try {
      const pro = await this.getProfessional(id);
      await Promise.all([
        this.prisma.professional.update({ where: { id }, data: { suspendedAt: new Date() } }),
        this.prisma.user.update({ where: { id: pro.userId }, data: { suspended: true } }),
      ]);
      logger.info('[AdminModule] Professional suspended', { id });
    } catch (err) {
      logger.error('[AdminModule] suspendProfessional failed', { id, error: err.message });
      throw err;
    }
  }

  async reactivateProfessional(id) {
    try {
      const pro = await this.getProfessional(id);
      await Promise.all([
        this.prisma.professional.update({ where: { id }, data: { suspendedAt: null } }),
        this.prisma.user.update({ where: { id: pro.userId }, data: { suspended: false } }),
      ]);
      logger.info('[AdminModule] Professional reactivated', { id });
    } catch (err) {
      logger.error('[AdminModule] reactivateProfessional failed', { id, error: err.message });
      throw err;
    }
  }

  async addComplaint(id) {
    await this.getProfessional(id);
    return this.prisma.professional.update({ where: { id }, data: { complaintsCount: { increment: 1 } } });
  }

  async removeComplaint(id) {
    await this.getProfessional(id);
    return this.prisma.professional.update({ where: { id }, data: { complaintsCount: { decrement: 1 } } });
  }

  // ---- Users ----

  async resetUserPassword(userId) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });

      const temporaryPassword = crypto.randomBytes(12).toString('hex');
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);
      await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

      logger.info('[AdminModule] Password reset', { userId });
      return { temporaryPassword };
    } catch (err) {
      logger.error('[AdminModule] resetUserPassword failed', { userId, error: err.message });
      throw err;
    }
  }

  // ---- Finances ----

  async getFinanceSummary() {
    try {
      const { getConfig } = require('../utils/appConfig');
      const commissionRate = (await getConfig('commission_rate')) ?? DEFAULT_COMMISSION_RATE;
      const payments = await this.prisma.payment.findMany({ where: { status: 'succeeded', isDeposit: false } });

      const totalTransactions = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const totalCommissions = totalTransactions * commissionRate;
      const commissionsDuesAmount = payments.filter(p => !p.commissionPaid).reduce((sum, p) => sum + (p.amount || 0), 0);
      const commissionsPercuesAmount = payments.filter(p => p.commissionPaid).reduce((sum, p) => sum + (p.amount || 0), 0);

      const revenueByMonth = this._buildRevenueByMonth(payments);

      return {
        commissionRate,
        totalTransactions,
        totalCommissions,
        commissionsDues: commissionsDuesAmount * commissionRate,
        commissionsPercues: commissionsPercuesAmount * commissionRate,
        revenueByMonth,
      };
    } catch (err) {
      logger.error('[AdminModule] getFinanceSummary failed', { error: err.message });
      throw err;
    }
  }

  _buildRevenueByMonth(payments) {
    const now = new Date();
    const revenueByMonth = {};
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
    return revenueByMonth;
  }

  async listCommissions({ status, page = 1, limit = 20 } = {}) {
    try {
      const { getConfig } = require('../utils/appConfig');
      const commissionRate = (await getConfig('commission_rate')) ?? DEFAULT_COMMISSION_RATE;

      const payments = await this.prisma.payment.findMany({
        where: { status: 'succeeded', isDeposit: false },
        include: {
          quote: {
            include: { professional: { include: { user: true } }, project: true },
          },
        },
      });

      const proMap = new Map();
      payments.forEach(p => {
        const pro = p.quote?.professional;
        if (!pro) return;
        if (!proMap.has(pro.id)) {
          proMap.set(pro.id, { professionalId: pro.id, professional: pro, totalTransactions: 0, commissionDue: 0, commissionPaid: 0 });
        }
        const entry = proMap.get(pro.id);
        entry.totalTransactions += p.amount || 0;
        if (!p.commissionPaid) {
          entry.commissionDue += (p.amount || 0) * commissionRate;
        } else {
          entry.commissionPaid += (p.amount || 0) * commissionRate;
        }
      });

      let professionals = Array.from(proMap.values());
      if (status === 'due') professionals = professionals.filter(p => p.commissionDue > 0);
      if (status === 'paid') professionals = professionals.filter(p => p.commissionDue === 0);
      professionals.sort((a, b) => b.commissionDue - a.commissionDue);

      const total = professionals.length;
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const paginated = professionals.slice((pageNum - 1) * limitNum, pageNum * limitNum);

      return { professionals: paginated, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) };
    } catch (err) {
      logger.error('[AdminModule] listCommissions failed', { error: err.message });
      throw err;
    }
  }

  async markCommissionsPaid() {
    try {
      const payments = await this.prisma.payment.findMany({ where: { commissionPaid: false } });
      await Promise.all(payments.map(p =>
        this.prisma.payment.update({ where: { id: p.id }, data: { commissionPaid: true } })
      ));
      return { updated: payments.length };
    } catch (err) {
      logger.error('[AdminModule] markCommissionsPaid failed', { error: err.message });
      throw err;
    }
  }

  // ---- Support ----

  async getSupportStats() {
    try {
      const [total, open, inProgress, resolved, closed, byCategory, resolvedTickets] = await Promise.all([
        this.prisma.supportTicket.count(),
        this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
        this.prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
        this.prisma.supportTicket.count({ where: { status: 'RESOLVED' } }),
        this.prisma.supportTicket.count({ where: { status: 'CLOSED' } }),
        this.prisma.supportTicket.groupBy({ by: ['category'], _count: { _all: true } }),
        this.prisma.supportTicket.findMany({
          where: { status: { in: ['RESOLVED', 'CLOSED'] } },
          select: { createdAt: true, updatedAt: true },
        }),
      ]);

      const byCategoryMap = {};
      byCategory.forEach(item => { byCategoryMap[item.category] = item._count._all; });

      let avgResolutionHours = null;
      if (resolvedTickets.length > 0) {
        const totalHours = resolvedTickets.reduce((sum, t) => {
          return sum + (new Date(t.updatedAt) - new Date(t.createdAt)) / (1000 * 3600);
        }, 0);
        avgResolutionHours = Math.round(totalHours / resolvedTickets.length);
      }

      return { total, open, inProgress, resolved, closed, byCategory: byCategoryMap, avgResolutionHours };
    } catch (err) {
      logger.error('[AdminModule] getSupportStats failed', { error: err.message });
      throw err;
    }
  }

  async listSupportTickets({ category, status, search } = {}) {
    const where = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.supportTicket.findMany({ where });
  }

  async updateTicketPriority(id, priority) {
    return this.prisma.supportTicket.update({ where: { id }, data: { priority } });
  }

  async assignTicket(id, assignedToAdminId) {
    return this.prisma.supportTicket.update({ where: { id }, data: { assignedToAdminId } });
  }

  // ---- Messaging ----

  async getMessagingStats() {
    try {
      const [total, unread, topSendersRaw] = await Promise.all([
        this.prisma.message.count(),
        this.prisma.message.count({ where: { read: false } }).catch(() => 0),
        this.prisma.message.groupBy({ by: ['senderId'], _count: { _all: true } }),
      ]);
      const topSenders = topSendersRaw.slice(0, 5).map(s => ({ id: s.senderId }));
      return { total, unread, totalConversations: total, activeConversations: unread, topSenders };
    } catch (err) {
      logger.error('[AdminModule] getMessagingStats failed', { error: err.message });
      throw err;
    }
  }

  async deleteMessage(id) {
    const message = await this.prisma.message.findUnique({ where: { id } });
    if (!message) throw Object.assign(new Error('Message introuvable'), { status: 404 });
    await this.prisma.message.delete({ where: { id } });
  }
}

module.exports = AdminModule;
