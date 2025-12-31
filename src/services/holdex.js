/**
 * HolDex Integration - Token Verification & K-score Oracle
 *
 * HolDex is the $ASDF ecosystem's single source of truth for:
 * - Community verification (hasCommunityUpdate)
 * - K-score calculation with conviction analysis
 * - Metal rank tiers
 * - Credit rating system (A1-D grades)
 *
 * K-score: 100 = native tokens (SOL), 0-99 for everything else
 *
 * Metal Ranks:
 *   💎 Diamond  = K-score 90-99 (level 8), 100 reserved for native tokens (SOL)
 *   💠 Platinum = K-score 80-89  (level 7)
 *   🥇 Gold     = K-score 70-79  (level 6)
 *   🥈 Silver   = K-score 60-69  (level 5)
 *   🥉 Bronze   = K-score 50-59  (level 4)
 *   🟤 Copper   = K-score 40-49  (level 3)
 *   ⚫ Iron     = K-score 20-39  (level 2)
 *   🔩 Rust     = K-score 0-19   (level 1)
 *
 * Credit Rating:
 *   A1 (90+) = Prime Quality, minimal risk
 *   A2 (80+) = Excellent, very low risk
 *   A3 (70+) = Good, low risk
 *   B1 (60+) = Fair, moderate risk
 *   B2 (50+) = Speculative, high risk
 *   B3 (40+) = Very Speculative, very high risk
 *   C  (20+) = Substantial Risk, severe risk
 *   D  (<20) = Default, extreme risk
 *
 * Acceptance: Bronze+ (K-score >= 50)
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

// Accepted tiers for gasless transactions (K-score >= 50)
// Diamond/Platinum/Gold/Silver/Bronze = accepted, Copper and below = rejected
const ACCEPTED_TIERS = new Set(['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze']);

// All valid tier names
const VALID_TIERS = new Set(['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Copper', 'Iron', 'Rust']);

/**
 * Get metal rank info from K-score
 * Matches HolDex getKRank() function
 * @param {number} score - K-score (0-100)
 * @returns {{tier: string, icon: string, level: number}}
 */
function getKRank(score) {
  if (score >= 90) return { tier: 'Diamond', icon: '💎', level: 8 };  // A1 [90-99], 100 = native
  if (score >= 80) return { tier: 'Platinum', icon: '💠', level: 7 }; // A2 [80-89]
  if (score >= 70) return { tier: 'Gold', icon: '🥇', level: 6 };     // A3 [70-79]
  if (score >= 60) return { tier: 'Silver', icon: '🥈', level: 5 };   // B1 [60-69]
  if (score >= 50) return { tier: 'Bronze', icon: '🥉', level: 4 };   // B2 [50-59]
  if (score >= 40) return { tier: 'Copper', icon: '🟤', level: 3 };   // B3 [40-49]
  if (score >= 20) return { tier: 'Iron', icon: '⚫', level: 2 };     // C  [20-39]
  return { tier: 'Rust', icon: '🔩', level: 1 };                      // D  [0-19]
}

/**
 * Get credit rating from K-score
 * Matches HolDex getCreditRating() function
 * @param {number} kScore - K-score (0-100)
 * @param {string|null} trajectory - Score trajectory: 'improving', 'slightly_improving', 'stable', 'slightly_declining', 'declining'
 * @returns {{grade: string, label: string, risk: string, outlook: string, trajectory: string}}
 */
