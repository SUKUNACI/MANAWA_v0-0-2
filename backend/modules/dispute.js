'use strict';

const logger = require('../utils/logger');

/**
 * DisputeModule — Dispute lifecycle and eligibility management
 */

const DISPUTE_STATUSES = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
  REFUNDED: 'REFUNDED',
};

class DisputeModule {
  constructor(prisma, sendPushNotification = null) {
    this.prisma = prisma;
    this.sendPushNotification = sendPushNotification;
  }

  async open({ paymentId, reason, description, clientId }) {
    if (!paymentId || !reason || !clientId) {
      throw Object.assign(new Error('paymentId, reason et clientId sont requis'), { status: 400, code: 'MISSING_FIELDS' });
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { professional: { select: { userId: true } } } } },
    });

    if (!payment) throw Object.assign(new Error('Paiement introuvable'), { status: 404, code: 'PAYMENT_NOT_FOUND' });
    if (payment.status !== 'COMPLETED') {
      throw Object.assign(new Error('Seuls les paiements confirmés peuvent être contestés'), { status: 400, code: 'INVALID_PAYMENT_STATUS' });
    }

    const daysSincePayment = Math.floor((Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSincePayment > 90) {
      throw Object.assign(new Error('Délai de contestation de 90 jours dépassé'), { status: 400, code: 'DISPUTE_WINDOW_EXPIRED' });
    }

    const existingDispute = await this.prisma.dispute.findFirst({
      where: { paymentId, status: { not: 'REJECTED' } },
    });
    if (existingDispute) {
      throw Object.assign(new Error('Une contestation existe déjà pour ce paiement'), { status: 400, code: 'DISPUTE_EXISTS' });
    }

    const dispute = await this.prisma.dispute.create({
      data: {
        paymentId,
        clientId,
        reason,
        description: description || null,
        status: DISPUTE_STATUSES.OPEN,
      },
      include: { payment: { include: { booking: true } } },
    });

    this._notifyProfessional(payment.booking.professional.userId, paymentId).catch(
      err => logger.warn('[DisputeModule] Push notification failed', { disputeId: dispute.id, error: err.message })
    );

    logger.info('[DisputeModule] Dispute opened', { clientId, paymentId, disputeId: dispute.id });
    return dispute;
  }

  async listForClient(clientId) {
    return this.prisma.dispute.findMany({
      where: { clientId },
      include: { payment: { include: { booking: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDetail(disputeId, userId, role) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        payment: { include: { booking: { include: { professional: { select: { userId: true, firstName: true, lastName: true } } } } } },
        client: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!dispute) throw Object.assign(new Error('Contestation introuvable'), { status: 404, code: 'DISPUTE_NOT_FOUND' });

    const isClient = dispute.clientId === userId;
    const isPro = dispute.payment.booking.professional.userId === userId;
    const isAdmin = role === 'ADMIN';

    if (!isClient && !isPro && !isAdmin) {
      throw Object.assign(new Error('Accès refusé'), { status: 403, code: 'ACCESS_DENIED' });
    }

    return dispute;
  }

  getStatuses() {
    return DISPUTE_STATUSES;
  }

  async _notifyProfessional(professionalUserId, paymentId) {
    if (!this.sendPushNotification) return;
    await this.sendPushNotification(
      professionalUserId,
      '⚠️ Contestation de paiement',
      'Un client a contesté un de vos paiements. Vérifiez les détails.',
      { type: 'dispute', paymentId }
    );
  }
}

module.exports = DisputeModule;
