/**
 * Token Gating - Security by Design
 *
 * Determines which tokens are accepted as payment for gasless transactions.
 * Uses HolDex as the single source of truth for tier-based acceptance.
 *
 * =============================================================================
 * SCORING SYSTEM EVOLUTION
 * =============================================================================
 *
 * Current: K-Score Based
 *   - Community tokens scored by conviction, liquidity, holder behavior
 *   - Infrastructure tokens (USDC, USDT, mSOL, jitoSOL) hardcoded as Diamond
 *
 * Future: Unified Score (see docs/UNIFIED_SCORE_PHILOSOPHY.md)
 *   UNIFIED_SCORE = S^(1/φ) × U^(1/φ²) × (1 + A)^(1/φ³)
 *   Where:
 *     S = Safety Score (K-Score or I-Score based on token type)
 *     U = Utility Score (volume/TVL ratio, unique users)
 *     A = Alignment Score (LP provision, burn contribution, integrations)
 *
 * Token Types:
 *   - NATIVE: SOL only (always Diamond, no external scoring)
 *   - INFRASTRUCTURE: Stablecoins, LSTs (I-Score based on liquidity/backing)
 *   - COMMUNITY: All other tokens (K-Score based on conviction)
 *
 * =============================================================================
 * METAL RANKS (Tier System)
 * =============================================================================
 *   💎 Diamond  (90-99, 100=native) → Accepted
 *   💠 Platinum (80-89)  → Accepted
 *   🥇 Gold     (70-79)  → Accepted
 *   🥈 Silver   (60-69)  → Accepted
 *   🥉 Bronze   (50-59)  → Accepted (minimum tier)
 *   🟤 Copper   (40-49)  → Rejected
 *   ⚫ Iron     (20-39)  → Rejected
 *   🔩 Rust     (0-19)   → Rejected
 *
 * This protects the treasury from:
 *   - Rug pulls (worthless tokens)
 *   - Illiquid tokens (can't swap to $ASDF for burn)
 *   - Low conviction tokens (holders fleeing)
 *   - Dust accumulation
 *
 * Security model: Binary accept/reject based on tier.
 * A token is either safe enough (Bronze+), or it's not.
 */

const logger = require('../utils/logger');
const holdex = require('./holdex');

// =============================================================================
// TOKEN CLASSIFICATION (Unified Score preparation)
// =============================================================================
// Token types for the upcoming Unified Score system:
//
// NATIVE: SOL only - Always Diamond, no external scoring
// INFRASTRUCTURE: Stablecoins & LSTs - Will use I-Score from HolDex
// COMMUNITY: All other tokens - Use K-Score from HolDex
//
// When HolDex implements the Unified Score endpoint, INFRASTRUCTURE tokens
// will transition from hardcoded Diamond to dynamic I-Score based scoring.
// =============================================================================

// SOL is the only native token - always accepted, no scoring needed
const NATIVE_TOKENS = new Set([
  'So11111111111111111111111111111111111111112', // SOL (native)
]);

// Infrastructure tokens: stablecoins and liquid staking tokens
// Currently hardcoded as Diamond, will transition to I-Score
const INFRASTRUCTURE_TOKENS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
]);

// =============================================================================
// DIAMOND TOKENS - Always accepted, no HolDex call needed
// =============================================================================
// Combined set of NATIVE + INFRASTRUCTURE tokens for current behavior.
// These tokens have deep liquidity and will never lose it.
// HolDex should return tier="Diamond" for these, but we check locally
// for performance (skip network call).
const DIAMOND_TOKENS = new Set([...NATIVE_TOKENS, ...INFRASTRUCTURE_TOKENS]);

// Get diamond tokens (no longer includes $ASDF - uses real K-score)
// $ASDF benefits from the Dual-Burn Flywheel (100% burn), not hardcoded Diamond tier
function getDiamondTokens() {
  return DIAMOND_TOKENS;
}

/**
 * Check if a token is accepted for payment
 *
 * @param {string} mint - Token mint address
 * @returns {Promise<{accepted: boolean, reason: string, tier: string, kScore?: number, kRank?: object, creditRating?: object, supply?: object, ecosystemBurn?: object}>}
 */
