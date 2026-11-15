const express = require('express');
const { authenticateToken, checkAdminRole } = require('../middleware/auth');
const SecretRotationModule = require('../modules/SecretRotationModule');
const { ROTATION_CONFIG } = require('../config/ROTATION_SCHEDULE');
const { sendSuccess, sendError } = require('../utils/error-response');

const router = express.Router();

router.use(authenticateToken);
router.use(checkAdminRole);

/**
 * GET /admin/secret-rotation/schedules
 */
router.get('/schedules', async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const schedules = await prisma.secretRotationSchedule.findMany({
      orderBy: { nextRotation: 'asc' },
    });

    await prisma.$disconnect();
    return sendSuccess(res, { schedules }, 200, 'Rotation schedules retrieved');
  } catch (error) {
    return sendError(res, error, 500);
  }
});

/**
 * GET /admin/secret-rotation/due
 */
router.get('/due', async (req, res) => {
  try {
    const due = await SecretRotationModule.getRotationsDue();
    return sendSuccess(res, { due }, 200, 'Secrets due for rotation retrieved');
  } catch (error) {
    return sendError(res, error, 500);
  }
});

/**
 * GET /admin/secret-rotation/history/:secretName
 */
router.get('/history/:secretName', async (req, res) => {
  try {
    const { secretName } = req.params;
    const history = await SecretRotationModule.getRotationHistory(secretName);
    return sendSuccess(res, { history }, 200, 'Rotation history retrieved');
  } catch (error) {
    return sendError(res, error, 500);
  }
});

/**
 * POST /admin/secret-rotation/rotate/:secretName
 */
router.post('/rotate/:secretName', async (req, res) => {
  try {
    const { secretName } = req.params;
    const userId = req.user.id;

    const result = await SecretRotationModule.rotateSecret(secretName, userId);

    if (!result.success) {
      return sendError(res, new Error(result.error), 400);
    }

    return sendSuccess(res, result, 200, `Secret ${secretName} rotated`);
  } catch (error) {
    return sendError(res, error, 500);
  }
});

/**
 * POST /admin/secret-rotation/approve/:logId
 */
router.post('/approve/:logId', async (req, res) => {
  try {
    const { logId } = req.params;
    const userId = req.user.id;

    const result = await SecretRotationModule.handleApproval(logId, true, userId);
    return sendSuccess(res, result, 200, 'Rotation approved');
  } catch (error) {
    return sendError(res, error, 500);
  }
});

/**
 * POST /admin/secret-rotation/reject/:logId
 */
router.post('/reject/:logId', async (req, res) => {
  try {
    const { logId } = req.params;
    const userId = req.user.id;

    const result = await SecretRotationModule.handleApproval(logId, false, userId);
    return sendSuccess(res, result, 200, 'Rotation rejected');
  } catch (error) {
    return sendError(res, error, 500);
  }
});

/**
 * GET /admin/secret-rotation/config
 */
router.get('/config', (req, res) => {
  return sendSuccess(res, { config: ROTATION_CONFIG }, 200, 'Config retrieved');
});

module.exports = router;
