/**
 * Token Gating - Phase 0 Whitelist Model
 *
 * Phase 0: Hardcoded whitelist only. No external dependencies.
 * HolDex K-score removed — single point of failure (403 in prod, killed service).
 *
 * Accepted tokens:
 *   USDC — swap to SOL for gas, surplus → buy+burn $ASDF
 *   USDT — swap to SOL for gas, surplus → buy+burn $ASDF
 *   $ASDF — 100% burn channel (every unit paid becomes deflationary pressure)
 *
 * Future: Unified Score (Phase 3) when ecosystem matures.
 */

const logger = require('../utils/logger');

// =============================================================================
// WHITELIST — Only these tokens accepted as gas payment
// =============================================================================
// Key: mint address
// Value: token metadata
// =============================================================================
const WHITELIST = new Map([
  [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  [
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  ],
  [
    '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
    { symbol: 'ASDF', name: '$asdfasdfa', decimals: 6 },
  ],
]);

/**
 * Check if a token is accepted for payment.
 * Phase 0: whitelist check only, no network calls.
 *
 * @param {string} mint - Token mint address
 * @returns {Promise<{accepted: boolean, reason: string, tier: string, kScore?: number}>}
 */
async function isTokenAccepted(mint) {
  if (WHITELIST.has(mint)) {
    return {
      accepted: true,
      reason: 'whitelisted',
      tier: 'Diamond',
      kScore: 100,
    };
  }

  logger.info('TOKEN_GATE', 'Token rejected — not whitelisted', {
    mint: mint.slice(0, 8),
  });

  return {
    accepted: false,
    reason: 'not_whitelisted',
    tier: null,
  };
}

/**
 * Get list of accepted tokens (for /tokens endpoint).
 */
function getDiamondTokensList() {
  return [...WHITELIST.entries()].map(([mint, info]) => ({
    mint,
    ...info,
    tier: 'Diamond',
  }));
}

/**
 * Check if a token is in the whitelist (sync, no network).
 */
function isDiamondToken(mint) {
  return WHITELIST.has(mint);
}

// Compat shims for code that imports DIAMOND_TOKENS as a Set
const DIAMOND_TOKENS = new Set(WHITELIST.keys());

// Legacy exports for backward compatibility
const TRUSTED_TOKENS = DIAMOND_TOKENS;
const getAcceptedTokensList = getDiamondTokensList;
const isTrustedToken = isDiamondToken;

module.exports = {
  isTokenAccepted,
  isDiamondToken,
  getDiamondTokensList,
  WHITELIST,
  DIAMOND_TOKENS,

  // Legacy (deprecated but kept for existing callers)
  isTrustedToken,
  getAcceptedTokensList,
  TRUSTED_TOKENS,
};
