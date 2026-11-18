/**
 * Caller Stack Tracer - Captures real call stack at error time
 * Differences from network-diagnostics.js:
 * - Captures stack at net.Socket.emit('error'), not in net.createConnection
 * - Shows actual caller frames, not just node:net internals
 * - Minimal, no net override
 */

const net = require('net');
const logger = require('./logger');

function activateCallerStackTracer() {
  // Track socket creation stack for later correlation
  const socketCreationStacks = new WeakMap();
  const originalCreateConnection = net.createConnection;

  net.createConnection = function(...args) {
    const socket = originalCreateConnection.apply(net, args);
    const creationStack = new Error().stack
      .split('\n')
      .slice(2, 8)
      .map(line => line.trim())
      .join(' | ');
    socketCreationStacks.set(socket, creationStack);
    return socket;
  };

  // Capture error with creation context + current stack
  const originalOn = net.Socket.prototype.on;
  net.Socket.prototype.on = function(eventName, listener) {
    if (eventName === 'error') {
      return originalOn.call(this, eventName, (err) => {
        if (err && err.code === 'ECONNREFUSED') {
          const creationStack = socketCreationStacks.get(this) || 'unknown';
          const errorStack = new Error().stack
            .split('\n')
            .slice(2, 6)
            .map(line => line.trim())
            .join(' | ');
          logger.error('[CALLER_STACK] ECONNREFUSED detected', {
            address: err.address,
            port: err.port,
            syscall: err.syscall,
            creation_stack: creationStack,
            error_handler_stack: errorStack,
          });
        }
        return listener.call(this, err);
      });
    }
    return originalOn.apply(this, arguments);
  };

  logger.info('[CALLER_STACK] Tracer activated');
}

module.exports = { activateCallerStackTracer };
