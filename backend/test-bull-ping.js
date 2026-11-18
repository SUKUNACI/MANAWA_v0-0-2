#!/usr/bin/env node
/**
 * Test: Bull queue connection ready event and PING to verify Redis connectivity
 */

require('dotenv').config();

const Queue = require('bull');
const logger = console;

const redisUrl = process.env.REDIS_URL || '';
if (!redisUrl) {
  console.error('[TEST] REDIS_URL not set');
  process.exit(1);
}

console.log(`[TEST] Testing Bull connection to ${redisUrl.replace(/:[^:/@]*@/, ':***@')}`);

// Parse URL to extract host/port (mimic queue.js logic)
const urlObj = new URL(redisUrl);
const isTls = urlObj.protocol === 'rediss:';
const host = urlObj.hostname;
const port = urlObj.port || (isTls ? 6380 : 6379);

console.log(`[TEST] Parsed: host=${host}, port=${port}, tls=${isTls}`);

// Create a test queue with same config as production
const testQueue = new Queue('test-queue', {
  redis: {
    host,
    port: parseInt(port, 10),
    password: urlObj.password || undefined,
    ...(isTls && { tls: {} }),
    connectTimeout: 5000,
    maxRetriesPerRequest: null,
  },
});

let readyFired = false;
let errorFired = false;

testQueue.on('ready', () => {
  readyFired = true;
  console.log('[TEST] ✅ Queue READY event fired');
});

testQueue.on('error', (err) => {
  errorFired = true;
  console.log(`[TEST] ❌ Queue ERROR: ${err.message}`);
  console.log(`[TEST]    Code: ${err.code}, Errno: ${err.errno}`);
  if (err.address) console.log(`[TEST]    Address: ${err.address}`);
  if (err.port) console.log(`[TEST]    Port: ${err.port}`);
});

testQueue.on('connected', () => {
  console.log('[TEST] Queue connected to Redis');
});

// Try PING via the queue's internal client
setTimeout(async () => {
  try {
    // Access internal Redis client if available
    if (testQueue.client && testQueue.client.ping) {
      const pingResult = await testQueue.client.ping();
      console.log(`[TEST] ✅ PING result: ${pingResult}`);
    } else if (testQueue.bclient && testQueue.bclient.ping) {
      const pingResult = await testQueue.bclient.ping();
      console.log(`[TEST] ✅ PING via bclient: ${pingResult}`);
    } else {
      console.log('[TEST] ⚠️  Queue clients not accessible for PING');
    }
  } catch (err) {
    console.log(`[TEST] ❌ PING failed: ${err.message}`);
  }

  // Check status
  console.log(`[TEST] Status: readyFired=${readyFired}, errorFired=${errorFired}`);

  if (readyFired) {
    console.log('[TEST] ✅ CONNECTION SUCCESS: Queue reached ready state');
    process.exit(0);
  } else if (errorFired) {
    console.log('[TEST] ❌ CONNECTION FAILED: Queue emitted error');
    process.exit(1);
  } else {
    console.log('[TEST] ⚠️  Connection status unclear after 5s');
    process.exit(2);
  }
}, 5000);

// Cleanup timeout
setTimeout(() => {
  console.log('[TEST] ⚠️  Test timeout after 10s');
  process.exit(3);
}, 10000);
