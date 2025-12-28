const express = require('express');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const rpc = require('../utils/rpc');
const { signTransaction, markPayerUnhealthy } = require('../services/signer');
const { releaseReservation, getReservation } = require('../services/fee-payer-pool');
const {
  deserializeTransaction,
  validateTransaction,
  validateTransactionSize,
  getTransactionBlockhash,
  computeTransactionHash,
} = require('../services/validator');
const { submitLimiter, walletSubmitLimiter } = require('../middleware/security');
const { validate } = require('../middleware/validation');
const txQueue = require('../services/tx-queue');
const { submitsTotal, submitDuration, activeQuotes } = require('../utils/metrics');
const { logSubmitSuccess, logSubmitRejected, logSecurityEvent, AUDIT_EVENTS } = require('../services/audit');
const { anomalyDetector } = require('../services/anomaly-detector');

const router = express.Router();

// Apply rate limiting (IP-based first, then wallet-based)
router.use(submitLimiter);

/**
 * POST /submit
 * Submit a transaction for gasless execution
 */
router.post('/', validate('submit'), walletSubmitLimiter, async (req, res) => {
  const { quoteId, transaction, userPubkey } = req.body;
  const startTime = process.hrtime.bigint();
  const clientIp = req.ip || req.headers['x-forwarded-for'];

  // Track activity for anomaly detection
  anomalyDetector.trackWallet(userPubkey, 'submit', clientIp).catch(() => {});
  anomalyDetector.trackIp(clientIp, 'submit').catch(() => {});

  try {
    // Get and validate quote
    const quote = await redis.getQuote(quoteId);
    if (!quote) {
      logger.warn('SUBMIT', 'Quote not found', { requestId: req.requestId, quoteId });
      return res.status(400).json({
        error: 'Quote not found or expired',
        code: 'QUOTE_NOT_FOUND',
      });
    }

    if (Date.now() > quote.expiresAt) {
      await redis.deleteQuote(quoteId);
      logger.warn('SUBMIT', 'Quote expired', { requestId: req.requestId, quoteId });
      return res.status(400).json({
        error: 'Quote expired',
        code: 'QUOTE_EXPIRED',
      });
    }

    // =========================================================================
    // SECURITY: Validate transaction size (Solana limit: 1,232 bytes)
    // =========================================================================
    const sizeValidation = validateTransactionSize(transaction);
    if (!sizeValidation.valid) {
      logger.warn('SUBMIT', 'Transaction too large', {
        requestId: req.requestId,
        quoteId,
        size: sizeValidation.size,
        maxSize: sizeValidation.maxSize,
        userPubkey,
      });

      logSecurityEvent(AUDIT_EVENTS.VALIDATION_FAILED, {
        quoteId,
        reason: 'transaction_size_exceeded',
        size: sizeValidation.size,
        maxSize: sizeValidation.maxSize,
        userPubkey,
        ip: clientIp,
      });

      return res.status(400).json({
        error: sizeValidation.error,
        code: 'TX_TOO_LARGE',
        size: sizeValidation.size,
        maxSize: sizeValidation.maxSize,
      });
    }

    // Deserialize transaction
    let tx;
    try {
      tx = deserializeTransaction(transaction);
    } catch (error) {
      logger.warn('SUBMIT', 'Invalid transaction format', {
        requestId: req.requestId,
        error: error.message,
      });
      return res.status(400).json({
        error: 'Invalid transaction format',
        code: 'INVALID_TX_FORMAT',
      });
    }

    // =========================================================================
    // SECURITY: Anti-Replay Protection
    // =========================================================================
    const txHash = computeTransactionHash(tx);

    // Check if this transaction was already submitted
    const isReplay = await redis.hasTransactionHash(txHash);
    if (isReplay) {
      logger.warn('SUBMIT', 'Replay attack detected', {
        requestId: req.requestId,
        quoteId,
        txHash: txHash.slice(0, 16),
        userPubkey,
      });

      logSecurityEvent(AUDIT_EVENTS.REPLAY_ATTACK_DETECTED, {
        quoteId,
        txHash: txHash.slice(0, 16),
        userPubkey,
        ip: clientIp,
      });

      // Track failure for anomaly detection
      anomalyDetector.trackWallet(userPubkey, 'failure', clientIp).catch(() => {});

      return res.status(400).json({
        error: 'Transaction already submitted',
        code: 'REPLAY_DETECTED',
      });
    }

    // =========================================================================
    // SECURITY: Blockhash Freshness Validation
    // =========================================================================
    const blockhash = getTransactionBlockhash(tx);
    const isBlockhashValid = await rpc.isBlockhashValid(blockhash);

    if (!isBlockhashValid) {
      logger.warn('SUBMIT', 'Stale blockhash detected', {
        requestId: req.requestId,
        quoteId,
        blockhash: blockhash.slice(0, 16),
        userPubkey,
      });

      logSecurityEvent(AUDIT_EVENTS.BLOCKHASH_EXPIRED, {
        quoteId,
        blockhash: blockhash.slice(0, 16),
        userPubkey,
        ip: clientIp,
      });

      return res.status(400).json({
        error: 'Transaction blockhash expired, please get a new quote',
        code: 'BLOCKHASH_EXPIRED',
      });
    }

    // Validate transaction
    const validation = validateTransaction(tx, quote.feeAmountToken, userPubkey);
    if (!validation.valid) {
      logger.warn('SUBMIT', 'Transaction validation failed', {
        requestId: req.requestId,
        errors: validation.errors,
      });

      logSecurityEvent(AUDIT_EVENTS.VALIDATION_FAILED, {
        quoteId,
        errors: validation.errors,
        userPubkey,
        ip: clientIp,
      });

      anomalyDetector.trackWallet(userPubkey, 'failure', clientIp).catch(() => {});

      return res.status(400).json({
        error: 'Transaction validation failed',
        code: 'VALIDATION_FAILED',
        details: validation.errors,
      });
    }

    // =========================================================================
    // SECURITY: Validate fee payer matches quote reservation
    // =========================================================================
    const reservation = getReservation(quoteId);
    if (reservation && reservation.pubkey !== validation.feePayer) {
      logger.warn('SUBMIT', 'Fee payer mismatch with reservation', {
        requestId: req.requestId,
        quoteId,
        expected: reservation.pubkey?.slice(0, 8),
        actual: validation.feePayer?.slice(0, 8),
      });

      logSecurityEvent(AUDIT_EVENTS.FEE_PAYER_MISMATCH, {
        quoteId,
        expected: reservation.pubkey,
        actual: validation.feePayer,
        userPubkey,
        ip: clientIp,
      });

      anomalyDetector.trackWallet(userPubkey, 'failure', clientIp).catch(() => {});

      return res.status(400).json({
        error: 'Transaction fee payer does not match quote',
        code: 'FEE_PAYER_MISMATCH',
      });
    }

    // Also validate against quote.feePayer for backward compatibility
    if (quote.feePayer && quote.feePayer !== validation.feePayer) {
      logger.warn('SUBMIT', 'Fee payer mismatch with quote', {
        requestId: req.requestId,
        quoteId,
        expected: quote.feePayer?.slice(0, 8),
        actual: validation.feePayer?.slice(0, 8),
      });

      logSecurityEvent(AUDIT_EVENTS.FEE_PAYER_MISMATCH, {
        quoteId,
        expected: quote.feePayer,
        actual: validation.feePayer,
        userPubkey,
        ip: clientIp,
      });

      anomalyDetector.trackWallet(userPubkey, 'failure', clientIp).catch(() => {});

      return res.status(400).json({
        error: 'Transaction fee payer does not match quote',
        code: 'FEE_PAYER_MISMATCH',
      });
    }

    // Enqueue transaction for tracking
    const txEntry = await txQueue.enqueue({
      quoteId,
      transaction,
      userPubkey,
      feePayer: validation.feePayer,
      feeAmount: quote.feeAmountLamports,
      paymentToken: quote.paymentToken,
    });

    // Sign with fee payer
    const signedTx = signTransaction(tx, validation.feePayer);

    // =========================================================================
    // SECURITY: Simulate transaction before sending
    // =========================================================================
    const simulation = await rpc.simulateTransaction(signedTx);
    if (!simulation.success) {
      logger.warn('SUBMIT', 'Transaction simulation failed', {
        requestId: req.requestId,
        quoteId,
        error: simulation.error,
        logs: simulation.logs?.slice(-5), // Last 5 log lines
      });

      logSecurityEvent(AUDIT_EVENTS.SIMULATION_FAILED, {
        quoteId,
        error: simulation.error,
        userPubkey,
        ip: clientIp,
      });

      anomalyDetector.trackWallet(userPubkey, 'failure', clientIp).catch(() => {});

      // Release reservation since we won't be using this quote
      releaseReservation(quoteId);

      return res.status(400).json({
        error: 'Transaction simulation failed',
        code: 'SIMULATION_FAILED',
        details: simulation.error,
        logs: simulation.logs?.slice(-3),
      });
    }

    logger.debug('SUBMIT', 'Transaction simulation passed', {
      requestId: req.requestId,
      quoteId,
      unitsConsumed: simulation.unitsConsumed,
    });

    // Mark as processing
    await txQueue.markProcessing(quoteId);

    // Send transaction with retry logic
    const result = await sendWithRetry(signedTx, quoteId, validation.feePayer);

    if (!result.success) {
      // Transaction failed after all retries
      return res.status(500).json({
        error: 'Transaction submission failed',
        code: 'SUBMIT_FAILED',
        retriable: result.retriable,
        attempts: result.attempts,
        requestId: req.requestId,
      });
    }

    // Success - delete used quote and release reservation
    await redis.deleteQuote(quoteId);
    releaseReservation(quoteId);

    // Mark transaction hash to prevent replay attacks
    await redis.markTransactionHash(txHash);

    // Track for burn worker
    await redis.addPendingSwap(quote.feeAmountLamports);
    await redis.incrTxCount();

    // Track wallet burn contribution (CCM-aligned)
    const burnAmount = quote.burnAmount || Math.floor(quote.feeAmountLamports * config.BURN_RATIO);
    await redis.incrWalletBurn(userPubkey, burnAmount);

    // Mark as successful
    await txQueue.markSuccess(quoteId, result.signature);

    // Record success metrics
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    submitsTotal.inc({ status: 'success' });
    submitDuration.observe({ status: 'success' }, duration);
    activeQuotes.dec(); // Quote consumed

    logger.info('SUBMIT', 'Transaction submitted', {
      requestId: req.requestId,
      quoteId,
      signature: result.signature,
      userPubkey,
      feeLamports: quote.feeAmountLamports,
      attempts: result.attempts,
    });

    // Audit log
    logSubmitSuccess({
      quoteId,
      signature: result.signature,
      userPubkey,
      feePayer: validation.feePayer,
      feeAmountLamports: quote.feeAmountLamports,
      attempts: result.attempts,
      ip: clientIp,
    });

    // Confirm in background (don't block response)
    rpc.confirmTransaction(result.signature).catch((err) => {
      logger.warn('SUBMIT', 'Confirmation failed', {
        signature: result.signature,
        error: err.message,
      });
    });

    res.json({
      signature: result.signature,
      status: 'submitted',
      attempts: result.attempts,
      explorer: `https://solscan.io/tx/${result.signature}${config.IS_DEV ? '?cluster=devnet' : ''}`,
    });
  } catch (error) {
    // Record error metrics
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    submitsTotal.inc({ status: 'error' });
    submitDuration.observe({ status: 'error' }, duration);

    logger.error('SUBMIT', 'Failed to submit transaction', {
      requestId: req.requestId,
      quoteId,
      error: error.message,
    });

    // Release reservation on error
    releaseReservation(quoteId);

    // Mark as failed in queue
    await txQueue.markRetryOrFailed(quoteId, error).catch(() => {});

    res.status(500).json({
      error: 'Failed to submit transaction',
      code: 'SUBMIT_FAILED',
      requestId: req.requestId,
    });
  }
});

