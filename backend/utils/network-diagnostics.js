/**
 * Network Diagnostics - Temporary instrumentation
 * Observes TCP connection attempts and logs errors with source identification
 * Does NOT intercept or change error handling - purely observational
 *
 * Activation: require() this at app startup before any network operations
 */

const net = require('net');
const logger = require('./logger');

let instrumentationActive = false;

function activateNetworkDiagnostics() {
  if (instrumentationActive) return;
  instrumentationActive = true;

  const originalCreateConnection = net.createConnection;

  // Override net.createConnection to observe connection attempts
  net.createConnection = function(...args) {
    const socket = originalCreateConnection.apply(net, args);

    // Extract connection parameters
    const params = args[0];
    const options = typeof params === 'object' ? params : {};
    const host = options.host || args[0]?.toString?.() || 'unknown';
    const port = options.port || (typeof args[1] === 'number' ? args[1] : 'unknown');

    const connId = `${host}:${port}`;

    // Get caller stack trace (expurgated)
    const stack = new Error().stack
      .split('\n')
      .slice(0, 6)
      .map(line => line.replace(/:[0-9]+:[0-9]+/g, ':***:***'))
      .join('|');

    // Log connection attempt
    logger.debug('[NET_DIAG] Connection attempt', { connId, caller_frame: stack.split('|')[2] });

    // Observe error event WITHOUT preventing it
    const originalOn = socket.on.bind(socket);
    socket.on = function(event, listener) {
      if (event === 'error') {
        return originalOn(event, function(err) {
          // Log error with source context BEFORE calling original listener
          logger.error('[NET_DIAG] Connection error', {
            connId,
            code: err.code,
            syscall: err.syscall,
            errno: err.errno,
            address: err.address,
            port: err.port,
            message: err.message?.slice(0, 100),
          });

          // If AggregateError, log sub-errors
          if (err.errors && Array.isArray(err.errors)) {
            err.errors.forEach((subErr, idx) => {
              logger.error(`[NET_DIAG] AggregateError[${idx}]`, {
                connId,
                code: subErr.code,
                syscall: subErr.syscall,
              });
            });
          }

          // Call original listener - error propagates unchanged
          return listener.call(this, err);
        });
      }
      return originalOn(event, listener);
    };

    return socket;
  };

  logger.info('[NET_DIAG] Network diagnostics activated');
}

module.exports = { activateNetworkDiagnostics };
