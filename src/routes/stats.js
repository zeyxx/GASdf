const express = require('express');
const config = require('../utils/config');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /stats
 * Get public burn and treasury statistics
 */
router.get('/', async (req, res) => {
  try {
    const [stats, treasuryBalance] = await Promise.all([
      redis.getStats(),
      redis.getTreasuryBalance(),
    ]);

    res.json({
      // Burn stats
      totalBurned: stats.burnTotal,
      totalTransactions: stats.txCount,
      burnedFormatted: formatAsdf(stats.burnTotal),

      // Treasury stats (80/20 model)
      treasury: {
        balance: treasuryBalance,
        balanceFormatted: formatSol(treasuryBalance),
        model: '80/20',
        burnRatio: config.BURN_RATIO,
        treasuryRatio: config.TREASURY_RATIO,
      },
    });
  } catch (error) {
    logger.error('STATS', 'Failed to get stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /stats/treasury
 * Get detailed treasury information
 */
router.get('/treasury', async (req, res) => {
  try {
    const [balance, history] = await Promise.all([
      redis.getTreasuryBalance(),
      redis.getTreasuryHistory(20),
    ]);

    res.json({
      balance,
      balanceFormatted: formatSol(balance),
      model: {
        name: '80/20 Treasury Model',
        description: '80% of fees burn $ASDF, 20% fund operations',
        burnRatio: config.BURN_RATIO,
        treasuryRatio: config.TREASURY_RATIO,
      },
      recentEvents: history,
    });
  } catch (error) {
    logger.error('STATS', 'Failed to get treasury stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get treasury stats' });
  }
});

function formatAsdf(amount) {
  // $ASDF has 6 decimals
  const decimals = 6;
  const formatted = (amount / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} $ASDF`;
}

function formatSol(lamports) {
  const sol = lamports / 1e9;
  return `${sol.toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })} SOL`;
}

module.exports = router;
