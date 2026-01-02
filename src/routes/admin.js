/**
 * Admin Routes
 * Protected endpoints for administrative operations
 */

const express = require('express');
const logger = require('../utils/logger');
const { checkAndExecuteBurn, getTreasuryTokenBalances } = require('../services/burn');

const router = express.Router();

// =============================================================================
// Admin Authentication Middleware
// =============================================================================

function adminAuth(req, res, next) {
  // SECURITY: Only accept API key from header, never from query params
  // Query params are logged in server logs, browser history, and referrer headers
  const apiKey = req.headers['x-admin-key'];
  const expectedKey = process.env.ADMIN_API_KEY;

  // Warn if someone tries to use query param (legacy/attack detection)
  if (req.query.key) {
    logger.warn('ADMIN', 'API key in query param rejected (security risk)', {
      ip: req.ip,
      path: req.path,
    });
  }

  if (!expectedKey) {
    logger.warn('ADMIN', 'Admin endpoint accessed but ADMIN_API_KEY not configured');
    return res.status(503).json({
      error: 'Admin API not configured',
      code: 'ADMIN_NOT_CONFIGURED',
    });
  }

  if (!apiKey || apiKey !== expectedKey) {
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

// Apply auth to all admin routes
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
          tokens: balances.map(b => ({
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
      tokens: balances.map(b => ({
        mint: b.mint,
        symbol: b.symbol,
        balance: b.uiAmount,
        valueUsd: b.valueUsd,
        eligible: b.valueUsd >= 0.50, // MIN_VALUE_USD
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
// POST /admin/migrate-redis - Migrate old Redis keys to prefixed format
// =============================================================================

router.post('/migrate-redis', async (req, res) => {
  const { dryRun = true } = req.body;

  try {
    logger.info('ADMIN', 'Redis key migration triggered', { dryRun, ip: req.ip });

    const { migrateRedisKeys } = require('../../scripts/migrate-redis-keys');
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

module.exports = router;