/**
 * Send transaction with retry logic
 */
async function sendWithRetry(signedTx, txId, feePayerPubkey) {
  let attempts = 0;
  let lastError = null;

  while (attempts < txQueue.MAX_RETRIES) {
    attempts++;

    try {
      const signature = await rpc.sendTransaction(signedTx);
      return { success: true, signature, attempts };
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (!txQueue.isRetryableError(error)) {
        logger.warn('SUBMIT', 'Non-retryable error', {
          txId,
          attempt: attempts,
          error: error.message,
        });
        break;
      }

      // Check if we should mark fee payer as unhealthy
      if (shouldMarkPayerUnhealthy(error)) {
        markPayerUnhealthy(feePayerPubkey, 60_000); // 1 minute cooldown
      }

      // Wait before retry if not last attempt
      if (attempts < txQueue.MAX_RETRIES) {
        const delay = txQueue.RETRY_DELAYS[attempts - 1] || txQueue.RETRY_DELAYS[txQueue.RETRY_DELAYS.length - 1];
        logger.info('SUBMIT', 'Retrying transaction', {
          txId,
          attempt: attempts,
          nextAttemptIn: delay,
          error: error.message,
        });
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    attempts,
    retriable: txQueue.isRetryableError(lastError),
    error: lastError?.message,
  };
}

/**
 * Check if error indicates fee payer should be marked unhealthy
 */
function shouldMarkPayerUnhealthy(error) {
  const errorStr = String(error.message || error).toLowerCase();
  return (
    errorStr.includes('insufficient funds') ||
    errorStr.includes('insufficient lamports') ||
    errorStr.includes('account not found')
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * GET /submit/status/:txId
 * Check status of a submitted transaction
 */
router.get('/status/:txId', async (req, res) => {
  const { txId } = req.params;

  try {
    const entry = await txQueue.getEntry(txId);

    if (!entry) {
      return res.status(404).json({
        error: 'Transaction not found',
        code: 'TX_NOT_FOUND',
      });
    }

    res.json({
      id: entry.id,
      status: entry.status,
      signature: entry.signature,
      attempts: entry.attempts,
      createdAt: entry.createdAt,
      completedAt: entry.completedAt,
      failedAt: entry.failedAt,
      nextRetry: entry.nextRetry,
      errors: entry.errors?.slice(-3), // Last 3 errors
    });
  } catch (error) {
    logger.error('SUBMIT', 'Failed to get transaction status', {
      requestId: req.requestId,
      txId,
      error: error.message,
    });

    res.status(500).json({
      error: 'Failed to get transaction status',
      requestId: req.requestId,
    });
  }
});

module.exports = router;
