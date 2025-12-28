/**
 * HolDex Integration - Community Verification
 *
 * HolDex is the $ASDF ecosystem's token verification service.
 * A token with hasCommunityUpdate=true has a verified community.
 *
 * @see https://github.com/sollama58/HolDex
 */

const config = require('../utils/config');
const logger = require('../utils/logger');

// Cache verified tokens (reduces API calls)
const verificationCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ERROR_CACHE_TTL = 30 * 1000; // 30 seconds for errors (retry sooner)

// API configuration
const HOLDEX_TIMEOUT = 5000; // 5 seconds

/**
 * Check if a token's community is verified by HolDex
 * @param {string} mint - Token mint address
 * @returns {Promise<{verified: boolean, kScore: number, cached: boolean, error?: string}>}
 */
async function isVerifiedCommunity(mint) {
  // Check cache first
  const cached = verificationCache.get(mint);
  if (cached) {
    const ttl = cached.isError ? ERROR_CACHE_TTL : CACHE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
      return { verified: cached.verified, kScore: cached.kScore || 0, cached: true };
    }
  }

  const holdexUrl = config.HOLDEX_URL;
  if (!holdexUrl) {
    logger.debug('HOLDEX', 'HOLDEX_URL not configured, skipping verification');
    return { verified: false, kScore: 0, cached: false, error: 'HOLDEX_URL not configured' };
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
      // Token not found in HolDex = not verified
      if (response.status === 404) {
        cacheResult(mint, false, 0);
        return { verified: false, kScore: 0, cached: false };
      }
      throw new Error(`HolDex returned ${response.status}`);
    }

    const data = await response.json();

    // Handle response structure: { success: true, token: { hasCommunityUpdate: true, kScore: 70 } }
    const token = data.token || data;
    const verified = token.hasCommunityUpdate === true || token.hascommunityupdate === true;
    const kScore = token.kScore ?? token.k_score ?? 0;

    cacheResult(mint, verified, kScore);

    logger.debug('HOLDEX', 'Verification result', {
      mint: mint.slice(0, 8),
      verified,
      kScore,
    });

    return { verified, kScore, cached: false };
  } catch (error) {
    logger.warn('HOLDEX', 'Verification check failed', {
      mint: mint.slice(0, 8),
      error: error.message,
    });

    // Cache the error to avoid hammering a failing service
    verificationCache.set(mint, {
      verified: false,
      kScore: 0,
      timestamp: Date.now(),
      isError: true,
    });

    return { verified: false, kScore: 0, cached: false, error: error.message };
  }
}

/**
 * Cache a verification result
 */
function cacheResult(mint, verified, kScore = 0) {
  verificationCache.set(mint, {
    verified,
    kScore,
    timestamp: Date.now(),
    isError: false,
  });
}

/**
 * Clear the verification cache
 */
function clearCache() {
  verificationCache.clear();
  logger.info('HOLDEX', 'Cache cleared');
}

/**
 * Get cache stats for monitoring
 */
function getCacheStats() {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;

  for (const [, entry] of verificationCache) {
    const ttl = entry.isError ? ERROR_CACHE_TTL : CACHE_TTL;
    if (now - entry.timestamp < ttl) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    totalEntries: verificationCache.size,
    validEntries,
    expiredEntries,
  };
}

module.exports = {
  isVerifiedCommunity,
  clearCache,
  getCacheStats,
};
