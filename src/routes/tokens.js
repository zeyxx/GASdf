const express = require('express');
const oracle = require('../services/oracle');
const logger = require('../utils/logger');
const { scoreLimiter } = require('../middleware/security');

const router = express.Router();

// Popular tokens for the dropdown
const POPULAR_TOKENS = [
  {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  },
  {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  },
  {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
  },
  {
    mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    symbol: 'mSOL',
    name: 'Marinade staked SOL',
    decimals: 9,
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png',
  },
  {
    mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    symbol: 'jitoSOL',
    name: 'Jito Staked SOL',
    decimals: 9,
    logoURI: 'https://storage.googleapis.com/token-metadata/JitoSOL-256.png',
  },
];

/**
 * GET /tokens
 * Get list of supported payment tokens
 */
router.get('/', (req, res) => {
  res.json({
    tokens: POPULAR_TOKENS,
  });
});

/**
 * GET /tokens/:mint/score
 * Get K-score for a specific token
 */
router.get('/:mint/score', scoreLimiter, async (req, res) => {
  try {
    const { mint } = req.params;

    // Validate mint address format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return res.status(400).json({ error: 'Invalid mint address format' });
    }

    const kScore = await oracle.getKScore(mint);

    res.json({
      mint,
      score: kScore.score,
      tier: kScore.tier,
      feeMultiplier: kScore.feeMultiplier,
    });
  } catch (error) {
    logger.error('TOKENS', 'Token score lookup failed', { mint: req.params.mint, error: error.message });
    res.status(500).json({ error: 'Failed to get token score' });
  }
});

module.exports = router;
