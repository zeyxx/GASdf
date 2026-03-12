const express = require('express');
const config = require('./utils/config');
const logger = require('./utils/logger');
const redis = require('./utils/redis');
const feePayer = require('./services/fee-payer');
const { startBurnWorker, stopBurnWorker } = require('./services/burn-worker');
const { securityHeaders, globalLimiter, quoteLimiter, submitLimiter } = require('./middleware/security');

const healthRouter = require('./routes/health');
const tokensRouter = require('./routes/tokens');
const quoteRouter = require('./routes/quote');
const submitRouter = require('./routes/submit');

const app = express();

// Middleware
app.use(express.json());
app.use(logger.requestLogger);
app.use(securityHeaders);
app.use(globalLimiter);

// Routes
app.use('/v1/health', healthRouter);
app.use('/v1/tokens', tokensRouter);
app.use('/v1/quote', quoteLimiter, quoteRouter);
app.use('/v1/submit', submitLimiter, submitRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error('EXPRESS', 'Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// Start
async function start() {
  await redis.initializeClient();
  feePayer.startBalanceMonitor();
  startBurnWorker();

  app.listen(config.PORT, () => {
    logger.info('SERVER', `GASdf running on port ${config.PORT}`, {
      env: config.ENV,
      network: config.NETWORK,
    });
  });
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info('SERVER', `${signal} received, shutting down...`);
  feePayer.stopBalanceMonitor();
  stopBurnWorker();
  await redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error('SERVER', 'Failed to start', { error: err.message });
  process.exit(1);
});

module.exports = app;
