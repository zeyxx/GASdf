const express = require('express');
const config = require('../utils/config');
const redis = require('../utils/redis');
const rpc = require('../utils/rpc');
const alt = require('../utils/alt');
const { getAllStatus: getCircuitBreakerStatus } = require('../utils/circuit-breaker');
const oracle = require('../services/oracle');
const holdex = require('../services/holdex');
const jupiter = require('../services/jupiter');
const pyth = require('../services/pyth');
const { withTimeout, HEALTH_CHECK_TIMEOUT } = require('../utils/fetch-timeout');

const router = express.Router();

// Track uptime
const startTime = Date.now();

/**
 * GET /health
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || '1.0.0',
    network: config.NETWORK,
    environment: config.ENV,
    checks: {},
  };

  // ==========================================================================
  // TIMEOUT PROTECTION: Each health check has individual timeout
  // ==========================================================================
  const checks = await Promise.allSettled([
    withTimeout(checkRedis(), HEALTH_CHECK_TIMEOUT, 'Redis health check'),
    withTimeout(checkRpc(), HEALTH_CHECK_TIMEOUT, 'RPC health check'),
    withTimeout(checkFeePayer(), HEALTH_CHECK_TIMEOUT, 'Fee payer health check'),
    withTimeout(checkVelocity(), HEALTH_CHECK_TIMEOUT, 'Velocity metrics'),
  ]);

  health.checks.redis = checks[0].status === 'fulfilled' ? checks[0].value : { status: 'error', error: checks[0].reason?.message };
  health.checks.rpc = checks[1].status === 'fulfilled' ? checks[1].value : { status: 'error', error: checks[1].reason?.message };
  health.checks.feePayer = checks[2].status === 'fulfilled' ? checks[2].value : { status: 'error', error: checks[2].reason?.message };

  // Velocity metrics (behavioral proof for treasury refill)
  health.velocity = checks[3].status === 'fulfilled' ? checks[3].value : { error: checks[3].reason?.message };

  // Add circuit breaker status
  health.circuitBreakers = getCircuitBreakerStatus();

  // Add oracle health
  health.oracle = oracle.getOracleHealth();

  // Add HolDex status (K-score oracle)
  health.holdex = holdex.getStatus();

  // Add Pyth oracle status (on-chain pricing)
  health.pyth = pyth.getStatus();

  // Add Jupiter API status (swap execution + fallback pricing)
  health.jupiter = jupiter.getApiInfo();

  // Add RPC pool health
  health.rpcPool = rpc.getRpcHealth();

  // Add ALT status (Address Lookup Tables for tx size reduction)
  health.alt = alt.getStatus();

  // Determine overall status
  // In staging/production, Redis is CRITICAL - treat it as error
  const hasError = Object.values(health.checks).some(c => c.status === 'error');
  const hasCriticalWarning = (config.IS_STAGING || config.IS_PROD) && health.checks.redis?.status === 'warning';
  const hasWarning = Object.values(health.checks).some(c => c.status === 'warning');

  // Check if any circuit breaker is open
  const hasOpenCircuitBreaker = Object.values(health.circuitBreakers).some(cb => cb.state === 'open');

  if (hasError || hasCriticalWarning) {
    health.status = 'unhealthy';
  } else if (hasWarning || hasOpenCircuitBreaker) {
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * GET /health/ready
 * Readiness probe (for k8s)
 * All critical dependencies must be available
 */
router.get('/ready', async (req, res) => {
  try {
    // Check critical dependencies with timeout protection
    const [redisCheck, rpcCheck, feePayerCheck] = await Promise.all([
      withTimeout(checkRedis(), HEALTH_CHECK_TIMEOUT, 'Redis').catch(() => ({ status: 'error', message: 'timeout' })),
      withTimeout(checkRpc(), HEALTH_CHECK_TIMEOUT, 'RPC').catch(() => ({ status: 'error', message: 'timeout' })),
      withTimeout(checkFeePayer(), HEALTH_CHECK_TIMEOUT, 'FeePayer').catch(() => ({ status: 'error', message: 'timeout' })),
    ]);

    // In staging/production, Redis is required
    const redisOk = config.IS_DEV
      ? redisCheck.status !== 'error'
      : redisCheck.status === 'ok'; // Staging and production require actual Redis

    const rpcOk = rpcCheck.status === 'ok';
    const feePayerOk = feePayerCheck.status !== 'error';

    if (redisOk && rpcOk && feePayerOk) {
      res.status(200).json({
        ready: true,
        checks: { redis: redisCheck.status, rpc: rpcCheck.status, feePayer: feePayerCheck.status },
      });
    } else {
      res.status(503).json({
        ready: false,
        checks: { redis: redisCheck.status, rpc: rpcCheck.status, feePayer: feePayerCheck.status },
      });
    }
  } catch (error) {
    res.status(503).json({ ready: false, error: error.message });
  }
});

