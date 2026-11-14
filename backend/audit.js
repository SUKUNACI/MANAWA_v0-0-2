const fs = require('fs');
const path = require('path');

const violations = [];

// CRITICAL: index.js - main entry point issues
violations.push({
  file: './index.js',
  line: 877,
  severity: 'MEDIUM',
  description: 'File exceeds 800-line soft ceiling (877 lines) - difficult to maintain, multiple responsibilities',
  refactor_suggestion: 'Split into: app-setup.js (routes/middleware), cron-jobs.js (background tasks), health-checks.js'
});

violations.push({
  file: './index.js',
  line: 733,
  severity: 'MEDIUM',
  description: 'startServer() function is 136 lines - violates 50-line function size limit',
  refactor_suggestion: 'Extract: setupDatabase(), setupServices(), startListeners(), registerCronJobs() as separate functions'
});

violations.push({
  file: './index.js',
  line: 624,
  severity: 'MEDIUM',
  description: 'reconcilePendingPayments() has complex nested logic (57 lines)',
  refactor_suggestion: 'Extract payment status verification into separate function, use early returns to reduce nesting'
});

violations.push({
  file: './index.js',
  line: 146,
  severity: 'MEDIUM',
  description: 'Helmet configuration with inline CSP policy - duplicate logic for admin vs API',
  refactor_suggestion: 'Create helmets config module with separate policies to avoid duplication'
});

// Route files - file size issues
violations.push({
  file: './routes/projects.js',
  line: 1,
  severity: 'MEDIUM',
  description: 'File is 673 lines - approaching maintainability ceiling',
  refactor_suggestion: 'Consider splitting into: projects-get.js, projects-create.js, projects-quotes.js'
});

violations.push({
  file: './routes/auth.js',
  line: 1,
  severity: 'MEDIUM',
  description: 'File is 606 lines - mixed authentication concerns',
  refactor_suggestion: 'Extract: login/logout to auth-sessions.js, profile to auth-profile.js, security to auth-security.js'
});

violations.push({
  file: './routes/admin.js',
  line: 1,
  severity: 'MEDIUM',
  description: 'File is 530 lines - consolidates too many admin operations',
  refactor_suggestion: 'Split into: admin-users.js, admin-system.js, admin-reports.js'
});

// Code duplication issues
violations.push({
  file: './routes/admin-anonymization.js',
  line: 1,
  severity: 'HIGH',
  description: 'Duplicate anonymization patterns found in 4+ places - violates DRY principle',
  refactor_suggestion: 'Create anonymization-service.js with reusable anonymizeUser(), anonymizeEmail(), anonymizeData() utilities'
});

violations.push({
  file: './utils/webhooks.js',
  line: 146,
  severity: 'MEDIUM',
  description: 'triggerWebhook() function is 61 lines with high nesting depth',
  refactor_suggestion: 'Extract webhook signing, retry logic, and event tracking into separate utilities'
});

violations.push({
  file: './utils/webhooks.js',
  line: 292,
  severity: 'MEDIUM',
  description: 'retryFailedWebhooks() has complex retry logic (56 lines) with nested conditions',
  refactor_suggestion: 'Create retry-strategy.js module with exponential backoff, circuit breaker pattern'
});

// Error handling gaps
violations.push({
  file: './routes/projects.js',
  line: 117,
  severity: 'MEDIUM',
  description: 'Database update without explicit error handling - could swallow errors',
  refactor_suggestion: 'Wrap in try-catch with proper logging and user-facing error response'
});

violations.push({
  file: './routes/quotes.js',
  line: 168,
  severity: 'MEDIUM',
  description: 'Promise chain with .then() without .catch() - unhandled rejection possible',
  refactor_suggestion: 'Convert to async/await with try-catch, or add explicit .catch() handler'
});

violations.push({
  file: './routes/analytics-funnels.js',
  line: 68,
  severity: 'MEDIUM',
  description: 'Multiple .then() chains without error handling in analytics module',
  refactor_suggestion: 'Standardize all async code to async/await pattern with try-catch blocks'
});

// Documentation gaps
violations.push({
  file: './routes/projects.js',
  line: 1,
  severity: 'LOW',
  description: 'Low documentation ratio: 5% (34/673 lines) - only 34 lines of comments',
  refactor_suggestion: 'Add JSDoc comments to all endpoints describing: purpose, auth requirements, request/response shapes'
});

