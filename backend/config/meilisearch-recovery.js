/**
 * MeiliSearch Recovery Handler
 *
 * Gère deux types de défaillances :
 * 1. HTML au réveil : retrys avec backoff jusqu'à JSON valide
 * 2. Index manquants : resync unique throttlée (1/min) pour recréer + remplir
 *
 * Évite : resyncs parallèles, boucles infinies, auth errors
 */

const logger = require('../utils/logger');

// Import at module load time to avoid Jest teardown issues
let syncAllIndices;
function getSyncAllIndices() {
  if (!syncAllIndices) {
    // Lazy load: import only when needed (on first triggerRecoverySync call)
    const syncModule = require('../jobs/meilisearch-sync');
    syncAllIndices = syncModule.syncAllIndices;
  }
  return syncAllIndices;
}

let resyncInProgress = false;
let lastResyncAttempt = 0;

/**
 * Check if error is auth (401/403)—stop immediately
 */
function isAuthError(err) {
  const statusCode = err?.response?.status || err?.status;
  const code = err?.code;
  const msg = err?.message || '';

  return statusCode === 401 || statusCode === 403 ||
         code === 'invalid_api_key' || code === 'unauthorized' ||
         msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized');
}

/**
 * Réessaye une fonction avec backoff exponential
 * Pour Render gratuit : augmenter les délais pour couvrir le réveil (~30-60s)
 *
 * Auth errors (401/403): STOP on first attempt, NO retries
 * Transient errors: Retry with exponential backoff up to maxRetries
 *
 * delayFn: Optional injectable delay function for testing (default: setTimeout).
 *          Allows tests to mock delays without waiting real 5-155s.
 */
async function retryWithBackoff(fn, maxRetries = 6, baseDelayMs = 5000, delayFn = null) {
  // Use injectable delay function (for testing) or default setTimeout
  const delay = delayFn || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));

  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug('[MeiliSearch Recovery] Retry attempt', { attempt, maxRetries });
      return await fn();
    } catch (err) {
      lastErr = err;

      // ✅ AUTH ERROR: Stop immediately, no retry
      if (isAuthError(err)) {
        logger.warn('[MeiliSearch Recovery] Auth error on attempt 1, stopping (401/403)', { error: err.message });
        throw err;
      }

      if (attempt < maxRetries) {
        // Backoff: 5s, 10s, 20s, 40s, 80s max (~155s total)
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn('[MeiliSearch Recovery] Retry delayed', { attempt, delay: delayMs, error: err.message });
        await delay(delayMs);
      }
    }
  }
  throw lastErr;
}

/**
 * Déclenche resync si indices manquants (throttlé 1/min)
 * N'intervient PAS pour les erreurs d'auth (401/403)
 */
async function triggerRecoverySync(errorType = 'missing_index') {
  const now = Date.now();
  const timeSinceLastAttempt = now - lastResyncAttempt;

  // Ne resyncer que pour 'startup' ou 'missing_index'
  if (errorType === 'auth_error') {
    logger.warn('[MeiliSearch Recovery] Auth error detected, skipping resync');
    return;
  }

  if (resyncInProgress) {
    logger.debug('[MeiliSearch Recovery] Resync already in progress');
    return;
  }

  if (timeSinceLastAttempt < 60000) {
    logger.debug('[MeiliSearch Recovery] Resync throttled (1min cooldown)', { timeSinceLastAttempt });
    return;
  }

  resyncInProgress = true;
  lastResyncAttempt = now;

  try {
    logger.info('[MeiliSearch Recovery] Starting recovery sync', { errorType });

    const syncFn = getSyncAllIndices();
    const result = await syncFn();
    logger.info('[MeiliSearch Recovery] Recovery sync completed', { result });

    return result;
  } catch (err) {
    logger.error('[MeiliSearch Recovery] Recovery sync failed', { error: err.message });
    throw err;
  } finally {
    resyncInProgress = false;
  }
}

/**
 * Gère la récupération après HTML au réveil
 * Retrys avec backoff pour couvrir Render wake-up (~30-60s)
 *
 * Erreurs d'auth (401/403): STOP immédiatement, aucun retry, aucun resync
 * Erreurs transitoires (HTML, index absent): Retry avec backoff borné à 6
 *
 * delayFn: Optional injectable delay function for testing (default: real setTimeout)
 */
async function handleStartupRecovery(fn, maxRetries = 6, baseDelayMs = 5000, delayFn = null) {
  try {
    // Reessayer avec backoff: 6 retries, 5s base (5/10/20/40/80s delays, ~155s total)
    // Pass delayFn to allow testing without real delays
    return await retryWithBackoff(fn, maxRetries, baseDelayMs, delayFn);
  } catch (err) {
    // ✅ AUTH ERROR: Stop immediately, NO resync
    if (isAuthError(err)) {
      logger.warn('[MeiliSearch Recovery] Auth error detected, stopping recovery (401/403)', { error: err.message });
      throw err;
    }

    // Transient error: Trigger resync (indices may be empty after restart)
    logger.warn('[MeiliSearch Recovery] Startup retry exhausted, triggering resync', { error: err.message });
    await triggerRecoverySync('startup');
    throw err; // Toujours propager au client (mais recovery lancé)
  }
}

module.exports = {
  triggerRecoverySync,
  handleStartupRecovery,
  retryWithBackoff,
};
