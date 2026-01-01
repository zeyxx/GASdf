const { Keypair, Transaction, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const config = require('../utils/config');
const logger = require('../utils/logger');
const rpc = require('../utils/rpc');

// =============================================================================
// Constants
// =============================================================================

// Minimum balance to consider a payer healthy (0.01 SOL in prod, 0 in dev)
const MIN_HEALTHY_BALANCE = process.env.NODE_ENV === 'development' ? 0 : 10_000_000;

// Warning balance threshold (0.05 SOL)
const WARNING_BALANCE = 50_000_000;

// How often to refresh balances (30 seconds - balances RPC efficiency vs responsiveness)
// 10s was too aggressive, causing unnecessary RPC calls (~360/hour vs ~120/hour)
const BALANCE_REFRESH_INTERVAL = 30_000;

// Maximum pending reservations per fee payer (prevents over-commitment)
const MAX_RESERVATIONS_PER_PAYER = 50;

// Reservation TTL (matches quote TTL + buffer)
const RESERVATION_TTL_MS = 90_000; // 90 seconds

// =============================================================================
// Fee Payer Pool
// =============================================================================

// Key rotation states
const KEY_STATUS = {
  ACTIVE: 'active',       // Normal operation, accepts new quotes
  RETIRING: 'retiring',   // No new quotes, still processes existing reservations
  RETIRED: 'retired',     // Fully deprecated, should not be used
};

class FeePayerPool {
  constructor() {
    this.payers = [];
    this.currentIndex = 0;
    this.balances = new Map(); // pubkey -> balance in lamports
    this.unhealthyUntil = new Map(); // pubkey -> timestamp
    this.lastBalanceRefresh = 0;
    this.initialized = false;

    // Balance reservation system
    this.reservations = new Map(); // quoteId -> { pubkey, amount, expiresAt }
    this.reservationsByPayer = new Map(); // pubkey -> Set<quoteId>

    // Circuit breaker state
    this.circuitOpen = false;
    this.circuitOpenUntil = 0;
    this.consecutiveFailures = 0;

    // Key rotation state
    this.keyStatus = new Map(); // pubkey -> { status, retiredAt, reason }

    // ==========================================================================
    // RACE CONDITION FIX: In-process mutex for reservation operations
    // ==========================================================================
    this._reservationLock = Promise.resolve();
    this._lockQueue = [];
  }

  /**
   * Acquire in-process lock for reservation operations
   * Prevents race conditions when multiple concurrent requests try to reserve
   */
  async _acquireReservationLock() {
    let release;
    const lockPromise = new Promise((resolve) => {
      release = resolve;
    });

    // Wait for previous lock to release
    const previousLock = this._reservationLock;
    this._reservationLock = lockPromise;

    await previousLock;
    return release;
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
   * Check if a payer is healthy (for new quotes)
   * Considers: balance, temporary unhealthy status, and rotation status
   */
  isPayerHealthy(pubkey) {
    // Check key rotation status first
    if (!this.canAcceptNewQuotes(pubkey)) {
      return false;
    }

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
   * Check if a payer can process an existing reservation (submit)
   * More permissive than isPayerHealthy - allows RETIRING keys
   */
  canPayerProcessSubmit(pubkey) {
    // Check key rotation status (ACTIVE or RETIRING allowed)
    if (!this.canProcessReservations(pubkey)) {
      return false;
    }

    const balance = this.balances.get(pubkey) || 0;

    // Still need minimum balance to submit
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

  // ===========================================================================
  // Key Rotation System
  // ===========================================================================

  /**
   * Get current status of a key
   */
  getKeyStatus(pubkey) {
    const status = this.keyStatus.get(pubkey);
    if (!status) {
      return { status: KEY_STATUS.ACTIVE };
    }
    return status;
  }

  /**
   * Check if a key can accept new quotes
   * Returns true only for ACTIVE keys
   */
  canAcceptNewQuotes(pubkey) {
    const keyInfo = this.getKeyStatus(pubkey);
    return keyInfo.status === KEY_STATUS.ACTIVE;
  }

  /**
   * Check if a key can process existing reservations
   * Returns true for ACTIVE and RETIRING keys
   */
  canProcessReservations(pubkey) {
    const keyInfo = this.getKeyStatus(pubkey);
    return keyInfo.status !== KEY_STATUS.RETIRED;
  }

  /**
   * Start retiring a key - no new quotes, but existing reservations honored
   * @param {string} pubkey - The fee payer public key
   * @param {string} reason - Reason for retirement (e.g., 'scheduled_rotation', 'compromise_suspected')
   */
  startKeyRetirement(pubkey, reason = 'scheduled_rotation') {
    const existingStatus = this.getKeyStatus(pubkey);

    if (existingStatus.status === KEY_STATUS.RETIRED) {
      logger.warn('FEE_PAYER_POOL', `Cannot retire already retired key: ${pubkey.slice(0, 8)}...`);
      return false;
    }

    this.keyStatus.set(pubkey, {
      status: KEY_STATUS.RETIRING,
      retirementStartedAt: Date.now(),
      reason,
    });

    logger.warn('FEE_PAYER_POOL', `Key rotation started for ${pubkey.slice(0, 8)}...`, { reason });

    // Log to audit if available
    try {
      const { logPayerMarkedUnhealthy } = require('./audit');
      logPayerMarkedUnhealthy({
        pubkey,
        reason: `KEY_ROTATION_STARTED: ${reason}`,
        duration: 'until_manual_completion',
      });
    } catch {
      // Audit service may not be available
    }

    return true;
  }

  /**
   * Complete key retirement - fully remove from active duty
   * Should be called after all existing reservations are processed
   */
  completeKeyRetirement(pubkey) {
    const existingStatus = this.getKeyStatus(pubkey);

    if (existingStatus.status !== KEY_STATUS.RETIRING) {
      logger.warn('FEE_PAYER_POOL', `Cannot complete retirement for non-retiring key: ${pubkey.slice(0, 8)}...`);
      return false;
    }

    // Check if there are pending reservations
    const pendingReservations = this.reservationsByPayer.get(pubkey)?.size || 0;
    if (pendingReservations > 0) {
      logger.warn('FEE_PAYER_POOL', `Cannot complete retirement: ${pendingReservations} pending reservations`, { pubkey: pubkey.slice(0, 8) });
      return false;
    }

    this.keyStatus.set(pubkey, {
      status: KEY_STATUS.RETIRED,
      retiredAt: Date.now(),
      retirementStartedAt: existingStatus.retirementStartedAt,
      reason: existingStatus.reason,
    });

    logger.warn('FEE_PAYER_POOL', `Key rotation completed for ${pubkey.slice(0, 8)}...`);

    return true;
  }

  /**
   * Emergency: Immediately retire a key (e.g., suspected compromise)
   * Forces retirement even with pending reservations
   */
  emergencyRetireKey(pubkey, reason = 'emergency') {
    this.keyStatus.set(pubkey, {
      status: KEY_STATUS.RETIRED,
      retiredAt: Date.now(),
      reason: `EMERGENCY: ${reason}`,
      forced: true,
    });

    // Cancel all pending reservations for this key
    const quoteIds = this.reservationsByPayer.get(pubkey);
    if (quoteIds) {
      const cancelled = quoteIds.size;
      for (const quoteId of [...quoteIds]) {
        this.releaseReservation(quoteId);
      }
      logger.error('FEE_PAYER_POOL', `Emergency retirement: cancelled ${cancelled} reservations`, { pubkey: pubkey.slice(0, 8) });
    }

    logger.error('FEE_PAYER_POOL', `EMERGENCY key retirement for ${pubkey.slice(0, 8)}...`, { reason });

    // Log to audit
    try {
      const { logSecurityEvent } = require('./audit');
      logSecurityEvent('KEY_EMERGENCY_RETIRED', { pubkey, reason });
    } catch {
      // Audit service may not be available
    }

    return true;
  }

  /**
   * Reactivate a retired key (use with caution)
   */
  reactivateKey(pubkey) {
    const existingStatus = this.getKeyStatus(pubkey);

    if (existingStatus.status === KEY_STATUS.ACTIVE) {
      return true; // Already active
    }

    if (existingStatus.forced) {
      logger.error('FEE_PAYER_POOL', `Cannot reactivate emergency-retired key: ${pubkey.slice(0, 8)}...`);
      return false;
    }

    this.keyStatus.delete(pubkey);
    logger.info('FEE_PAYER_POOL', `Key reactivated: ${pubkey.slice(0, 8)}...`);

    return true;
  }

  /**
   * Get rotation status for all keys
   */
  getRotationStatus() {
    const status = [];

    for (const payer of this.payers) {
      const pubkey = payer.publicKey.toBase58();
      const keyInfo = this.getKeyStatus(pubkey);
      const pendingReservations = this.reservationsByPayer.get(pubkey)?.size || 0;

      status.push({
        pubkey: pubkey.slice(0, 12) + '...',
        fullPubkey: pubkey,
        status: keyInfo.status,
        canAcceptQuotes: this.canAcceptNewQuotes(pubkey),
        canProcessReservations: this.canProcessReservations(pubkey),
        pendingReservations,
        ...(keyInfo.retirementStartedAt && { retirementStartedAt: new Date(keyInfo.retirementStartedAt).toISOString() }),
        ...(keyInfo.retiredAt && { retiredAt: new Date(keyInfo.retiredAt).toISOString() }),
        ...(keyInfo.reason && { reason: keyInfo.reason }),
      });
    }

    return status;
  }

  // ===========================================================================
  // Balance Reservation System
  // ===========================================================================

  /**
   * Clean up expired reservations
   */
  cleanupExpiredReservations() {
    const now = Date.now();
    const expired = [];

    for (const [quoteId, reservation] of this.reservations) {
      if (now > reservation.expiresAt) {
        expired.push(quoteId);
      }
    }

    for (const quoteId of expired) {
      this.releaseReservation(quoteId);
    }

    if (expired.length > 0) {
      logger.debug('FEE_PAYER_POOL', `Cleaned up ${expired.length} expired reservations`);
    }
  }

  /**
   * Get available balance for a payer (actual balance - reserved amount)
   */
  getAvailableBalance(pubkey) {
    const actualBalance = this.balances.get(pubkey) || 0;
    const reservedAmount = this.getReservedAmount(pubkey);
    return Math.max(0, actualBalance - reservedAmount);
  }

  /**
   * Get total reserved amount for a payer
   */
  getReservedAmount(pubkey) {
    const quoteIds = this.reservationsByPayer.get(pubkey);
    if (!quoteIds || quoteIds.size === 0) return 0;

    let total = 0;
    for (const quoteId of quoteIds) {
      const reservation = this.reservations.get(quoteId);
      if (reservation) {
        total += reservation.amount;
      }
    }
    return total;
  }

  /**
   * Get reservation count for a payer
   */
  getReservationCount(pubkey) {
    return this.reservationsByPayer.get(pubkey)?.size || 0;
  }

  /**
   * Reserve balance for a quote (with mutex protection)
   * Returns the assigned fee payer pubkey, or null if circuit breaker is open
   */
  async reserveBalance(quoteId, amountLamports) {
    this.initialize();

    // ==========================================================================
    // RACE CONDITION FIX: Acquire lock before checking/modifying state
    // ==========================================================================
    const releaseLock = await this._acquireReservationLock();

    try {
      this.cleanupExpiredReservations();

      // Check circuit breaker
      if (this.isCircuitOpen()) {
        logger.warn('FEE_PAYER_POOL', 'Circuit breaker open, rejecting reservation', { quoteId });
        return null;
      }

      // Find a payer with capacity
      for (let i = 0; i < this.payers.length; i++) {
        const index = (this.currentIndex + i) % this.payers.length;
        const payer = this.payers[index];
        const pubkey = payer.publicKey.toBase58();

        // Skip unhealthy payers
        if (!this.isPayerHealthy(pubkey)) continue;

        // Check reservation count limit
        const reservationCount = this.getReservationCount(pubkey);
        if (reservationCount >= MAX_RESERVATIONS_PER_PAYER) {
          logger.debug('FEE_PAYER_POOL', `Payer ${pubkey.slice(0, 8)}... at max reservations`);
          continue;
        }

        // Check available balance
        const availableBalance = this.getAvailableBalance(pubkey);
        if (availableBalance < amountLamports + MIN_HEALTHY_BALANCE) {
          logger.debug('FEE_PAYER_POOL', `Payer ${pubkey.slice(0, 8)}... insufficient available balance`);
          continue;
        }

        // Create reservation
        const reservation = {
          pubkey,
          amount: amountLamports,
          expiresAt: Date.now() + RESERVATION_TTL_MS,
          createdAt: Date.now(),
        };

        this.reservations.set(quoteId, reservation);

        if (!this.reservationsByPayer.has(pubkey)) {
          this.reservationsByPayer.set(pubkey, new Set());
        }
        this.reservationsByPayer.get(pubkey).add(quoteId);

        // Move to next payer for round-robin
        this.currentIndex = (index + 1) % this.payers.length;

        logger.debug('FEE_PAYER_POOL', 'Reserved balance', {
          quoteId,
          pubkey: pubkey.slice(0, 8),
          amount: amountLamports,
          availableAfter: availableBalance - amountLamports,
        });

        // Reset consecutive failures on successful reservation
        this.consecutiveFailures = 0;

        return pubkey;
      }

      // No payer available - record failure
      this.recordFailure();
      logger.error('FEE_PAYER_POOL', 'No payer available for reservation', {
        quoteId,
        amount: amountLamports,
      });

      return null;
    } finally {
      // Always release lock
      releaseLock();
    }
  }

  /**
   * Release a reservation (quote used or expired)
   */
  releaseReservation(quoteId) {
    const reservation = this.reservations.get(quoteId);
    if (!reservation) return false;

    const { pubkey } = reservation;

    // Remove from maps
    this.reservations.delete(quoteId);

    const payerReservations = this.reservationsByPayer.get(pubkey);
    if (payerReservations) {
      payerReservations.delete(quoteId);
      if (payerReservations.size === 0) {
        this.reservationsByPayer.delete(pubkey);
      }
    }

    logger.debug('FEE_PAYER_POOL', 'Released reservation', {
      quoteId,
      pubkey: pubkey.slice(0, 8),
    });

    return true;
  }

  /**
   * Get reservation info for a quote
   */
  getReservation(quoteId) {
    return this.reservations.get(quoteId);
  }

  // ===========================================================================
  // Circuit Breaker
  // ===========================================================================

  /**
   * Record a failure (no payers available)
   */
  recordFailure() {
    this.consecutiveFailures++;

    // Open circuit after 5 consecutive failures
    if (this.consecutiveFailures >= 5) {
      this.openCircuit(30_000); // 30 seconds
    }
  }

  /**
   * Open the circuit breaker
   */
  openCircuit(durationMs) {
    if (!this.circuitOpen) {
      this.circuitOpen = true;
      this.circuitOpenUntil = Date.now() + durationMs;
      logger.error('FEE_PAYER_POOL', 'Circuit breaker OPENED', {
        duration: durationMs,
        consecutiveFailures: this.consecutiveFailures,
      });
    }
  }

  /**
   * Check if circuit breaker is open
   */
  isCircuitOpen() {
    if (!this.circuitOpen) return false;

    // Check if circuit should close
    if (Date.now() >= this.circuitOpenUntil) {
      this.circuitOpen = false;
      this.consecutiveFailures = 0;
      logger.info('FEE_PAYER_POOL', 'Circuit breaker CLOSED');
      return false;
    }

    return true;
  }

  /**
   * Force close the circuit (manual recovery)
   */
  closeCircuit() {
    this.circuitOpen = false;
    this.circuitOpenUntil = 0;
    this.consecutiveFailures = 0;
    logger.info('FEE_PAYER_POOL', 'Circuit breaker manually closed');
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState() {
    return {
      isOpen: this.isCircuitOpen(),
      consecutiveFailures: this.consecutiveFailures,
      closesAt: this.circuitOpen ? this.circuitOpenUntil : null,
      totalReservations: this.reservations.size,
    };
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
  canPayerProcessSubmit: (pubkey) => pool.canPayerProcessSubmit(pubkey),

  // Balance reservation system
  reserveBalance: (quoteId, amount) => pool.reserveBalance(quoteId, amount),
  releaseReservation: (quoteId) => pool.releaseReservation(quoteId),
  getReservation: (quoteId) => pool.getReservation(quoteId),

  // Circuit breaker
  isCircuitOpen: () => pool.isCircuitOpen(),
  getCircuitState: () => pool.getCircuitState(),
  closeCircuit: () => pool.closeCircuit(),

  // Key rotation
  startKeyRetirement: (pubkey, reason) => pool.startKeyRetirement(pubkey, reason),
  completeKeyRetirement: (pubkey) => pool.completeKeyRetirement(pubkey),
  emergencyRetireKey: (pubkey, reason) => pool.emergencyRetireKey(pubkey, reason),
  reactivateKey: (pubkey) => pool.reactivateKey(pubkey),
  getRotationStatus: () => pool.getRotationStatus(),
  getKeyStatus: (pubkey) => pool.getKeyStatus(pubkey),

  // Constants
  MIN_HEALTHY_BALANCE,
  WARNING_BALANCE,
  MAX_RESERVATIONS_PER_PAYER,
  KEY_STATUS,
};
