// K-score oracle for dynamic pricing
// Security by design: trusted tokens → cache → API → fallback
// No single point of failure

const config = require('../utils/config');
const logger = require('../utils/logger');

// Cache K-scores (survives API outages)
const kScoreCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// K-score tiers
const K_TIERS = {
  TRUSTED: { minScore: 80, feeMultiplier: 1.0 },
  STANDARD: { minScore: 50, feeMultiplier: 1.25 },
  RISKY: { minScore: 20, feeMultiplier: 1.5 },
  UNKNOWN: { minScore: 0, feeMultiplier: 2.0 },
};

// Known trusted tokens - instant, no network call
const TRUSTED_TOKENS = new Set([
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump', // $ASDF
]);

// Oracle API configuration
const ORACLE_TIMEOUT = 3000; // 3 seconds max

async function getKScore(mint) {
  // 1. Check trusted list (instant)
  if (TRUSTED_TOKENS.has(mint)) {
    return { score: 100, tier: 'TRUSTED', feeMultiplier: 1.0 };
  }

  // 2. Check cache (no network)
  const cached = kScoreCache.get(mint);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // 3. Try oracle API
  try {
    const score = await fetchFromOracle(mint);
    const tier = getTierForScore(score);

    const result = {
      score,
      tier: tier.name,
      feeMultiplier: tier.feeMultiplier,
    };

    // Cache the result
    kScoreCache.set(mint, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    logger.warn('ORACLE', 'API unavailable, using fallback', {
      mint,
      error: error.message,
    });
  }

  // 4. Fallback: STANDARD tier (system continues)
  const fallback = {
    score: 50,
    tier: 'STANDARD',
    feeMultiplier: K_TIERS.STANDARD.feeMultiplier,
    fallback: true,
  };

  // Cache fallback too (prevents hammering dead API)
  kScoreCache.set(mint, { data: fallback, timestamp: Date.now() });

  return fallback;
}

async function fetchFromOracle(mint) {
  const oracleUrl = config.ORACLE_URL || process.env.ORACLE_URL;

  if (!oracleUrl) {
    throw new Error('ORACLE_URL not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORACLE_TIMEOUT);

  try {
    const headers = {};
    if (config.ORACLE_API_KEY) {
      headers['X-Oracle-Key'] = config.ORACLE_API_KEY;
    }

    const response = await fetch(`${oracleUrl}/api/v1/token/${mint}`, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Oracle returned ${response.status}`);
    }

    const data = await response.json();
    return data.k ?? data.k_score ?? data.score ?? 50;
  } finally {
    clearTimeout(timeout);
  }
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
