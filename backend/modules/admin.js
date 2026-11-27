'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { DEFAULT_COMMISSION_RATE } = require('../config/commission');

/**
 * Admin Module — Dashboard KPIs, professional management, finance, support, messaging
 */

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
        const now = new Date();
        const trialEnd = new Date(now);
        trialEnd.setDate(trialEnd.getDate() + 14);
        data.trialStartedAt = now;
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

  /**
   * Initiate a secure admin-triggered password reset (D1=Option B, D2=yes, D3=fail-closed).
   * Generates a cryptographically secure token, stores only its SHA-256 hash, sends a
   * one-time reset link to the user's email, and sets mustChangePassword=true.
   * Never returns a password or token in the HTTP response.
   * Throws HTTP 503 if email delivery fails (D3), cleaning up any stored token.
   *
   * @param {string} userId
   * @param {object} mailer - { send, isConfigured } from config/mailer
   * @returns {Promise<{ initiated: true }>}
   */
  async resetUserPassword(userId, mailer) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true },
    });
    if (!user) throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });

    // D3: reject immediately if mailer is not configured — no silent partial success
    if (!mailer.isConfigured) {
      throw Object.assign(
        new Error("Service email non disponible — réinitialisation impossible"),
        { status: 503, code: 'EMAIL_SERVICE_UNAVAILABLE' }
      );
    }

    // Generate a 48-byte (96 hex chars) cryptographically secure raw token
    const rawToken = crypto.randomBytes(48).toString('hex');
    // Store only the SHA-256 hash — raw token never persisted
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    // 2-hour TTL, coherent with the project's existing OTP conventions
    const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000);

    // Write hash + expiry + mustChangePassword atomically
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetCode: tokenHash,
        passwordResetExpiry: expiry,
        mustChangePassword: true,
      },
    });

    // Build reset link — raw token is only ever sent via email
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetLink = `${baseUrl}/reset-password?token=${rawToken}&userId=${userId}`;

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0A0D14;color:#fff;border-radius:12px;">
        <h2 style="color:#F97316;margin-bottom:8px;">MANAWA</h2>
        <p style="color:#9CA3AF;margin-bottom:24px;">Réinitialisation de votre mot de passe</p>
        <div style="background:#1A1F2E;border-radius:10px;padding:24px;margin-bottom:24px;">
          <p style="color:#9CA3AF;font-size:14px;margin-bottom:16px;">
            Un administrateur MANAWA a demandé une réinitialisation de votre mot de passe.
          </p>
          <a href="${resetLink}" style="display:inline-block;background:#F97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Définir mon nouveau mot de passe
          </a>
        </div>
        <p style="color:#9CA3AF;font-size:13px;">Ce lien expire dans <strong style="color:#fff;">2 heures</strong> et ne peut être utilisé qu'une seule fois.</p>
        <p style="color:#6B7280;font-size:12px;margin-top:24px;">Si vous n'attendiez pas cet email, contactez l'équipe support MANAWA immédiatement.</p>
      </div>`;

    const text = `Un administrateur MANAWA a demandé une réinitialisation de votre mot de passe.\n\nCliquez sur ce lien pour définir votre nouveau mot de passe :\n${resetLink}\n\nCe lien expire dans 2 heures et ne peut être utilisé qu'une seule fois.`;

    let emailResult;
    try {
      emailResult = await mailer.send({
        to: user.email,
        subject: 'Réinitialisation de votre mot de passe — MANAWA',
        html,
        text,
      });
    } catch (emailErr) {
      // D3: rollback the token and mustChangePassword on email failure
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordResetCode: null, passwordResetExpiry: null, mustChangePassword: false },
      }).then(
        () => logger.info('[AdminModule] resetUserPassword email failed — rollback succeeded', { userId }),
        (rbErr) => logger.error('[AdminModule] resetUserPassword email failed — ROLLBACK FAILED — token may still be active', { userId, rollbackError: rbErr.message })
      );
      throw Object.assign(
        new Error("Service email indisponible — réinitialisation annulée"),
        { status: 503, code: 'EMAIL_SERVICE_UNAVAILABLE' }
      );
    }

    // D3: treat sent:false (non-throw path, e.g. circuit-open) as failure too
    if (!emailResult?.sent) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordResetCode: null, passwordResetExpiry: null, mustChangePassword: false },
      }).then(
        () => logger.info('[AdminModule] resetUserPassword email not sent — rollback succeeded', { userId }),
        (rbErr) => logger.error('[AdminModule] resetUserPassword email not sent — ROLLBACK FAILED — token may still be active', { userId, rollbackError: rbErr.message })
      );
      throw Object.assign(
        new Error("Service email indisponible — réinitialisation annulée"),
        { status: 503, code: 'EMAIL_SERVICE_UNAVAILABLE' }
      );
    }

    logger.info('[AdminModule] Password reset link sent', { userId });
    return { initiated: true };
  }

  /**
   * Complete an admin-triggered password reset using the raw one-time token.
   * Validates token hash, expiry, password strength, sets new hash,
   * clears mustChangePassword and all refresh tokens (session invalidation).
   *
   * @param {string} userId
   * @param {string} rawToken - the token from the reset link
   * @param {string} newPassword
   * @returns {Promise<{ reset: true }>}
   */
  async completePasswordReset(userId, rawToken, newPassword) {
    if (!newPassword || newPassword.length < 8) {
      throw Object.assign(new Error('Le mot de passe doit faire au moins 8 caractères'), { status: 400 });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, passwordResetCode: true, passwordResetExpiry: true,
        passwordHash: true, mustChangePassword: true,
      },
    });

    if (!user || !user.passwordResetCode) {
      throw Object.assign(new Error('Lien de réinitialisation invalide'), { status: 400, code: 'RESET_TOKEN_INVALID' });
    }

    if (new Date() > user.passwordResetExpiry) {
      throw Object.assign(new Error('Lien expiré — demandez une nouvelle réinitialisation'), { status: 400, code: 'RESET_TOKEN_EXPIRED' });
    }

    const incomingHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    // Constant-time comparison to prevent timing attacks
    const storedHashBuf = Buffer.from(user.passwordResetCode, 'hex');
    const incomingHashBuf = Buffer.from(incomingHash, 'hex');
    const tokenValid =
      storedHashBuf.length === incomingHashBuf.length &&
      crypto.timingSafeEqual(storedHashBuf, incomingHashBuf);

    if (!tokenValid) {
      throw Object.assign(new Error('Lien de réinitialisation invalide'), { status: 400, code: 'RESET_TOKEN_INVALID' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw Object.assign(new Error("Le nouveau mot de passe doit être différent de l'ancien"), { status: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date();

    // Single transaction: atomically consume token + update password + invalidate sessions.
    // The WHERE clause on passwordResetCode prevents TOCTOU (concurrent request finds 0 rows).
    // The WHERE clause on passwordResetExpiry re-checks expiry at write time, not just at read.
    // deleteMany inside the same transaction ensures sessions are wiped iff the UPDATE succeeds.
    const [updateResult] = await this.prisma.$transaction([
      this.prisma.$queryRaw`
        UPDATE "User"
        SET "passwordHash"        = ${passwordHash},
            "passwordResetCode"   = NULL,
            "passwordResetExpiry" = NULL,
            "mustChangePassword"  = false
        WHERE id = ${userId}
          AND "passwordResetCode"   = ${user.passwordResetCode}
          AND "passwordResetExpiry" > ${now}
        RETURNING id
      `,
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    if (!updateResult || updateResult.length === 0) {
      throw Object.assign(
        new Error('Lien de réinitialisation expiré ou déjà utilisé'),
        { status: 400, code: 'RESET_TOKEN_INVALID' }
      );
    }

    logger.info('[AdminModule] Password reset completed', { userId });
    return { reset: true };
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
