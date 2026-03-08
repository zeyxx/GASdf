/**
 * K-score Oracle - Phase 0 Stub
 *
 * HolDex removed. Phase 0 uses whitelist-only model.
 * Oracle functions now reflect whitelist state.
 *
 * @deprecated This module is a Phase 0 stub. Remove in Phase 3 with Unified Score.
 */

const logger = require('../utils/logger');
const { WHITELIST } = require('./token-gate');

// Legacy tier constants (kept for health check callers)
const K_TIERS = {
  TRUSTED: { minScore: 80 },
  STANDARD: { minScore: 50 },
  RISKY: { minScore: 20 },
  UNKNOWN: { minScore: 0 },
};

// Phase 0: whitelist is the source of truth
const TRUSTED_TOKENS = new Set(WHITELIST.keys());

/**
 * Get K-score for a token (Phase 0: whitelist only)
 * @deprecated Phase 0 stub
 */
async function getKScore(mint) {
  if (TRUSTED_TOKENS.has(mint)) {
    return { score: 100, tier: 'TRUSTED' };
  }
  return { score: 0, tier: 'UNKNOWN' };
}

/**
 * Get oracle health status (Phase 0: whitelist model)
 */
function getOracleHealth() {
  return {
    provider: 'whitelist',
    status: 'CONFIGURED',
    tokens: WHITELIST.size,
  };
}

/**
 * Ping oracle (Phase 0: always healthy — no external dep)
 */
async function pingOracle() {
  return { success: true, latencyMs: 0, source: 'whitelist' };
}

/**
 * Clear cache (no-op in Phase 0)
 */
function clearCache() {
  logger.info('ORACLE', 'Cache cleared (whitelist model — no-op)');
}

module.exports = {
  getKScore,
  getOracleHealth,
  pingOracle,
  clearCache,
  K_TIERS,
  TRUSTED_TOKENS,
};
