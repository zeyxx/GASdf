const express = require('express');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /stats
 * Get public burn statistics
 */
router.get('/', async (req, res) => {
  try {
    const stats = await redis.getStats();

    res.json({
      totalBurned: stats.burnTotal,
      totalTransactions: stats.txCount,
      burnedFormatted: formatAsdf(stats.burnTotal),
    });
  } catch (error) {
    logger.error('STATS', 'Failed to get stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

function formatAsdf(amount) {
  // Assuming 9 decimals for ASDF
  const decimals = 9;
  const formatted = (amount / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} $ASDF`;
}

module.exports = router;
