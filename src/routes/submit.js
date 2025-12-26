const express = require('express');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const rpc = require('../utils/rpc');
const { signTransaction, markPayerUnhealthy } = require('../services/signer');
const { deserializeTransaction, validateTransaction } = require('../services/validator');
const { submitLimiter } = require('../middleware/security');
const { validate } = require('../middleware/validation');
const txQueue = require('../services/tx-queue');
const { submitsTotal, submitDuration, activeQuotes } = require('../utils/metrics');

const router = express.Router();

// Apply rate limiting
router.use(submitLimiter);

/**
 * POST /submit
 * Submit a transaction for gasless execution
 */
router.post('/', validate('submit'), async (req, res) => {
  const { quoteId, transaction, userPubkey } = req.body;
  const startTime = process.hrtime.bigint();

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

    // Validate transaction
    const validation = validateTransaction(tx, quote.feeAmountToken, userPubkey);
    if (!validation.valid) {
      logger.warn('SUBMIT', 'Transaction validation failed', {
        requestId: req.requestId,
        errors: validation.errors,
      });
      return res.status(400).json({
        error: 'Transaction validation failed',
        code: 'VALIDATION_FAILED',
        details: validation.errors,
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

    // Success - delete used quote
    await redis.deleteQuote(quoteId);

    // Track for burn worker
    await redis.addPendingSwap(quote.feeAmountLamports);
    await redis.incrTxCount();

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
