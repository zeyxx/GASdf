/**
 * Helius SDK Integration
 * Provides optimized RPC methods via the Helius SDK
 */

const { createHelius } = require('helius-sdk');
const config = require('../utils/config');
const logger = require('../utils/logger');

// Initialize Helius SDK (singleton)
let helius = null;

function getHelius() {
  if (!helius && config.HELIUS_API_KEY) {
    helius = createHelius({
      apiKey: config.HELIUS_API_KEY,
      network: config.USE_MAINNET ? 'mainnet' : 'devnet',
    });
    logger.info('HELIUS', 'SDK initialized', { network: config.USE_MAINNET ? 'mainnet' : 'devnet' });
  }
  return helius;
}

// Cache for priority fees (5 second TTL - network conditions change fast)
let priorityFeeCache = {
  estimate: null,
  timestamp: 0,
  ttl: 5000, // 5 seconds
};

/**
 * Get priority fee estimate from Helius
 * Returns recommended priority fee in microlamports per compute unit
 *
 * @param {Object} options
 * @param {string[]} options.accountKeys - Accounts involved in transaction (for localized fees)
 * @param {string} options.priorityLevel - 'Min' | 'Low' | 'Medium' | 'High' | 'VeryHigh' | 'UnsafeMax'
 * @returns {Promise<{priorityFee: number, priorityLevel: string, cached: boolean}>}
 */
async function getPriorityFeeEstimate(options = {}) {
  const {
    accountKeys = [],
    priorityLevel = 'Medium', // Good balance between speed and cost
  } = options;

  const h = getHelius();

  // Fallback if SDK not available
  if (!h) {
    logger.debug('HELIUS', 'SDK not available, using fallback priority fee');
    return {
      priorityFee: 1000, // 1000 microlamports/CU fallback
      priorityLevel: 'fallback',
      cached: false,
    };
  }

  // Check cache (only if no specific accounts - global estimate)
  const now = Date.now();
  if (accountKeys.length === 0 && priorityFeeCache.estimate && (now - priorityFeeCache.timestamp) < priorityFeeCache.ttl) {
    return {
      ...priorityFeeCache.estimate,
      cached: true,
    };
  }

  try {
    // Call Helius priority fee API (direct method on SDK v2)
    const response = await h.getPriorityFeeEstimate({
      accountKeys: accountKeys.length > 0 ? accountKeys : undefined,
      options: {
        priorityLevel,
        includeAllPriorityFeeLevels: false,
        lookbackSlots: 150, // ~1 minute of history
      },
    });

    const estimate = {
      priorityFee: Math.ceil(response.priorityFeeEstimate || 1000),
      priorityLevel,
      cached: false,
    };

    // Cache global estimates
    if (accountKeys.length === 0) {
      priorityFeeCache = {
        estimate,
        timestamp: now,
        ttl: priorityFeeCache.ttl,
      };
    }

    logger.debug('HELIUS', 'Priority fee estimate', {
      priorityFee: estimate.priorityFee,
      priorityLevel,
      accountKeys: accountKeys.length,
    });

    return estimate;

  } catch (error) {
    logger.warn('HELIUS', 'Failed to get priority fee estimate', {
      error: error.message,
      fallback: 1000,
    });

    // Return fallback on error
    return {
      priorityFee: 1000,
      priorityLevel: 'fallback',
      cached: false,
      error: error.message,
    };
  }
}

/**
 * Calculate total priority fee in lamports for a transaction
 *
 * @param {number} computeUnits - Estimated compute units for transaction
 * @param {Object} options - Options for getPriorityFeeEstimate
 * @returns {Promise<{priorityFeeLamports: number, microLamportsPerCU: number, computeUnits: number}>}
 */
async function calculatePriorityFee(computeUnits, options = {}) {
  const { priorityFee: microLamportsPerCU } = await getPriorityFeeEstimate(options);

  // Priority fee = (microlamports per CU) × (compute units) / 1,000,000
  // Because 1 lamport = 1,000,000 microlamports
  const priorityFeeLamports = Math.ceil((microLamportsPerCU * computeUnits) / 1_000_000);

  return {
    priorityFeeLamports,
    microLamportsPerCU,
    computeUnits,
  };
}

/**
 * Get SDK instance for advanced usage
 */
function getSDK() {
  return getHelius();
}

/**
 * Check if Helius SDK is available
 */
function isAvailable() {
  return !!config.HELIUS_API_KEY;
}

module.exports = {
  getPriorityFeeEstimate,
  calculatePriorityFee,
  getSDK,
  isAvailable,
};
