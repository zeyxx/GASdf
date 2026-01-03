const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./utils/config');
const logger = require('./utils/logger');
const redis = require('./utils/redis');
const db = require('./utils/db');
const { securityHeaders, globalLimiter } = require('./middleware/security');
const { startBurnWorker } = require('./services/burn');
const { collect: collectMetrics, metricsMiddleware } = require('./utils/metrics');
const {
  startMonitoring: startAlertMonitoring,
  stopMonitoring: stopAlertMonitoring,
  alertingService,
} = require('./services/alerting');
const dataSync = require('./services/data-sync');

// Routes
const quoteRouter = require('./routes/quote');
const submitRouter = require('./routes/submit');
const tokensRouter = require('./routes/tokens');
const statsRouter = require('./routes/stats');
const healthRouter = require('./routes/health');
const adminRouter = require('./routes/admin');

const app = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(securityHeaders);
app.use(
  cors({
    // SECURITY: In production, require explicit ALLOWED_ORIGINS - never default to '*'
    origin: config.IS_DEV ? '*' : process.env.ALLOWED_ORIGINS?.split(',') || [],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-request-id'],
  })
);

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

  // SECURITY: Only accept API key from header, never from query params
  const apiKey = req.headers['x-metrics-key'];
  const expectedKey = process.env.METRICS_API_KEY;

  // Warn if someone tries to use query param (legacy/attack detection)
  if (req.query.key) {
    logger.warn('METRICS', 'API key in query param rejected (security risk)', {
      ip: req.ip,
    });
  }

  // Production: require METRICS_API_KEY
  if (config.IS_PROD && !expectedKey) {
    logger.error('METRICS', 'METRICS_API_KEY not configured in production');
    return res.status(503).json({ error: 'Metrics not configured' });
  }

  // Validate API key if configured
  if (expectedKey && apiKey !== expectedKey) {
    logger.warn('METRICS', 'Unauthorized metrics access attempt', { ip: req.ip });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.set('Content-Type', 'text/plain');
  res.send(collectMetrics());
});

