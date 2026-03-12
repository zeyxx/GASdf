const express = require('express');
const { VersionedTransaction } = require('@solana/web3.js');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const feePayer = require('../services/fee-payer');
const helius = require('../services/helius');
const validator = require('../services/validator');
const { EXPLORER_BASE } = require('../constants');

const router = express.Router();

// POST /v1/submit
router.post('/', async (req, res) => {
  try {
    const { quoteId, transaction } = req.body;

    // =========================================================================
    // 1. Validate input
    // =========================================================================
    if (!quoteId || !transaction) {
      return res.status(400).json({
        error: 'Missing required fields: quoteId, transaction',
        code: 'INVALID_INPUT',
      });
    }

    // =========================================================================
    // 2. Get quote from Redis
    // =========================================================================
    const quote = await redis.getQuote(quoteId);
    if (!quote) {
      return res.status(404).json({
        error: 'Quote not found or expired',
        code: 'QUOTE_NOT_FOUND',
      });
    }

    // =========================================================================
    // 3. Delete quote immediately (single use)
    // =========================================================================
    await redis.deleteQuote(quoteId);

    // =========================================================================
    // 4. Anti-replay: claim transaction slot
    // =========================================================================
    const txBuffer = Buffer.from(transaction, 'base64');
    const txHash = Buffer.from(txBuffer).toString('hex').slice(0, 64);
    const { claimed } = await redis.claimTransactionSlot(txHash);
    if (!claimed) {
      return res.status(409).json({
        error: 'Transaction already submitted',
        code: 'REPLAY_DETECTED',
      });
    }

    // =========================================================================
    // 5. Validate transaction
    // =========================================================================
    const validation = validator.validateTransaction(transaction, quote);
    if (!validation.valid) {
      await redis.releaseTransactionSlot(txHash);
      return res.status(400).json({
        error: 'Transaction validation failed',
        code: 'VALIDATION_FAILED',
        details: validation.error,
      });
    }

    // =========================================================================
    // 6. Co-sign: deserialize, add fee payer signature
    // =========================================================================
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([feePayer.getFeePayer()]);
    const serialized = tx.serialize();

    // =========================================================================
    // 7. Submit via Helius — NEVER raw connection.sendTransaction()
    // =========================================================================
    const result = await helius.sendAndConfirmTransaction(serialized, {
      skipPreflight: true,
    });

    // =========================================================================
    // 8. Record velocity + stats
    // =========================================================================
    await redis.recordTransactionVelocity(quote.feeAmountLamports);
    await redis.incrTxCount();

    logger.info('SUBMIT', 'Transaction submitted', {
      quoteId,
      signature: result.signature,
      userPubkey: quote.userPubkey ? quote.userPubkey.slice(0, 8) : 'unknown',
    });

    // =========================================================================
    // 9. Response — ALWAYS orbmarkets.io explorer links
    // =========================================================================
    res.json({
      signature: result.signature,
      explorer: `${EXPLORER_BASE}/tx/${result.signature}`,
      confirmed: true,
    });
  } catch (error) {
    logger.error('SUBMIT', 'Failed to submit transaction', { error: error.message });
    res.status(500).json({
      error: 'Failed to submit transaction',
      code: 'SUBMIT_FAILED',
    });
  }
});

module.exports = router;
