/**
 * Harmony E-Score - User Engagement Oracle
 *
 * Integration with HolDex Oracle API for user engagement scoring.
 *
 * HolDex Endpoints:
 *   /oracle/escore/:wallet              - Get E-Score + tier + benefits
 *   /oracle/discount/:wallet/:operation - Get operation-specific discount
 *
 * E-Score Dimensions (stored in HolDex participants table):
 *   1. holdings        - $ASDF holdings relative to supply (todo)
 *   2. total_burned    - Lifetime burn contribution (via /oracle/webhook/burns)
 *   3. api_calls_30d   - Developer API calls (todo)
 *   4. apps_live       - Built applications using GASdf (todo)
 *   5. nodes_active    - Running infrastructure (todo)
 *   6. referrals_active- User acquisition (todo)
 *   7. first_activity_at - Duration (calculated)
 *
 * E-Score Tiers:
 *   Observer (0)    → Seedling (0.1) → Sprout (1) → Sapling (5)
 *   → Tree (15)     → Grove (30)     → Forest (50) → Ecosystem (75)
 *
 * E-Score range: 0-100
 * Discount formula: discount = min(95%, 1 - φ^(-E/25))
 *
 * @see https://github.com/zeyxx/HolDex
 */

const config = require('../utils/config');
const logger = require('../utils/logger');
const crypto = require('crypto');

// =============================================================================
// Golden Ratio Constants
// =============================================================================
const PHI = 1.618033988749;
const PHI_INV = 1 / PHI; // 0.618...
const PHI_INV_SQ = 1 / (PHI * PHI); // 0.382...
const PHI_INV_CUBED = 1 / (PHI * PHI * PHI); // 0.236...

// =============================================================================
// E-Score Dimension Weights (sum = 1.0)
// =============================================================================
// Weights derived from golden ratio for mathematical harmony
const DIMENSION_WEIGHTS = {
  holding: PHI_INV_SQ, // 0.382 - Most important
  burning: PHI_INV_CUBED * PHI, // 0.236 × φ ≈ 0.382
  apiUsage: PHI_INV_CUBED, // 0.236
  appDev: PHI_INV_CUBED * PHI_INV, // 0.146
  nodeOps: PHI_INV_CUBED * PHI_INV_SQ, // 0.090
  referrals: PHI_INV_CUBED * PHI_INV_CUBED, // 0.056
  duration: 1 - 0.382 - 0.382 - 0.236, // Remainder ≈ 0
};

// Normalize weights to sum exactly to 1
const WEIGHT_SUM = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
Object.keys(DIMENSION_WEIGHTS).forEach((k) => {
  DIMENSION_WEIGHTS[k] /= WEIGHT_SUM;
});

// =============================================================================
// Tier Thresholds (share of supply for holder discounts)
// =============================================================================
const HOLDER_TIERS = {
  diamond: { threshold: 0.01, discount: 0.95 }, // 1% of supply
  platinum: { threshold: 0.001, discount: 0.67 }, // 0.1%
  gold: { threshold: 0.0001, discount: 0.33 }, // 0.01%
  silver: { threshold: 0.00001, discount: 0.1 }, // 0.001%
  bronze: { threshold: 0, discount: 0 }, // Any holder
};

// Maximum discount (prevents negative fees)
const MAX_DISCOUNT = 0.95;

// API configuration
const HOLDEX_HARMONY_TIMEOUT = parseInt(process.env.HOLDEX_TIMEOUT) || 10000;

// Cache for E-scores
const escoreCache = new Map();
const ESCORE_CACHE_TTL = 60 * 1000; // 1 minute (E-scores are dynamic)

/**
 * Calculate holder tier and discount based on holdings
 *
 * @param {number} holdings - User's token holdings (raw amount)
 * @param {number} totalSupply - Total circulating supply
 * @returns {{tier: string, discount: number, share: number}}
 */
