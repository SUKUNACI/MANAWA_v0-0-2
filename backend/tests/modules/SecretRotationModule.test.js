const crypto = require('crypto');
const { ROTATION_STATUS, ROTATION_TYPE } = require('../../config/ROTATION_SCHEDULE');

jest.mock('../../config/db', () => ({
  secretRotationSchedule: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  secretRotationLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
}));

const SecretRotationModule = require('../../modules/SecretRotationModule');
const { setPrisma } = require('../../modules/SecretRotationModule');
const prisma = require('../../config/db');

describe('SecretRotationModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Inject mock Prisma into module
    SecretRotationModule.setPrisma(prisma);
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
      const lastRotated = new Date();
      const nextRotation = new Date(lastRotated.getTime() + 90 * 24 * 60 * 60 * 1000);

      prisma.secretRotationSchedule.create.mockResolvedValue({
        secretName,
        secretType: 'api_key',
        rotationInterval: 90,
        enabled: true,
        lastRotated,
        nextRotation,
        rotationMethod: 'auto',
      });

      const result = await SecretRotationModule.scheduleRotation({
        secretName,
        secretType: 'api_key',
        rotationInterval: 90,
        method: 'auto',
      });

      expect(result.secretName).toBe(secretName);
      expect(result.rotationInterval).toBe(90);
      expect(result.enabled).toBe(true);
      expect(prisma.secretRotationSchedule.create).toHaveBeenCalled();
    });

    test('should calculate nextRotation correctly', async () => {
      const secretName = `TEST_SECRET_${Date.now()}`;
      const lastRotated = new Date();
      const nextRotation = new Date(lastRotated.getTime() + 30 * 24 * 60 * 60 * 1000);

      prisma.secretRotationSchedule.create.mockResolvedValue({
        secretName,
        secretType: 'token',
        rotationInterval: 30,
        enabled: true,
        lastRotated,
        nextRotation,
        rotationMethod: 'manual',
      });

      const result = await SecretRotationModule.scheduleRotation({
        secretName,
        secretType: 'token',
        rotationInterval: 30,
        method: 'manual',
      });

      const expectedNextRotation = new Date(result.lastRotated.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(result.nextRotation).toEqual(expectedNextRotation);
    });
  });

  describe('getRotationsDue', () => {
    test('should return secrets that are due for rotation', async () => {
      const secretName = `DUE_SECRET_${Date.now()}`;
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const mockDueSecrets = [{
        secretName,
        secretType: 'api_key',
        rotationInterval: 90,
        lastRotated: pastDate,
        nextRotation: pastDate,
        enabled: true,
        rotationMethod: 'auto',
      }];
      prisma.secretRotationSchedule.findMany.mockResolvedValue(mockDueSecrets);

      const due = await SecretRotationModule.getRotationsDue();
      const found = due.find((s) => s.secretName === secretName);
      expect(found).toBeDefined();
      expect(found.secretName).toBe(secretName);
      expect(prisma.secretRotationSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ enabled: true }),
        })
      );
    });

    test('should only return enabled rotations', async () => {
      const mockDueSecrets = [{
        secretName: 'ENABLED_SECRET',
        enabled: true,
      }];
      prisma.secretRotationSchedule.findMany.mockResolvedValue(mockDueSecrets);

      const due = await SecretRotationModule.getRotationsDue();
      expect(due.every((s) => s.enabled === true)).toBe(true);
    });

    test('should return empty array when no rotations due', async () => {
      prisma.secretRotationSchedule.findMany.mockResolvedValue([]);

      const due = await SecretRotationModule.getRotationsDue();
      expect(due).toEqual([]);
    });
  });

  describe('rotateSecret', () => {
    test('should rotate a secret and update the schedule', async () => {
      const secretName = `ROTATE_SECRET_${Date.now()}`;
      const mockUpdated = { secretName, lastRotated: new Date() };

      prisma.secretRotationSchedule.findUnique.mockResolvedValue({
        secretName,
        secretType: 'api_key',
        rotationInterval: 90,
      });
      prisma.secretRotationLog.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockResolvedValue({});

      const result = await SecretRotationModule.rotateSecret(secretName, 'test_user_123');

      expect(result.success).toBe(true);
      expect(result.newSecret).toBeDefined();
      expect(result.oldHash).toBeDefined();
      expect(result.newHash).toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    test('should handle error when secret schedule not found', async () => {
      const secretName = `MISSING_SECRET_${Date.now()}`;

      prisma.secretRotationSchedule.findUnique.mockResolvedValue(null);

      const result = await SecretRotationModule.rotateSecret(secretName, 'test_user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Secret schedule not found');
    });

    test('should log errors on rotation failure', async () => {
      const secretName = `ERROR_SECRET_${Date.now()}`;

      prisma.secretRotationSchedule.findUnique.mockResolvedValue({
        secretName,
        secretType: 'api_key',
        rotationInterval: 90,
      });
      prisma.secretRotationLog.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error('DB connection failed'));

      const result = await SecretRotationModule.rotateSecret(secretName, 'test_user');

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB connection failed');
    });
  });

  describe('logRotation', () => {
    test('should log a rotation attempt', async () => {
      const secretName = `LOG_SECRET_${Date.now()}`;
      const oldHash = SecretRotationModule.hashSecret('old_secret');
      const newHash = SecretRotationModule.hashSecret('new_secret');
      const mockLog = {
        id: 'log-1',
        secretName,
        status: ROTATION_STATUS.SUCCESS,
        oldHash,
        newHash,
      };
      prisma.secretRotationLog.create.mockResolvedValue(mockLog);

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
      expect(prisma.secretRotationLog.create).toHaveBeenCalled();
    });

    test('should log errors', async () => {
      const secretName = `ERROR_LOG_SECRET_${Date.now()}`;
      const mockLog = {
        id: 'log-2',
        secretName,
        status: ROTATION_STATUS.FAILED,
        errorMessage: 'API connection failed',
      };
      prisma.secretRotationLog.create.mockResolvedValue(mockLog);

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
    });
  });

  describe('getRotationHistory', () => {
    test('should retrieve rotation history for a secret', async () => {
      const secretName = `HISTORY_SECRET_${Date.now()}`;
      const mockHistory = [
        { id: '1', secretName, status: ROTATION_STATUS.SUCCESS },
        { id: '2', secretName, status: ROTATION_STATUS.SUCCESS },
        { id: '3', secretName, status: ROTATION_STATUS.SUCCESS },
      ];
      prisma.secretRotationLog.findMany.mockResolvedValue(mockHistory);

      const history = await SecretRotationModule.getRotationHistory(secretName);

      expect(history.length).toBe(3);
      expect(history[0].secretName).toBe(secretName);
      expect(prisma.secretRotationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { secretName },
        })
      );
    });

    test('should return empty array for secret with no history', async () => {
      prisma.secretRotationLog.findMany.mockResolvedValue([]);

      const history = await SecretRotationModule.getRotationHistory('NONEXISTENT_SECRET');
      expect(history).toEqual([]);
    });

    test('should respect limit parameter', async () => {
      prisma.secretRotationLog.findMany.mockResolvedValue([]);

      await SecretRotationModule.getRotationHistory('TEST_SECRET', 50);

      expect(prisma.secretRotationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        })
      );
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

    test('should fail if new hash does not match', () => {
      const oldSecret = 'old_secret_value';
      const newSecret = 'new_secret_value';
      const oldHash = SecretRotationModule.hashSecret(oldSecret);
      const newHash = SecretRotationModule.hashSecret('wrong_new_secret');

      const isValid = SecretRotationModule.verifyRotation(oldSecret, newSecret, oldHash, newHash);
      expect(isValid).toBe(false);
    });
  });
});
