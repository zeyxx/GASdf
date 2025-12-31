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
const rpc = require('../utils/rpc');
const { PublicKey } = require('@solana/web3.js');

// Cache token data (reduces API calls)
const tokenCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ERROR_CACHE_TTL = 30 * 1000; // 30 seconds for errors (retry sooner)

// =============================================================================
// DUAL-BURN FLYWHEEL: Pure Golden Ratio (φ) Based Economics
// =============================================================================
// All ratios derive from the Golden Ratio φ = 1.618033988749...
//
// The Golden Ratio appears throughout nature (spirals, shells, galaxies),
// art (Parthenon, Da Vinci), and markets (Fibonacci retracements).
//
// Fee Split (Pure Golden):
//   Treasury:      1/φ³ = 23.6%
//   Ecosystem max: 1/φ² = 38.2%
//   ASDF min:      1/φ² = 38.2%
//   Total:                100.0% ✓
//
// Formula: ecosystemBurn = (1/φ²) × (1 - φ^(-burnPct/30))
//
// This creates a virtuous flywheel with mathematically elegant proportions:
// Token burns → Higher bonus → More direct burns → Incentive to burn more
// =============================================================================
const PHI = 1.618033988749; // Golden Ratio (φ)
const PHI_SQUARED = PHI * PHI; // φ² = 2.618...
const PHI_CUBED = PHI * PHI * PHI; // φ³ = 4.236...

// Pure Golden ratios
const MAX_ECOSYSTEM_BURN_PCT = 1 / PHI_SQUARED; // 1/φ² ≈ 38.2%
const TREASURY_RATIO = 1 / PHI_CUBED; // 1/φ³ ≈ 23.6%
const BURN_CURVE_STEEPNESS = 30; // Controls how fast bonus grows

// Default initial supply for pump.fun tokens (1 billion with 6 decimals)
const PUMP_FUN_INITIAL_SUPPLY = 1_000_000_000_000_000;

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
 * Calculate burned percentage from supply data
 * @param {number} currentSupply - Current circulating supply (raw, with decimals)
 * @param {number} initialSupply - Initial supply (raw, with decimals), defaults to pump.fun standard
 * @returns {number} - Burned percentage (0-100)
 */
function calculateBurnedPercent(currentSupply, initialSupply = PUMP_FUN_INITIAL_SUPPLY) {
  if (!currentSupply || currentSupply <= 0 || initialSupply <= 0) return 0;
  if (currentSupply >= initialSupply) return 0; // No burns

  const burned = initialSupply - currentSupply;
  return (burned / initialSupply) * 100;
}

/**
 * Calculate ecosystem burn bonus based on token's own burn rate
 * Uses Pure Golden Ratio formula for mathematically elegant proportions
 *
 * Formula: ecosystemBurn = (1/φ²) × (1 - φ^(-burnPct/30))
 *
 * This creates an asymptotic curve that:
 * - Rewards early burns more (diminishing returns)
 * - Never truly reaches max (always room to improve)
 * - Uses φ throughout for mathematical harmony
 *
 * @param {number} burnedPercent - Token's burned percentage (0-100)
 * @returns {{ecosystemBurnPct: number, asdfBurnPct: number, treasuryPct: number, explanation: string}}
 */
function calculateEcosystemBurnBonus(burnedPercent) {
  // Treasury is always 1/φ³ ≈ 23.6%
  const treasuryPct = TREASURY_RATIO;
  const burnablePct = 1 - treasuryPct; // ≈ 76.4% available for burns

  if (!burnedPercent || burnedPercent <= 0) {
    return {
      ecosystemBurnPct: 0,
      asdfBurnPct: burnablePct, // Full burnable portion goes to ASDF
      treasuryPct,
      explanation: 'No ecosystem burn bonus (token has not burned supply)',
    };
  }

  // Pure Golden Formula: ecosystemBurn = (1/φ²) × (1 - φ^(-b/30))
  // This creates a smooth asymptotic curve approaching 1/φ² ≈ 38.2%
  const goldenMultiplier = 1 - Math.pow(PHI, -burnedPercent / BURN_CURVE_STEEPNESS);
  const ecosystemBurn = MAX_ECOSYSTEM_BURN_PCT * goldenMultiplier;
  const asdfBurn = burnablePct - ecosystemBurn;

  return {
    ecosystemBurnPct: ecosystemBurn,
    asdfBurnPct: asdfBurn,
    treasuryPct,
    explanation: `${(ecosystemBurn * 100).toFixed(1)}% ecosystem burn (φ-curve, token burned ${burnedPercent.toFixed(1)}% of supply)`,
  };
}