function getHolderDiscount(holdings, totalSupply) {
  if (!holdings || !totalSupply || totalSupply <= 0) {
    return { tier: 'none', discount: 0, share: 0 };
  }

  const share = holdings / totalSupply;

  for (const [tier, { threshold, discount }] of Object.entries(HOLDER_TIERS)) {
    if (share >= threshold) {
      return { tier, discount, share };
    }
  }

  return { tier: 'none', discount: 0, share };
}

/**
 * Calculate E-Score from dimension scores
 *
 * Formula: E = Σ(weight_i × score_i) where score_i ∈ [0, 100]
 *
 * @param {Object} dimensions - Score per dimension (0-100 each)
 * @returns {number} - Composite E-Score (0-100)
 */
function calculateEScore(dimensions) {
  let score = 0;

  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    const dimScore = dimensions[dim] || 0;
    score += weight * Math.min(100, Math.max(0, dimScore));
  }

  return Math.round(score * 10) / 10; // Round to 1 decimal
}

/**
 * Calculate discount from E-Score
 *
 * Uses golden ratio curve for smooth progression:
 * discount = min(95%, 1 - φ^(-E/25))
 *
 * @param {number} eScore - E-Score (0-100)
 * @returns {number} - Discount percentage (0-0.95)
 */
function eScoreToDiscount(eScore) {
  if (!eScore || eScore <= 0) return 0;

  // Golden ratio curve: asymptotic approach to 95%
  const discount = 1 - Math.pow(PHI, -eScore / 25);
  return Math.min(MAX_DISCOUNT, Math.max(0, discount));
}

/**
 * Fetch E-Score from HolDex Oracle API
 *
 * Endpoint: /oracle/escore/:wallet
 * Response: {
 *   wallet, e_score, tier: {name, icon}, is_registered,
 *   benefits: {theoreticalDiscount, freeCalls, rateLimit, priority},
 *   progress: {currentTier, nextTier, remaining}
 * }
 *
 * @param {string} userPubkey - User's wallet address
 * @returns {Promise<{eScore: number, tier: Object, discount: number, benefits: Object, cached: boolean}>}
 */
async function getEScore(userPubkey) {
  // Check cache
  const cached = escoreCache.get(userPubkey);
  if (cached && Date.now() - cached.timestamp < ESCORE_CACHE_TTL) {
    return { ...cached.data, cached: true };
  }

  const holdexUrl = process.env.HOLDEX_API_URL || config.HOLDEX_URL;
  if (!holdexUrl) {
    logger.debug('HARMONY', 'HOLDEX_API_URL not configured, returning 0');
    return { eScore: 0, tier: null, discount: 0, benefits: null, cached: false };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOLDEX_HARMONY_TIMEOUT);

    const headers = { Accept: 'application/json' };
    if (config.HOLDEX_API_KEY) {
      headers['x-api-key'] = config.HOLDEX_API_KEY;
    }

    // Correct endpoint: /oracle/escore/:wallet
    const res = await fetch(`${holdexUrl}/oracle/escore/${userPubkey}`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 404) {
        // User not found = new user, score 0
        const result = {
          eScore: 0,
          tier: { name: 'Observer', icon: '👁️' },
          discount: 0,
          benefits: null,
        };
        escoreCache.set(userPubkey, { data: result, timestamp: Date.now() });
        return { ...result, cached: false };
      }
      throw new Error(`Oracle API returned ${res.status}`);
    }

    const data = await res.json();

    // Map HolDex response format to GASdf format
    const eScore = data.e_score ?? 0;
    const tier = data.tier || { name: 'Observer', icon: '👁️' };
    const discount = data.benefits?.theoreticalDiscount ?? eScoreToDiscount(eScore);
    const benefits = data.benefits || null;
    const progress = data.progress || null;

    const result = { eScore, tier, discount, benefits, progress, isRegistered: data.is_registered };
    escoreCache.set(userPubkey, { data: result, timestamp: Date.now() });

    logger.debug('HARMONY', 'E-Score fetched from Oracle', {
      user: userPubkey.slice(0, 8),
      eScore,
      tier: tier.name,
      discount: (discount * 100).toFixed(1) + '%',
      isRegistered: data.is_registered,
    });

    return { ...result, cached: false };
  } catch (error) {
    logger.warn('HARMONY', 'E-Score fetch failed', {
      user: userPubkey.slice(0, 8),
      error: error.message,
    });

    return {
      eScore: 0,
      tier: null,
      discount: 0,
      benefits: null,
      cached: false,
      error: error.message,
    };
  }
}

