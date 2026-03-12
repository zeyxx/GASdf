/**
 * Fee Payer — Single keypair + circuit breaker
 * Phase 0: one wallet. Phase 2: multi-wallet pool.
 */

const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const config = require('../utils/config');
const logger = require('../utils/logger');

let keypair = null;
let connection = null;
let circuitOpen = false;

/**
 * Initialize keypair from env (lazy singleton).
 * @returns {Keypair}
 */
function getFeePayer() {
  if (!keypair) {
    if (!config.FEE_PAYER_PRIVATE_KEY) {
      throw new Error('FEE_PAYER_PRIVATE_KEY not configured');
    }
    const secretKey = bs58.decode(config.FEE_PAYER_PRIVATE_KEY);
    keypair = Keypair.fromSecretKey(secretKey);
    logger.info('FEE_PAYER', 'Initialized', { pubkey: keypair.publicKey.toBase58() });
  }
  return keypair;
}

/**
 * Get or create a Connection instance.
 * @returns {Connection}
 */
function getConnection() {
  if (!connection) {
    connection = new Connection(config.RPC_URL, 'confirmed');
  }
  return connection;
}

/**
 * Get the fee payer public key.
 * @returns {import('@solana/web3.js').PublicKey}
 */
function getPublicKey() {
  return getFeePayer().publicKey;
}

/**
 * Circuit breaker: check SOL balance against velocity-based threshold.
 * @returns {Promise<{balance: number, threshold: number, circuitOpen: boolean, solBalance: number}>}
 */
async function checkBalance() {
  try {
    const conn = getConnection();
    const balance = await conn.getBalance(getPublicKey());

    let threshold = 0.1 * LAMPORTS_PER_SOL; // default 0.1 SOL
    try {
      const redis = require('../utils/redis');
      const velocityResult = await redis.calculateVelocityBasedBuffer();
      if (velocityResult && typeof velocityResult.required === 'number') {
        threshold = velocityResult.required;
      }
    } catch (err) {
      logger.warn('FEE_PAYER', 'Velocity buffer unavailable, using default', {
        error: err.message,
      });
    }

    circuitOpen = balance < threshold;

    return { balance, threshold, circuitOpen, solBalance: balance / LAMPORTS_PER_SOL };
  } catch (err) {
    logger.error('FEE_PAYER', 'Balance check failed', { error: err.message });
    return { balance: 0, threshold: 0, circuitOpen, solBalance: 0 };
  }
}

/** @returns {boolean} Whether circuit breaker is open (balance too low). */
function isCircuitOpen() {
  return circuitOpen;
}

let balanceInterval = null;

/** Start periodic balance check (every 30s). */
function startBalanceMonitor() {
  checkBalance();
  balanceInterval = setInterval(checkBalance, 30_000);
}

/** Stop the periodic balance monitor. */
function stopBalanceMonitor() {
  if (balanceInterval) {
    clearInterval(balanceInterval);
    balanceInterval = null;
  }
}

module.exports = {
  getFeePayer,
  getConnection,
  getPublicKey,
  checkBalance,
  isCircuitOpen,
  startBalanceMonitor,
  stopBalanceMonitor,
};
