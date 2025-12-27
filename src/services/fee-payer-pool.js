const { Keypair, Transaction, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const config = require('../utils/config');
const logger = require('../utils/logger');
const rpc = require('../utils/rpc');

// =============================================================================
// Constants
// =============================================================================

// Minimum balance to consider a payer healthy (0.05 SOL in prod, 0 in dev)
const MIN_HEALTHY_BALANCE = process.env.NODE_ENV === 'development' ? 0 : 50_000_000;

// Warning balance threshold (0.1 SOL)
const WARNING_BALANCE = 100_000_000;

// How often to refresh balances (30 seconds)
const BALANCE_REFRESH_INTERVAL = 30_000;

// =============================================================================
// Fee Payer Pool
// =============================================================================

class FeePayerPool {
  constructor() {
    this.payers = [];
    this.currentIndex = 0;
    this.balances = new Map(); // pubkey -> balance in lamports
    this.unhealthyUntil = new Map(); // pubkey -> timestamp
    this.lastBalanceRefresh = 0;
    this.initialized = false;
  }

  /**
   * Initialize the pool with configured payers
   */
  initialize() {
    if (this.initialized) return;

    const keys = [];

    // Add primary fee payer
    if (config.FEE_PAYER_PRIVATE_KEY) {
      keys.push(config.FEE_PAYER_PRIVATE_KEY);
    }

    // Add additional fee payers from FEE_PAYER_KEYS
    if (config.FEE_PAYER_KEYS && config.FEE_PAYER_KEYS.length > 0) {
      keys.push(...config.FEE_PAYER_KEYS);
    }

    if (keys.length === 0) {
      throw new Error('No fee payer keys configured');
    }

    // Deduplicate and create keypairs
    const seenPubkeys = new Set();
    for (const key of keys) {
      try {
        const secretKey = bs58.decode(key.trim());
        const keypair = Keypair.fromSecretKey(secretKey);
        const pubkey = keypair.publicKey.toBase58();

        if (!seenPubkeys.has(pubkey)) {
          seenPubkeys.add(pubkey);
          this.payers.push(keypair);
          this.balances.set(pubkey, 0);
          logger.info('FEE_PAYER_POOL', `Added fee payer: ${pubkey.slice(0, 8)}...`);
        }
      } catch (error) {
        logger.error('FEE_PAYER_POOL', 'Failed to decode fee payer key', { error: error.message });
      }
    }

    if (this.payers.length === 0) {
      throw new Error('No valid fee payer keys could be loaded');
    }

    logger.info('FEE_PAYER_POOL', `Initialized with ${this.payers.length} fee payer(s)`);
    this.initialized = true;

    // Initial balance refresh
    this.refreshBalances().catch(err => {
      logger.warn('FEE_PAYER_POOL', 'Initial balance refresh failed', { error: err.message });
    });
  }

  /**
   * Refresh balances for all payers
   */
  async refreshBalances() {
    const now = Date.now();
    if (now - this.lastBalanceRefresh < BALANCE_REFRESH_INTERVAL) {
      return;
    }

    this.lastBalanceRefresh = now;

    const balancePromises = this.payers.map(async (payer) => {
      const pubkey = payer.publicKey.toBase58();
      try {
        const balance = await rpc.getBalance(payer.publicKey);
        this.balances.set(pubkey, balance);

        // Auto-heal if balance is now healthy
        if (balance >= MIN_HEALTHY_BALANCE && this.unhealthyUntil.has(pubkey)) {
          this.unhealthyUntil.delete(pubkey);
          logger.info('FEE_PAYER_POOL', `Payer ${pubkey.slice(0, 8)}... recovered (balance: ${balance / 1e9} SOL)`);
        }
      } catch (error) {
        logger.warn('FEE_PAYER_POOL', `Failed to get balance for ${pubkey.slice(0, 8)}...`, { error: error.message });
      }
    });

    await Promise.allSettled(balancePromises);
  }

  /**
   * Check if a payer is healthy
   */
  isPayerHealthy(pubkey) {
    const balance = this.balances.get(pubkey) || 0;
    const unhealthyUntil = this.unhealthyUntil.get(pubkey);

    // Check if marked unhealthy temporarily
    if (unhealthyUntil && Date.now() < unhealthyUntil) {
      return false;
    }

    // Check balance
    return balance >= MIN_HEALTHY_BALANCE;
  }

  /**
   * Get the next healthy payer using round-robin
   */
  getHealthyPayer() {
    this.initialize();

    // Try each payer starting from current index
    for (let i = 0; i < this.payers.length; i++) {
      const index = (this.currentIndex + i) % this.payers.length;
      const payer = this.payers[index];
      const pubkey = payer.publicKey.toBase58();

      if (this.isPayerHealthy(pubkey)) {
        // Move to next payer for next request (round-robin)
        this.currentIndex = (index + 1) % this.payers.length;
        return payer;
      }
    }

    // No healthy payers - return first one anyway (caller should handle error)
    logger.error('FEE_PAYER_POOL', 'No healthy fee payers available!');
    return null;
  }

  /**
   * Get a specific payer by public key (for submit validation)
   */
  getPayerByPubkey(pubkey) {
    this.initialize();
    return this.payers.find(p => p.publicKey.toBase58() === pubkey);
  }

  /**
   * Mark a payer as unhealthy temporarily (e.g., after a failed transaction)
   */
  markUnhealthy(pubkey, durationMs = 60_000) {
    this.unhealthyUntil.set(pubkey, Date.now() + durationMs);
    logger.warn('FEE_PAYER_POOL', `Marked ${pubkey.slice(0, 8)}... as unhealthy for ${durationMs / 1000}s`);
  }

  /**
   * Get all payer public keys
   */
  getAllPublicKeys() {
    this.initialize();
    return this.payers.map(p => p.publicKey);
  }

  /**
   * Get balances for all payers
   */
  async getBalances() {
    this.initialize();
    await this.refreshBalances();

    const result = [];
    for (const payer of this.payers) {
      const pubkey = payer.publicKey.toBase58();
      const balance = this.balances.get(pubkey) || 0;
      result.push({
        pubkey,
        balance,
        balanceSol: balance / 1e9,
        isHealthy: this.isPayerHealthy(pubkey),
        status: balance < MIN_HEALTHY_BALANCE ? 'critical' :
                balance < WARNING_BALANCE ? 'warning' : 'ok',
      });
    }
    return result;
  }

  /**
   * Get health summary
   */
  getHealthSummary() {
    this.initialize();
    const total = this.payers.length;
    let healthy = 0;
    let warning = 0;
    let critical = 0;

    for (const payer of this.payers) {
      const pubkey = payer.publicKey.toBase58();
      const balance = this.balances.get(pubkey) || 0;

      if (this.isPayerHealthy(pubkey)) {
        if (balance < WARNING_BALANCE) {
          warning++;
        } else {
          healthy++;
        }
      } else {
        critical++;
      }
    }

    return { total, healthy, warning, critical };
  }
}

// Singleton instance
const pool = new FeePayerPool();

// =============================================================================
// Exported Functions (backward compatible with signer.js)
// =============================================================================

function getFeePayer() {
  const payer = pool.getHealthyPayer();
  if (!payer) {
    throw new Error('No healthy fee payers available');
  }
  return payer;
}

function getFeePayerPublicKey() {
  return getFeePayer().publicKey;
}

function signTransaction(transaction, feePayerPubkey = null) {
  // If specific payer requested, use that one
  let feePayer;
  if (feePayerPubkey) {
    feePayer = pool.getPayerByPubkey(feePayerPubkey);
    if (!feePayer) {
      throw new Error(`Fee payer ${feePayerPubkey} not found in pool`);
    }
  } else {
    feePayer = getFeePayer();
  }

  if (transaction instanceof VersionedTransaction) {
    transaction.sign([feePayer]);
  } else {
    transaction.partialSign(feePayer);
  }

  return transaction;
}

function isTransactionSignedByFeePayer(transaction) {
  pool.initialize();

  // Get all valid fee payer pubkeys
  const validPubkeys = new Set(pool.payers.map(p => p.publicKey.toBase58()));

  if (transaction instanceof VersionedTransaction) {
    const signerKeys = transaction.message.staticAccountKeys;

    // Find if any of our fee payers signed this transaction
    for (let i = 0; i < signerKeys.length; i++) {
      const keyStr = signerKeys[i].toBase58();
      if (validPubkeys.has(keyStr)) {
        // Verify signature exists and is not empty (all zeros = unsigned)
        const signature = transaction.signatures[i];
        if (signature && signature.length === 64 && !signature.every((byte) => byte === 0)) {
          return true;
        }
      }
    }
    return false;
  } else {
    // For legacy Transaction
    const feePayerStr = transaction.feePayer?.toBase58();
    if (!feePayerStr || !validPubkeys.has(feePayerStr)) {
      return false;
    }

    const feePayerSig = transaction.signatures.find(
      (sig) => validPubkeys.has(sig.publicKey.toBase58())
    );
    return feePayerSig?.signature !== null;
  }
}

/**
 * Get the fee payer pubkey that signed a transaction
 */
function getTransactionFeePayer(transaction) {
  pool.initialize();
  const validPubkeys = new Set(pool.payers.map(p => p.publicKey.toBase58()));

  if (transaction instanceof VersionedTransaction) {
    const signerKeys = transaction.message.staticAccountKeys;
    for (let i = 0; i < signerKeys.length; i++) {
      const keyStr = signerKeys[i].toBase58();
      if (validPubkeys.has(keyStr)) {
        const signature = transaction.signatures[i];
        if (signature && signature.length === 64 && !signature.every((byte) => byte === 0)) {
          return keyStr;
        }
      }
    }
    return null;
  } else {
    const feePayerStr = transaction.feePayer?.toBase58();
    if (feePayerStr && validPubkeys.has(feePayerStr)) {
      return feePayerStr;
    }
    return null;
  }
}

module.exports = {
  // Pool access
  pool,

  // Backward compatible functions
  getFeePayer,
  getFeePayerPublicKey,
  signTransaction,
  isTransactionSignedByFeePayer,

  // New functions
  getTransactionFeePayer,
  getAllFeePayerPublicKeys: () => pool.getAllPublicKeys(),
  getPayerBalances: () => pool.getBalances(),
  markPayerUnhealthy: (pubkey, duration) => pool.markUnhealthy(pubkey, duration),
  getHealthSummary: () => pool.getHealthSummary(),

  // Constants
  MIN_HEALTHY_BALANCE,
  WARNING_BALANCE,
};