/**
 * GET /health/live
 * Liveness probe (for k8s)
 */
router.get('/live', (req, res) => {
  res.status(200).json({ alive: true });
});

async function checkRedis() {
  try {
    const connectionState = redis.getConnectionState();

    // If using memory fallback
    if (connectionState.isMemoryFallback) {
      if (config.IS_DEV) {
        return {
          status: 'warning',
          type: 'memory',
          message: 'Using in-memory store (dev only)',
        };
      } else {
        // Staging/Production should never have memory fallback
        return {
          status: 'error',
          type: 'memory',
          message: 'Redis required in staging/production',
        };
      }
    }

    // Check actual Redis connection
    const pong = await redis.ping();
    if (pong) {
      return {
        status: 'ok',
        type: 'redis',
        state: connectionState.state,
      };
    }

    // Not connected
    if (config.IS_DEV) {
      return {
        status: 'warning',
        type: 'disconnected',
        message: 'Redis not connected',
      };
    }

    // Staging/Production
    return {
      status: 'error',
      type: 'disconnected',
      message: 'Redis connection required',
    };
  } catch (error) {
    if (config.IS_DEV) {
      return {
        status: 'warning',
        type: 'error',
        message: error.message,
      };
    }
    // Staging/Production
    return {
      status: 'error',
      type: 'error',
      message: error.message,
    };
  }
}

async function checkRpc() {
  try {
    const poolHealth = rpc.getRpcHealth();
    const conn = rpc.getConnection();
    const slot = await conn.getSlot();

    // Determine status based on pool health
    if (poolHealth.status === 'CRITICAL') {
      return { status: 'error', slot, network: config.NETWORK, pool: poolHealth.status };
    }
    if (poolHealth.status === 'DEGRADED') {
      return { status: 'warning', slot, network: config.NETWORK, pool: poolHealth.status };
    }
    return { status: 'ok', slot, network: config.NETWORK, pool: poolHealth.status };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

/**
 * Check velocity metrics (behavioral proof for treasury refill)
 */
async function checkVelocity() {
  try {
    const bufferCalc = await redis.calculateVelocityBasedBuffer();
    const velocity = bufferCalc.velocity;

    return {
      txPerHour: velocity.txPerHour,
      avgCostLamports: velocity.avgCost,
      hoursOfData: velocity.hoursOfData,
      txCount: velocity.txCount,
      requiredBufferSol: (bufferCalc.required / 1_000_000_000).toFixed(4),
      targetBufferSol: (bufferCalc.target / 1_000_000_000).toFixed(4),
      explanation: bufferCalc.explanation,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function checkFeePayer() {
  if (!config.FEE_PAYER_PRIVATE_KEY && config.FEE_PAYER_KEYS.length === 0) {
    if (config.IS_DEV) {
      return { status: 'warning', message: 'Not configured (dev mode)' };
    }
    // Staging/Production
    return { status: 'error', message: 'FEE_PAYER_PRIVATE_KEY required' };
  }

  try {
    const { getPayerBalances, getHealthSummary, MIN_HEALTHY_BALANCE, WARNING_BALANCE } = require('../services/signer');

    const balances = await getPayerBalances();
    const summary = getHealthSummary();

    // Format payer details
    const payers = balances.map(p => ({
      pubkey: `${p.pubkey.slice(0, 8)}...${p.pubkey.slice(-4)}`,
      balance: p.balanceSol.toFixed(4),
      status: p.status,
    }));

    // Determine overall status
    if (summary.critical > 0 && summary.healthy === 0) {
      return {
        status: 'error',
        message: 'All fee payers critically low',
        payers,
        summary,
      };
    }

    if (summary.critical > 0) {
      return {
        status: 'warning',
        message: `${summary.critical} of ${summary.total} payer(s) critical`,
        payers,
        summary,
      };
    }

    if (summary.warning > 0) {
      return {
        status: 'warning',
        message: `${summary.warning} of ${summary.total} payer(s) low balance`,
        payers,
        summary,
      };
    }

    return {
      status: 'ok',
      payers,
      summary,
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

module.exports = router;
