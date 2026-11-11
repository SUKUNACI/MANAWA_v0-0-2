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
    logger.error('Database health check failed', {
      error: error.message,
      code: error.code,
    });
    return {
      status: 'unhealthy',
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = { checkDatabaseHealth };
