const express = require('express');
const logger = require('../utils/logger');
const { scoreLimiter } = require('../middleware/security');
const { getAllTiers, getHolderTier } = require('../services/holder-tiers');
const { getAcceptedTokensList, isTokenAccepted } = require('../services/token-gate');

const router = express.Router();

/**
 * GET /tokens
 * Get list of supported payment tokens (trusted tokens)
 * HolDex-verified tokens are also accepted but not listed here
 */
router.get('/', (req, res) => {
  res.json({
    tokens: getAcceptedTokensList(),
    note: 'HolDex-verified community tokens are also accepted',
  });
});

/**
 * GET /tokens/:mint/check
 * Check if a token is accepted for payment
 */
router.get('/:mint/check', scoreLimiter, async (req, res) => {
  try {
    const { mint } = req.params;

    // Validate mint address format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return res.status(400).json({ error: 'Invalid mint address format' });
    }

    const result = await isTokenAccepted(mint);

    res.json({
      mint,
      accepted: result.accepted,
      reason: result.reason,
    });
  } catch (error) {
    logger.error('TOKENS', 'Token check failed', { mint: req.params.mint, error: error.message });
    res.status(500).json({ error: 'Failed to check token' });
  }
});

/**
 * GET /tokens/tiers
 * Get $ASDF holder tier structure
 */
router.get('/tiers', (req, res) => {
  res.json({
    tiers: getAllTiers(),
    description: 'Hold $ASDF to get fee discounts. The more you hold, the lower your fees.',
  });
});

/**
 * GET /tokens/tiers/:wallet
 * Get holder tier for a specific wallet
 */
router.get('/tiers/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    // Validate wallet address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    const tierInfo = await getHolderTier(wallet);

    res.json({
      wallet,
      tier: tierInfo.tier,
      emoji: tierInfo.emoji,
      asdfBalance: tierInfo.balance,
      sharePercent: tierInfo.sharePercent,
      circulating: tierInfo.circulating,
      discountPercent: tierInfo.discountPercent,
    });
  } catch (error) {
    logger.error('TOKENS', 'Tier lookup failed', {
      wallet: req.params.wallet,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to get tier info' });
  }
});

module.exports = router;