/**
 * Get combined discount (holder tier + E-Score)
 *
 * Takes the maximum of holder discount and E-Score discount.
 * E-Score discount comes from HolDex /oracle/escore/:wallet
 *
 * @param {string} userPubkey - User's wallet address
 * @param {number} holdings - User's $ASDF holdings
 * @param {number} totalSupply - Total $ASDF supply
 * @returns {Promise<{discount: number, source: string, holderTier: string, eScore: number, eScoreTier: Object}>}
 */
async function getDiscount(userPubkey, holdings = 0, totalSupply = 0) {
  // Get holder-based discount
  const holderData = getHolderDiscount(holdings, totalSupply);

  // Get E-Score based discount from HolDex Oracle
  const eScoreData = await getEScore(userPubkey);

  // Use the higher of the two discounts
  let discount, source;

  if (holderData.discount >= eScoreData.discount) {
    discount = holderData.discount;
    source = `holder_${holderData.tier}`;
  } else {
    discount = eScoreData.discount;
    source = 'escore';
  }

  return {
    discount,
    source,
    // Holder data
    holderTier: holderData.tier,
    holderDiscount: holderData.discount,
    // E-Score data (from HolDex Oracle)
    eScore: eScoreData.eScore,
    eScoreTier: eScoreData.tier,
    eScoreDiscount: eScoreData.discount,
    // Extra HolDex data
    benefits: eScoreData.benefits,
    progress: eScoreData.progress,
    isRegistered: eScoreData.isRegistered,
  };
}

/**
 * Get operation-specific discount from HolDex Oracle
 *
 * Endpoint: /oracle/discount/:wallet/:operation
 * Operations: 'gasdf_fee', 'holdex_api', etc.
 *
 * @param {string} userPubkey - User's wallet address
 * @param {string} operation - Operation type (default: 'gasdf_fee')
 * @returns {Promise<{discount: number, cached: boolean}>}
 */
async function getOperationDiscount(userPubkey, operation = 'gasdf_fee') {
  const holdexUrl = process.env.HOLDEX_API_URL || config.HOLDEX_URL;
  if (!holdexUrl) {
    return { discount: 0, cached: false, error: 'HOLDEX_API_URL not configured' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOLDEX_HARMONY_TIMEOUT);

    const headers = { Accept: 'application/json' };
    if (config.HOLDEX_API_KEY) {
      headers['x-api-key'] = config.HOLDEX_API_KEY;
    }

    const res = await fetch(`${holdexUrl}/oracle/discount/${userPubkey}/${operation}`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 404) {
        return { discount: 0, cached: false };
      }
      throw new Error(`Oracle discount API returned ${res.status}`);
    }

    const data = await res.json();

    logger.debug('HARMONY', 'Operation discount fetched', {
      user: userPubkey.slice(0, 8),
      operation,
      discount: (data.discount * 100).toFixed(1) + '%',
    });

    return { discount: data.discount ?? 0, cached: false };
  } catch (error) {
    logger.warn('HARMONY', 'Operation discount fetch failed', {
      user: userPubkey.slice(0, 8),
      operation,
      error: error.message,
    });
    return { discount: 0, cached: false, error: error.message };
  }
}

/**
 * Create HMAC-SHA256 signature for webhook authentication
 *
 * @param {Object} payload - Data to sign
 * @param {string} secret - Webhook secret (hex)
 * @returns {string} - HMAC signature (hex)
 */