function getCreditRating(kScore, trajectory = null) {
  // Trajectory bonus/malus
  let trajectoryModifier = 0;
  let trajectoryLabel = '→ Stable';

  if (trajectory === 'improving') {
    trajectoryModifier = 5;
    trajectoryLabel = '↗️ Improving';
  } else if (trajectory === 'slightly_improving') {
    trajectoryModifier = 2;
    trajectoryLabel = '↗ Slightly Up';
  } else if (trajectory === 'declining') {
    trajectoryModifier = -5;
    trajectoryLabel = '↘️ Declining';
  } else if (trajectory === 'slightly_declining') {
    trajectoryModifier = -2;
    trajectoryLabel = '↘ Slightly Down';
  }

  // Adjusted score for grade calculation
  const adjustedScore = Math.max(0, Math.min(100, kScore + trajectoryModifier));

  // Grade mapping
  let grade, label, risk;
  if (adjustedScore >= 90) {
    grade = 'A1'; label = 'Prime Quality'; risk = 'minimal';
  } else if (adjustedScore >= 80) {
    grade = 'A2'; label = 'Excellent'; risk = 'very_low';
  } else if (adjustedScore >= 70) {
    grade = 'A3'; label = 'Good'; risk = 'low';
  } else if (adjustedScore >= 60) {
    grade = 'B1'; label = 'Fair'; risk = 'moderate';
  } else if (adjustedScore >= 50) {
    grade = 'B2'; label = 'Speculative'; risk = 'high';
  } else if (adjustedScore >= 40) {
    grade = 'B3'; label = 'Very Speculative'; risk = 'very_high';
  } else if (adjustedScore >= 20) {
    grade = 'C'; label = 'Substantial Risk'; risk = 'severe';
  } else {
    grade = 'D'; label = 'Default'; risk = 'extreme';
  }

  // Outlook based on trajectory
  let outlook = 'stable';
  if (trajectoryModifier > 0) outlook = 'positive';
  else if (trajectoryModifier < 0) outlook = 'negative';

  return { grade, label, risk, outlook, trajectory: trajectoryLabel };
}

/**
 * Get token data from HolDex
 * @param {string} mint - Token mint address
 * @returns {Promise<{tier: string, kScore: number, kRank: object, creditRating: object, hasCommunityUpdate: boolean, conviction?: object, cached: boolean, error?: string}>}
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
    const creditRating = getCreditRating(0);
    return { tier: 'Rust', kScore: 0, kRank, creditRating, hasCommunityUpdate: false, cached: false, error: 'HOLDEX_URL not configured' };
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
        const creditRating = getCreditRating(0);
        const result = { tier: 'Rust', kScore: 0, kRank, creditRating, hasCommunityUpdate: false };
        cacheResult(mint, result);
        return { ...result, cached: false };
      }
      throw new Error(`HolDex returned ${response.status}`);
    }

    const data = await response.json();

    // Handle response structure: { token: { kScore, kRank, creditRating, hasCommunityUpdate, conviction } }
    const token = data.token || data;
    const kScore = typeof token.kScore === 'number' ? token.kScore : (token.k_score ?? 0);

    // Use kRank from API if available, otherwise calculate locally
    const kRank = token.kRank || getKRank(kScore);
    const tier = VALID_TIERS.has(kRank.tier) ? kRank.tier : getKRank(kScore).tier;
    const hasCommunityUpdate = token.hasCommunityUpdate === true || token.hascommunityupdate === true;

    // Use creditRating from API if available, otherwise calculate locally
    const creditRating = token.creditRating || getCreditRating(kScore);

    // Extract conviction data if available
    const conviction = token.conviction ? {
      score: token.conviction.score || 0,
      accumulators: token.conviction.accumulators || 0,
      holders: token.conviction.holders || 0,
      reducers: token.conviction.reducers || 0,
      extractors: token.conviction.extractors || 0,
      analyzed: token.conviction.analyzed || 0,
    } : null;

    const result = { tier, kScore, kRank, creditRating, hasCommunityUpdate, conviction };
    cacheResult(mint, result);

    logger.debug('HOLDEX', 'Token data fetched', {
      mint: mint.slice(0, 8),
      tier,
      kScore,
      grade: creditRating.grade,
    });

    return { ...result, cached: false };
  } catch (error) {
    logger.warn('HOLDEX', 'Token fetch failed', {
      mint: mint.slice(0, 8),
      error: error.message,
    });

    // Cache the error to avoid hammering a failing service
    const kRank = getKRank(0);
    const creditRating = getCreditRating(0);
    tokenCache.set(mint, {
      data: { tier: 'Rust', kScore: 0, kRank, creditRating, hasCommunityUpdate: false },
      timestamp: Date.now(),
      isError: true,
    });

    return { tier: 'Rust', kScore: 0, kRank, creditRating, hasCommunityUpdate: false, cached: false, error: error.message };
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
  getCreditRating,
  isVerifiedCommunity, // deprecated, for backward compatibility
  clearCache,
  getCacheStats,
  ACCEPTED_TIERS,
  VALID_TIERS,
};
