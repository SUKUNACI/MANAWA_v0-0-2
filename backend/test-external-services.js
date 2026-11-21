#!/usr/bin/env node
/**
 * Test External Services - Non-Destructive Health Check
 *
 * Usage: node test-external-services.js [--verbose]
 *
 * Tests all external services without modifying any data:
 * - Redis (PING command)
 * - Bull Queues (connection test)
 * - Firebase FCM (initialization status)
 * - Mailjet (configuration check)
 * - Twilio (configuration check)
 * - Sentry (configuration check)
 * - Database (connection test)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  debug: (msg) => verbose && console.log(`${colors.gray}debug: ${msg}${colors.reset}`),
};

let passCount = 0;
let failCount = 0;
let skipCount = 0;

async function testDatabase() {
  log.info('Testing Database...');
  try {
    const prisma = require('./config/db');
    const result = await prisma.$queryRaw`SELECT 1 as health`;
    log.success('Database: PostgreSQL connected (Neon)');
    passCount++;
  } catch (err) {
    log.error(`Database: ${err.message}`);
    failCount++;
  }
}

async function testRedis() {
  log.info('Testing Redis...');
  try {
    const redis = require('./config/redis');
    const health = await redis.healthCheck();

    if (health.status === 'ok') {
      log.success(`Redis: ${health.mode} active (${health.message})`);
      passCount++;
    } else {
      log.warn(`Redis: ${health.message}`);
      skipCount++;
    }
  } catch (err) {
    log.error(`Redis: ${err.message}`);
    failCount++;
  }
}


async function testBullQueues() {
  log.info('Testing Bull Queues...');
  try {
    const queueConfig = require('./config/queue');
    const { getQueueStats } = queueConfig;

    // Test one queue to verify connection
    const stats = await getQueueStats(queueConfig.emailQueue, 'emails');

    if (stats.error) {
      log.error(`Bull Queues: ${stats.error}`);
      failCount++;
    } else {
      log.success(`Bull Queues: Connected (${stats.active} active, ${stats.waiting} waiting, ${stats.failed} failed)`);
      passCount++;
    }
  } catch (err) {
    log.error(`Bull Queues: ${err.message}`);
    failCount++;
  }
}

async function testFirebase() {
  log.info('Testing Firebase FCM...');
  try {
    const firebase = require('./config/firebase-admin');
    const isInitialized = firebase.isInitialized();

    if (isInitialized) {
      log.success('Firebase: Initialized and ready');
      passCount++;
    } else {
      log.warn('Firebase: Not configured (FIREBASE_SERVICE_ACCOUNT missing)');
      skipCount++;
    }
  } catch (err) {
    log.error(`Firebase: ${err.message}`);
    failCount++;
  }
}

function testMailjet() {
  log.info('Testing Mailjet...');
  try {
    const mailer = require('./config/mailer');

    if (mailer.isConfigured) {
      log.success('Mailjet: Configured and ready');
      passCount++;
    } else {
      log.warn('Mailjet: Not configured (API key missing) - using dev mode');
      skipCount++;
    }
  } catch (err) {
    log.error(`Mailjet: ${err.message}`);
    failCount++;
  }
}

function testTwilio() {
  log.info('Testing Twilio...');
  try {
    const sms = require('./config/sms');

    if (sms.isConfigured) {
      log.success('Twilio: Configured and ready');
      passCount++;
    } else {
      log.warn('Twilio: Not configured (credentials missing) - using test mode');
      skipCount++;
    }
  } catch (err) {
    log.error(`Twilio: ${err.message}`);
    failCount++;
  }
}

function testSentry() {
  log.info('Testing Sentry...');
  try {
    const sentryDsn = process.env.SENTRY_DSN;

    if (sentryDsn) {
      log.success('Sentry: Configured and ready');
      passCount++;
    } else {
      log.warn('Sentry: Not configured (DSN missing)');
      skipCount++;
    }
  } catch (err) {
    log.error(`Sentry: ${err.message}`);
    failCount++;
  }
}

async function runTests() {
  console.log(`\n${colors.blue}MANAWA Backend - External Services Test${colors.reset}\n`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Run all tests in sequence
  await testDatabase();
  await testRedis();
  await testBullQueues();
  await testFirebase();
  testMailjet();
  testTwilio();
  testSentry();

  // Summary
  console.log(`\n${colors.blue}Test Summary${colors.reset}`);
  console.log(`${colors.green}✓ Passed:${colors.reset} ${passCount}`);
  console.log(`${colors.yellow}⚠ Skipped:${colors.reset} ${skipCount}`);
  console.log(`${colors.red}✗ Failed:${colors.reset} ${failCount}`);

  const total = passCount + skipCount + failCount;
  const percentage = total > 0 ? Math.round((passCount / total) * 100) : 0;
  console.log(`\nOverall: ${percentage}% healthy\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

// Run tests
runTests().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