// Alerts endpoint (requires same auth as metrics - operational data)
app.get('/alerts', (req, res) => {
  // SECURITY: Only accept API key from header
  const apiKey = req.headers['x-metrics-key'];
  const expectedKey = process.env.METRICS_API_KEY;

  // Production: require METRICS_API_KEY
  if (config.IS_PROD && !expectedKey) {
    return res.status(503).json({ error: 'Alerts not configured' });
  }

  // Validate API key if configured
  if (expectedKey && apiKey !== expectedKey) {
    logger.warn('ALERTS', 'Unauthorized alerts access attempt', { ip: req.ip });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({
    enabled: alertingService.isEnabled(),
    active: alertingService.getActiveAlerts(),
    history: alertingService.getHistory(20),
  });
});

// Public status page endpoint (for external monitoring)
// Cache status for 10 seconds to prevent abuse
let statusCache = { data: null, timestamp: 0 };
const STATUS_CACHE_TTL = 10000; // 10 seconds

app.get('/status', async (req, res) => {
  try {
    // Return cached response if fresh
    if (statusCache.data && Date.now() - statusCache.timestamp < STATUS_CACHE_TTL) {
      return res.json(statusCache.data);
    }

    const rpc = require('./utils/rpc');
    const redisClient = require('./utils/redis');
    const oracle = require('./services/oracle');

    // Gather all health checks in parallel
    const startTime = Date.now();
    const [rpcHealth, redisState, oracleHealth] = await Promise.all([
      (async () => {
        try {
          const conn = rpc.getConnection();
          await conn.getSlot();
          return { status: 'operational' };
        } catch {
          return { status: 'degraded' };
        }
      })(),
      (async () => {
        const state = redisClient.getConnectionState();
        if (state.isHealthy) return { status: 'operational' };
        if (state.isMemoryFallback) return { status: 'degraded' };
        return { status: 'outage' };
      })(),
      (async () => {
        const health = oracle.getOracleHealth();
        if (health.status === 'HEALTHY') return { status: 'operational' };
        if (health.status === 'DEGRADED') return { status: 'degraded' };
        return { status: 'unknown' };
      })(),
    ]);

    // Calculate overall status
    const components = {
      api: { status: 'operational' }, // If we got here, API is up
      rpc: rpcHealth,
      database: redisState,
      oracle: oracleHealth,
    };

    const statuses = Object.values(components).map((c) => c.status);
    let overall = 'operational';
    if (statuses.includes('outage')) overall = 'major_outage';
    else if (statuses.includes('degraded')) overall = 'degraded';

    // Response compatible with common status page formats
    const response = {
      status: overall,
      updated_at: new Date().toISOString(),
      response_time_ms: Date.now() - startTime,
      components,
      // Upptime-compatible format
      page: {
        name: 'GASdf',
        url: 'https://gasdf.io',
      },
      // Simple status indicators
      indicators: {
        operational: overall === 'operational',
        degraded: overall === 'degraded',
        outage: overall === 'major_outage',
      },
    };

    // Cache the response
    statusCache = { data: response, timestamp: Date.now() };

    res.json(response);
  } catch (error) {
    res.status(503).json({
      status: 'major_outage',
      updated_at: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// API Routes - v1 (versioned)
app.use('/v1/quote', quoteRouter);
app.use('/v1/submit', submitRouter);
app.use('/v1/tokens', tokensRouter);
app.use('/v1/stats', statsRouter);
app.use('/v1/health', healthRouter);

// Admin routes (protected by API key)
app.use('/admin', adminRouter);

// API Routes - legacy (backwards compatibility)
// Deprecation middleware
const deprecationWarning = (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Wed, 01 Jul 2026 00:00:00 GMT');
  res.set('Link', `</v1${req.path}>; rel="successor-version"`);
  next();
};
app.use('/quote', deprecationWarning, quoteRouter);
app.use('/submit', deprecationWarning, submitRouter);
app.use('/tokens', deprecationWarning, tokensRouter);
app.use('/stats', deprecationWarning, statsRouter);
app.use('/health', deprecationWarning, healthRouter);

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

    // Initialize PostgreSQL (optional - for analytics/history)
    logger.info('BOOT', 'Initializing PostgreSQL connection...');
    await db.initialize();
    const dbConnected = db.isConnected();

    // Start data sync service (Redis ↔ PostgreSQL)
    if (dbConnected) {
      logger.info('BOOT', 'Starting data sync service...');
      dataSync.start();

      // Set up memory → Redis sync on reconnection
      redis.setOnReconnectCallback(dataSync.syncMemoryToRedis);

      // Restore stats from PostgreSQL if Redis was wiped
      await dataSync.restoreStatsFromPostgres();
    }

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
        ['POSTGRES', dbConnected, dbConnected ? '' : '(disabled)'],
      ];

      checks.forEach(([name, ok, extra = '']) => {
        console.log(`  ${ok ? '✓' : '○'} ${name}${extra ? ' ' + extra : ''}`);
      });
      console.log('');

      // Start burn worker only if properly configured
      if (
        config.FEE_PAYER_PRIVATE_KEY &&
        config.ASDF_MINT &&
        !config.ASDF_MINT.includes('DEVNET')
      ) {
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

  // Force sync data before shutdown
  try {
    await dataSync.forceSync();
    dataSync.stop();
    logger.info('SHUTDOWN', 'Data sync stopped');
  } catch (err) {
    logger.warn('SHUTDOWN', 'Data sync error', { error: err.message });
  }

  // Give active requests time to complete
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Disconnect databases gracefully
  try {
    await redis.disconnect();
  } catch (err) {
    logger.warn('SHUTDOWN', 'Redis disconnect error', { error: err.message });
  }

  try {
    await db.disconnect();
  } catch (err) {
    logger.warn('SHUTDOWN', 'PostgreSQL disconnect error', { error: err.message });
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
