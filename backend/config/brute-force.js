/**
 * Brute Force Protection Configuration
 * Implements account lockout after failed login attempts
 */

module.exports = {
  // Maximum failed login attempts before lockout
  maxAttempts: 5,

  // Lockout duration in seconds (15 minutes)
  lockoutDurationSeconds: 15 * 60,

  // Window for counting attempts in seconds (also 15 minutes)
  // Attempts older than this window are not counted
  attemptWindowSeconds: 15 * 60,

  // Redis key prefixes for tracking
  keyPrefixes: {
    failedAttempts: 'brute_force:failed_attempts:',
    lockout: 'brute_force:lockout:',
    loginLog: 'login_log:',
  },

  // Rate limit headers
  headers: {
    attemptsRemaining: 'X-Attempts-Remaining',
    retryAfter: 'Retry-After',
  },

  // HTTP status codes
  statusCodes: {
    tooManyRequests: 429,
    lockedOut: 429,
  },

  // Error messages
  messages: {
    accountLocked: 'Ce compte est temporairement bloqué suite à trop de tentatives de connexion échouées. Veuillez réessayer dans 15 minutes.',
    tooManyAttempts: 'Trop de tentatives échouées. Votre compte sera bloqué si vous échouez encore.',
    loginFailed: 'Email ou mot de passe incorrect',
  },
};
