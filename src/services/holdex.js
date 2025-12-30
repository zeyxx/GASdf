/**
 * HolDex Integration - Token Verification & K-score Oracle
 *
 * HolDex is the $ASDF ecosystem's single source of truth for:
 * - Community verification (hasCommunityUpdate)
 * - K-score calculation with conviction analysis
 * - Metal rank tiers (Diamond/Platinum/Gold/Silver/Bronze/Rust)
 *
 * Metal Ranks:
 *   💎 Diamond  = K-score 90+ (level 6)
 *   💠 Platinum = K-score 80+ (level 5)
 *   🥇 Gold     = K-score 60+ (level 4)
 *   🥈 Silver   = K-score 40+ (level 3)
 *   🥉 Bronze   = K-score 20+ (level 2)
 *   🔩 Rust     = K-score <20 (level 1)
 *
 * @see https://github.com/sollama58/HolDex
 */

const config = require('../utils/config');
const logger = require('../utils/logger');

// Cache token data (reduces API calls)
const tokenCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ERROR_CACHE_TTL = 30 * 1000; // 30 seconds for errors (retry sooner)

// API configuration
const HOLDEX_TIMEOUT = 5000; // 5 seconds

// Accepted tiers for gasless transactions
// Diamond/Platinum/Gold = trusted, Silver/Bronze/Rust = rejected
const ACCEPTED_TIERS = new Set(['Diamond', 'Platinum', 'Gold']);

// All valid tier names (including new Rust tier)
const VALID_TIERS = new Set(['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Rust']);

/**
 * Get metal rank info from K-score
 * Matches HolDex getKRank() function
 * @param {number} score - K-score (0-100)
 * @returns {{tier: string, icon: string, level: number}}
 */
function getKRank(score) {
  if (score >= 90) return { tier: 'Diamond', icon: '💎', level: 6 };
  if (score >= 80) return { tier: 'Platinum', icon: '💠', level: 5 };
  if (score >= 60) return { tier: 'Gold', icon: '🥇', level: 4 };
  if (score >= 40) return { tier: 'Silver', icon: '🥈', level: 3 };
  if (score >= 20) return { tier: 'Bronze', icon: '🥉', level: 2 };
  return { tier: 'Rust', icon: '🔩', level: 1 };
}

/**
 * Get token data from HolDex
 * @param {string} mint - Token mint address
 * @returns {Promise<{tier: string, kScore: number, kRank: object, hasCommunityUpdate: boolean, conviction?: object, cached: boolean, error?: string}>}
 */
async function getToken(mint) {
  // Check cache first
  const cached = tokenCache.get(mint);
  if (cached) {
    const ttl = cached.isError ? ERROR_CACHE_TTL : CACHE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
      return { ...cached.data, cached: true };
    }
  }

  const holdexUrl = config.HOLDEX_URL;
  if (!holdexUrl) {
    logger.debug('HOLDEX', 'HOLDEX_URL not configured, skipping verification');
    const kRank = getKRank(0);
    return { tier: 'Rust', kScore: 0, kRank, hasCommunityUpdate: false, cached: false, error: 'HOLDEX_URL not configured' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOLDEX_TIMEOUT);

    const response = await fetch(`${holdexUrl}/token/${mint}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      // Token not found in HolDex = Rust tier
      if (response.status === 404) {
        const kRank = getKRank(0);
        const result = { tier: 'Rust', kScore: 0, kRank, hasCommunityUpdate: false };
        cacheResult(mint, result);
        return { ...result, cached: false };
      }
      throw new Error(`HolDex returned ${response.status}`);
    }

    const data = await response.json();

    // Handle response structure: { token: { kScore, kRank, hasCommunityUpdate, conviction } }
    const token = data.token || data;
    const kScore = typeof token.kScore === 'number' ? token.kScore : (token.k_score ?? 0);

    // Use kRank from API if available, otherwise calculate locally
    const kRank = token.kRank || getKRank(kScore);
    const tier = VALID_TIERS.has(kRank.tier) ? kRank.tier : getKRank(kScore).tier;
    const hasCommunityUpdate = token.hasCommunityUpdate === true || token.hascommunityupdate === true;

    // Extract conviction data if available
    const conviction = token.conviction ? {
      score: token.conviction.score || 0,
      accumulators: token.conviction.accumulators || 0,
      holders: token.conviction.holders || 0,
      reducers: token.conviction.reducers || 0,
      extractors: token.conviction.extractors || 0,
      analyzed: token.conviction.analyzed || 0,
    } : null;

    const result = { tier, kScore, kRank, hasCommunityUpdate, conviction };
    cacheResult(mint, result);

    logger.debug('HOLDEX', 'Token data fetched', {
      mint: mint.slice(0, 8),
      tier,
      kScore,
      level: kRank.level,
    });

    return { ...result, cached: false };
  } catch (error) {
    logger.warn('HOLDEX', 'Token fetch failed', {
      mint: mint.slice(0, 8),
      error: error.message,
    });

    // Cache the error to avoid hammering a failing service
    const kRank = getKRank(0);
    tokenCache.set(mint, {
      data: { tier: 'Rust', kScore: 0, kRank, hasCommunityUpdate: false },
      timestamp: Date.now(),
      isError: true,
    });

    return { tier: 'Rust', kScore: 0, kRank, hasCommunityUpdate: false, cached: false, error: error.message };
  }
}

/**
 * Check if a token's tier is accepted for gasless transactions
 * @param {string} mint - Token mint address
 * @returns {Promise<{accepted: boolean, tier: string, kScore: number, cached: boolean, error?: string}>}
 */
async function isTokenAccepted(mint) {
  const tokenData = await getToken(mint);
  return {
    accepted: ACCEPTED_TIERS.has(tokenData.tier),
    ...tokenData,
  };
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use getToken() or isTokenAccepted() instead
 */
async function isVerifiedCommunity(mint) {
  const tokenData = await getToken(mint);
  return {
    verified: tokenData.hasCommunityUpdate && ACCEPTED_TIERS.has(tokenData.tier),
    kScore: tokenData.kScore,
    cached: tokenData.cached,
    error: tokenData.error,
  };
}

/**
 * Cache a token result
 */
function cacheResult(mint, data) {
  tokenCache.set(mint, {
    data,
    timestamp: Date.now(),
    isError: false,
  });
}

/**
 * Clear the token cache
 */
function clearCache() {
  tokenCache.clear();
  logger.info('HOLDEX', 'Cache cleared');
}

/**
 * Get cache stats for monitoring
 */
function getCacheStats() {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;

  for (const [, entry] of tokenCache) {
    const ttl = entry.isError ? ERROR_CACHE_TTL : CACHE_TTL;
    if (now - entry.timestamp < ttl) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    totalEntries: tokenCache.size,
    validEntries,
    expiredEntries,
  };
}

module.exports = {
  getToken,
  isTokenAccepted,
  getKRank,
  isVerifiedCommunity, // deprecated, for backward compatibility
  clearCache,
  getCacheStats,
  ACCEPTED_TIERS,
  VALID_TIERS,
};
