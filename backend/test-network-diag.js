#!/usr/bin/env node
/**
 * Test: Network diagnostics observes refused connection without blocking it
 */

const net = require('net');
const { activateNetworkDiagnostics } = require('./utils/network-diagnostics');

// Mock logger for this test
const logger = {
  debug: (msg, data) => console.log('[DEBUG]', msg, JSON.stringify(data)),
  error: (msg, data) => console.error('[ERROR]', msg, JSON.stringify(data)),
  info: (msg, data) => console.log('[INFO]', msg, JSON.stringify(data)),
};

// Inject mock logger
require.cache[require.resolve('./utils/logger')].exports = logger;

// Activate diagnostics
activateNetworkDiagnostics();

console.log('\n=== TEST: Connection to refused port (127.0.0.1:9999) ===\n');

// Try to connect to port that will refuse connection
const socket = net.createConnection({
  host: '127.0.0.1',
  port: 9999,
  timeout: 2000,
});

// Set up error listener
socket.on('error', (err) => {
  console.log('\n[TEST] Socket error event received:');
  console.log('  - Code:', err.code);
  console.log('  - Syscall:', err.syscall);
  console.log('  - Address:', err.address);
  console.log('  - Port:', err.port);
  console.log('\n✅ TEST PASSED: Error was observable and did not disappear');
  process.exit(0);
});

socket.on('timeout', () => {
  console.log('[TEST] Socket timeout');
  process.exit(0);
});

// Wait 5 seconds, then fail if nothing happened
setTimeout(() => {
  console.log('[TEST] Timeout waiting for connection error');
  process.exit(1);
}, 5000);
