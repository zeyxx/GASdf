/**
 * @deprecated Use fee-payer-pool.js instead
 * This file is kept for backward compatibility
 */

const feePayerPool = require('./fee-payer-pool');

// Re-export all functions from fee-payer-pool
module.exports = {
  getFeePayer: feePayerPool.getFeePayer,
  getFeePayerPublicKey: feePayerPool.getFeePayerPublicKey,
  signTransaction: feePayerPool.signTransaction,
  isTransactionSignedByFeePayer: feePayerPool.isTransactionSignedByFeePayer,

  // New exports
  getTransactionFeePayer: feePayerPool.getTransactionFeePayer,
  getAllFeePayerPublicKeys: feePayerPool.getAllFeePayerPublicKeys,
  getPayerBalances: feePayerPool.getPayerBalances,
  markPayerUnhealthy: feePayerPool.markPayerUnhealthy,
  getHealthSummary: feePayerPool.getHealthSummary,
  isCircuitOpen: feePayerPool.isCircuitOpen,
  pool: feePayerPool.pool,

  // Constants
  MIN_HEALTHY_BALANCE: feePayerPool.MIN_HEALTHY_BALANCE,
  CRITICAL_BALANCE: feePayerPool.CRITICAL_BALANCE,
  WARNING_BALANCE: feePayerPool.WARNING_BALANCE,
  BALANCE_MAX_AGE_MS: feePayerPool.BALANCE_MAX_AGE_MS,
};
