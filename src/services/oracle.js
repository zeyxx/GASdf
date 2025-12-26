// K-score oracle for dynamic pricing
// K-score = measure of token "trust" (higher = lower fee multiplier)

const logger = require('../utils/logger');

const BIRDEYE_API = 'https://public-api.birdeye.so';

// Cache K-scores for 5 minutes
const kScoreCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Default K-score tiers
const K_TIERS = {
  TRUSTED: { minScore: 80, feeMultiplier: 1.0 },
  STANDARD: { minScore: 50, feeMultiplier: 1.25 },
  RISKY: { minScore: 20, feeMultiplier: 1.5 },
  UNKNOWN: { minScore: 0, feeMultiplier: 2.0 },
};

// Known trusted tokens (skip oracle lookup)
const TRUSTED_TOKENS = new Set([
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump', // $ASDF (native token)
]);

async function getKScore(mint) {
  // Check trusted list
  if (TRUSTED_TOKENS.has(mint)) {
    return { score: 100, tier: 'TRUSTED', feeMultiplier: 1.0 };
  }

  // Check cache
  const cached = kScoreCache.get(mint);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // Fetch from Birdeye (would need API key in prod)
    // For now, return default
    const score = await fetchTokenScore(mint);
    const tier = getTierForScore(score);

    const result = {
      score,
      tier: tier.name,
      feeMultiplier: tier.feeMultiplier,
    };

    kScoreCache.set(mint, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    logger.warn('ORACLE', 'Failed to fetch K-score', { mint, error: error.message });
    return { score: 0, tier: 'UNKNOWN', feeMultiplier: K_TIERS.UNKNOWN.feeMultiplier };
  }
}

async function fetchTokenScore(mint) {
  // Placeholder - integrate with actual oracle/API
  // Could use: Birdeye, DexScreener, custom scoring
  return 50; // Default to STANDARD tier
}

function getTierForScore(score) {
  if (score >= K_TIERS.TRUSTED.minScore) {
    return { name: 'TRUSTED', ...K_TIERS.TRUSTED };
  }
  if (score >= K_TIERS.STANDARD.minScore) {
    return { name: 'STANDARD', ...K_TIERS.STANDARD };
  }
  if (score >= K_TIERS.RISKY.minScore) {
    return { name: 'RISKY', ...K_TIERS.RISKY };
  }
  return { name: 'UNKNOWN', ...K_TIERS.UNKNOWN };
}

function calculateFeeWithKScore(baseFee, kScore) {
  return Math.ceil(baseFee * kScore.feeMultiplier);
}

module.exports = {
  getKScore,
  calculateFeeWithKScore,
  K_TIERS,
  TRUSTED_TOKENS,
};