function createHmacSignature(payload, secret) {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(payloadStr).digest('hex');
}

/**
 * Verify HMAC-SHA256 signature
 *
 * @param {Object|string} payload - Received payload
 * @param {string} signature - Received signature
 * @param {string} secret - Webhook secret (hex)
 * @returns {boolean} - True if signature is valid
 */
function verifyHmacSignature(payload, signature, secret) {
  const expected = createHmacSignature(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

/**
 * Notify HolDex of a burn event (HMAC-signed webhook)
 *
 * @param {Object} burnData - Burn event data
 * @param {string} burnData.signature - Transaction signature
 * @param {string} burnData.mint - Token mint burned
 * @param {number} burnData.amount - Amount burned (raw)
 * @param {string} burnData.burner - Burner's pubkey
 * @param {number} burnData.timestamp - Unix timestamp
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function notifyBurn(burnData) {
  const holdexUrl = process.env.HOLDEX_API_URL || config.HOLDEX_URL;
  const webhookSecret = process.env.HOLDEX_WEBHOOK_SECRET;

  if (!holdexUrl) {
    logger.debug('HARMONY', 'HOLDEX_API_URL not configured, skipping burn notification');
    return { success: false, error: 'HOLDEX_API_URL not configured' };
  }

  if (!webhookSecret) {
    logger.warn('HARMONY', 'HOLDEX_WEBHOOK_SECRET not configured, cannot sign burn notification');
    return { success: false, error: 'HOLDEX_WEBHOOK_SECRET not configured' };
  }

  try {
    const payload = {
      event: 'burn',
      data: {
        signature: burnData.signature,
        mint: burnData.mint,
        amount: burnData.amount.toString(),
        burner: burnData.burner,
        timestamp: burnData.timestamp || Date.now(),
        source: 'gasdf',
      },
    };

    const hmacSignature = createHmacSignature(payload, webhookSecret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOLDEX_HARMONY_TIMEOUT);

    const res = await fetch(`${holdexUrl}/harmony/webhook/burn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': hmacSignature,
        'X-Webhook-Source': 'gasdf',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      logger.error('HARMONY', 'Burn notification rejected', {
        status: res.status,
        error: errorText,
        signature: burnData.signature?.slice(0, 16),
      });
      return { success: false, error: `HolDex returned ${res.status}: ${errorText}` };
    }

    logger.info('HARMONY', 'Burn notification sent', {
      signature: burnData.signature?.slice(0, 16),
      amount: burnData.amount,
    });

    return { success: true };
  } catch (error) {
    logger.error('HARMONY', 'Burn notification failed', {
      error: error.message,
      signature: burnData.signature?.slice(0, 16),
    });
    return { success: false, error: error.message };
  }
}

/**
 * Clear E-Score cache
 */
function clearCache() {
  escoreCache.clear();
  logger.info('HARMONY', 'E-Score cache cleared');
}

/**
 * Get cache stats
 */
function getCacheStats() {
  const now = Date.now();
  let valid = 0;
  let expired = 0;

  for (const [, entry] of escoreCache) {
    if (now - entry.timestamp < ESCORE_CACHE_TTL) {
      valid++;
    } else {
      expired++;
    }
  }

  return { total: escoreCache.size, valid, expired };
}

module.exports = {
  // E-Score (via HolDex Oracle /oracle/escore/:wallet)
  getEScore,
  calculateEScore,
  eScoreToDiscount,
  getDiscount,
  getOperationDiscount, // /oracle/discount/:wallet/:operation

  // Holder tiers
  getHolderDiscount,
  HOLDER_TIERS,

  // Burn notifications
  notifyBurn,
  createHmacSignature,
  verifyHmacSignature,

  // Cache
  clearCache,
  getCacheStats,

  // Constants
  PHI,
  PHI_INV,
  PHI_INV_SQ,
  PHI_INV_CUBED,
  DIMENSION_WEIGHTS,
  MAX_DISCOUNT,
};
