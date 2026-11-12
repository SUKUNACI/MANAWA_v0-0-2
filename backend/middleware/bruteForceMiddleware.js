/**
 * Brute Force Protection Middleware
 * Tracks failed login attempts and enforces account lockout
 */

const bruteForceConfig = require('../config/brute-force');
const redisCache = require('../config/redis');
const logger = require('../utils/logger');
const prisma = require('../config/db');

/**
 * Track a failed login attempt for a user
 * @param {string} email - User email (lowercased)
 * @returns {Promise<number>} - Attempt count after increment
 */
async function trackFailedLogin(email) {
  const key = `${bruteForceConfig.keyPrefixes.failedAttempts}${email.toLowerCase()}`;

  try {
    const current = await redisCache.get(key);
    const count = (current ? parseInt(current, 10) : 0) + 1;

    // Set with TTL = attempt window
    await redisCache.set(
      key,
      count.toString(),
      bruteForceConfig.attemptWindowSeconds
    );

    logger.warn('[Brute Force] Failed login attempt tracked', {
      email: email.toLowerCase(),
      attemptCount: count,
      maxAttempts: bruteForceConfig.maxAttempts,
    });

    return count;
  } catch (err) {
    logger.error('[Brute Force] Failed to track attempt', {
      email: email.toLowerCase(),
      error: err.message,
    });
    throw err;
  }
}

/**
 * Check if a user account is locked out
 * @param {string} email - User email (lowercased)
 * @returns {Promise<{isLocked: boolean, remainingSeconds: number}>}
 */
async function checkLockout(email) {
  const lockoutKey = `${bruteForceConfig.keyPrefixes.lockout}${email.toLowerCase()}`;

  try {
    const lockout = await redisCache.get(lockoutKey);

    if (lockout) {
      // Account is locked
      const { lockedUntil } = JSON.parse(lockout);
      const now = Date.now();
      const remainingMs = lockedUntil - now;
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

      if (remainingSeconds > 0) {
        logger.warn('[Brute Force] Account locked out', {
          email: email.toLowerCase(),
          remainingSeconds,
        });
        return {
          isLocked: true,
          remainingSeconds,
          lockedUntil,
        };
      } else {
        // Lockout expired, clean up
        await redisCache.deleteKey(lockoutKey);
        logger.info('[Brute Force] Lockout expired', {
          email: email.toLowerCase(),
        });
      }
    }

    return {
      isLocked: false,
      remainingSeconds: 0,
    };
  } catch (err) {
    logger.error('[Brute Force] Error checking lockout', {
      email: email.toLowerCase(),
      error: err.message,
    });
    throw err;
  }
}

/**
 * Lock an account for failed attempts
 * @param {string} email - User email (lowercased)
 */
async function lockAccount(email) {
  const lockoutKey = `${bruteForceConfig.keyPrefixes.lockout}${email.toLowerCase()}`;
  const attemptsKey = `${bruteForceConfig.keyPrefixes.failedAttempts}${email.toLowerCase()}`;

  try {
    const lockedUntil = Date.now() + (bruteForceConfig.lockoutDurationSeconds * 1000);
    const lockoutData = {
      lockedUntil,
      lockedAt: new Date().toISOString(),
      reason: 'max_failed_attempts',
    };

    await redisCache.set(
      lockoutKey,
      JSON.stringify(lockoutData),
      bruteForceConfig.lockoutDurationSeconds
    );

    logger.error('[Brute Force] Account locked due to max attempts', {
      email: email.toLowerCase(),
      lockoutDurationSeconds: bruteForceConfig.lockoutDurationSeconds,
      lockedUntil: new Date(lockedUntil).toISOString(),
    });
  } catch (err) {
    logger.error('[Brute Force] Failed to lock account', {
      email: email.toLowerCase(),
      error: err.message,
    });
    throw err;
  }
}

/**
 * Get current attempt count for a user
 * @param {string} email - User email (lowercased)
 * @returns {Promise<number>} - Number of failed attempts
 */
async function getAttemptCount(email) {
  const key = `${bruteForceConfig.keyPrefixes.failedAttempts}${email.toLowerCase()}`;

  try {
    const count = await redisCache.get(key);
    return count ? parseInt(count, 10) : 0;
  } catch (err) {
    logger.error('[Brute Force] Failed to get attempt count', {
      email: email.toLowerCase(),
      error: err.message,
    });
    return 0;
  }
}

