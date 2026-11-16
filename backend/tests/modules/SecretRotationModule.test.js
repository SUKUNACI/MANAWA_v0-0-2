const crypto = require('crypto');
const SecretRotationModule = require('../../modules/SecretRotationModule');
const { PrismaClient } = require('@prisma/client');
const { ROTATION_CONFIG, ROTATION_STATUS, ROTATION_TYPE } = require('../../config/ROTATION_SCHEDULE');


// Use shared Prisma instance from SecretRotationModule
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

describe('SecretRotationModule', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('generateNewSecret', () => {
    test('should generate a secure random secret', () => {
      const secret = SecretRotationModule.generateNewSecret('api_key');
      expect(secret).toBeDefined();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(20);
    });

    test('should generate different secrets on each call', () => {
      const secret1 = SecretRotationModule.generateNewSecret('api_key');
      const secret2 = SecretRotationModule.generateNewSecret('api_key');
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('hashSecret', () => {
    test('should hash a secret consistently', () => {
      const secret = 'test_secret_12345';
      const hash1 = SecretRotationModule.hashSecret(secret);
      const hash2 = SecretRotationModule.hashSecret(secret);
      expect(hash1).toBe(hash2);
    });

    test('should hash different secrets differently', () => {
      const hash1 = SecretRotationModule.hashSecret('secret1');
      const hash2 = SecretRotationModule.hashSecret('secret2');
      expect(hash1).not.toBe(hash2);
    });

    test('should return a valid SHA256 hash', () => {
      const secret = 'test_secret';
      const hash = SecretRotationModule.hashSecret(secret);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('scheduleRotation', () => {
    test('should create a rotation schedule in DB', async () => {
      const secretName = `TEST_SECRET_${Date.now()}`;
      const result = await SecretRotationModule.scheduleRotation({
        secretName,
        secretType: 'api_key',
        rotationInterval: 90,
        method: 'auto',
      });

      expect(result.secretName).toBe(secretName);
      expect(result.rotationInterval).toBe(90);
      expect(result.enabled).toBe(true);

      await prisma.secretRotationSchedule.delete({ where: { secretName } });
    });

    test('should calculate nextRotation correctly', async () => {
      const secretName = `TEST_SECRET_${Date.now()}`;
      const result = await SecretRotationModule.scheduleRotation({
        secretName,
        secretType: 'token',
        rotationInterval: 30,
        method: 'manual',
      });

      const expectedNextRotation = new Date(result.lastRotated.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(result.nextRotation).toEqual(expectedNextRotation);

      await prisma.secretRotationSchedule.delete({ where: { secretName } });
    });
  });

  describe('getRotationsDue', () => {
    test('should return secrets that are due for rotation', async () => {
      const secretName = `DUE_SECRET_${Date.now()}`;
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      await prisma.secretRotationSchedule.create({
        data: {
          secretName,
          secretType: 'api_key',
          rotationInterval: 90,
          lastRotated: pastDate,
          nextRotation: pastDate,
          enabled: true,
          rotationMethod: 'auto',
        },
      });

      const due = await SecretRotationModule.getRotationsDue();
      const found = due.find((s) => s.secretName === secretName);
      expect(found).toBeDefined();

      await prisma.secretRotationSchedule.delete({ where: { secretName } });
    });

    test('should only return enabled rotations', async () => {
      const secretName = `DISABLED_SECRET_${Date.now()}`;
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      await prisma.secretRotationSchedule.create({
        data: {
          secretName,
          secretType: 'api_key',
          rotationInterval: 90,
          lastRotated: pastDate,
          nextRotation: pastDate,
          enabled: false,
          rotationMethod: 'auto',
        },
      });

      const due = await SecretRotationModule.getRotationsDue();
      const found = due.find((s) => s.secretName === secretName);
      expect(found).toBeUndefined();

      await prisma.secretRotationSchedule.delete({ where: { secretName } });
    });
  });

  describe('rotateSecret', () => {
    test('should rotate a secret and update the schedule', async () => {
      const secretName = `ROTATE_SECRET_${Date.now()}`;

      await prisma.secretRotationSchedule.create({
        data: {
          secretName,
          secretType: 'api_key',
          rotationInterval: 90,
          lastRotated: new Date(),
          nextRotation: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          enabled: true,
          rotationMethod: 'auto',
        },
      });

      const result = await SecretRotationModule.rotateSecret(secretName, 'test_user_123');
      expect(result.success).toBe(true);
      expect(result.newSecret).toBeDefined();
      expect(result.oldHash).toBeDefined();
      expect(result.newHash).toBeDefined();

      const updated = await prisma.secretRotationSchedule.findUnique({
        where: { secretName },
      });
      expect(updated.lastRotated.getTime()).toBeGreaterThanOrEqual(Date.now() - 5000);

      await prisma.secretRotationSchedule.delete({ where: { secretName } });
      await prisma.secretRotationLog.deleteMany({ where: { secretName } });
    });
  });

  describe('logRotation', () => {
    test('should log a rotation attempt', async () => {
      const secretName = `LOG_SECRET_${Date.now()}`;
      const oldHash = SecretRotationModule.hashSecret('old_secret');
      const newHash = SecretRotationModule.hashSecret('new_secret');

      const result = await SecretRotationModule.logRotation({
        secretName,
        rotationType: ROTATION_TYPE.MANUAL,
        oldHash,
        newHash,
        rotatedBy: 'admin_user',
        status: ROTATION_STATUS.SUCCESS,
      });

      expect(result.secretName).toBe(secretName);
      expect(result.status).toBe(ROTATION_STATUS.SUCCESS);
      expect(result.oldHash).toBe(oldHash);

      await prisma.secretRotationLog.delete({ where: { id: result.id } });
    });

    test('should log errors', async () => {
      const secretName = `ERROR_LOG_SECRET_${Date.now()}`;

      const result = await SecretRotationModule.logRotation({
        secretName,
        rotationType: ROTATION_TYPE.AUTOMATIC,
        oldHash: 'old_hash',
        newHash: 'new_hash',
        status: ROTATION_STATUS.FAILED,
        errorMessage: 'API connection failed',
      });

      expect(result.status).toBe(ROTATION_STATUS.FAILED);
      expect(result.errorMessage).toBe('API connection failed');

      await prisma.secretRotationLog.delete({ where: { id: result.id } });
    });
  });

  describe('verifyRotation', () => {
    test('should verify a successful rotation by comparing hashes', () => {
      const oldSecret = 'old_secret_value';
      const newSecret = 'new_secret_value';
      const oldHash = SecretRotationModule.hashSecret(oldSecret);
      const newHash = SecretRotationModule.hashSecret(newSecret);

      const isValid = SecretRotationModule.verifyRotation(oldSecret, newSecret, oldHash, newHash);
      expect(isValid).toBe(true);
    });

    test('should fail verification if hashes dont match', () => {
      const oldSecret = 'old_secret_value';
      const newSecret = 'new_secret_value';
      const oldHash = SecretRotationModule.hashSecret('wrong_old_secret');
      const newHash = SecretRotationModule.hashSecret(newSecret);

      const isValid = SecretRotationModule.verifyRotation(oldSecret, newSecret, oldHash, newHash);
      expect(isValid).toBe(false);
    });
  });

  describe('getRotationHistory', () => {
    test('should retrieve rotation history for a secret', async () => {
      const secretName = `HISTORY_SECRET_${Date.now()}`;

      for (let i = 0; i < 3; i++) {
        await prisma.secretRotationLog.create({
          data: {
            secretName,
            rotationType: ROTATION_TYPE.MANUAL,
            oldHash: `old_hash_${i}`,
            newHash: `new_hash_${i}`,
            status: ROTATION_STATUS.SUCCESS,
          },
        });
      }

      const history = await SecretRotationModule.getRotationHistory(secretName);
      expect(history.length).toBe(3);
      expect(history[0].secretName).toBe(secretName);

      await prisma.secretRotationLog.deleteMany({ where: { secretName } });
    });

    test('should return empty array for secret with no history', async () => {
      const history = await SecretRotationModule.getRotationHistory('NONEXISTENT_SECRET');
      expect(history).toEqual([]);
    });
  });
});