async function isTokenAccepted(mint) {
  // 1. Check DIAMOND_TOKENS locally (instant, no network call)
  // Note: $ASDF is NOT in this list - it uses real K-score from HolDex
  if (DIAMOND_TOKENS.has(mint)) {
    // Diamond tokens (SOL, USDC, USDT, mSOL, jitoSOL) get perfect scores
    const kRank = holdex.getKRank(100);
    const creditRating = holdex.getCreditRating(100);

    return {
      accepted: true,
      reason: 'diamond',
      tier: 'Diamond',
      kScore: 100,
      kRank,
      creditRating,
    };
  }

  // 2. Check HolDex for tier
  const tokenData = await holdex.isTokenAccepted(mint);

  if (!tokenData.accepted) {
    logger.info('TOKEN_GATE', 'Token rejected', {
      mint: mint.slice(0, 8),
      tier: tokenData.tier,
      kScore: tokenData.kScore,
      creditRating: tokenData.creditRating?.grade,
      error: tokenData.error,
    });
    return {
      accepted: false,
      reason: tokenData.error ? 'verification_failed' : 'tier_rejected',
      tier: tokenData.tier,
      kScore: tokenData.kScore,
      kRank: tokenData.kRank,
      creditRating: tokenData.creditRating,
    };
  }

  // Passed tier check (Platinum or Gold)
  logger.debug('TOKEN_GATE', 'Token accepted', {
    mint: mint.slice(0, 8),
    tier: tokenData.tier,
    kScore: tokenData.kScore,
    creditRating: tokenData.creditRating?.grade,
    burnedPct: tokenData.supply?.burnedPercent?.toFixed(2),
  });

  return {
    accepted: true,
    reason: 'tier_accepted',
    tier: tokenData.tier,
    kScore: tokenData.kScore,
    kRank: tokenData.kRank,
    creditRating: tokenData.creditRating,
    // Dual-burn flywheel data
    supply: tokenData.supply,
    ecosystemBurn: tokenData.ecosystemBurn,
  };
}

/**
 * Get list of Diamond tier tokens (for /tokens endpoint)
 */
function getDiamondTokensList() {
  return [
    {
      mint: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      tier: 'Diamond',
    },
    {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      tier: 'Diamond',
    },
    {
      mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      tier: 'Diamond',
    },
    {
      mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
      symbol: 'mSOL',
      name: 'Marinade staked SOL',
      decimals: 9,
      tier: 'Diamond',
    },
    {
      mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
      symbol: 'jitoSOL',
      name: 'Jito Staked SOL',
      decimals: 9,
      tier: 'Diamond',
    },
    // Note: $ASDF is NOT in Diamond list - uses real K-score from HolDex
    // $ASDF benefits from Dual-Burn Flywheel (100% burn), not hardcoded tier
  ];
}

/**
 * Check if a token is Diamond tier (sync, no network)
 */
function isDiamondToken(mint) {
  return getDiamondTokens().has(mint);
}

// =============================================================================
// TOKEN CLASSIFICATION HELPERS (Unified Score preparation)
// =============================================================================

/**
 * Get the token type for Unified Score classification
 * @param {string} mint - Token mint address
 * @returns {'native' | 'infrastructure' | 'community'}
 */
function getTokenType(mint) {
  if (NATIVE_TOKENS.has(mint)) return 'native';
  if (INFRASTRUCTURE_TOKENS.has(mint)) return 'infrastructure';
  return 'community';
}

/**
 * Check if a token is native (SOL only)
 * Native tokens always get Diamond tier without any scoring
 */
function isNativeToken(mint) {
  return NATIVE_TOKENS.has(mint);
}

/**
 * Check if a token is infrastructure (stablecoins, LSTs)
 * Will transition from hardcoded Diamond to I-Score based
 */
function isInfrastructureToken(mint) {
  return INFRASTRUCTURE_TOKENS.has(mint);
}

/**
 * Check if a token is community (everything else)
 * Uses K-Score from HolDex
 */
function isCommunityToken(mint) {
  return !NATIVE_TOKENS.has(mint) && !INFRASTRUCTURE_TOKENS.has(mint);
}

// Legacy exports for backward compatibility
const TRUSTED_TOKENS = DIAMOND_TOKENS;
const getAcceptedTokensList = getDiamondTokensList;
const isTrustedToken = isDiamondToken;

module.exports = {
  isTokenAccepted,
  isDiamondToken,
  getDiamondTokensList,
  DIAMOND_TOKENS,

  // Token classification (Unified Score preparation)
  getTokenType,
  isNativeToken,
  isInfrastructureToken,
  isCommunityToken,
  NATIVE_TOKENS,
  INFRASTRUCTURE_TOKENS,

  // Legacy (deprecated)
  isTrustedToken,
  getAcceptedTokensList,
  TRUSTED_TOKENS,
};