/**
 * Fallback: Get token supply directly from Solana RPC
 * On-chain is truth - use this when HolDex is unavailable
 * @param {string} mint - Token mint address
 * @returns {Promise<{supply: number, burnedPercent: number} | null>}
 */
async function getOnChainSupply(mint) {
  try {
    const connection = rpc.getConnection();
    const mintPubkey = new PublicKey(mint);
    const supplyInfo = await connection.getTokenSupply(mintPubkey);

    if (supplyInfo?.value) {
      // Convert to raw amount (with decimals)
      const currentSupply = parseInt(supplyInfo.value.amount);
      const burnedPercent = calculateBurnedPercent(currentSupply);

      logger.debug('HOLDEX', 'On-chain supply fallback', {
        mint: mint.slice(0, 8),
        supply: currentSupply,
        burnedPercent: burnedPercent.toFixed(2) + '%',
      });

      return { supply: currentSupply, burnedPercent };
    }
    return null;
  } catch (error) {
    logger.warn('HOLDEX', 'On-chain supply fallback failed', {
      mint: mint.slice(0, 8),
      error: error.message,
    });
    return null;
  }
}

/**
 * Get token data from HolDex
 * Falls back to on-chain data if HolDex is unavailable
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
    } : (token.conviction_score ? {
      score: token.conviction_score,
      accumulators: token.conviction_accumulators || 0,
      holders: token.conviction_holders || 0,
      reducers: token.conviction_reducers || 0,
      extractors: token.conviction_extractors || 0,
      analyzed: token.conviction_analyzed || 0,
    } : null);

    // ==========================================================================
    // DUAL-BURN FLYWHEEL: Use HolDex burn data (source of truth) or calculate
    // ==========================================================================
    const currentSupply = parseInt(token.supply) || 0;

    // Calculate burn data - pump.fun tokens always use 1B initial supply
    let burnedPercent = 0;
    let burnedAmount = 0;
    let initialSupply = PUMP_FUN_INITIAL_SUPPLY;
    let burnSource = 'none';

    const isPumpFun = token.isPumpFun || token.is_pump_fun || mint.endsWith('pump');
    const isMayhemMode = token.isMayhemMode || token.is_mayhem_mode || false;

    if (isPumpFun && !isMayhemMode) {
      // Standard pump.fun tokens: ALWAYS use 1B initial supply
      initialSupply = PUMP_FUN_INITIAL_SUPPLY;
      burnedPercent = calculateBurnedPercent(currentSupply);
      burnedAmount = PUMP_FUN_INITIAL_SUPPLY - currentSupply;
      burnSource = 'pump_fun_1b';
    } else if (isMayhemMode && token.initialSupply) {
      // Mayhem Mode tokens: Use HolDex initialSupply (variable supply)
      initialSupply = parseFloat(token.initialSupply) * Math.pow(10, token.decimals || 6);
      if (currentSupply < initialSupply) {
        burnedAmount = initialSupply - currentSupply;
        burnedPercent = (burnedAmount / initialSupply) * 100;
      }
      burnSource = 'mayhem_mode';
    } else if (typeof token.burnedPercent === 'number' && token.burnedPercent > 0) {
      // Non-pump.fun: Use HolDex data if available
      burnedPercent = token.burnedPercent;
      burnedAmount = token.burnedAmount || 0;
      initialSupply = parseFloat(token.initialSupply) * Math.pow(10, token.decimals || 6) || PUMP_FUN_INITIAL_SUPPLY;
      burnSource = 'holdex';
    } else if (token.burned_percent && token.burned_percent > 0) {
      // Alternative field names
      burnedPercent = token.burned_percent;
      burnedAmount = token.burned_amount || 0;
      initialSupply = parseFloat(token.initial_supply) * Math.pow(10, token.decimals || 6) || PUMP_FUN_INITIAL_SUPPLY;
      burnSource = 'holdex';
    } else if (currentSupply > 0 && currentSupply < PUMP_FUN_INITIAL_SUPPLY) {
      // Fallback: Calculate from pump.fun standard 1B initial supply
      burnedPercent = calculateBurnedPercent(currentSupply);
      burnedAmount = PUMP_FUN_INITIAL_SUPPLY - currentSupply;
      burnSource = 'calculated';
    }

    const ecosystemBurn = calculateEcosystemBurnBonus(burnedPercent);

    const supplyData = {
      current: currentSupply,
      initial: initialSupply,
      burnedPercent,
      burnedAmount,
      source: burnSource, // 'pump_fun_1b', 'mayhem_mode', 'holdex', 'calculated', 'none'
      isPumpFun,
      isMayhemMode,
      bondingCurveComplete: token.bondingCurveComplete || token.bonding_curve_complete || false,
    };

    const result = {
      tier,
      kScore,
      kRank,
      creditRating,
      hasCommunityUpdate,
      conviction,
      // Dual-burn flywheel data
      supply: supplyData,
      ecosystemBurn,
    };
    cacheResult(mint, result);

    logger.debug('HOLDEX', 'Token data fetched', {
      mint: mint.slice(0, 8),
      tier,
      kScore,
      grade: creditRating.grade,
      burnedPercent: burnedPercent.toFixed(2) + '%',
      burnSource,
      ecosystemBurnBonus: (ecosystemBurn.ecosystemBurnPct * 100).toFixed(1) + '%',
    });

    return { ...result, cached: false };
  } catch (error) {
    logger.warn('HOLDEX', 'Token fetch failed, trying on-chain fallback', {
      mint: mint.slice(0, 8),
      error: error.message,
    });

    // ==========================================================================
    // FALLBACK: On-chain is truth - get supply directly from Solana
    // ==========================================================================
    const onChainData = await getOnChainSupply(mint);

    const kRank = getKRank(0);
    const creditRating = getCreditRating(0);

    // If on-chain fallback succeeded, include burn data
    let supply = null;
    let ecosystemBurn = null;

    if (onChainData) {
      supply = {
        current: onChainData.supply,
        initial: PUMP_FUN_INITIAL_SUPPLY,
        burnedPercent: onChainData.burnedPercent,
        burnedAmount: PUMP_FUN_INITIAL_SUPPLY - onChainData.supply,
        source: 'on-chain', // Mark as on-chain fallback
      };
      ecosystemBurn = calculateEcosystemBurnBonus(onChainData.burnedPercent);

      logger.info('HOLDEX', 'Using on-chain fallback for burn data', {
        mint: mint.slice(0, 8),
        burnedPercent: onChainData.burnedPercent.toFixed(2) + '%',
      });
    }

    // Cache the result (with shorter TTL for errors)
    const result = {
      tier: 'Rust',
      kScore: 0,
      kRank,
      creditRating,
      hasCommunityUpdate: false,
      supply,
      ecosystemBurn,
    };

    tokenCache.set(mint, {
      data: result,
      timestamp: Date.now(),
      isError: true,
    });

    return { ...result, cached: false, error: error.message, fallback: 'on-chain' };
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
  // Pure Golden Dual-burn flywheel
  calculateBurnedPercent,
  calculateEcosystemBurnBonus,
  getOnChainSupply, // Fallback to Solana RPC
  // Golden Ratio constants
  PHI,
  PHI_SQUARED,
  PHI_CUBED,
  MAX_ECOSYSTEM_BURN_PCT, // 1/φ² ≈ 38.2%
  TREASURY_RATIO, // 1/φ³ ≈ 23.6%
  BURN_CURVE_STEEPNESS,
  PUMP_FUN_INITIAL_SUPPLY,
};
