const express = require('express');
const fs = require('fs');
const path = require('path');
const { VersionedTransaction } = require('@solana/web3.js');
const config = require('../utils/config');
const logger = require('../utils/logger');
const feePayer = require('../services/fee-payer');
const helius = require('../services/helius');
const { EXPLORER_BASE } = require('../constants');

const router = express.Router();

function ledgerPath() {
  return (
    process.env.GASDF_LEDGER_PATH || path.join(__dirname, '../../data/proofs/submit-ledger.jsonl')
  );
}

/**
 * Append one JSONL proof line per accepted submission.
 * Public data only (signature, network, timestamps) — never secrets.
 */
function appendProof(entry) {
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

// POST /v1/submit
router.post('/', async (req, res) => {
  try {
    const { transaction } = req.body || {};
    if (!transaction || typeof transaction !== 'string') {
      return res.status(400).json({
        error: 'Missing required fields: transaction',
        code: 'INVALID_INPUT',
      });
    }

    let txBuffer;
    try {
      txBuffer = Buffer.from(transaction, 'base64');
      if (txBuffer.length === 0) throw new Error('empty');
    } catch {
      return res.status(400).json({
        error: 'transaction must be non-empty base64',
        code: 'INVALID_BASE64',
      });
    }

    if (feePayer.isCircuitOpen()) {
      return res.status(503).json({
        error: 'Fee-payer circuit breaker is open (balance too low)',
        code: 'CIRCUIT_OPEN',
      });
    }

    let tx;
    try {
      tx = VersionedTransaction.deserialize(txBuffer);
    } catch {
      return res.status(400).json({
        error: 'transaction is not a valid VersionedTransaction',
        code: 'INVALID_TRANSACTION',
      });
    }

    // Validation is offloaded to the on-chain Pinocchio program
    // The program will revert if the fee transferred is insufficient.

    // =========================================================================
    // 5b. Simulate (free): bill on consumed CUs, not declared budget.
    // Recorded per tx — this is the calibration feed.
    // =========================================================================
    let unitsConsumed = null;
    try {
      const sim = await helius.getConnection().simulateTransaction(tx, { sigVerify: false });
      if (sim && sim.value && sim.value.err === null) {
        unitsConsumed = sim.value.unitsConsumed ?? null;
      }
    } catch {
      unitsConsumed = null;
    }

    // =========================================================================
    // 6. Co-sign: deserialize, add fee payer signature
    // =========================================================================
    tx.sign([feePayer.getFeePayer()]);
    const serialized = tx.serialize();

    // =========================================================================
    // 7. Submit via Helius — NEVER raw connection.sendTransaction()
    // =========================================================================
    const result = await helius.sendAndConfirmTransaction(serialized, {
      skipPreflight: true,
    });

    const proof = {
      ts: new Date().toISOString(),
      network: config.NETWORK,
      signature: result.signature,
      explorer: `${EXPLORER_BASE}/tx/${result.signature}`,
      confirmed: true,
      unitsConsumed,
    };
    appendProof(proof);

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
