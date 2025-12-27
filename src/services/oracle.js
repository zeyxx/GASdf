// K-score oracle for dynamic pricing
// Security by design: trusted tokens → cache → API → fallback
// No single point of failure

const config = require('../utils/config');
const logger = require('../utils/logger');

// Cache K-scores (survives API outages)
const kScoreCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ERROR_CACHE_TTL = 60 * 1000; // 1 minute for errors (retry sooner)

// Oracle health state
const oracleHealth = {
  lastSuccess: null,
  lastError: null,
  consecutiveErrors: 0,
  totalRequests: 0,
  totalErrors: 0,
  avgLatencyMs: 0,
  latencySamples: [],
};

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
const MIN_HOLDERS_FOR_CONFIDENCE = 10; // Minimum holders for reliable K-score

async function getKScore(mint) {
  // 1. Check trusted list (instant)
  if (TRUSTED_TOKENS.has(mint)) {
    return { score: 100, tier: 'TRUSTED', feeMultiplier: 1.0 };
  }

  // 2. Check cache (no network)
  const cached = kScoreCache.get(mint);
  if (cached) {
    const ttl = cached.isError ? ERROR_CACHE_TTL : CACHE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
      return cached.data;
    }
  }

  // 3. Try oracle API
  try {
    const { score, holders } = await fetchFromOracle(mint);

    // Low holder count = unreliable K-score → downgrade to RISKY
    if (holders < MIN_HOLDERS_FOR_CONFIDENCE) {
      logger.info('ORACLE', 'Low holder count, using RISKY tier', {
        mint: mint.slice(0, 8),
        holders,
        minRequired: MIN_HOLDERS_FOR_CONFIDENCE,
        rawScore: score,
      });

      const result = {
        score,
        tier: 'RISKY',
        feeMultiplier: K_TIERS.RISKY.feeMultiplier,
        holders,
        lowConfidence: true,
      };

      kScoreCache.set(mint, { data: result, timestamp: Date.now() });
      return result;
    }

    const tier = getTierForScore(score);

    const result = {
      score,
      tier: tier.name,
      feeMultiplier: tier.feeMultiplier,
      holders,
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

  // Cache fallback with shorter TTL (retry sooner)
  kScoreCache.set(mint, { data: fallback, timestamp: Date.now(), isError: true });

  return fallback;
}

async function fetchFromOracle(mint) {
  const oracleUrl = config.ORACLE_URL || process.env.ORACLE_URL;

  if (!oracleUrl) {
    throw new Error('ORACLE_URL not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORACLE_TIMEOUT);
  const startTime = Date.now();

  oracleHealth.totalRequests++;

  try {
    const headers = {
      'Accept': 'application/json',
    };
    if (config.ORACLE_API_KEY) {
      headers['X-Oracle-Key'] = config.ORACLE_API_KEY;
    }

    const response = await fetch(`${oracleUrl}/api/v1/token/${mint}`, {
      headers,
      signal: controller.signal,
    });

    const latency = Date.now() - startTime;
    trackLatency(latency);

    if (!response.ok) {
      oracleHealth.totalErrors++;
      oracleHealth.consecutiveErrors++;
      oracleHealth.lastError = { time: Date.now(), status: response.status };
      throw new Error(`Oracle returned ${response.status}`);
    }

    const data = await response.json();

    // Validate response structure
    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid oracle response: not an object');
    }

    // Parse K-score with validation
    const rawScore = data.k ?? data.k_score ?? data.kScore ?? data.score;
    const score = typeof rawScore === 'number' ? Math.max(0, Math.min(100, rawScore)) : 50;

    // Parse holders with validation
    const rawHolders = data.holders ?? data.holderCount ?? data.holder_count;
    const holders = typeof rawHolders === 'number' && rawHolders >= 0 ? Math.floor(rawHolders) : 0;

    // Track success
    oracleHealth.consecutiveErrors = 0;
    oracleHealth.lastSuccess = Date.now();

    logger.debug('ORACLE', 'K-score fetched', {
      mint: mint.slice(0, 8),
      score,
      holders,
      latencyMs: latency,
    });

    return { score, holders };
  } catch (error) {
    oracleHealth.totalErrors++;
    oracleHealth.consecutiveErrors++;
    oracleHealth.lastError = { time: Date.now(), message: error.message };
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function trackLatency(latencyMs) {
  oracleHealth.latencySamples.push(latencyMs);
  // Keep last 100 samples
  if (oracleHealth.latencySamples.length > 100) {
    oracleHealth.latencySamples.shift();
  }
  // Calculate average
  oracleHealth.avgLatencyMs = Math.round(
    oracleHealth.latencySamples.reduce((a, b) => a + b, 0) / oracleHealth.latencySamples.length
  );
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

/**
 * Get oracle health status for monitoring
 */
function getOracleHealth() {
  const oracleUrl = config.ORACLE_URL || process.env.ORACLE_URL;

  return {
    configured: !!oracleUrl,
    url: oracleUrl ? oracleUrl.replace(/api-key=[^&]+/, 'api-key=***') : null,
    lastSuccess: oracleHealth.lastSuccess,
    lastError: oracleHealth.lastError,
    consecutiveErrors: oracleHealth.consecutiveErrors,
    totalRequests: oracleHealth.totalRequests,
    totalErrors: oracleHealth.totalErrors,
    errorRate: oracleHealth.totalRequests > 0
      ? ((oracleHealth.totalErrors / oracleHealth.totalRequests) * 100).toFixed(2) + '%'
      : '0%',
    avgLatencyMs: oracleHealth.avgLatencyMs,
    cacheSize: kScoreCache.size,
    status: getOracleStatus(),
  };
}

function getOracleStatus() {
  const oracleUrl = config.ORACLE_URL || process.env.ORACLE_URL;

  if (!oracleUrl) return 'NOT_CONFIGURED';
  if (oracleHealth.consecutiveErrors >= 5) return 'UNHEALTHY';
  if (oracleHealth.consecutiveErrors >= 2) return 'DEGRADED';
  if (oracleHealth.lastSuccess && Date.now() - oracleHealth.lastSuccess < 60000) return 'HEALTHY';
  if (oracleHealth.totalRequests === 0) return 'UNKNOWN';
  return 'IDLE';
}

/**
 * Ping oracle to check connectivity
 */
async function pingOracle() {
  const oracleUrl = config.ORACLE_URL || process.env.ORACLE_URL;

  if (!oracleUrl) {
    return { success: false, error: 'ORACLE_URL not configured' };
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${oracleUrl}/api/v1/status`, {
      signal: controller.signal,
    });

    const latency = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latencyMs: latency };
    }
    return { success: false, error: `HTTP ${response.status}`, latencyMs: latency };
  } catch (error) {
    return { success: false, error: error.message, latencyMs: Date.now() - startTime };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Clear cache (useful for testing or forced refresh)
 */
function clearCache() {
  kScoreCache.clear();
  logger.info('ORACLE', 'Cache cleared');
}

module.exports = {
  getKScore,
  calculateFeeWithKScore,
  getOracleHealth,
  pingOracle,
  clearCache,
  K_TIERS,
  TRUSTED_TOKENS,
};
