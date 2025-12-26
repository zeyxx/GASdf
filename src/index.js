const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./utils/config');
const logger = require('./utils/logger');
const redis = require('./utils/redis');
const { securityHeaders, globalLimiter } = require('./middleware/security');
const { startBurnWorker } = require('./services/burn');
const { collect: collectMetrics, metricsMiddleware } = require('./utils/metrics');
const { startMonitoring: startAlertMonitoring, stopMonitoring: stopAlertMonitoring, alertingService } = require('./services/alerting');

// Routes
const quoteRouter = require('./routes/quote');
const submitRouter = require('./routes/submit');
const tokensRouter = require('./routes/tokens');
const statsRouter = require('./routes/stats');
const healthRouter = require('./routes/health');

const app = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(securityHeaders);
app.use(cors({
  origin: config.IS_DEV ? '*' : process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-request-id'],
}));

// Request parsing
app.use(express.json({ limit: '100kb' }));

// Logging
app.use(logger.requestLogger);

// Metrics middleware
app.use(metricsMiddleware);

// Global rate limit
app.use(globalLimiter);

// Static files (dashboard)
app.use(express.static(path.join(__dirname, '../public')));

// Metrics endpoint (Prometheus scrape target)
app.get('/metrics', (req, res) => {
  if (!config.PROMETHEUS_ENABLED) {
    return res.status(404).json({ error: 'Metrics disabled' });
  }

  // Optional: require API key for metrics
  const apiKey = req.headers['x-metrics-key'] || req.query.key;
  if (process.env.METRICS_API_KEY && apiKey !== process.env.METRICS_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.set('Content-Type', 'text/plain');
  res.send(collectMetrics());
});

// Alerts endpoint
app.get('/alerts', (req, res) => {
  res.json({
    enabled: alertingService.isEnabled(),
    active: alertingService.getActiveAlerts(),
    history: alertingService.getHistory(20),
  });
});

// API Routes
app.use('/quote', quoteRouter);
app.use('/submit', submitRouter);
app.use('/tokens', tokensRouter);
app.use('/stats', statsRouter);
app.use('/health', healthRouter);

// Root redirect to dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('EXPRESS', 'Unhandled error', {
    requestId: req.requestId,
    error: err.message,
    stack: config.IS_DEV ? err.stack : undefined,
  });

  res.status(500).json({
    error: 'Internal server error',
    requestId: req.requestId,
  });
});

// Async startup
let server;

async function start() {
  try {
    // Initialize Redis first (required in production)
    logger.info('BOOT', 'Initializing Redis connection...');
    await redis.initializeClient();
    const redisState = redis.getConnectionState();

    // Start HTTP server
    server = app.listen(config.PORT, () => {
      console.log(`
  ╔═══════════════════════════════════════╗
  ║           GASdf Server                ║
  ║   Gasless transactions for Solana     ║
  ╠═══════════════════════════════════════╣
  ║   Port: ${config.PORT.toString().padEnd(29)}║
  ║   Network: ${config.NETWORK.padEnd(26)}║
  ║   Mode: ${config.ENV.padEnd(28)}║
  ╚═══════════════════════════════════════╝
      `);

      // Show config status
      const checks = [
        ['FEE_PAYER', !!config.FEE_PAYER_PRIVATE_KEY],
        ['ASDF_MINT', !!config.ASDF_MINT && !config.ASDF_MINT.includes('DEVNET')],
        ['RPC', !!config.RPC_URL],
        ['REDIS', redisState.isHealthy, redisState.isMemoryFallback ? '(memory)' : ''],
      ];

      checks.forEach(([name, ok, extra = '']) => {
        console.log(`  ${ok ? '✓' : '○'} ${name}${extra ? ' ' + extra : ''}`);
      });
      console.log('');

      // Start burn worker only if properly configured
      if (config.FEE_PAYER_PRIVATE_KEY && config.ASDF_MINT && !config.ASDF_MINT.includes('DEVNET')) {
        startBurnWorker(60000);
      } else if (config.IS_DEV) {
        logger.info('BOOT', 'Burn worker disabled (dev mode or missing ASDF_MINT)');
      }

      // Start alert monitoring (checks every 60 seconds)
      startAlertMonitoring(60000);
    });
  } catch (error) {
    logger.error('BOOT', 'Failed to start server', { error: error.message });
    process.exit(1);
  }
}

start();

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('SHUTDOWN', `Received ${signal}, starting graceful shutdown`);

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      logger.info('SHUTDOWN', 'HTTP server closed');
    });
  }

  // Stop alert monitoring
  stopAlertMonitoring();

  // Give active requests time to complete
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Disconnect Redis gracefully
  try {
    await redis.disconnect();
  } catch (err) {
    logger.warn('SHUTDOWN', 'Redis disconnect error', { error: err.message });
  }

  logger.info('SHUTDOWN', 'Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('FATAL', 'Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('FATAL', 'Unhandled rejection', { reason: String(reason) });
});

module.exports = app;
