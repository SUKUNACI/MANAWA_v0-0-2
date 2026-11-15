'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const CALL_EXPIRY_MINUTES = 60;
const TERMINAL_STATUSES = new Set(['ENDED', 'MISSED']);

class VideoCallModule {
  constructor(prisma, createVideoRoom = null, deleteVideoRoom = null, sendPushNotification = null) {
    this.prisma = prisma;
    this.createVideoRoom = createVideoRoom;
    this.deleteVideoRoom = deleteVideoRoom;
    this.sendPushNotification = sendPushNotification;
  }

  async listActiveCalls(userId) {
    const activeCalls = await this.prisma.videoCall.findMany({
      where: {
        OR: [{ initiatorId: userId }, { participantId: userId }],
        endedAt: null,
      },
      include: {
        initiator: { select: { id: true, firstName: true, lastName: true, email: true } },
        participant: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      take: 10,
    });
    return { activeCalls, count: activeCalls.length };
  }

  async getActivePendingCalls(userId) {
    return this.prisma.videoCall.findMany({
      where: {
        OR: [{ initiatorId: userId }, { participantId: userId }],
        status: { in: ['PENDING', 'ACTIVE'] },
        expiresAt: { gt: new Date() },
      },
      include: {
        initiator: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        participant: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getHistory(userId, { page = 1, limit = 20 } = {}) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, limit);
    const userFilter = { OR: [{ initiatorId: userId }, { participantId: userId }] };

    const [calls, total] = await Promise.all([
      this.prisma.videoCall.findMany({
        where: userFilter,
        include: {
          initiator: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          participant: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
        skip: (safePage - 1) * safeLimit,
      }),
      this.prisma.videoCall.count({ where: userFilter }),
    ]);

    return {
      calls,
      pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    };
  }

  async initiateCall(initiatorId, { participantId, projectId } = {}) {
    if (!participantId) {
      throw Object.assign(new Error('participantId est requis'), { status: 400, code: 'MISSING_PARTICIPANT' });
    }
    if (participantId === initiatorId) {
      throw Object.assign(new Error('Vous ne pouvez pas appeler vous-meme'), { status: 400, code: 'CANNOT_CALL_SELF' });
    }

    const participant = await this.prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true, suspended: true, deletedAt: true },
    });
    if (!participant || participant.deletedAt) {
      throw Object.assign(new Error('Participant introuvable'), { status: 404, code: 'PARTICIPANT_NOT_FOUND' });
    }
    if (participant.suspended) {
      throw Object.assign(new Error('Ce compte est suspendu'), { status: 403, code: 'ACCOUNT_SUSPENDED' });
    }

    const roomName = 'mnw-' + uuidv4().replace(/-/g, '').substring(0, 8);
    const expiresAt = new Date(Date.now() + CALL_EXPIRY_MINUTES * 60 * 1000);

    const videoCall = await this.prisma.videoCall.create({
      data: {
        roomName,
        roomUrl: 'https://daily.co/' + roomName,
        initiatorId,
        participantId,
        status: 'PENDING',
        projectId: projectId || null,
        expiresAt,
      },
    });

    logger.info('[VideoCallModule] Call initiated', { initiatorId, participantId, callId: videoCall.id });
    return { callId: videoCall.id, roomUrl: videoCall.roomUrl, roomName, expiresAt };
  }

  async joinCall(callId, userId) {
    const videoCall = await this.prisma.videoCall.findUnique({ where: { id: callId } });
    if (!videoCall) throw Object.assign(new Error('Appel introuvable'), { status: 404, code: 'CALL_NOT_FOUND' });
    if (videoCall.participantId !== userId) {
      throw Object.assign(new Error('Vous n\'etes pas le participant'), { status: 403, code: 'ACCESS_DENIED' });
    }
    if (TERMINAL_STATUSES.has(videoCall.status)) {
      throw Object.assign(new Error('Cet appel est termine'), { status: 400, code: 'CALL_ENDED' });
    }
    if (new Date() > videoCall.expiresAt) {
      throw Object.assign(new Error('Cet appel a expire'), { status: 400, code: 'CALL_EXPIRED' });
    }

    const updated = await this.prisma.videoCall.update({
      where: { id: callId },
      data: { status: 'ACTIVE', startedAt: videoCall.startedAt || new Date() },
    });
    return { roomUrl: updated.roomUrl, callId: updated.id, status: updated.status };
  }

  async endCall(callId, userId) {
    const videoCall = await this.prisma.videoCall.findUnique({ where: { id: callId } });
    if (!videoCall) throw Object.assign(new Error('Appel introuvable'), { status: 404, code: 'CALL_NOT_FOUND' });
    if (videoCall.initiatorId !== userId && videoCall.participantId !== userId) {
      throw Object.assign(new Error('Vous ne participez pas a cet appel'), { status: 403, code: 'ACCESS_DENIED' });
    }
    if (videoCall.status === 'ENDED') {
      throw Object.assign(new Error('Cet appel est deja termine'), { status: 400, code: 'CALL_ALREADY_ENDED' });
    }

    await this.prisma.videoCall.update({
      where: { id: callId },
      data: { status: 'ENDED', endedAt: new Date() },
    });

    if (this.deleteVideoRoom) {
      this.deleteVideoRoom(videoCall.roomName).catch(
        err => logger.warn('[VideoCallModule] Room deletion failed', { error: err.message })
      );
    }

    logger.info('[VideoCallModule] Call ended', { callId, userId });
    return { success: true };
  }
}

module.exports = VideoCallModule;
