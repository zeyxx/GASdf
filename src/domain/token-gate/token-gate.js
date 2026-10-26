/**
 * Token gating — pure domain logic (Phase 0 Whitelist Model).
 *
 * Accepted tokens: USDC, USDT, PYUSD, wSOL, $ASDF (static base) plus
 * HolDex-listed cult tokens merged at runtime.
 * K-score removed — single point of failure. No E-score, no holder tiers.
 *
 * Domain layer: pure logic, zero I/O. The whitelist is injected (not
 * hardcoded here) so the domain stays testable and the I/O (HolDex fetch)
 * lives in an adapter.
 */

/**
 * Build the static base whitelist from mints + token info.
 * @param {Object} mints - {USDC, USDT, PYUSD, WSOL, ASDF}
 * @param {Object} tokenInfo - {mint: {symbol, name, decimals}}
 * @returns {Map<string, {symbol, name, decimals, source}>}
 */
function createBaseWhitelist(mints, tokenInfo) {
  const wl = new Map();
  for (const key of Object.keys(mints)) {
    const mint = mints[key];
    const info = tokenInfo[mint];
    if (info) {
      wl.set(mint, { ...info, source: 'static' });
    }
  }
  return wl;
}

/**
 * Check if a token is accepted for payment.
 * @param {Map} whitelist
 * @param {string} mint
 * @returns {{accepted: boolean, reason: string}}
 */
function isTokenAccepted(whitelist, mint) {
  if (whitelist.has(mint)) {
    return { accepted: true, reason: 'whitelisted' };
  }
  return { accepted: false, reason: 'not_whitelisted' };
}

/**
 * Check if a token is in the whitelist (sync).
 * @param {Map} whitelist
 * @param {string} mint
 * @returns {boolean}
 */
function isWhitelisted(whitelist, mint) {
  return whitelist.has(mint);
}

/**
 * Get list of accepted tokens.
 * @param {Map} whitelist
 * @returns {Array<{mint, symbol, name, decimals, source}>}
 */
function getAcceptedTokens(whitelist) {
  return [...whitelist.entries()].map(([mint, info]) => ({ mint, ...info }));
}

/**
 * Merge HolDex-listed tokens into a whitelist (pure, returns new map).
 * @param {Map} whitelist
 * @param {Array<{mint, symbol, name, decimals}>} list
 * @returns {Map} new whitelist with merged entries
 */
function mergeHoldexTokens(whitelist, list) {
  const wl = new Map(whitelist);
  for (const t of list || []) {
    if (t && t.mint && t.symbol) {
      wl.set(t.mint, {
        symbol: t.symbol,
        name: t.name || t.symbol,
        decimals: t.decimals ?? 6,
        source: 'holdex',
      });
    }
  }
  return wl;
}

module.exports = {
  createBaseWhitelist,
  isTokenAccepted,
  isWhitelisted,
  getAcceptedTokens,
  mergeHoldexTokens,
};