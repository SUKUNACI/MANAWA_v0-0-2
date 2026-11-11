const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFile = path.join(logsDir, 'app.log');
const errorFile = path.join(logsDir, 'error.log');

function formatLog(level, message, data = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  });
}

function writeLog(file, entry) {
  try {
    fs.appendFileSync(file, entry + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to write log:', err.message);
  }
}

const logger = {
  info(message, data = {}) {
    const entry = formatLog('INFO', message, data);
    console.log(entry);
    writeLog(logFile, entry);
  },

  warn(message, data = {}) {
    const entry = formatLog('WARN', message, data);
    console.warn(entry);
    writeLog(logFile, entry);
  },

  error(message, data = {}) {
    const entry = formatLog('ERROR', message, data);
    console.error(entry);
    writeLog(logFile, entry);
    writeLog(errorFile, entry);
  },

  debug(message, data = {}) {
    if (process.env.DEBUG === 'true') {
      const entry = formatLog('DEBUG', message, data);
      console.log(entry);
      writeLog(logFile, entry);
    }
  },
};

module.exports = logger;
