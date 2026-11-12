/**
 * Jest Configuration for E2E Tests
 * Optimized for API integration testing with realistic timeouts
 */

module.exports = {
  displayName: 'E2E Tests',
  testEnvironment: 'node',

  // Test timeout increased for API calls
  testTimeout: 30000,

  // Test patterns
  testMatch: ['**/?(*.)+(e2e|integration).js'],

  // Coverage
  collectCoverageFrom: [
    '../routes/**/*.js',
    '../middleware/**/*.js',
    '../utils/**/*.js',
    '!../node_modules/**',
    '!**/dist/**',
  ],
  coverageThreshold: {
    global: {
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70,
    },
  },

  // Setup
  setupFilesAfterEnv: ['./setup.js'],

  // Reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '../test-results',
        outputName: 'e2e-results.xml',
        suiteName: 'E2E Test Suite',
        usePathAsTestName: true,
      },
    ],
  ],

  // Verbosity
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Bail on first failure (optional, remove to continue on failure)
  // bail: 1,

  // Max workers for parallel execution
  maxWorkers: '50%',
};
