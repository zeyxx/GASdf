/**
 * Helius SDK Integration
 * Priority fees, tx submission (Sender), and RPC connection.
 *
 * Uses helius-sdk for: getPriorityFeeEstimate, sendSmartTransaction
 * Uses @solana/web3.js v1 Connection (via Helius RPC URL) for: raw RPC calls
 */

const { createHelius } = require('helius-sdk');
const { Connection } = require('@solana/web3.js');
const config = require('../utils/config');
const logger = require('../utils/logger');

let helius = null;
let connection = null;

function getHelius() {
  if (!helius && config.HELIUS_API_KEY) {
    helius = createHelius(config.HELIUS_API_KEY);
    logger.info('HELIUS', 'SDK initialized', {
      network: config.USE_MAINNET ? 'mainnet' : 'devnet',
    });
  }
  return helius;
}

// Cache for priority fees (5s TTL)
let priorityFeeCache = { estimate: null, timestamp: 0, ttl: 5000 };

/**
 * Get priority fee estimate from Helius.
 */
async function getPriorityFeeEstimate(options = {}) {
  const { accountKeys = [], priorityLevel = 'Medium' } = options;

  const h = getHelius();
  if (!h) {
    return { priorityFee: 1000, priorityLevel: 'fallback', cached: false };
  }

  const now = Date.now();
  if (accountKeys.length === 0 && priorityFeeCache.estimate && now - priorityFeeCache.timestamp < priorityFeeCache.ttl) {
    return { ...priorityFeeCache.estimate, cached: true };
  }

  try {
    const response = await h.getPriorityFeeEstimate({
      accountKeys: accountKeys.length > 0 ? accountKeys : undefined,
      options: { priorityLevel, includeAllPriorityFeeLevels: false, lookbackSlots: 150 },
    });

    const estimate = {
      priorityFee: Math.ceil(response.priorityFeeEstimate || 1000),
      priorityLevel,
      cached: false,
    };

    if (accountKeys.length === 0) {
      priorityFeeCache = { estimate, timestamp: now, ttl: priorityFeeCache.ttl };
    }

    return estimate;
  } catch (error) {
    logger.warn('HELIUS', 'Priority fee estimate failed', { error: error.message });
    return { priorityFee: 1000, priorityLevel: 'fallback', cached: false };
  }
}

/**
 * Calculate total priority fee in lamports.
 */
async function calculatePriorityFee(computeUnits, options = {}) {
  const { priorityFee: microLamportsPerCU } = await getPriorityFeeEstimate(options);
  const priorityFeeLamports = Math.ceil((microLamportsPerCU * computeUnits) / 1_000_000);
  return { priorityFeeLamports, microLamportsPerCU, computeUnits };
}

/**
 * Get a @solana/web3.js v1 Connection using Helius RPC URL.
 * This is separate from the SDK — used for raw RPC calls.
 * @returns {Connection}
 */
function getConnection() {
  if (!connection) {
    connection = new Connection(config.RPC_URL, 'confirmed');
  }
  return connection;
}

/**
 * Send and confirm a pre-built serialized transaction via Helius RPC.
 * Used for the main relay flow (user's pre-signed tx).
 * @param {Buffer} serializedTx
 * @param {Object} options
 * @returns {Promise<{signature: string, confirmation: Object}>}
 */
async function sendAndConfirmTransaction(serializedTx, options = {}) {
  const conn = getConnection();

  const signature = await conn.sendRawTransaction(serializedTx, {
    skipPreflight: true,
    ...options,
  });

  const latestBlockhash = await conn.getLatestBlockhash('confirmed');
  const confirmation = await conn.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    'confirmed'
  );

  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  return { signature, confirmation };
}

/**
 * Send a smart transaction via Helius SDK (for burn worker / internal ops).
 * Uses Helius's sendSmartTransaction which handles priority fees + Jito tips.
 * @param {TransactionInstruction[]} instructions
 * @param {Keypair[]} signers
 * @param {Object} options
 * @returns {Promise<string>} signature
 */
async function sendSmartTransaction(instructions, signers, options = {}) {
  const h = getHelius();
  if (!h) throw new Error('Helius SDK not available');

  const signature = await h.sendSmartTransaction(instructions, signers, [], {
    skipPreflight: true,
    ...options,
  });

  return signature;
}

function getSDK() {
  return getHelius();
}

function isAvailable() {
  return !!config.HELIUS_API_KEY;
}

module.exports = {
  getPriorityFeeEstimate,
  calculatePriorityFee,
  sendAndConfirmTransaction,
  sendSmartTransaction,
  getConnection,
  getSDK,
  isAvailable,
};
