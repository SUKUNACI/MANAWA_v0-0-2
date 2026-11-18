#!/usr/bin/env node
/**
 * Test: Tracer captures TLS (rediss://) connection failures
 */

const tls = require('tls');
const { activateCallerStackTracer } = require('./utils/caller-stack-tracer');

// Mock logger
const logger = {
  error: (msg, data) => console.error('[ERROR]', msg, JSON.stringify(data, null, 2)),
  info: (msg, data) => console.log('[INFO]', msg, JSON.stringify(data, null, 2)),
};
require.cache[require.resolve('./utils/logger')] = { exports: logger };

activateCallerStackTracer();

console.log('\n=== TEST: TLS connection to refused port (127.0.0.1:6379) ===\n');

// Simulate rediss:// client connecting to refused port
const socket = tls.connect({
  host: '127.0.0.1',
  port: 6379,
  rejectUnauthorized: false,
  timeout: 2000,
});

socket.on('error', (err) => {
  console.log('\n[TEST] TLS error received with caller frames logged above');
  process.exit(0);
});

setTimeout(() => {
  console.log('[TEST] Timeout');
  process.exit(1);
}, 3000);
