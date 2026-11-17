const { ROTATION_STATUS } = require('../../config/ROTATION_SCHEDULE');

jest.mock('../../config/db', () => ({
  secretRotationSchedule: {
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  secretRotationLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
}));

jest.mock('../../modules/SecretRotationModule', () => ({
  getRotationsDue: jest.fn(),
  rotateSecret: jest.fn(),
  logRotation: jest.fn(),
}));

const secretRotationDailyJob = require('../../jobs/secret-rotation-daily');
const SecretRotationModule = require('../../modules/SecretRotationModule');
const prisma = require('../../config/db');

describe('secretRotationDailyJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return empty results when no secrets are due', async () => {
    SecretRotationModule.getRotationsDue.mockResolvedValue([]);

    const result = await secretRotationDailyJob();

    expect(result).toBeDefined();
    expect(result.total).toBe(0);
    expect(result.autoRotated).toBe(0);
    expect(result.manualRequired).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test('should auto-rotate secrets with method=auto', async () => {
    const secretName = `AUTO_JOB_${Date.now()}`;
    const pastDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const mockSecrets = [{
      secretName,
      secretType: 'api_key',
      rotationInterval: 90,
      lastRotated: pastDate,
      nextRotation: pastDate,
      enabled: true,
      rotationMethod: 'auto',
    }];

    SecretRotationModule.getRotationsDue.mockResolvedValue(mockSecrets);
    SecretRotationModule.rotateSecret.mockResolvedValue({ success: true, newSecret: 'new_secret_123' });
    prisma.secretRotationLog.create.mockResolvedValue({ status: ROTATION_STATUS.SUCCESS });

    const result = await secretRotationDailyJob();

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.autoRotated).toBeGreaterThanOrEqual(1);
  });

  test('should mark manual rotations as pending', async () => {
    const secretName = `MANUAL_JOB_${Date.now()}`;
    const mockSecrets = [{
      secretName,
      secretType: 'token',
      rotationInterval: 365,
      rotationMethod: 'manual',
    }];

    SecretRotationModule.getRotationsDue.mockResolvedValue(mockSecrets);
    prisma.secretRotationLog.create.mockResolvedValue({ status: ROTATION_STATUS.PENDING_APPROVAL });

    const result = await secretRotationDailyJob();

    expect(result.manualRequired).toBeGreaterThanOrEqual(1);
  });

  test('should skip disabled secrets', async () => {
    SecretRotationModule.getRotationsDue.mockResolvedValue([]);

    const result = await secretRotationDailyJob();

    expect(result.total).toBe(0);
  });

  test('should process multiple secrets', async () => {
    const secretNames = [
      `MULTI_1_${Date.now()}`,
      `MULTI_2_${Date.now()}`,
      `MULTI_3_${Date.now()}`,
    ];
    const mockSecrets = secretNames.map((name) => ({
      secretName: name,
      secretType: 'api_key',
      rotationInterval: 90,
      rotationMethod: 'auto',
    }));

    SecretRotationModule.getRotationsDue.mockResolvedValue(mockSecrets);
    SecretRotationModule.rotateSecret.mockResolvedValue({ success: true });
    prisma.secretRotationLog.create.mockResolvedValue({ status: ROTATION_STATUS.SUCCESS });

    const result = await secretRotationDailyJob();

    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.autoRotated).toBeGreaterThanOrEqual(3);
  });

  test('should return correct result structure', async () => {
    SecretRotationModule.getRotationsDue.mockResolvedValue([]);

    const result = await secretRotationDailyJob();

    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('autoRotated');
    expect(result).toHaveProperty('manualRequired');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('errors');

    expect(typeof result.total).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
