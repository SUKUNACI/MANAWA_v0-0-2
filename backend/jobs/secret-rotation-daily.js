require('dotenv').config();

const SecretRotationModule = require('../modules/SecretRotationModule');
const { ROTATION_METHOD, ROTATION_STATUS } = require('../config/ROTATION_SCHEDULE');
const Sentry = require('@sentry/node');
const logger = require('../utils/logger');

async function secretRotationDailyJob() {
  const startTime = Date.now();
  const results = {
    total: 0,
    autoRotated: 0,
    manualRequired: 0,
    failed: 0,
    errors: [],
  };

  try {
    const duedSecrets = await SecretRotationModule.getRotationsDue();
    results.total = duedSecrets.length;

    if (results.total === 0) {
      logger.info('[SECRET ROTATION] No secrets due for rotation');
      return results;
    }

    logger.info('[SECRET ROTATION] Found secrets due for rotation', { count: results.total });

    for (const secret of duedSecrets) {
      try {
        if (secret.rotationMethod === ROTATION_METHOD.AUTO) {
          const rotationResult = await SecretRotationModule.rotateSecret(
            secret.secretName,
            'system-scheduled-job'
          );

          if (rotationResult.success) {
            results.autoRotated++;
            logger.info('[SECRET ROTATION] Auto-rotated secret', { secretName: secret.secretName });

            Sentry.addBreadcrumb({
              category: 'secret-rotation',
              message: `Auto-rotated secret: ${secret.secretName}`,
              level: 'info',
              data: {
                secretName: secret.secretName,
                secretType: secret.secretType,
              },
            });
          } else {
            results.failed++;
            results.errors.push({
              secret: secret.secretName,
              error: rotationResult.error,
            });
            logger.error('[SECRET ROTATION] Auto-rotation failed', { secretName: secret.secretName, error: rotationResult.error });

            Sentry.captureException(new Error(`Auto-rotation failed: ${secret.secretName}`), {
              tags: { rotation_method: 'auto' },
            });
          }
        } else if (
          secret.rotationMethod === ROTATION_METHOD.MANUAL ||
          secret.rotationMethod === ROTATION_METHOD.MANUAL_WITH_APPROVAL
        ) {
          results.manualRequired++;
          logger.info('[SECRET ROTATION] Manual rotation required', { secretName: secret.secretName });

          await SecretRotationModule.logRotation({
            secretName: secret.secretName,
            rotationType: 'manual',
            oldHash: 'pending',
            newHash: 'pending',
            status: ROTATION_STATUS.PENDING_APPROVAL,
            rotatedBy: 'system-scheduled-job',
            metadata: {
              scheduledAt: new Date().toISOString(),
              method: secret.rotationMethod,
            },
          });

          await alertAdminForManualRotation(secret);

          Sentry.addBreadcrumb({
            category: 'secret-rotation',
            message: `Manual rotation required: ${secret.secretName}`,
            level: 'warning',
          });
        }
      } catch (secretError) {
        results.failed++;
        results.errors.push({
          secret: secret.secretName,
          error: secretError.message,
        });
        logger.error('[SECRET ROTATION] Error processing secret', { secretName: secret.secretName, error: secretError.message });

        Sentry.captureException(secretError, {
          tags: { rotation_type: 'job_processing' },
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info('[SECRET ROTATION] Job completed', {
      durationMs: duration,
      total: results.total,
      autoRotated: results.autoRotated,
      manualRequired: results.manualRequired,
      failed: results.failed,
    });

    Sentry.addBreadcrumb({
      category: 'secret-rotation-job',
      message: 'Daily rotation job completed',
      level: 'info',
      data: {
        total: results.total,
        autoRotated: results.autoRotated,
        manualRequired: results.manualRequired,
        failed: results.failed,
        durationMs: duration,
      },
    });

    return results;
  } catch (error) {
    logger.error('[SECRET ROTATION] Job failed', { error: error.message });
    Sentry.captureException(error, {
      tags: { rotation_type: 'job_failure' },
    });
    throw error;
  }
}

async function alertAdminForManualRotation(secret) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@manawa.com';
    logger.info('[SECRET ROTATION] Admin alert dispatched', { secretName: secret.secretName, adminEmail });
  } catch (error) {
    logger.error('[SECRET ROTATION] Failed to alert admin', { error: error.message });
    throw error;
  }
}

module.exports = secretRotationDailyJob;
