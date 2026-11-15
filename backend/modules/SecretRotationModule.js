const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { ROTATION_STATUS, ROTATION_TYPE, ROTATION_METHOD } = require('../config/ROTATION_SCHEDULE');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

class SecretRotationModule {
  static generateNewSecret(type = 'api_key') {
    const length = type === 'password' ? 32 : 48;
    const raw = crypto.randomBytes(length * 2).toString('base64');
    const result = raw.replace(/[^a-zA-Z0-9]/g, '').substring(0, length);
    if (result.length < length) {
      throw new Error(`Insufficient entropy: got ${result.length}, need ${length}`);
    }
    return result;
  }

  static hashSecret(secret) {
    const key = process.env.ROTATION_HASH_KEY;
    if (!key) throw new Error('ROTATION_HASH_KEY env var required');
    return crypto.createHmac('sha256', key).update(secret).digest('hex');
  }

  static async scheduleRotation(data) {
    const { secretName, secretType, rotationInterval, method = 'auto', metadata = {} } = data;

    const lastRotated = new Date();
    const nextRotation = new Date(lastRotated.getTime() + rotationInterval * 24 * 60 * 60 * 1000);

    return prisma.secretRotationSchedule.create({
      data: {
        secretName,
        secretType,
        rotationInterval,
        lastRotated,
        nextRotation,
        rotationMethod: method,
        enabled: true,
        metadata,
      },
    });
  }

  static async getRotationsDue() {
    return prisma.secretRotationSchedule.findMany({
      where: {
        enabled: true,
        nextRotation: {
          lte: new Date(),
        },
      },
      orderBy: { nextRotation: 'asc' },
    });
  }

  static async rotateSecret(secretName, rotatedBy = 'system') {
    try {
      const schedule = await prisma.secretRotationSchedule.findUnique({
        where: { secretName },
      });

      if (!schedule) {
        throw new Error(`Secret schedule not found: ${secretName}`);
      }

      const lastLog = await prisma.secretRotationLog.findFirst({
        where: { secretName, status: ROTATION_STATUS.SUCCESS },
        orderBy: { rotatedAt: 'desc' },
      });

      const oldHash = lastLog?.newHash ?? null;
      const newSecret = this.generateNewSecret(schedule.secretType);
      const newHash = this.hashSecret(newSecret);
      const now = new Date();
      const nextRotation = new Date(now.getTime() + schedule.rotationInterval * 24 * 60 * 60 * 1000);

      await prisma.$transaction(async (tx) => {
        await tx.secretRotationSchedule.update({
          where: { secretName },
          data: {
            lastRotated: now,
            nextRotation,
            updatedAt: now,
          },
        });

        await tx.secretRotationLog.create({
          data: {
            secretName,
            rotationType: ROTATION_TYPE.AUTOMATIC,
            oldHash: oldHash || 'initial',
            newHash,
            rotatedBy,
            status: ROTATION_STATUS.SUCCESS,
            metadata: {
              deploymentRequired: true,
              generatedAt: now.toISOString(),
            },
          },
        });
      });

      return {
        success: true,
        newSecret,
        message: 'Secret generated. DEPLOYMENT TO PROVIDER REQUIRED',
      };
    } catch (error) {
      try {
        await this.logRotation({
          secretName,
          rotationType: ROTATION_TYPE.AUTOMATIC,
          oldHash: 'unknown',
          newHash: 'unknown',
          rotatedBy,
          status: ROTATION_STATUS.FAILED,
          errorMessage: error.message,
        });
      } catch (logError) {
        console.error(`Failed to log error for ${secretName}:`, logError.message);
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Log a rotation event
   */
  static async logRotation(data) {
    const { secretName, rotationType, oldHash, newHash, rotatedBy, status, errorMessage, metadata } = data;

    return prisma.secretRotationLog.create({
      data: {
        secretName,
        rotationType,
        oldHash,
        newHash,
        rotatedBy: rotatedBy || 'system',
        status: status || ROTATION_STATUS.SUCCESS,
        errorMessage,
        metadata: metadata || {},
      },
    });
  }

  /**
   * Verify rotation by comparing hashes
   */
  static verifyRotation(oldSecret, newSecret, oldHash, newHash) {
    const calculatedOldHash = this.hashSecret(oldSecret);
    const calculatedNewHash = this.hashSecret(newSecret);

    return calculatedOldHash === oldHash && calculatedNewHash === newHash;
  }

  /**
   * Get rotation history for a secret
   */
  static async getRotationHistory(secretName, limit = 100) {
    return prisma.secretRotationLog.findMany({
      where: { secretName },
      orderBy: { rotatedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Check pending approvals
   */
  static async getPendingApprovals() {
    return prisma.secretRotationLog.findMany({
      where: {
        status: ROTATION_STATUS.PENDING_APPROVAL,
      },
      orderBy: { rotatedAt: 'asc' },
    });
  }

  /**
   * Approve or reject a pending rotation
   */
  static async handleApproval(logId, approved, approvedBy) {
    const status = approved ? ROTATION_STATUS.SUCCESS : ROTATION_STATUS.FAILED;
    const errorMessage = approved ? null : 'Rotation rejected by approver';

    return prisma.secretRotationLog.update({
      where: { id: logId },
      data: {
        status,
        errorMessage,
        metadata: {
          approvedBy,
          approvalTime: new Date().toISOString(),
        },
      },
    });
  }
}

module.exports = SecretRotationModule;
