#!/usr/bin/env node
/**
 * Test: Caller stack tracer captures real frames
 */

const net = require('net');
const { activateCallerStackTracer } = require('./utils/caller-stack-tracer');

// Mock logger
const logger = {
  error: (msg, data) => console.error('[ERROR]', msg, JSON.stringify(data, null, 2)),
  info: (msg, data) => console.log('[INFO]', msg, JSON.stringify(data, null, 2)),
};

// Inject mock logger
require.cache[require.resolve('./utils/logger')] = { exports: logger };

// Activate tracer
activateCallerStackTracer();

console.log('\n=== TEST: Connection to refused port (127.0.0.1:9999) ===\n');

// Simulate a client attempting connection
const socket = net.createConnection({
  host: '127.0.0.1',
  port: 9999,
  timeout: 2000,
});

socket.on('error', (err) => {
  console.log('\n[TEST] Socket error received with caller frames logged');
  process.exit(0);
});

setTimeout(() => {
  console.log('[TEST] Timeout');
  process.exit(1);
}, 3000);