violations.push({
  file: './routes/auth.js',
  line: 1,
  severity: 'LOW',
  description: 'Low documentation ratio: 5% (36/606 lines) - security-critical code is undocumented',
  refactor_suggestion: 'Add security notes, rate limiting info, session management explanation'
});

// Naming and consistency
violations.push({
  file: './middleware/',
  line: 1,
  severity: 'MEDIUM',
  description: 'Inconsistent middleware naming: auth.js, auth-2fa.js, auth-recovery.js - no clear convention',
  refactor_suggestion: 'Standardize to auth-*.js or split auth concerns into separate modules with clear scope'
});

violations.push({
  file: './config/',
  line: 1,
  severity: 'MEDIUM',
  description: '37 config files with varying sizes and purposes - hard to navigate',
  refactor_suggestion: 'Group into: config/integrations (firebase, geniuspay), config/policies (csp, cors), config/system (db, redis)'
});

// Magic numbers
violations.push({
  file: './routes/',
  line: 1,
  severity: 'LOW',
  description: 'Magic numbers throughout: rate limits (100, 1440, 3650, etc.) - not centralized',
  refactor_suggestion: 'Create config/constants.js with RATE_LIMIT_RULES, RETENTION_DAYS, PAGINATION_DEFAULTS'
});

// Nesting depth issues
violations.push({
  file: './routes/admin-anonymization.js',
  line: 92,
  severity: 'MEDIUM',
  description: 'Nesting depth reaches 7 levels in Prisma query where clause - hard to read',
  refactor_suggestion: 'Extract complex query builders into helper functions, limit to 4 levels max'
});

violations.push({
  file: './routes/admin-costs.js',
  line: 37,
  severity: 'MEDIUM',
  description: 'Deeply nested Prisma queries (5+ levels) - difficult to understand and maintain',
  refactor_suggestion: 'Create query-builders.js module with named functions for each complex query'
});

// Testing gaps
violations.push({
  file: './routes/projects.js',
  line: 1,
  severity: 'HIGH',
  description: 'No unit tests for business logic - only integration tests',
  refactor_suggestion: 'Add unit tests for: payment verification, quote expiry, project status transitions'
});

violations.push({
  file: './utils/geniuspay.js',
  line: 1,
  severity: 'HIGH',
  description: 'Payment integration lacks mocking - tests require live API calls',
  refactor_suggestion: 'Create utils/__mocks__/geniuspay.js with jest.mock() setup for offline testing'
});

// Dead code and unused imports
violations.push({
  file: './config/upload.js',
  line: 1,
  severity: 'LOW',
  description: 'Multiple upload configuration files (upload.js, cdn.js, cloudinary.js, mobile-images.js)',
  refactor_suggestion: 'Consolidate into single upload-config.js with different strategies, reduce from 4 to 1 file'
});

// Security issues
violations.push({
  file: './routes/admin-gdpr.js',
  line: 126,
  severity: 'MEDIUM',
  description: 'GDPR deletion uses placeholder strings like "GDPR_DELETED" - not cryptographically random',
  refactor_suggestion: 'Use crypto.randomBytes() or uuid for anonymization placeholders to prevent reverse lookup'
});

violations.push({
  file: './middleware/auth.js',
  line: 1,
  severity: 'MEDIUM',
  description: 'JWT token validation lacks token revocation check - compromised tokens still valid',
  refactor_suggestion: 'Implement token blacklist in Redis with TTL matching JWT expiry'
});

function calculateScore(violations) {
  let score = 100;
  score -= violations.filter(v => v.severity === 'CRITICAL').length * 20;
  score -= violations.filter(v => v.severity === 'HIGH').length * 10;
  score -= violations.filter(v => v.severity === 'MEDIUM').length * 5;
  score -= violations.filter(v => v.severity === 'LOW').length * 1;
  return Math.max(0, score);
}

console.log(JSON.stringify({
  violations: violations.sort((a, b) => {
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  }),
  maintainability_score: calculateScore(violations),
  summary: {
    total_violations: violations.length,
    critical: violations.filter(v => v.severity === 'CRITICAL').length,
    high: violations.filter(v => v.severity === 'HIGH').length,
    medium: violations.filter(v => v.severity === 'MEDIUM').length,
    low: violations.filter(v => v.severity === 'LOW').length,
  }
}, null, 2));
