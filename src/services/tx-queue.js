const config = require('../utils/config');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

// =============================================================================
// Constants
// =============================================================================

const QUEUE_KEY = 'tx:queue';
const PROCESSING_KEY = 'tx:processing';
const FAILED_KEY = 'tx:failed';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // ms

// Retryable error patterns
const RETRYABLE_ERRORS = [
  'BlockhashNotFound',
  'TransactionExpired',
  'TransactionSimulationFailed',
  'ServiceUnavailable',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'rate limit',
  'Too Many Requests',
];

// =============================================================================
// Transaction Queue
// =============================================================================

/**
 * Enqueue a transaction for processing
 */
async function enqueue(txData) {
  const entry = {
    id: txData.quoteId,
    transaction: txData.transaction, // base64 serialized
    userPubkey: txData.userPubkey,
    feePayer: txData.feePayer,
    feeAmount: txData.feeAmount,
    paymentToken: txData.paymentToken,
    attempts: 0,
    maxRetries: MAX_RETRIES,
    createdAt: Date.now(),
    lastAttempt: null,
    nextRetry: null,
    status: 'pending',
    errors: [],
  };

  await redis.setQuote(`tx:${entry.id}`, entry, 3600); // 1 hour TTL

  logger.info('TX_QUEUE', 'Transaction enqueued', {
    id: entry.id,
    userPubkey: txData.userPubkey.slice(0, 8),
  });

  return entry;
}

/**
 * Get a transaction entry by ID
 */
async function getEntry(txId) {
  return redis.getQuote(`tx:${txId}`);
}

/**
 * Update a transaction entry
 */
async function updateEntry(txId, updates) {
  const entry = await getEntry(txId);
  if (!entry) return null;

  const updated = { ...entry, ...updates };
  await redis.setQuote(`tx:${txId}`, updated, 3600);
  return updated;
}

/**
 * Mark transaction as processing
 */
async function markProcessing(txId) {
  return updateEntry(txId, {
    status: 'processing',
    lastAttempt: Date.now(),
  });
}

/**
 * Mark transaction as successful
 */
async function markSuccess(txId, signature) {
  const entry = await updateEntry(txId, {
    status: 'success',
    signature,
    completedAt: Date.now(),
  });

  logger.info('TX_QUEUE', 'Transaction succeeded', {
    id: txId,
    signature,
    attempts: entry.attempts,
  });

  return entry;
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error) {
  const errorStr = String(error.message || error);
  return RETRYABLE_ERRORS.some(pattern =>
    errorStr.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Mark transaction for retry or as failed
 */
async function markRetryOrFailed(txId, error) {
  const entry = await getEntry(txId);
  if (!entry) return null;

  const errorMessage = error.message || String(error);
  const attempts = entry.attempts + 1;
  const canRetry = attempts < MAX_RETRIES && isRetryableError(error);

  if (canRetry) {
    const retryDelay = RETRY_DELAYS[attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
    const nextRetry = Date.now() + retryDelay;

    const updated = await updateEntry(txId, {
      status: 'pending_retry',
      attempts,
      nextRetry,
      errors: [...entry.errors, { message: errorMessage, at: Date.now() }],
    });

    logger.warn('TX_QUEUE', 'Transaction scheduled for retry', {
      id: txId,
      attempt: attempts,
      nextRetry: new Date(nextRetry).toISOString(),
      error: errorMessage,
    });

    return updated;
  }

  // Mark as failed
  const updated = await updateEntry(txId, {
    status: 'failed',
    attempts,
    failedAt: Date.now(),
    errors: [...entry.errors, { message: errorMessage, at: Date.now() }],
  });

  logger.error('TX_QUEUE', 'Transaction failed permanently', {
    id: txId,
    attempts,
    error: errorMessage,
  });

  return updated;
}

/**
 * Get transactions ready for retry
 */
async function getRetryableTxs() {
  // In production, this would use Redis SCAN to find pending_retry entries
  // For now, we rely on the polling mechanism to check individual transactions
  return [];
}

/**
 * Get queue statistics
 */
async function getStats() {
  // This would be enhanced with Redis counters in production
  return {
    pending: 0,
    processing: 0,
    pendingRetry: 0,
    failed: 0,
    success: 0,
  };
}

/**
 * Clean up old entries
 */
async function cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
  // In production, this would scan and delete old entries
  logger.debug('TX_QUEUE', 'Cleanup completed');
}

module.exports = {
  enqueue,
  getEntry,
  updateEntry,
  markProcessing,
  markSuccess,
  markRetryOrFailed,
  isRetryableError,
  getRetryableTxs,
  getStats,
  cleanup,

  // Constants
  MAX_RETRIES,
  RETRY_DELAYS,
  RETRYABLE_ERRORS,
};