/**
 * Get remaining attempts before lockout
 * @param {string} email - User email (lowercased)
 * @returns {Promise<number>} - Number of remaining attempts
 */
async function getRemainingAttempts(email) {
  const attempts = await getAttemptCount(email);
  return Math.max(0, bruteForceConfig.maxAttempts - attempts);
}

/**
 * Clear failed attempts (after successful login)
 * @param {string} email - User email (lowercased)
 */
async function clearFailedAttempts(email) {
  const attemptsKey = `${bruteForceConfig.keyPrefixes.failedAttempts}${email.toLowerCase()}`;

  try {
    await redisCache.deleteKey(attemptsKey);
    logger.info('[Brute Force] Failed attempts cleared', {
      email: email.toLowerCase(),
    });
  } catch (err) {
    logger.error('[Brute Force] Failed to clear attempts', {
      email: email.toLowerCase(),
      error: err.message,
    });
  }
}

/**
 * Clear lockout (manual admin unlock)
 * @param {string} email - User email (lowercased)
 */
async function clearLockout(email) {
  const lockoutKey = `${bruteForceConfig.keyPrefixes.lockout}${email.toLowerCase()}`;

  try {
    await redisCache.deleteKey(lockoutKey);
    logger.info('[Brute Force] Lockout cleared (manual)', {
      email: email.toLowerCase(),
    });
  } catch (err) {
    logger.error('[Brute Force] Failed to clear lockout', {
      email: email.toLowerCase(),
      error: err.message,
    });
  }
}

/**
 * Log login attempt to database for audit trail
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {string} status - 'success' or 'failed'
 * @param {string} ipAddress - Client IP address
 * @param {string} userAgent - Client user agent
 * @param {object} metadata - Additional metadata
 */
async function logLoginAttempt(userId, email, status, ipAddress, userAgent, metadata = {}) {
  try {
    await prisma.loginAttempt.create({
      data: {
        userId: userId || null,
        email: email.toLowerCase(),
        status,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        timestamp: new Date(),
      },
    });
  } catch (err) {
    // Log table might not exist yet, don't fail the request
    logger.warn('[Login Attempt] Failed to log attempt', {
      email: email.toLowerCase(),
      status,
      error: err.message,
    });
  }
}

/**
 * Get login history for a user
 * @param {string} userId - User ID
 * @param {number} limit - Number of records to retrieve
 * @returns {Promise<array>} - Login attempts
 */
async function getLoginHistory(userId, limit = 20) {
  try {
    const attempts = await prisma.loginAttempt.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        ipAddress: true,
        userAgent: true,
        timestamp: true,
        metadata: true,
      },
    });

    return attempts.map(a => ({
      ...a,
      metadata: a.metadata ? JSON.parse(a.metadata) : null,
    }));
  } catch (err) {
    logger.warn('[Login History] Failed to retrieve history', {
      userId,
      error: err.message,
    });
    return [];
  }
}

/**
 * Express middleware to check brute force protection
 * Place this BEFORE the actual login handler
 */
function bruteForceCheckMiddleware() {
  return async (req, res, next) => {
    const email = req.body?.email?.toLowerCase();

    if (!email) {
      return next();
    }

    try {
      const lockout = await checkLockout(email);

      if (lockout.isLocked) {
        res.setHeader(bruteForceConfig.headers.retryAfter, lockout.remainingSeconds);
        return res.status(bruteForceConfig.statusCodes.tooManyRequests).json({
          error: bruteForceConfig.messages.accountLocked,
          code: 'ACCOUNT_LOCKED',
          remainingSeconds: lockout.remainingSeconds,
        });
      }

      // Attach attempt count to request for use in login handler
      req.bruteForceAttempts = await getAttemptCount(email);
      next();
    } catch (err) {
      logger.error('[Brute Force Middleware] Error', {
        email,
        error: err.message,
      });
      // Don't fail the request due to cache errors, continue
      next();
    }
  };
}

module.exports = {
  trackFailedLogin,
  checkLockout,
  lockAccount,
  getAttemptCount,
  getRemainingAttempts,
  clearFailedAttempts,
  clearLockout,
  logLoginAttempt,
  getLoginHistory,
  bruteForceCheckMiddleware,
};
