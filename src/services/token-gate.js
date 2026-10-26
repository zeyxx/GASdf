/**
 * Token Gating — Phase 0 Whitelist Model (service facade).
 *
 * Thin adapter over the pure domain. Holds mutable state (whitelist,
 * HolDex cache) and I/O (fetch, logger). Domain logic lives in
 * src/domain/token-gate/.
 */

const { MINTS, TOKEN_INFO } = require('../constants');
const logger = require('../utils/logger');
const domain = require('../domain/token-gate/token-gate');
const holdexAdapter = require('../adapters/holdex/token-list');

// Mutable whitelist state (adapter concern, not domain)
let whitelist = domain.createBaseWhitelist(MINTS, TOKEN_INFO);

const HOLDEX_TTL_MS = 60 * 60 * 1000;
let holdexRefreshedAt = 0;

/**
 * Merge HolDex-listed tokens into the whitelist (I/O + cache).
 * @returns {Promise<number>} merged entries count
 */
async function refreshFromHoldex() {
  const url = process.env.HOLDEX_TOKENS_URL;
  if (!url) return 0;
  const now = Date.now();
  if (now - holdexRefreshedAt < HOLDEX_TTL_MS) return 0;
  const list = await holdexAdapter.fetchTokens(url);
  const before = whitelist.size;
  whitelist = domain.mergeHoldexTokens(whitelist, list);
  const merged = whitelist.size - before;
  holdexRefreshedAt = now;
  logger.info('TOKEN_GATE', 'HolDex list merged', { merged });
  return merged;
}

function isTokenAccepted(mint) {
  const result = domain.isTokenAccepted(whitelist, mint);
  if (!result.accepted) {
    logger.info('TOKEN_GATE', 'Token rejected - not whitelisted', {
      mint: typeof mint === 'string' ? mint.slice(0, 8) : mint,
    });
  }
  return result;
}

function getAcceptedTokens() {
  return domain.getAcceptedTokens(whitelist);
}

function isWhitelisted(mint) {
  return domain.isWhitelisted(whitelist, mint);
}

module.exports = {
  isTokenAccepted,
  getAcceptedTokens,
  isWhitelisted,
  refreshFromHoldex,
  // Expose for testing / backward compat
  get WHITELIST() {
    return whitelist;
  },
};