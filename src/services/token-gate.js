/**
 * Token Gating - Security by Design
 *
 * Determines which tokens are accepted as payment for gasless transactions.
 * Only accepts tokens that are:
 *   1. TRUSTED_TOKENS (hardcoded, deep liquidity)
 *   2. Verified by HolDex (hasCommunityUpdate=true AND kScore >= MIN_KSCORE)
 *
 * This protects the treasury from:
 *   - Rug pulls (worthless tokens)
 *   - Illiquid tokens (can't swap to $ASDF for burn)
 *   - Low conviction tokens (holders fleeing)
 *   - Dust accumulation
 *
 * Security model: Binary accept/reject. No fee multipliers.
 * A token is either safe enough, or it's not.
 */

const config = require('../utils/config');
const logger = require('../utils/logger');
const holdex = require('./holdex');

// =============================================================================
// TRUSTED TOKENS - Always accepted, no verification needed
// =============================================================================
// These tokens have deep liquidity and will never lose it.
// They form the backbone of Solana DeFi.
const TRUSTED_TOKENS = new Set([
  'So11111111111111111111111111111111111111112',   // SOL (native)
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
]);

// Add $ASDF mint if configured (we always want to accept our own token)
function getTrustedTokens() {
  const tokens = new Set(TRUSTED_TOKENS);
  if (config.ASDF_MINT && !config.ASDF_MINT.includes('Devnet')) {
    tokens.add(config.ASDF_MINT);
  }
  return tokens;
}

// Minimum K-score required for HolDex-verified tokens
// K-score measures holder conviction: (accumulators + maintained) / total_holders
// A token with K < MIN means holders are fleeing = red flag
const MIN_KSCORE = config.MIN_KSCORE ?? 50;

/**
 * Check if a token is accepted for payment
 *
 * @param {string} mint - Token mint address
 * @returns {Promise<{accepted: boolean, reason: string, kScore?: number}>}
 */
async function isTokenAccepted(mint) {
  // 1. Check TRUSTED_TOKENS (instant, no network call)
  const trustedTokens = getTrustedTokens();
  if (trustedTokens.has(mint)) {
    return {
      accepted: true,
      reason: 'trusted',
    };
  }

  // 2. Check HolDex: community verification AND K-score threshold
  const verification = await holdex.isVerifiedCommunity(mint);

  // Must have community verification
  if (!verification.verified) {
    logger.info('TOKEN_GATE', 'Token rejected: not verified', {
      mint: mint.slice(0, 8),
      holdexError: verification.error,
    });
    return {
      accepted: false,
      reason: verification.error ? 'verification_failed' : 'not_verified',
      kScore: verification.kScore,
    };
  }

  // Must meet minimum K-score (conviction threshold)
  if (verification.kScore < MIN_KSCORE) {
    logger.info('TOKEN_GATE', 'Token rejected: K-score too low', {
      mint: mint.slice(0, 8),
      kScore: verification.kScore,
      minRequired: MIN_KSCORE,
    });
    return {
      accepted: false,
      reason: 'low_kscore',
      kScore: verification.kScore,
    };
  }

  // Passed all checks
  logger.debug('TOKEN_GATE', 'Token accepted via HolDex', {
    mint: mint.slice(0, 8),
    kScore: verification.kScore,
  });

  return {
    accepted: true,
    reason: 'holdex_verified',
    kScore: verification.kScore,
  };
}

/**
 * Get list of all trusted tokens (for /tokens endpoint)
 */
function getAcceptedTokensList() {
  return [
    {
      mint: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      trusted: true,
    },
    {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      trusted: true,
    },
    {
      mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      trusted: true,
    },
    {
      mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
      symbol: 'mSOL',
      name: 'Marinade staked SOL',
      decimals: 9,
      trusted: true,
    },
    {
      mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
      symbol: 'jitoSOL',
      name: 'Jito Staked SOL',
      decimals: 9,
      trusted: true,
    },
    // $ASDF added dynamically if configured
    ...(config.ASDF_MINT && !config.ASDF_MINT.includes('Devnet') ? [{
      mint: config.ASDF_MINT,
      symbol: 'ASDF',
      name: '$ASDF',
      decimals: 6,
      trusted: true,
    }] : []),
  ];
}

/**
 * Check if a token is in the trusted list (sync, no network)
 */
function isTrustedToken(mint) {
  return getTrustedTokens().has(mint);
}

module.exports = {
  isTokenAccepted,
  isTrustedToken,
  getAcceptedTokensList,
  TRUSTED_TOKENS,
  MIN_KSCORE,
};
