const express = require('express');
const logger = require('../utils/logger');
const { scoreLimiter } = require('../middleware/security');
const holdex = require('../services/holdex');

const router = express.Router();

/**
 * GET /holdex/tokens
 * Proxy to HolDex API - returns verified community tokens
 * Frontend calls this instead of HolDex directly (avoids exposing API key)
 */
router.get('/tokens', scoreLimiter, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const result = await holdex.getAllTokens(limit);

    if (!result.success) {
      logger.warn('HOLDEX_PROXY', 'getAllTokens failed', { error: result.error });
      return res.status(502).json({
        success: false,
        error: 'Failed to fetch tokens from HolDex',
      });
    }

    res.json({
      success: true,
      tokens: result.tokens,
      source: 'holdex',
    });
  } catch (error) {
    logger.error('HOLDEX_PROXY', 'Unexpected error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /holdex/token/:mint
 * Proxy to HolDex API - returns single token data
 */
router.get('/token/:mint', scoreLimiter, async (req, res) => {
  try {
    const { mint } = req.params;

    // Validate mint address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mint address format',
      });
    }

    const tokenData = await holdex.getToken(mint);

    // getToken returns token data directly with error property if failed
    if (tokenData.error && tokenData.tier === 'Rust') {
      return res.status(404).json({
        success: false,
        error: tokenData.error,
      });
    }

    res.json({
      success: true,
      token: tokenData,
      source: 'holdex',
    });
  } catch (error) {
    logger.error('HOLDEX_PROXY', 'getToken error', { mint: req.params.mint, error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /holdex/status
 * HolDex integration status
 */
router.get('/status', (req, res) => {
  const status = holdex.getStatus();
  res.json({
    configured: status.configured,
    hasApiKey: status.hasApiKey,
    circuitBreaker: status.circuitBreaker.state,
  });
});

module.exports = router;
