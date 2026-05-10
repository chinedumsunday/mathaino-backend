require('dotenv').config();

const app = require('./app');
const prisma = require('./config/database');
const { initializeFirebase } = require('./config/firebase');
const logger = require('./config/logger');

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    // Initialize Firebase Admin
    initializeFirebase();
    logger.info('Firebase Admin initialized');

    // Test database connection
    await prisma.$connect();
    logger.info('PostgreSQL connected via Prisma');

    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`EdTain API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
      logger.info(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down');
  await prisma.$disconnect();
  process.exit(0);
});

main();
