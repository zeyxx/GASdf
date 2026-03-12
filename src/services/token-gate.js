/**
 * Token Gating - Phase 0 Whitelist Model
 *
 * Accepted tokens: USDC, USDT, PYUSD, $ASDF
 * HolDex K-score removed — single point of failure.
 */

const { MINTS, TOKEN_INFO } = require('../constants');
const logger = require('../utils/logger');

const WHITELIST = new Map([
  [MINTS.USDC, TOKEN_INFO[MINTS.USDC]],
  [MINTS.USDT, TOKEN_INFO[MINTS.USDT]],
  [MINTS.PYUSD, TOKEN_INFO[MINTS.PYUSD]],
  [MINTS.ASDF, TOKEN_INFO[MINTS.ASDF]],
]);

/**
 * Check if a token is accepted for payment.
 * @param {string} mint - Token mint address
 * @returns {{accepted: boolean, reason: string}}
 */
function isTokenAccepted(mint) {
  if (WHITELIST.has(mint)) {
    return { accepted: true, reason: 'whitelisted' };
  }

  logger.info('TOKEN_GATE', 'Token rejected - not whitelisted', {
    mint: mint.slice(0, 8),
  });

  return { accepted: false, reason: 'not_whitelisted' };
}

/**
 * Get list of accepted tokens (for /tokens endpoint).
 * @returns {Array<{mint: string, symbol: string, name: string, decimals: number}>}
 */
function getAcceptedTokens() {
  return [...WHITELIST.entries()].map(([mint, info]) => ({
    mint,
    ...info,
  }));
}

/**
 * Check if a token is in the whitelist (sync).
 * @param {string} mint
 * @returns {boolean}
 */
function isWhitelisted(mint) {
  return WHITELIST.has(mint);
}

module.exports = {
  isTokenAccepted,
  getAcceptedTokens,
  isWhitelisted,
  WHITELIST,
};
