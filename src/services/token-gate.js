/**
 * Token Gating - Phase 0 Whitelist Model
 *
 * Accepted tokens: USDC, USDT, PYUSD, wSOL, $ASDF (static base) plus
 * HolDex-listed cult tokens merged at runtime when HOLDEX_TOKENS_URL is set.
 * K-score removed — single point of failure. No E-score, no holder tiers.
 */

const { MINTS, TOKEN_INFO } = require('../constants');
const logger = require('../utils/logger');

const WHITELIST = new Map([
  [MINTS.USDC, TOKEN_INFO[MINTS.USDC]],
  [MINTS.USDT, TOKEN_INFO[MINTS.USDT]],
  [MINTS.PYUSD, TOKEN_INFO[MINTS.PYUSD]],
  [MINTS.WSOL, TOKEN_INFO[MINTS.WSOL]],
  [MINTS.ASDF, TOKEN_INFO[MINTS.ASDF]],
]);

const HOLDEX_TTL_MS = 60 * 60 * 1000;
let holdexRefreshedAt = 0;

/**
 * Merge HolDex-listed tokens into the whitelist.
 * Expects HOLDEX_TOKENS_URL to serve [{mint, symbol, name, decimals}].
 * Memory-cached 1h; static base always stays. No-op when unset.
 * @returns {Promise<number>} merged entries count
 */
async function refreshFromHoldex() {
  const url = process.env.HOLDEX_TOKENS_URL;
  if (!url) return 0;
  const now = Date.now();
  if (now - holdexRefreshedAt < HOLDEX_TTL_MS) return 0;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`holdex list ${res.status}`);
  const list = await res.json();
  let merged = 0;
  for (const t of list) {
    if (t && t.mint && t.symbol) {
      WHITELIST.set(t.mint, {
        symbol: t.symbol,
        name: t.name || t.symbol,
        decimals: t.decimals ?? 6,
        source: 'holdex',
      });
      merged += 1;
    }
  }
  holdexRefreshedAt = now;
  logger.info('TOKEN_GATE', 'HolDex list merged', { merged });
  return merged;
}

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
  refreshFromHoldex,
  WHITELIST,
};
