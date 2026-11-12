module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['./tests/setup.js'],
  clearMocks: true,
  testTimeout: 10000,
  // Q113: Coverage gate — pipeline fails if any metric drops below 80%
  coverageThreshold: {
    global: {
      lines:      80,
      branches:   80,
      functions:  80,
      statements: 80,
    },
  },
  collectCoverageFrom: [
    'config/**/*.js',
    'middleware/**/*.js',
    'routes/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!config/db.js',
    '!config/firebase-admin.js',
    '!config/redis.js',
  ],
};
