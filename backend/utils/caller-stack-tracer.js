/**
 * Caller Stack Tracer - Captures ECONNREFUSED with caller context
 * Handles both net.Socket and tls.TLSSocket error paths
 * Captures creation stack (where connection was initiated)
 */

const net = require('net');
const tls = require('tls');
const logger = require('./logger');

function activateCallerStackTracer() {
  const socketStacks = new WeakMap();

  // Capture stack when net.createConnection is called
  const originalNetCreate = net.createConnection;
  net.createConnection = function(...args) {
    const socket = originalNetCreate.apply(net, args);
    const creationStack = new Error().stack
      .split('\n')
      .slice(2, 7)
      .filter(line => !line.includes('node:'))
      .join(' | ') || 'net.createConnection';
    socketStacks.set(socket, creationStack);
    return socket;
  };

  // Capture stack when tls.connect is called (rediss:// uses this)
  const originalTlsConnect = tls.connect;
  tls.connect = function(...args) {
    const socket = originalTlsConnect.apply(tls, args);
    const creationStack = new Error().stack
      .split('\n')
      .slice(2, 7)
      .filter(line => !line.includes('node:'))
      .join(' | ') || 'tls.connect';
    socketStacks.set(socket, creationStack);
    return socket;
  };

  // Hook error events on both net.Socket and tls.TLSSocket
  [net.Socket, tls.TLSSocket].forEach(SocketClass => {
    const originalOn = SocketClass.prototype.on;
    SocketClass.prototype.on = function(eventName, listener) {
      if (eventName === 'error') {
        return originalOn.call(this, eventName, (err) => {
          if (err && (err.code === 'ECONNREFUSED' || err.errno === 'ECONNREFUSED')) {
            const creationStack = socketStacks.get(this) || 'unknown';
            logger.error('[CALLER_STACK] ECONNREFUSED', {
              address: err.address,
              port: err.port,
              syscall: err.syscall,
              caller_frames: creationStack,
            });
          }
          return listener.call(this, err);
        });
      }
      return originalOn.apply(this, arguments);
    };
  });

  logger.info('[CALLER_STACK] Tracer activated (net + tls)');
}

module.exports = { activateCallerStackTracer };
