const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
    : [{ emit: 'event', level: 'error' }],
});

if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    logger.debug(`Query: ${e.query} | Duration: ${e.duration}ms`);
  });
}

prisma.$on('error', (e) => {
  logger.error(`Prisma error: ${e.message}`);
});

// Test connection on startup
(async () => {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');
  } catch (err) {
    logger.error(`Database connection failed: ${err.message}`);
    process.exit(1);
  }
})();

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
