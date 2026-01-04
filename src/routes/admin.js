/**
 * Admin Routes
 * Protected endpoints for administrative operations
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { checkAndExecuteBurn, getTreasuryTokenBalances } = require('../services/burn');
const db = require('../utils/db');

const router = express.Router();

// =============================================================================
// Admin Rate Limiting
// =============================================================================

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Admin rate limit exceeded',
    code: 'ADMIN_RATE_LIMITED',
  },
  // Use default key generator (handles IPv6 properly)
  validate: { xForwardedForHeader: false },
});

// =============================================================================
// Admin Authentication Middleware
// =============================================================================

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeCompare(a, b) {
  if (!a || !b) return false;
  // Ensure both strings are same length to prevent early exit
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function adminAuth(req, res, next) {
  // SECURITY: Only accept API key from header, never from query params
  // Query params are logged in server logs, browser history, and referrer headers
  const apiKey = req.headers['x-admin-key'] || '';
  const expectedKey = process.env.ADMIN_API_KEY || '';

  // Warn if someone tries to use query param (legacy/attack detection)
  if (req.query.key) {
    logger.warn('ADMIN', 'API key in query param rejected (security risk)', {
      ip: req.ip,
      path: req.path,
    });
  }

  // SECURITY: Always perform timing-safe comparison to prevent timing oracle
  // Even if expectedKey is empty, we compare to prevent detection of config state
  const isValidKey = timingSafeCompare(apiKey, expectedKey);
  const isConfigured = expectedKey.length > 0;

  if (!isConfigured) {
    logger.warn('ADMIN', 'Admin endpoint accessed but ADMIN_API_KEY not configured');
    return res.status(503).json({
      error: 'Admin API not configured',
      code: 'ADMIN_NOT_CONFIGURED',
    });
  }

  // SECURITY: Use timing-safe comparison to prevent timing attacks
  if (!isValidKey) {
    logger.warn('ADMIN', 'Unauthorized admin access attempt', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'INVALID_API_KEY',
    });
  }

  next();
}

// Apply rate limiting and auth to all admin routes
router.use(adminLimiter);
router.use(adminAuth);

// =============================================================================
// POST /admin/burn - Trigger burn manually
// =============================================================================

router.post('/burn', async (req, res) => {
  const startTime = Date.now();

  try {
    logger.info('ADMIN', 'Manual burn triggered', { ip: req.ip });

    // Check current treasury balances first
    const balances = await getTreasuryTokenBalances();

    if (balances.length === 0) {
      return res.json({
        success: false,
        message: 'No tokens to burn',
        treasury: {
          tokens: [],
          totalValueUsd: 0,
        },
      });
    }

    // Execute burn
    const result = await checkAndExecuteBurn();

    if (!result) {
      return res.json({
        success: false,
        message: 'Burn not executed (already in progress or below threshold)',
        treasury: {
          tokens: balances.map((b) => ({
            mint: b.mint,
            symbol: b.symbol,
            balance: b.uiAmount,
            valueUsd: b.valueUsd,
          })),
        },
      });
    }

    logger.info('ADMIN', 'Manual burn completed', {
      processed: result.processed.length,
      totalBurned: result.totalBurned,
      duration: Date.now() - startTime,
    });

    res.json({
      success: true,
      message: 'Burn executed successfully',
      result: {
        processed: result.processed,
        failed: result.failed,
        totalBurnedAsdf: result.totalBurned / 1e6,
        totalTreasurySol: result.totalTreasury / 1e9,
      },
      duration: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('ADMIN', 'Manual burn failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'BURN_FAILED',
    });
  }
});

// =============================================================================
// GET /admin/treasury - Get treasury status
// =============================================================================

router.get('/treasury', async (req, res) => {
  try {
    const balances = await getTreasuryTokenBalances();

    res.json({
      tokens: balances.map((b) => ({
        mint: b.mint,
        symbol: b.symbol,
        balance: b.uiAmount,
        valueUsd: b.valueUsd,
        eligible: b.valueUsd >= 0.5, // MIN_VALUE_USD
      })),
      totalTokens: balances.length,
      totalValueUsd: balances.reduce((sum, b) => sum + (b.valueUsd || 0), 0),
    });
  } catch (error) {
    logger.error('ADMIN', 'Treasury check failed', { error: error.message });
    res.status(500).json({
      error: error.message,
      code: 'TREASURY_CHECK_FAILED',
    });
  }
});

// =============================================================================
// GET /admin/transactions - Get transaction history from PostgreSQL
// =============================================================================

router.get('/transactions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await db.getTransactionHistory(limit, offset);

    if (!result) {
      return res.status(503).json({
        error: 'PostgreSQL not available',
        code: 'DB_UNAVAILABLE',
      });
    }

    res.json({
      transactions: result.transactions,
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.transactions.length < result.total,
    });
  } catch (error) {
    logger.error('ADMIN', 'Transaction history query failed', { error: error.message });
    res.status(500).json({
      error: error.message,
      code: 'QUERY_FAILED',
    });
  }
});

// =============================================================================
// GET /admin/burns - Get burn history from PostgreSQL
// =============================================================================

router.get('/burns', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const result = await db.getBurnHistory(limit);

    if (!result) {
      return res.status(503).json({
        error: 'PostgreSQL not available',
        code: 'DB_UNAVAILABLE',
      });
    }

    res.json({
      burns: result.burns,
      total: result.total,
      limit,
    });
  } catch (error) {
    logger.error('ADMIN', 'Burn history query failed', { error: error.message });
    res.status(500).json({
      error: error.message,
      code: 'QUERY_FAILED',
    });
  }
});

// =============================================================================
// POST /admin/migrate-redis - Migrate old Redis keys to prefixed format
// =============================================================================

router.post('/migrate-redis', async (req, res) => {
  const { dryRun = true } = req.body;

  try {
    logger.info('ADMIN', 'Redis key migration triggered', { dryRun, ip: req.ip });

    const {
      migrateRedisKeys,
      cleanupOldKeys: _cleanupOldKeys,
    } = require('../../scripts/migrate-redis-keys');
    const result = await migrateRedisKeys(dryRun);

    logger.info('ADMIN', 'Redis key migration completed', {
      success: result.success,
      migrated: result.stats?.migrated || 0,
    });

    res.json(result);
  } catch (error) {
    logger.error('ADMIN', 'Redis key migration failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'MIGRATION_FAILED',
    });
  }
});

// =============================================================================
// POST /admin/cleanup-redis - Delete old unprefixed Redis keys
// =============================================================================

router.post('/cleanup-redis', async (req, res) => {
  const { dryRun = true } = req.body;

  try {
    logger.info('ADMIN', 'Redis cleanup triggered', { dryRun, ip: req.ip });

    const { cleanupOldKeys } = require('../../scripts/migrate-redis-keys');
    const result = await cleanupOldKeys(dryRun);

    logger.info('ADMIN', 'Redis cleanup completed', {
      success: result.success,
      deleted: result.stats?.deleted || 0,
    });

    res.json(result);
  } catch (error) {
    logger.error('ADMIN', 'Redis cleanup failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'CLEANUP_FAILED',
    });
  }
});

module.exports = router;
