/**
 * K-score Oracle - Legacy Wrapper
 *
 * This module now delegates to HolDex as the single source of truth.
 * Kept for backward compatibility with existing health checks and monitoring.
 *
 * Tier mapping (HolDex Metal Ranks → Legacy):
 *   Diamond (90+)  → TRUSTED (100)
 *   Platinum (80+) → TRUSTED (85)
 *   Gold (60+)     → STANDARD (65)
 *   Silver (40+)   → RISKY (35)
 *   Bronze (20+)   → UNKNOWN (15)
 *   Rust (<20)     → UNKNOWN (5)
 *
 * @deprecated Use holdex.js directly for new code
 */

const config = require('../utils/config');
const logger = require('../utils/logger');
const holdex = require('./holdex');

// Legacy tier mapping for backward compatibility
const TIER_TO_LEGACY = {
  Diamond: { tier: 'TRUSTED', score: 100 },
  Platinum: { tier: 'TRUSTED', score: 85 },
  Gold: { tier: 'STANDARD', score: 65 },
  Silver: { tier: 'RISKY', score: 35 },
  Bronze: { tier: 'UNKNOWN', score: 15 },
  Rust: { tier: 'UNKNOWN', score: 5 },
};

// Legacy K_TIERS (no fee multipliers - $ASDF philosophy)
const K_TIERS = {
  TRUSTED: { minScore: 80 },
  STANDARD: { minScore: 50 },
  RISKY: { minScore: 20 },
  UNKNOWN: { minScore: 0 },
};

// Diamond tokens - same as holdex DIAMOND_TOKENS
const TRUSTED_TOKENS = new Set([
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump', // $ASDF
]);

/**
 * Get K-score for a token (delegates to HolDex)
 * @deprecated Use holdex.getToken() directly
 */
async function getKScore(mint) {
  // Check Diamond tokens locally (instant)
  if (TRUSTED_TOKENS.has(mint)) {
    return { score: 100, tier: 'TRUSTED', holdexTier: 'Diamond', kRank: holdex.getKRank(100) };
  }

  // Delegate to HolDex
  const tokenData = await holdex.getToken(mint);
  const legacy = TIER_TO_LEGACY[tokenData.tier] || TIER_TO_LEGACY.Rust;

  return {
    score: tokenData.kScore || legacy.score,
    tier: legacy.tier,
    holdexTier: tokenData.tier,
    kRank: tokenData.kRank,
  };
}

/**
 * Get oracle health status for monitoring
 * Now reports HolDex health
 */
function getOracleHealth() {
  const holdexUrl = config.HOLDEX_URL;
  const cacheStats = holdex.getCacheStats();

  return {
    configured: !!holdexUrl,
    url: holdexUrl ? holdexUrl.replace(/api-key=[^&]+/, 'api-key=***') : null,
    provider: 'HolDex',
    cacheSize: cacheStats.totalEntries,
    validCacheEntries: cacheStats.validEntries,
    status: holdexUrl ? 'CONFIGURED' : 'NOT_CONFIGURED',
  };
}

/**
 * Ping oracle to check connectivity (pings HolDex)
 */
async function pingOracle() {
  const holdexUrl = config.HOLDEX_URL;

  if (!holdexUrl) {
    return { success: false, error: 'HOLDEX_URL not configured' };
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${holdexUrl}/health`, {
      signal: controller.signal,
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs: latency };
    }
    return { success: false, error: `HTTP ${response.status}`, latencyMs: latency };
  } catch (error) {
    return { success: false, error: error.message, latencyMs: Date.now() - startTime };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Clear cache (delegates to HolDex)
 */
function clearCache() {
  holdex.clearCache();
  logger.info('ORACLE', 'Cache cleared (via HolDex)');
}

module.exports = {
  getKScore,
  getOracleHealth,
  pingOracle,
  clearCache,
  K_TIERS,
  TRUSTED_TOKENS,
};
