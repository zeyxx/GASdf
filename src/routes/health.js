const express = require('express');
const router = express.Router();
const redis = require('../utils/redis');
const feePayer = require('../services/fee-payer');
const helius = require('../services/helius');
const logger = require('../utils/logger');

// GET /v1/health
router.get('/', async (req, res) => {
  try {
    const [redisPing, balanceInfo] = await Promise.all([
      redis.ping(),
      feePayer.checkBalance(),
    ]);

    const redisOk = !!redisPing;
    // Circuit breaker is informational — don't fail healthcheck for low balance
    const healthy = redisOk;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      redis: { connected: !!redisPing },
      feePayer: {
        address: feePayer.getPublicKey().toBase58(),
        solBalance: balanceInfo.solBalance,
        circuitOpen: balanceInfo.circuitOpen,
      },
      helius: { available: helius.isAvailable() },
    });
  } catch (err) {
    logger.error('HEALTH', 'Health check failed', { error: err.message });
    res.status(503).json({ status: 'error', error: err.message });
  }
});

module.exports = router;
