/**
 * Secret Rotation Configuration
 * Defines which secrets to rotate, rotation intervals, and methods
 */

function deepFreeze(obj) {
  Object.values(obj).forEach((v) => {
    if (v && typeof v === 'object') Object.freeze(v);
  });
  return Object.freeze(obj);
}

const ROTATION_CONFIG = deepFreeze({
  // API Keys
  STRIPE_API_KEY: {
    type: 'api_key',
    interval: 90,
    method: 'auto',
    provider: 'stripe',
    endpoint: '/v1/api_keys',
  },
  SENDGRID_API_KEY: {
    type: 'api_key',
    interval: 180,
    method: 'manual_with_approval',
    provider: 'sendgrid',
    endpoint: '/v3/api_keys',
  },
  MAILJET_API_KEY: {
    type: 'api_key',
    interval: 90,
    method: 'auto',
    provider: 'mailjet',
  },
  CLOUDINARY_API_KEY: {
    type: 'api_key',
    interval: 180,
    method: 'manual',
    provider: 'cloudinary',
  },

  // Tokens & Secrets
  JWT_SECRET: {
    type: 'token',
    interval: 365,
    method: 'manual',
    provider: 'internal',
  },
  REFRESH_TOKEN_SECRET: {
    type: 'token',
    interval: 365,
    method: 'manual',
    provider: 'internal',
  },

  // Database Credentials
  DB_PASSWORD: {
    type: 'password',
    interval: 180,
    method: 'manual_with_approval',
    provider: 'neon',
  },

  // AWS Credentials
  AWS_SECRET_ACCESS_KEY: {
    type: 'api_key',
    interval: 90,
    method: 'auto',
    provider: 'aws',
  },

  // Google/OAuth
  GOOGLE_CLIENT_SECRET: {
    type: 'client_secret',
    interval: 365,
    method: 'manual',
    provider: 'google',
  },
});

// Rotation Schedule: Daily at 2:00 AM UTC
const ROTATION_SCHEDULE = Object.freeze({
  timeUtc: '02:00',
  timezone: 'UTC',
  checkInterval: 'daily',
  enableNotifications: true,
  alertEmail: 'admin@manawa.com',
});

// Rotation status constants
const ROTATION_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  PENDING_APPROVAL: 'pending_approval',
});

// Rotation type constants
const ROTATION_TYPE = Object.freeze({
  AUTOMATIC: 'automatic',
  MANUAL: 'manual',
  EMERGENCY: 'emergency',
});

// Rotation method constants
const ROTATION_METHOD = Object.freeze({
  AUTO: 'auto',
  MANUAL: 'manual',
  MANUAL_WITH_APPROVAL: 'manual_with_approval',
});

module.exports = {
  ROTATION_CONFIG,
  ROTATION_SCHEDULE,
  ROTATION_STATUS,
  ROTATION_TYPE,
  ROTATION_METHOD,
};
