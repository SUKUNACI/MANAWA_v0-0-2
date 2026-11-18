const prisma = require('../config/db');
const logger = require('./logger');

async function checkDatabaseHealth() {
  try {
    const result = await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorDetails = {
      message: error.message,
      code: error.code,
      syscall: error.syscall,
      address: error.address,
      port: error.port,
      errno: error.errno,
    };
    logger.error('Database health check failed (SELECT 1)', { error: errorDetails });
    return {
      status: 'unhealthy',
      error: error.message,
      code: error.code,
      syscall: error.syscall,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = { checkDatabaseHealth };
