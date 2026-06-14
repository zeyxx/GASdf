const express = require('express');
const { VersionedTransaction } = require('@solana/web3.js');
const config = require('../utils/config');
const logger = require('../utils/logger');
const feePayer = require('../services/fee-payer');
const helius = require('../services/helius');
const { EXPLORER_BASE } = require('../constants');

const router = express.Router();

// POST /v1/submit
router.post('/', async (req, res) => {
  try {
    if (!transaction) {
      return res.status(400).json({
        error: 'Missing required fields: transaction',
        code: 'INVALID_INPUT',
      });
    }

    const txBuffer = Buffer.from(transaction, 'base64');

    // Validation is offloaded to the on-chain Pinocchio program
    // The program will revert if the fee transferred is insufficient.

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

    // CYNIC OBSERVE: Record JSONL logs for the CYNIC kernel
    logger.info('SUBMIT', 'Transaction submitted', {
      signature: result.signature,
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
