const secretRotationDailyJob = require('../../jobs/secret-rotation-daily');
const { PrismaClient } = require('@prisma/client');
const { ROTATION_STATUS } = require('../../config/ROTATION_SCHEDULE');


const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

describe('secretRotationDailyJob', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should return empty results when no secrets are due', async () => {
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

    const result = await secretRotationDailyJob();

    expect(result.total).toBeGreaterThan(0);
    expect(result.autoRotated).toBeGreaterThan(0);

    const logs = await prisma.secretRotationLog.findMany({
      where: { secretName },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].status).toBe(ROTATION_STATUS.SUCCESS);

    await prisma.secretRotationSchedule.delete({ where: { secretName } });
    await prisma.secretRotationLog.deleteMany({ where: { secretName } });
  });

  test('should mark manual rotations as pending', async () => {
    const secretName = `MANUAL_JOB_${Date.now()}`;
    const pastDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

    await prisma.secretRotationSchedule.create({
      data: {
        secretName,
        secretType: 'token',
        rotationInterval: 365,
        lastRotated: pastDate,
        nextRotation: pastDate,
        enabled: true,
        rotationMethod: 'manual',
      },
    });

    const result = await secretRotationDailyJob();

    expect(result.manualRequired).toBeGreaterThan(0);

    const logs = await prisma.secretRotationLog.findMany({
      where: { secretName },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].status).toBe(ROTATION_STATUS.PENDING_APPROVAL);

    await prisma.secretRotationSchedule.delete({ where: { secretName } });
    await prisma.secretRotationLog.deleteMany({ where: { secretName } });
  });

  test('should skip disabled secrets', async () => {
    const secretName = `DISABLED_JOB_${Date.now()}`;
    const pastDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

    await prisma.secretRotationSchedule.create({
      data: {
        secretName,
        secretType: 'password',
        rotationInterval: 90,
        lastRotated: pastDate,
        nextRotation: pastDate,
        enabled: false,
        rotationMethod: 'auto',
      },
    });

    const result = await secretRotationDailyJob();

    const logs = await prisma.secretRotationLog.findMany({
      where: { secretName },
    });
    expect(logs.length).toBe(0);

    await prisma.secretRotationSchedule.delete({ where: { secretName } });
  });

  test('should process multiple secrets', async () => {
    const secretNames = [
      `MULTI_1_${Date.now()}`,
      `MULTI_2_${Date.now()}`,
      `MULTI_3_${Date.now()}`,
    ];
    const pastDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

    for (const secretName of secretNames) {
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
    }

    const result = await secretRotationDailyJob();

    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.autoRotated).toBeGreaterThanOrEqual(3);

    for (const secretName of secretNames) {
      await prisma.secretRotationSchedule.delete({ where: { secretName } });
      await prisma.secretRotationLog.deleteMany({ where: { secretName } });
    }
  });

  test('should return correct result structure', async () => {
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
